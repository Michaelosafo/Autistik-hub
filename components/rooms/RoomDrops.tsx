"use client";
import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatUnits, getAddress, http, isAddress, parseUnits } from "viem";
import { pickWallet } from "@/lib/connect";
import { CHAINS, viemChain } from "@/lib/launchpad";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DISPERSE, DISPERSE_ABI, DROP_BATCH, DROP_CHAINS, ERC20_DROP_ABI, type DropChain } from "@/lib/room-drops";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** A listener connects a wallet to receive the host's drops. Only they can see it; the room never shows it. */
export function DropOptIn({ roomId, meId }: { roomId: string; meId: string }) {
  const [addr, setAddr] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabaseBrowser().from("live_room_wallets").select("address").eq("room_id", roomId).eq("user_id", meId).maybeSingle()
      .then(({ data }) => setAddr(data?.address ?? null), () => {});
  }, [roomId, meId]);
  async function connect() {
    setMsg(""); setBusy(true);
    try {
      const eth = await pickWallet();
      if (!eth) return;
      const [a] = await createWalletClient({ transport: custom(eth) }).requestAddresses();
      const address = getAddress(a);
      const { error } = await supabaseBrowser().from("live_room_wallets").upsert({ room_id: roomId, user_id: meId, address }, { onConflict: "room_id,user_id" });
      if (error) throw error;
      setAddr(address);
      setMsg("✅ Connected privately. Only you can see this address.");
    } catch (e: any) {
      setMsg(/reject|denied/i.test(String(e?.message)) ? "You cancelled in your wallet." : "Couldn't connect your wallet. Try again.");
    } finally { setBusy(false); }
  }
  async function remove() {
    await supabaseBrowser().from("live_room_wallets").delete().eq("room_id", roomId).eq("user_id", meId);
    setAddr(null); setMsg("Disconnected. You won't get drops from this room.");
  }
  return (
    <div className="room-drop card stack" style={{ gap: 6 }}>
      <b>🎁 Get the host&apos;s drops</b>
      {addr ? (
        <small>Your wallet {short(addr)} is connected for drops in this room. 🔒 Private: the host and other listeners don&apos;t see it here. <button type="button" className="linkish" onClick={remove}>Disconnect</button></small>
      ) : (
        <>
          <small className="muted">If the host sends tokens to the room, they go to this wallet. Your address stays private in the room. Transfers themselves are public on the blockchain, like any transfer.</small>
          <button type="button" className="btn small primary" disabled={busy} onClick={connect} style={{ alignSelf: "flex-start" }}>{busy ? "…" : "Connect wallet for drops"}</button>
        </>
      )}
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );
}

/** The host sends the same amount of a coin to every listener who connected a wallet. */
export function DropPanel({ roomId, onDropped }: { roomId: string; onDropped: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [net, setNet] = useState<DropChain>("bsc");
  const [kind, setKind] = useState<"native" | "token">("native");
  const [token, setToken] = useState("");
  const [each, setEach] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const c = CHAINS[net];

  const refresh = () => fetch(`/api/rooms/${roomId}/drop?count=1`).then((r) => r.json()).then((j) => setCount(typeof j.count === "number" ? j.count : 0)).catch(() => {});
  useEffect(() => {
    if (!open) return;
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setMsg("");
    if (kind === "token" && !isAddress(token.trim())) { setMsg("Paste the token's contract address."); return; }
    if (!(Number(each) > 0)) { setMsg("Enter how much each listener gets."); return; }
    setBusy(true);
    try {
      const list = await fetch(`/api/rooms/${roomId}/drop`).then((r) => r.json());
      const to: `0x${string}`[] = list?.recipients || [];
      if (!to.length) { setMsg("No listener has connected a wallet yet. Ask them to press “Connect wallet for drops”."); return; }
      const eth = await pickWallet();
      if (!eth) return;
      const chain = viemChain(c);
      const wallet = createWalletClient({ chain, transport: custom(eth) });
      const pub = createPublicClient({ chain, transport: http(c.rpc) }) as any;
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: c.chainId }); } catch { await wallet.addChain({ chain }); await wallet.switchChain({ id: c.chainId }); }
      const tokenAddr = kind === "token" ? getAddress(token.trim()) : null;
      const [decimals, symbol] = tokenAddr
        ? await Promise.all([pub.readContract({ address: tokenAddr, abi: ERC20_DROP_ABI, functionName: "decimals" }), pub.readContract({ address: tokenAddr, abi: ERC20_DROP_ABI, functionName: "symbol" }).catch(() => "tokens")])
        : [18, c.coin];
      const per = parseUnits(each, Number(decimals));
      const total = per * BigInt(to.length);
      const bal: bigint = tokenAddr ? await pub.readContract({ address: tokenAddr, abi: ERC20_DROP_ABI, functionName: "balanceOf", args: [account] }) : await pub.getBalance({ address: account });
      if (bal < total) { setMsg(`You need ${formatUnits(total, Number(decimals))} ${symbol} for ${to.length} listeners and have ${formatUnits(bal, Number(decimals))}.`); return; }
      if (tokenAddr) {
        const allowed: bigint = await pub.readContract({ address: tokenAddr, abi: ERC20_DROP_ABI, functionName: "allowance", args: [account, DISPERSE] });
        if (allowed < total) {
          setMsg(`Confirm in your wallet: allow the drop to send ${formatUnits(total, Number(decimals))} ${symbol}…`);
          await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ account, chain, address: tokenAddr, abi: ERC20_DROP_ABI, functionName: "approve", args: [DISPERSE, total] } as any) });
        }
      }
      let sent = 0;
      const batches = Math.ceil(to.length / DROP_BATCH);
      for (let i = 0; i < to.length; i += DROP_BATCH) {
        const part = to.slice(i, i + DROP_BATCH);
        const values = part.map(() => per);
        setMsg(`Confirm in your wallet: send to ${part.length} listeners${batches > 1 ? ` (batch ${i / DROP_BATCH + 1} of ${batches})` : ""}…`);
        const hash = tokenAddr
          ? await wallet.writeContract({ account, chain, address: DISPERSE, abi: DISPERSE_ABI, functionName: "disperseToken", args: [tokenAddr, part, values] } as any)
          : await wallet.writeContract({ account, chain, address: DISPERSE, abi: DISPERSE_ABI, functionName: "disperseEther", args: [part, values], value: per * BigInt(part.length) } as any);
        const r = await pub.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error("A drop transaction failed.");
        sent += part.length;
        await fetch(`/api/rooms/${roomId}/drop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: net, token: tokenAddr ?? "native", symbol, total: formatUnits(per * BigInt(part.length), Number(decimals)), recipients: part.length, txHash: hash }) }).catch(() => {});
      }
      const text = `🎁 The host dropped ${each} ${symbol} to each of ${sent} listeners on ${c.name}!`;
      onDropped(text);
      setMsg(`✅ Sent ${each} ${symbol} to ${sent} listeners.`);
    } catch (e: any) {
      const r = String(e?.shortMessage || e?.message || "");
      setMsg(/reject|denied/i.test(r) ? "You cancelled in your wallet." : /insufficient funds/i.test(r) ? `Not enough ${c.coin} for the drop and the network fee.` : r.slice(0, 160) || "The drop didn't go through.");
    } finally { setBusy(false); }
  }

  if (!open) return <button type="button" className="room-btn" onClick={() => setOpen(true)}>🎁 Drop tokens</button>;
  return (
    <div className="room-drop card stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <b>🎁 Drop tokens to your listeners</b>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>Close</button>
      </div>
      <small className="muted"><b>{count === null ? "…" : count}</b> {count === 1 ? "listener has" : "listeners have"} connected a wallet. 🔒 Their addresses stay private: you only see the count.</small>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Network">
        {DROP_CHAINS.map((k) => <button key={k} type="button" role="radio" aria-checked={net === k} className={"btn small" + (net === k ? " primary" : "")} onClick={() => setNet(k)}>{CHAINS[k].name}</button>)}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="What to send">
        <button type="button" role="radio" aria-checked={kind === "native"} className={"btn small" + (kind === "native" ? " primary" : "")} onClick={() => setKind("native")}>{c.coin}</button>
        <button type="button" role="radio" aria-checked={kind === "token"} className={"btn small" + (kind === "token" ? " primary" : "")} onClick={() => setKind("token")}>A token</button>
      </div>
      {kind === "token" && <input value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="0x… token address" spellCheck={false} aria-label="Token address" />}
      <label className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <small>Each listener gets</small>
        <input value={each} inputMode="decimal" style={{ width: 140 }} onChange={(e) => setEach(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 1000" aria-label="Amount per listener" />
        <small className="muted">{kind === "native" ? c.coin : "tokens"}{count && Number(each) > 0 ? ` · ${(Number(each) * count).toLocaleString("en-US")} in total` : ""}</small>
      </label>
      <button type="button" className="btn primary" disabled={busy || !count} onClick={send}>{busy ? "Sending…" : `Send to ${count ?? 0} listeners`}</button>
      <small className="muted">Sent from your own wallet in one transaction per {DROP_BATCH} listeners, through Disperse (an open, widely used contract). You pay the network fee.</small>
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );
}
