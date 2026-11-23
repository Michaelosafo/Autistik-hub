"use client";

/**
 * Signal (owner only): swap or bridge any token through Bitget Wallet's swap service, from whichever wallet is
 * connected, with the coins sent to the address you choose (your connected wallet by default).
 *
 * The page asks /api/signal for routes and the order; your wallet signs and sends it here in the browser. On EVM
 * chains the order goes to Bitget Wallet's swap contract (an approval first when you pay with a token, not the
 * chain's own coin); on Solana your wallet signs Bitget's transaction and the Hub's node sends it.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getState, subscribe, pickWallet, setNetwork, switchEvm } from "@/lib/connect";
import { signAndSend } from "@/lib/sol-wallet";

type ChainKey = "bnb" | "eth" | "base" | "arbitrum" | "matic" | "sol";
const CH: Record<ChainKey, { name: string; id: number; native: string; scan: string }> = {
  bnb: { name: "BNB Chain", id: 56, native: "BNB", scan: "https://bscscan.com/tx/" },
  eth: { name: "Ethereum", id: 1, native: "ETH", scan: "https://etherscan.io/tx/" },
  base: { name: "Base", id: 8453, native: "ETH", scan: "https://basescan.org/tx/" },
  arbitrum: { name: "Arbitrum", id: 42161, native: "ETH", scan: "https://arbiscan.io/tx/" },
  matic: { name: "Polygon", id: 137, native: "POL", scan: "https://polygonscan.com/tx/" },
  sol: { name: "Solana", id: 0, native: "SOL", scan: "https://solscan.io/tx/" },
};
type Tok = { chain: ChainKey; contract: string; symbol: string; name?: string; icon?: string };
type Exec = { kind: "evm"; chainId: number; tx: { to: string; data: string; value: string; gas?: string }; spender?: string } | { kind: "sol"; txB64: string };
type Route = { market?: string; protocol?: string; label: string; out: string; min: string; gasUsd: number | null; slip?: string | null; router?: "lifi" | "okx"; exec?: Exec; track?: { fromChain: string; toChain: string } };
type RouterKey = "bitget" | "lifi" | "okx";
const ROUTERS: { key: RouterKey; name: string; note: string }[] = [
  { key: "bitget", name: "Bitget Wallet", note: "Swaps and bridges" },
  { key: "lifi", name: "LI.FI", note: "Swaps and bridges, many bridges" },
  { key: "okx", name: "OKX DEX", note: "Swaps on one network" },
];
const native = (c: ChainKey): Tok => ({ chain: c, contract: "", symbol: CH[c].native, name: CH[c].native });
const USDT_AT: Record<ChainKey, string> = {
  bnb: "0x55d398326f99059fF775485246999027B3197955", eth: "0xdAC17F958D2ee523a2206206994597C13D831ec7", base: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  arbitrum: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", matic: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", sol: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
};
const usdt = (c: ChainKey): Tok => ({ chain: c, contract: USDT_AT[c], symbol: "USDT", name: "Tether USD" });
type Bal = { chain: ChainKey; symbol: string; contract: string; amount: string };
const fmtAmt = (v: string) => Number(v).toLocaleString(undefined, { maximumFractionDigits: Number(v) >= 1 ? 4 : 8 });

async function api<T = any>(action: string, body: object): Promise<T> {
  const r = await fetch("/api/signal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

// ---------------------------------------------------------------- small helpers
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58bytes(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error("Bad transaction from Bitget Wallet"); n = n * 58n + BigInt(i); }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}
const b64 = (u: Uint8Array) => { let s = ""; u.forEach((x) => (s += String.fromCharCode(x))); return btoa(s); };
const hex = (v: bigint) => "0x" + v.toString(16);
const toWei = (v: unknown) => { const s = String(v ?? "0"); if (s.startsWith("0x")) return BigInt(s); if (!s.includes(".")) return BigInt(s || "0"); return BigInt(Math.round(Number(s) * 1e18)); };
const toInt = (v: unknown) => { const s = String(v ?? "0"); return s.startsWith("0x") ? BigInt(s) : BigInt(Math.floor(Number(s) || 0)); };
function rawAmount(human: string, dec: number): bigint {
  const [i, f = ""] = human.trim().split(".");
  return BigInt(i || "0") * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0");
}
const pad = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitReceipt(p: any, hash: string) {
  for (let i = 0; i < 90; i++) {
    const r = await p.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null);
    if (r) { if (r.status === "0x0") throw new Error("That transaction failed on chain."); return; }
    await sleep(2000);
  }
  throw new Error("The network is slow; check your wallet before trying again.");
}

// ---------------------------------------------------------------- token picker
function TokenPick({ label, chain, tok, onChain, onTok }: { label: string; chain: ChainKey; tok: Tok; onChain: (c: ChainKey) => void; onTok: (t: Tok) => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Tok[]>([]);
  useEffect(() => {
    const k = q.trim();
    if (!k) { setList([]); return; }
    const t = setTimeout(() => { api<{ list: Tok[] }>("search", { keyword: k, chain }).then((d) => setList(d.list)).catch(() => setList([])); }, 350);
    return () => clearTimeout(t);
  }, [q, chain]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <b>{label}</b>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <select value={chain} onChange={(e) => onChain(e.target.value as ChainKey)} aria-label={`${label} network`}>
          {(Object.keys(CH) as ChainKey[]).map((c) => <option key={c} value={c}>{CH[c].name}</option>)}
        </select>
        <span className="btn small" aria-live="polite">{tok.symbol}{tok.contract ? ` · ${short(tok.contract)}` : ""}</span>
        {tok.contract && <button className="btn small" onClick={() => onTok(native(chain))}>Use {CH[chain].native}</button>}
        {tok.contract.toLowerCase() !== USDT_AT[chain].toLowerCase() && <button className="btn small" onClick={() => onTok(usdt(chain))}>Use USDT</button>}
      </div>
      <input placeholder="Search a token or paste its address" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length > 0 && (
        <div className="stack" style={{ gap: 4, maxHeight: 220, overflowY: "auto" }}>
          {list.map((t) => (
            <button key={t.chain + t.contract} className="btn small" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => { onTok(t); setQ(""); setList([]); }}>
              {t.icon ? <img src={t.icon} alt="" width={18} height={18} style={{ borderRadius: 9, marginRight: 6 }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} /> : null}
              {t.symbol} <span className="muted" style={{ marginLeft: 6 }}>{t.name} · {short(t.contract || "native")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function Signal() {
  const conn = useSyncExternalStore(subscribe, getState, getState);
  const [evmAddr, setEvmAddr] = useState("");
  const solAddr = conn.sol?.account?.address || "";
  useEffect(() => {
    const p = conn.current?.provider;
    if (!p) { setEvmAddr(""); return; }
    p.request({ method: "eth_accounts" }).then((a: string[]) => setEvmAddr(a?.[0] || "")).catch(() => setEvmAddr(""));
  }, [conn.current]);

  const [fromChain, setFromChain] = useState<ChainKey>("bnb");
  const [toChain, setToChain] = useState<ChainKey>("bnb");
  const [fromTok, setFromTok] = useState<Tok>(native("bnb"));
  const [toTok, setToTok] = useState<Tok | null>(null);
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState("1");
  const [receive, setReceive] = useState("");
  const [receiveTouched, setReceiveTouched] = useState(false);
  const [router, setRouter] = useState<RouterKey>(() => { try { const v = localStorage.getItem("signal-router"); return v === "lifi" || v === "okx" ? v : "bitget"; } catch { return "bitget"; } });
  const [okxOn, setOkxOn] = useState(false);
  useEffect(() => { api<{ okx: boolean }>("routers", {}).then((d) => setOkxOn(d.okx)).catch(() => {}); }, []);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string; links?: { label: string; href: string }[] } | null>(null);

  const fromAddr = fromChain === "sol" ? solAddr : evmAddr;
  // Your funds: the chain's own coin and USDT on every network, read as soon as a wallet is connected.
  const [bals, setBals] = useState<Bal[] | null>(null);
  const [balKey, setBalKey] = useState(0);
  const [picked, setPicked] = useState<Bal | null>(null);
  useEffect(() => {
    if (!evmAddr && !solAddr) { setBals(null); return; }
    let on = true; setBals(null);
    api<{ list: Bal[] }>("balances", { evm: evmAddr, sol: solAddr }).then((d) => { if (on) setBals(d.list); }).catch(() => { if (on) setBals([]); });
    return () => { on = false; };
  }, [evmAddr, solAddr, balKey]);
  function pickFunds(b: Bal) {
    setPicked(b); setMsg(null);
    setFromChain(b.chain); setFromTok(b.contract ? (b.symbol === "USDT" ? usdt(b.chain) : { chain: b.chain, contract: b.contract, symbol: b.symbol }) : native(b.chain));
    setAmount(b.contract ? b.amount : "");
    if (router === "okx") setRouter("bitget");
    setToTok(null);
  }
  function bridgeTo(c: ChainKey) { setToChain(c); setToTok(usdt(c)); }
  const defReceive = toChain === "sol" ? solAddr : evmAddr;
  useEffect(() => { if (!receiveTouched) setReceive(defReceive); }, [defReceive, receiveTouched]);
  useEffect(() => { setRoutes([]); }, [fromChain, toChain, fromTok, toTok, amount, receive, router]);

  const fields = useMemo(() => toTok && ({
    fromChain, fromSymbol: fromTok.symbol, fromContract: fromTok.contract, fromAmount: amount, fromAddress: fromAddr,
    toChain, toSymbol: toTok.symbol, toContract: toTok.contract, toAddress: receive.trim(),
  }), [fromChain, fromTok, amount, fromAddr, toChain, toTok, receive]);

  // Connect, or switch to another wallet: always opens a fresh wallet list (replacing whatever is connected) on the
  // network you're paying from, the same way LobbySol connects Bitget and other wallets.
  const NETKEY: Record<ChainKey, string> = { bnb: "bsc", eth: "ethereum", base: "base", arbitrum: "arbitrum", matic: "polygon", sol: "solana" };
  async function connectFrom() {
    setMsg(null);
    try { setNetwork(NETKEY[fromChain]).catch(() => {}); await pickWallet({ fresh: true }); }
    catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
  }

  async function getQuote() {
    if (!fields) return setMsg({ kind: "err", text: "Pick the token you want to receive." });
    setBusy(`Getting routes from ${ROUTERS.find((x) => x.key === router)!.name}…`); setMsg(null);
    try {
      const d = await api<{ routes: Route[] }>("quote", { ...fields, router, slippage: slip });
      setRoutes(d.routes); setPick(0);
      if (!d.routes.length) setMsg({ kind: "err", text: "No route for this right now. Try another amount, token or router." });
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy("");
  }

  async function go() {
    const r = routes[pick];
    if (!fields || !r) return;
    setMsg(null);
    try {
      if (r.exec) { await goDirect(r); return; }
      setBusy("Building the order…");
      const o = await api<{ orderId: string; txs: any[] }>("order", { ...fields, market: r.market, protocol: r.protocol, slippage: r.slip || slip, lastOut: r.out });
      if (!o.txs.length) throw new Error("Bitget Wallet's order had nothing to sign. Get a new quote.");
      const sent: string[] = [];
      if (fromChain === "sol") {
        if (!conn.sol) throw new Error("Connect a Solana wallet first.");
        for (const t of o.txs) {
          const st = t.serializedTx || t.data?.serializedTx || t.data?.data?.serializedTx || t.deriveTransaction?.serializedTx;
          if (!st) throw new Error("Bitget Wallet's Solana order had no transaction.");
          setBusy("Approve it in your wallet…");
          sent.push(await signAndSend({ wallet: conn.sol.wallet, account: conn.sol.account }, b64(b58bytes(st))));
        }
      } else {
        const p = conn.current?.provider;
        if (!p || !evmAddr) throw new Error("Connect a wallet first.");
        setBusy(`Switching your wallet to ${CH[fromChain].name}…`);
        await switchEvm(p, CH[fromChain].id);
        let approved = !fromTok.contract;
        for (const t of o.txs) {
          const d = t.deriveTransaction || (typeof t.data === "object" && t.data ? t.data : {});
          if (Number(t.chainId || d.chainId || CH[fromChain].id) !== CH[fromChain].id) throw new Error("Bitget Wallet's order was for another network.");
          const to = String(t.to || d.to || ""), data = String(typeof t.data === "string" ? t.data : d.calldata || d.data || "0x");
          if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error("Bitget Wallet's order looked wrong.");
          if (!approved) {
            // Paying with a token: let the swap contract spend it first (only if it can't already).
            const decHex = await p.request({ method: "eth_call", params: [{ to: fromTok.contract, data: "0x313ce567" }, "latest"] }).catch(() => "0x12");
            const need = rawAmount(amount, Number(BigInt(decHex || "0x12")));
            const allowHex = await p.request({ method: "eth_call", params: [{ to: fromTok.contract, data: "0xdd62ed3e" + pad(evmAddr) + pad(to) }, "latest"] }).catch(() => "0x0");
            if (BigInt(allowHex || "0x0") < need) {
              setBusy(`Approve ${fromTok.symbol} in your wallet (one time)…`);
              const ah = await p.request({ method: "eth_sendTransaction", params: [{ from: evmAddr, to: fromTok.contract, data: "0x095ea7b3" + pad(to) + "f".repeat(64), value: "0x0" }] });
              setBusy("Waiting for the approval…");
              await waitReceipt(p, ah);
            }
            approved = true;
          }
          setBusy("Approve the swap in your wallet…");
          const gas = toInt(d.gasLimit ?? t.gasLimit);
          const h = await p.request({ method: "eth_sendTransaction", params: [{ from: evmAddr, to, data, value: hex(toWei(d.value ?? t.value)), ...(gas > 0n ? { gas: hex(gas) } : {}) }] });
          sent.push(h);
          setBusy("Waiting for the network…");
          await waitReceipt(p, h);
        }
      }
      const links = sent.map((h, i) => ({ label: sent.length > 1 ? `Transaction ${i + 1}` : "Transaction", href: CH[fromChain].scan + h }));
      if (fromChain !== toChain) {
        setMsg({ kind: "info", text: `Sent. The bridge to ${CH[toChain].name} usually takes a few minutes; the coins arrive at ${short(fields.toAddress)}.`, links });
        for (let i = 0; i < 40; i++) {
          await sleep(6000);
          const s = await api<{ status: string; toTx: string | null }>("status", { orderId: o.orderId }).catch(() => null);
          if (s?.status === "success") { setMsg({ kind: "ok", text: `Done: the coins arrived on ${CH[toChain].name}.`, links: [...links, ...(s.toTx ? [{ label: "Arrival", href: CH[toChain].scan + s.toTx }] : [])] }); break; }
          if (s && /fail|refund/i.test(s.status)) { setMsg({ kind: "err", text: `Bitget Wallet reports the bridge ${s.status}.`, links }); break; }
        }
      } else {
        setMsg({ kind: "ok", text: `Done: swapped through Bitget Wallet, sent to ${short(fields.toAddress)}.`, links });
      }
      setRoutes([]);
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    }
    setBusy("");
  }

  /** LI.FI and OKX: the route already has its transaction; approve the token if needed, sign, send, track. */
  async function goDirect(r: Route) {
    const ex = r.exec!, links: { label: string; href: string }[] = [];
    let hash = "";
    if (ex.kind === "sol") {
      if (!conn.sol) throw new Error("Connect a Solana wallet first.");
      setBusy("Approve it in your wallet…");
      hash = await signAndSend({ wallet: conn.sol.wallet, account: conn.sol.account }, ex.txB64);
    } else {
      const p = conn.current?.provider;
      if (!p || !evmAddr) throw new Error("Connect a wallet first.");
      setBusy(`Switching your wallet to ${CH[fromChain].name}…`);
      await switchEvm(p, ex.chainId);
      if (ex.spender && fromTok.contract) {
        const decHex = await p.request({ method: "eth_call", params: [{ to: fromTok.contract, data: "0x313ce567" }, "latest"] }).catch(() => "0x12");
        const need = rawAmount(amount, Number(BigInt(decHex || "0x12")));
        const allowHex = await p.request({ method: "eth_call", params: [{ to: fromTok.contract, data: "0xdd62ed3e" + pad(evmAddr) + pad(ex.spender) }, "latest"] }).catch(() => "0x0");
        if (BigInt(allowHex || "0x0") < need) {
          setBusy(`Approve ${fromTok.symbol} in your wallet (one time)…`);
          const ah = await p.request({ method: "eth_sendTransaction", params: [{ from: evmAddr, to: fromTok.contract, data: "0x095ea7b3" + pad(ex.spender) + "f".repeat(64), value: "0x0" }] });
          setBusy("Waiting for the approval…");
          await waitReceipt(p, ah);
        }
      }
      setBusy("Approve the swap in your wallet…");
      hash = await p.request({ method: "eth_sendTransaction", params: [{ from: evmAddr, to: ex.tx.to, data: ex.tx.data, value: ex.tx.value, ...(ex.tx.gas ? { gas: ex.tx.gas } : {}) }] });
      setBusy("Waiting for the network…");
      await waitReceipt(p, hash);
    }
    links.push({ label: "Transaction", href: CH[fromChain].scan + hash });
    const name = r.router === "okx" ? "OKX DEX" : "LI.FI";
    if (fromChain !== toChain && r.router === "lifi" && r.track) {
      setMsg({ kind: "info", text: `Sent through ${name}. The bridge to ${CH[toChain].name} usually takes a few minutes; the coins arrive at ${short(receive)}.`, links });
      for (let i = 0; i < 50; i++) {
        await sleep(6000);
        const s = await api<{ status: string; toTx: string | null; tips: string | null }>("status", { router: "lifi", txHash: hash, ...r.track }).catch(() => null);
        if (s?.status === "success") { setMsg({ kind: "ok", text: `Done: the coins arrived on ${CH[toChain].name}.`, links: [...links, ...(s.toTx ? [{ label: "Arrival", href: CH[toChain].scan + s.toTx }] : [])] }); break; }
        if (s?.status === "failed") { setMsg({ kind: "err", text: `LI.FI reports the bridge failed${s.tips ? `: ${s.tips}` : ""}.`, links }); break; }
      }
    } else {
      setMsg({ kind: "ok", text: `Done: swapped through ${name}, sent to ${short(receive)}.`, links });
    }
    setRoutes([]);
    setBusy("");
  }

  const r = routes[pick];
  return (
    <div className="stack" style={{ maxWidth: 560, margin: "0 auto" }}>
      <div className="card stack">
        <h1 style={{ margin: 0 }}>Signal</h1>
        <p className="muted" style={{ margin: 0 }}>Swap or bridge through Bitget Wallet, LI.FI or OKX DEX. Your wallet signs, the trade goes through that router on chain, and the coins go to your wallet. Only you can open this page.</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="muted">Paying from:</span>
          {fromAddr ? <><b>{short(fromAddr)}</b>{conn.current?.name && fromChain !== "sol" ? <span className="muted">({conn.current.name})</span> : null}<button className="btn small" onClick={connectFrom} disabled={!!busy}>Switch wallet</button></>
            : <button className="btn small primary" onClick={connectFrom} disabled={!!busy}>Connect {fromChain === "sol" ? "a Solana" : "a"} wallet</button>}
        </div>
      </div>

      {(evmAddr || solAddr) && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <b>Your funds</b>
            <button className="btn small" onClick={() => setBalKey((n) => n + 1)} disabled={bals === null}>Refresh</button>
          </div>
          {bals === null ? <span className="muted">Checking your wallet on every network…</span>
            : !bals.length ? <span className="muted">No USDT or coins found on {evmAddr && solAddr ? "these wallets" : "this wallet"}.{!solAddr ? " Connect a Solana wallet to see Solana too." : ""}</span>
            : <div className="stack" style={{ gap: 6 }}>
                {bals.map((b) => (
                  <button key={b.chain + b.symbol} type="button" className="btn" aria-pressed={picked?.chain === b.chain && picked?.symbol === b.symbol}
                    style={{ justifyContent: "space-between", outline: picked?.chain === b.chain && picked?.symbol === b.symbol ? "2px solid currentColor" : undefined }}
                    onClick={() => pickFunds(b)} disabled={!!busy}>
                    <span>{b.symbol} <span className="muted">· {CH[b.chain].name}</span></span>
                    <b>{fmtAmt(b.amount)}</b>
                  </button>
                ))}
                <small className="muted">Tap one to bridge it.</small>
              </div>}
          {picked && (
            <div className="stack" style={{ gap: 6 }}>
              <b>Bridge {picked.symbol} from {CH[picked.chain].name} to</b>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {(Object.keys(CH) as ChainKey[]).filter((c) => c !== picked.chain).map((c) => (
                  <button key={c} type="button" className={toChain === c && toTok?.symbol === "USDT" ? "btn small primary" : "btn small"} onClick={() => bridgeTo(c)} disabled={!!busy}>USDT · {CH[c].name}</button>
                ))}
              </div>
              <small className="muted">Or pick any token below under "You receive".</small>
            </div>
          )}
        </div>
      )}

      <div className="card stack">
        <TokenPick label="You pay" chain={fromChain} tok={fromTok} onChain={(c) => { setFromChain(c); setFromTok(native(c)); }} onTok={setFromTok} />
        <div className="row" style={{ gap: 8 }}>
          <input style={{ flex: 1 }} inputMode="decimal" placeholder={`Amount of ${fromTok.symbol}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          {(() => { const b = bals?.find((x) => x.chain === fromChain && x.contract.toLowerCase() === fromTok.contract.toLowerCase()); return b ? <button type="button" className="btn small" onClick={() => setAmount(b.contract ? b.amount : String(Math.max(0, Number(b.amount) - (fromChain === "sol" ? 0.01 : fromChain === "eth" ? 0.003 : 0.002))))}>Max {fmtAmt(b.amount)}</button> : null; })()}
        </div>
      </div>

      <div className="card stack">
        <TokenPick label="You receive" chain={toChain} tok={toTok || { chain: toChain, contract: "", symbol: "Pick a token" }} onChain={(c) => { setToChain(c); setToTok(null); }} onTok={setToTok} />
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Receive at ({toChain === "sol" ? "Solana" : "EVM"} address)</span>
          <input value={receive} onChange={(e) => { setReceive(e.target.value.trim()); setReceiveTouched(true); }} placeholder={toChain === "sol" ? "Your Solana address" : "Your 0x… address"} />
        </label>
        <label className="row" style={{ gap: 8 }}>
          <span className="muted">Slippage %</span>
          <input style={{ width: 80 }} inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        <div className="stack" style={{ gap: 6 }}>
          <span className="muted">Route through</span>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }} role="radiogroup" aria-label="Router">
            {ROUTERS.map((x) => {
              const off = x.key === "okx" && (!okxOn || fromChain !== toChain);
              return (
                <button key={x.key} type="button" role="radio" aria-checked={router === x.key} disabled={!!busy || off} title={x.note}
                  className={router === x.key ? "btn small primary" : "btn small"}
                  onClick={() => { setRouter(x.key); try { localStorage.setItem("signal-router", x.key); } catch { /* private mode */ } }}>{x.name}</button>
              );
            })}
          </div>
          {!okxOn && <small className="muted">OKX DEX needs your OKX API keys in Vercel (OKX_API_KEY, OKX_SECRET_KEY, OKX_API_PASSPHRASE, OKX_PROJECT_ID).</small>}
          {okxOn && fromChain !== toChain && <small className="muted">OKX DEX here swaps on one network; pick Bitget Wallet or LI.FI to bridge.</small>}
        </div>
        <button className="btn primary" disabled={!!busy || !toTok || !amount || !fromAddr || !receive || (router === "okx" && (!okxOn || fromChain !== toChain))} onClick={getQuote}>Get routes</button>
      </div>

      {routes.length > 0 && (
        <div className="card stack">
          <b>Routes from {ROUTERS.find((x) => x.key === router)!.name}</b>
          {routes.map((x, i) => (
            <button key={(x.market || x.label) + i} className="btn" aria-pressed={i === pick} style={{ justifyContent: "space-between", outline: i === pick ? "2px solid currentColor" : undefined }} onClick={() => setPick(i)}>
              <span>{x.label}</span>
              <span>{Number(x.out).toLocaleString(undefined, { maximumFractionDigits: 6 })} {toTok?.symbol}</span>
            </button>
          ))}
          {r && <p className="muted" style={{ margin: 0 }}>At least {Number(r.min).toLocaleString(undefined, { maximumFractionDigits: 6 })} {toTok?.symbol}{r.gasUsd != null ? ` · network fee about $${Number(r.gasUsd).toFixed(2)}` : ""}{fromChain !== toChain ? " · bridges need about $10 or more" : ""}</p>}
          <button className="btn primary" disabled={!!busy} onClick={go}>{fromChain === toChain ? "Swap" : "Bridge"} through {ROUTERS.find((x) => x.key === router)!.name}</button>
        </div>
      )}

      {busy && <div className="notice">{busy}</div>}
      {msg && (
        <div className={msg.kind === "err" ? "notice warn" : "notice"}>
          {msg.text}
          {msg.links?.map((l) => <div key={l.href}><a href={l.href} target="_blank" rel="noopener noreferrer">{l.label} ↗</a></div>)}
        </div>
      )}
    </div>
  );
}
