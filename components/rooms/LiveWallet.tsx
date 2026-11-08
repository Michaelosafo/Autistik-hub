"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, encodeFunctionData, formatUnits, getAddress, http, isAddress, parseUnits } from "viem";
import Avatar from "@/components/Avatar";
import SignerScope from "@/components/wallet/SignerScope";
import type { Member, Signer } from "@/components/wallet/types";
import { amt, api, Logo, short, store, usd, type Holding, type TokenInfo } from "@/components/wallet/util";
import { WCHAINS, isNative, type WChainKey, type WToken } from "@/lib/wallet-chains";
import { DISPERSE, DISPERSE_ABI, DROP_BATCH, ERC20_DROP_ABI } from "@/lib/room-drops";

/** The networks a live can send on (everyone in a live has an address on these). */
const SEND: WChainKey[] = ["bsc", "base", "ethereum", "arbitrum"];
const COLOR: Record<WChainKey, string> = { bsc: "#F0B90B", base: "#0052FF", ethereum: "#627EEA", arbitrum: "#28A0F0", solana: "#9945FF" };
type Row = Holding & { chain: WChainKey };
export type LivePerson = { id: string; alias: string; color: string | null; avatar_url: string | null };
type To = "all" | string;

/**
 * Your wallet inside the live: every token you hold on every network, with its network, and a Send button.
 * Send to one person in the room (or tap their picture), or, for the host and co-hosts, to everyone here at once.
 * It goes straight from your wallet (you approve it there); the room never shows anyone's address.
 */
export default function LiveWallet({ roomId, address, sol, canAll, people, target, onTargetDone, onSent, appId, member }: {
  roomId: string; address: string | null; sol: string | null; canAll: boolean; people: LivePerson[];
  target: { id: string; alias: string } | null; onTargetDone: () => void; onSent: (text: string) => void;
  appId: string | null; member: Member | null;
}) {
  const [bal, setBal] = useState<Partial<Record<WChainKey, Holding[] | "error">>>({});
  const [only, setOnly] = useState<WChainKey | null>(null);
  const [open, setOpen] = useState(true);
  const [send, setSend] = useState<{ chain: WChainKey; token: string | null; to: To | null } | null>(null);
  const chains: WChainKey[] = [...SEND, ...(sol ? (["solana"] as WChainKey[]) : [])];

  const load = useCallback(() => {
    for (const k of chains) {
      const owner = k === "solana" ? sol : address;
      if (!owner) continue;
      api<{ holdings: Holding[] }>("balances", { chain: k, owner, extra: store.get<WToken[]>(`aw-tokens-${k}`, []).map((t) => t.address) })
        .then((d) => setBal((b) => ({ ...b, [k]: d.holdings })))
        .catch(() => setBal((b) => ({ ...b, [k]: "error" })));
    }
  }, [address, sol]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  // Tapped someone's picture → Send tokens: open the send sheet for them.
  useEffect(() => {
    if (!target) return;
    setSend({ chain: send?.chain || "bsc", token: null, to: target.id });
  }, [target?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows: Row[] = useMemo(() => chains.flatMap((k) => {
    const h = bal[k];
    return Array.isArray(h) ? h.filter((x) => x.amount > 0).map((x) => ({ ...x, chain: k })) : [];
  }).sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0)), [bal, sol]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = only ? rows.filter((r) => r.chain === only) : rows;
  const loaded = chains.every((k) => bal[k] || (k === "solana" ? !sol : !address));
  const total = rows.reduce((s, r) => s + (r.valueUsd || 0), 0);
  const chainTotal = (k: WChainKey) => rows.filter((r) => r.chain === k).reduce((s, r) => s + (r.valueUsd || 0), 0);

  if (!address && !sol) return null;
  return (
    <section className="lw" aria-label="Your wallet">
      <button type="button" className="lw-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span><b>💼 Your wallet</b><small className="muted">{address ? ` · ${short(address)}` : ""} · only you see this</small></span>
        <span className="lw-total">{loaded ? usd(total) : "…"} <i aria-hidden="true">{open ? "▾" : "▸"}</i></span>
      </button>
      {open && (
        <>
          <div className="lw-nets" role="tablist" aria-label="Networks">
            <button type="button" role="tab" aria-selected={!only} className={!only ? "on" : ""} onClick={() => setOnly(null)}>All</button>
            {chains.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={only === k} className={only === k ? "on" : ""} style={{ ["--net" as any]: COLOR[k] }} onClick={() => setOnly(only === k ? null : k)}>
                <i className="lw-dot" />{WCHAINS[k].short}<small>{bal[k] === "error" ? "–" : bal[k] ? usd(chainTotal(k)) : "…"}</small>
              </button>
            ))}
          </div>
          <div className="lw-list">
            {!loaded && !rows.length && <small className="muted">Loading your tokens on every network…</small>}
            {loaded && !shown.length && <small className="muted">{only ? `No tokens on ${WCHAINS[only].name}.` : "No tokens yet."} <a href="/wallet" target="_blank" rel="noopener">Add money in your wallet</a>.</small>}
            {shown.map((r) => (
              <div key={r.chain + r.address} className="lw-row">
                <span className="lw-logo"><Logo t={r} size={34} /><i style={{ background: COLOR[r.chain] }} title={WCHAINS[r.chain].name} /></span>
                <span className="grow"><b>{r.symbol}</b><small>{WCHAINS[r.chain].name}{r.priceUsd ? ` · ${usd(r.priceUsd)}` : ""}</small></span>
                <span className="lw-num"><b>{usd(r.valueUsd)}</b><small>{amt(r.amount)} {r.symbol}</small></span>
                {r.chain !== "solana"
                  ? <button type="button" className="btn small primary" onClick={() => setSend({ chain: r.chain, token: r.address, to: null })}>Send</button>
                  : <small className="muted lw-nosend" title="Members' Solana addresses aren't linked to lives yet">View</small>}
              </div>
            ))}
          </div>
          <div className="lw-foot">
            <button type="button" className="btn small" onClick={() => setSend({ chain: only && only !== "solana" ? only : "bsc", token: null, to: canAll ? "all" : null })}>🎁 {canAll ? "Send to everyone or one person" : "Send tokens to someone"}</button>
            <button type="button" className="aw-link" onClick={load}>Refresh</button>
          </div>
        </>
      )}
      {send && (
        <SendSheet roomId={roomId} rows={rows} bal={bal} initial={send} canAll={canAll} people={people} appId={appId} member={member} linked={address}
          onClose={() => { setSend(null); onTargetDone(); }} onSent={(t) => { onSent(t); setTimeout(load, 4000); }} />
      )}
    </section>
  );
}

function SendSheet({ roomId, rows, bal, initial, canAll, people, appId, member, linked, onClose, onSent }: {
  roomId: string; rows: Row[]; bal: Partial<Record<WChainKey, Holding[] | "error">>; initial: { chain: WChainKey; token: string | null; to: To | null };
  canAll: boolean; people: LivePerson[]; appId: string | null; member: Member | null; linked: string | null; onClose: () => void; onSent: (t: string) => void;
}) {
  const [chain, setChain] = useState<WChainKey>(initial.chain === "solana" ? "bsc" : initial.chain);
  const c = WCHAINS[chain];
  const mine = rows.filter((r) => r.chain === chain);
  const [token, setToken] = useState<string>(initial.token || mine[0]?.address || c.native.address);
  const [extra, setExtra] = useState<WToken | null>(null);
  const [paste, setPaste] = useState("");
  const [to, setTo] = useState<To | null>(initial.to);
  const [each, setEach] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  // The tokens to pick from on this network: what you hold, plus the network's own coin.
  const choices: WToken[] = useMemo(() => {
    const m = new Map<string, WToken>();
    for (const t of [...mine, c.native, ...(extra ? [extra] : [])]) if (!m.has(t.address.toLowerCase())) m.set(t.address.toLowerCase(), t);
    return [...m.values()];
  }, [mine, c, extra]);
  const tok = choices.find((t) => t.address.toLowerCase() === token.toLowerCase()) || c.native;
  const have = (Array.isArray(bal[chain]) ? (bal[chain] as Holding[]) : []).find((h) => h.address.toLowerCase() === tok.address.toLowerCase());
  const n = to === "all" ? count ?? 0 : to ? 1 : 0;

  useEffect(() => {
    if (to !== "all") { setCount(null); return; }
    fetch(`/api/rooms/${roomId}/drop?count=1`).then((r) => r.json()).then((j) => setCount(typeof j.count === "number" ? j.count : 0)).catch(() => setCount(0));
  }, [to, roomId]);
  useEffect(() => { if (!choices.some((t) => t.address.toLowerCase() === token.toLowerCase())) setToken(mine[0]?.address || c.native.address); }, [chain]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [busy, onClose]);

  async function addPasted() {
    const a = paste.trim();
    if (!isAddress(a)) { setMsg("Paste a token contract address (0x…)."); return; }
    setMsg("Looking up that token…");
    try { const d = await api<{ token: TokenInfo }>("token", { chain, address: a }); setExtra(d.token); setToken(d.token.address); setPaste(""); setMsg(""); }
    catch (e: any) { setMsg(e.message || "Couldn't find that token on this network."); }
  }

  async function go(signer: Signer) {
    setMsg(""); setDone("");
    if (!signer.evm) { setMsg("Unlock or connect your wallet first."); return; }
    if (!to) { setMsg("Choose who gets it."); return; }
    if (!(Number(each) > 0)) { setMsg("Enter an amount."); return; }
    setBusy(true);
    try {
      const list = await fetch(`/api/rooms/${roomId}/drop${to === "all" ? "" : `?user=${to}`}`).then((r) => r.json());
      const rcpt: `0x${string}`[] = (list?.recipients || []).filter((a: string) => isAddress(a) && getAddress(a) !== getAddress(signer.evm!.address));
      if (!rcpt.length) { setMsg(list?.error || "Nobody here has a wallet linked yet."); return; }
      const account = signer.evm.address;
      const pub = createPublicClient({ chain: c.viem, transport: http(c.rpc) }) as any;
      const native = isNative(c, tok.address);
      const per = parseUnits(each, tok.decimals);
      const total = per * BigInt(rcpt.length);
      const balance: bigint = native ? await pub.getBalance({ address: account }) : await pub.readContract({ address: tok.address, abi: ERC20_DROP_ABI, functionName: "balanceOf", args: [account] });
      if (balance < total) { setMsg(`You need ${formatUnits(total, tok.decimals)} ${tok.symbol}${rcpt.length > 1 ? ` for ${rcpt.length} people` : ""} and have ${formatUnits(balance, tok.decimals)} on ${c.name}.`); return; }
      if (!native) {
        const allowed: bigint = await pub.readContract({ address: tok.address, abi: ERC20_DROP_ABI, functionName: "allowance", args: [account, DISPERSE] });
        if (allowed < total) {
          setMsg(`Approve in your wallet: let the send move ${formatUnits(total, tok.decimals)} ${tok.symbol}…`);
          const h = await signer.evm.send(c.chainId!, { to: tok.address as `0x${string}`, data: encodeFunctionData({ abi: ERC20_DROP_ABI, functionName: "approve", args: [DISPERSE, total] }), value: "0" });
          const r = await pub.waitForTransactionReceipt({ hash: h });
          if (r.status !== "success") throw new Error("The approval didn't go through.");
        }
      }
      let sent = 0;
      const batches = Math.ceil(rcpt.length / DROP_BATCH);
      for (let i = 0; i < rcpt.length; i += DROP_BATCH) {
        const part = rcpt.slice(i, i + DROP_BATCH);
        const values = part.map(() => per);
        setMsg(`Approve in your wallet: send ${each} ${tok.symbol}${part.length > 1 ? ` to ${part.length} people` : ""}${batches > 1 ? ` (part ${i / DROP_BATCH + 1} of ${batches})` : ""}…`);
        const data = native
          ? encodeFunctionData({ abi: DISPERSE_ABI, functionName: "disperseEther", args: [part, values] })
          : encodeFunctionData({ abi: DISPERSE_ABI, functionName: "disperseToken", args: [tok.address as `0x${string}`, part, values] });
        const hash = await signer.evm.send(c.chainId!, { to: DISPERSE, data, value: native ? (per * BigInt(part.length)).toString() : "0" });
        setMsg("Sending…");
        const r = await pub.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error("The transaction failed.");
        sent += part.length;
        fetch(`/api/rooms/${roomId}/drop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, token: native ? "native" : tok.address, symbol: tok.symbol, total: formatUnits(per * BigInt(part.length), tok.decimals), recipients: part.length, txHash: hash }) }).catch(() => {});
      }
      const who = to === "all" ? null : people.find((p) => p.id === to)?.alias || "them";
      onSent(who ? `🎁 ${who} just got ${each} ${tok.symbol} on ${c.name}!` : `🎁 ${each} ${tok.symbol} dropped to each of ${sent} people on ${c.name}!`);
      setDone(who ? `✅ Sent ${each} ${tok.symbol} to ${who}.` : `✅ Sent ${each} ${tok.symbol} to ${sent} people.`);
      setMsg(""); setEach("");
    } catch (e: any) {
      const r = String(e?.shortMessage || e?.message || "");
      setMsg(/reject|denied|cancel/i.test(r) ? "You cancelled in your wallet." : /insufficient funds/i.test(r) ? `Not enough ${c.native.symbol} for the network fee.` : r.slice(0, 160) || "That didn't go through.");
    } finally { setBusy(false); }
  }

  return (
    <div className="lv-sheet-wrap" role="presentation" onClick={() => !busy && onClose()}>
      <section className="lv-sheet lw-send" role="dialog" aria-modal="true" aria-label="Send tokens" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lv-x" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        <b className="lv-sheet-name">🎁 Send tokens</b>

        <small className="muted">Network</small>
        <div className="lw-nets" role="radiogroup" aria-label="Network">
          {SEND.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={chain === k} className={chain === k ? "on" : ""} style={{ ["--net" as any]: COLOR[k] }} disabled={busy} onClick={() => setChain(k)}>
              <i className="lw-dot" />{WCHAINS[k].name}
            </button>
          ))}
        </div>

        <small className="muted">Token</small>
        <div className="lw-toks" role="radiogroup" aria-label="Token">
          {choices.map((t) => {
            const h = (Array.isArray(bal[chain]) ? (bal[chain] as Holding[]) : []).find((x) => x.address.toLowerCase() === t.address.toLowerCase());
            return (
              <button key={t.address} type="button" role="radio" aria-checked={tok.address === t.address} className={"lw-tok" + (tok.address === t.address ? " on" : "")} disabled={busy} onClick={() => setToken(t.address)}>
                <Logo t={t} size={22} /><b>{t.symbol}</b><small>{h ? amt(h.amount) : "0"}</small>
              </button>
            );
          })}
        </div>
        <div className="lw-paste">
          <input value={paste} onChange={(e) => setPaste(e.target.value.trim())} placeholder="Another token? Paste its 0x… address" spellCheck={false} aria-label="Token address" disabled={busy} />
          <button type="button" className="btn small" onClick={addPasted} disabled={busy || !paste}>Add</button>
        </div>

        <small className="muted">To</small>
        <div className="lw-to" role="radiogroup" aria-label="Who gets it">
          {canAll && <button type="button" role="radio" aria-checked={to === "all"} className={"lw-who" + (to === "all" ? " on" : "")} disabled={busy} onClick={() => setTo("all")}>👥 Everyone here{to === "all" && count !== null ? ` (${count})` : ""}</button>}
          {people.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={to === p.id} className={"lw-who" + (to === p.id ? " on" : "")} disabled={busy} onClick={() => setTo(p.id)}>
              <Avatar className="avatar lv-av xs" alias={p.alias} color={p.color} url={p.avatar_url} /> {p.alias}
            </button>
          ))}
          {!people.length && !canAll && <small className="muted">Nobody else is in the room yet.</small>}
        </div>

        <label className="lw-amt">
          <small className="muted">{to === "all" ? "Each person gets" : "Amount"}</small>
          <span className="row" style={{ gap: 6 }}>
            <input value={each} inputMode="decimal" onChange={(e) => setEach(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" aria-label="Amount" disabled={busy} />
            <b>{tok.symbol}</b>
            {have && n === 1 && <button type="button" className="btn small" disabled={busy} onClick={() => setEach(isNative(c, tok.address) ? String(Math.max(0, have.amount * 0.98)) : formatUnits(BigInt(have.raw), tok.decimals))}>Max</button>}
          </span>
          <small className="muted">You have {have ? amt(have.amount) : "0"} {tok.symbol} on {c.name}{n > 1 && Number(each) > 0 ? ` · ${(Number(each) * n).toLocaleString("en-US")} ${tok.symbol} in total` : ""}. You pay the {c.native.symbol} network fee.</small>
        </label>

        <SignerScope appId={appId} member={member}>
          {(signer) => !signer.ready ? <small className="muted">Loading your wallet…</small> : !signer.evm ? (
            <div className="stack" style={{ gap: 6 }}>
              <small className="muted">Approve sends with your wallet:</small>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {signer.loginEmbedded && <button type="button" className="btn primary" onClick={signer.loginEmbedded}>🔓 Unlock my AUTISTIK wallet</button>}
                <button type="button" className={"btn" + (signer.loginEmbedded ? "" : " primary")} onClick={() => (signer.loginExternal || signer.login)()}>🔗 Connect my wallet</button>
              </div>
            </div>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {linked && getAddress(signer.evm.address) !== getAddress(linked) && <small className="muted">Sending from {short(signer.evm.address)} (the wallet you have open), not {short(linked)}.</small>}
              <button type="button" className="btn primary" disabled={busy || !to || !(Number(each) > 0) || (to === "all" && !count)} onClick={() => go(signer)}>
                {busy ? "Sending…" : `Send ${each || "0"} ${tok.symbol}${to === "all" ? ` to ${count ?? 0} people` : to ? ` to ${people.find((p) => p.id === to)?.alias || "them"}` : ""}`}
              </button>
            </div>
          )}
        </SignerScope>
        {msg && <small className="muted" role="status">{msg}</small>}
        {done && <small className="lw-done" role="status">{done}</small>}
        <small className="muted">🔒 Nobody in the room sees addresses. Transfers are public on the blockchain, like any transfer.</small>
      </section>
    </div>
  );
}
