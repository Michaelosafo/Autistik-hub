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
import { SwapPanels, toX, type CardIO, type Side } from "@/components/swap/SwapCard";
import { XCHAIN_BY_KEY, isXNative, type XChain, type XToken } from "@/lib/bridge-chains";
import { api as wapi, type Holding } from "@/components/wallet/util";

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
// The swap card speaks the AUTISTIK swap's networks; Signal's routers speak these keys.
const XKEY: Record<ChainKey, string> = { bnb: "bsc", eth: "ethereum", base: "base", arbitrum: "arbitrum", matic: "polygon", sol: "solana" };
const FROM_X: Record<string, ChainKey> = Object.fromEntries(Object.entries(XKEY).map(([k, v]) => [v, k as ChainKey]));
const netOf = (c: ChainKey) => XCHAIN_BY_KEY[XKEY[c]];
const signalOk = (n: XChain) => (FROM_X[n.key] ? null : "Signal routes BNB Chain, Ethereum, Base, Arbitrum, Polygon and Solana");
const tokOf = (n: XChain, t: XToken | null): Tok | null => t && ({ chain: FROM_X[n.key], contract: isXNative(n, t.address) ? "" : t.address, symbol: t.symbol, name: t.name });
const xUsdt = (c: ChainKey): XToken => ({ address: USDT_AT[c], symbol: "USDT", name: "Tether USD", decimals: c === "bnb" ? 18 : 6 });

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

  // The coins, picked in the swap card's sheet (your funds on every network show first; paste any contract address).
  const [fromNet, setFromNet] = useState<XChain>(netOf("bnb"));
  const [xFrom, setXFrom] = useState<XToken | null>(xUsdt("bnb"));
  const [toNet, setToNet] = useState<XChain>(netOf("sol"));
  const [xTo, setXTo] = useState<XToken | null>(xUsdt("sol"));
  const fromChain = FROM_X[fromNet.key], toChain = FROM_X[toNet.key];
  const fromTok = useMemo(() => tokOf(fromNet, xFrom) || native(fromChain), [fromNet, xFrom, fromChain]);
  const toTok = useMemo(() => tokOf(toNet, xTo), [toNet, xTo]);
  const [logos, setLogos] = useState<Record<number, string>>({});
  useEffect(() => { wapi<{ logos: Record<number, string> }>("x-chains", {}).then((d) => setLogos(d.logos)).catch(() => {}); }, []);
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
  // What you hold of the coin you pay with (for the card's balance and Max).
  const [have, setHave] = useState<number | null>(null);
  useEffect(() => {
    setHave(null);
    const owner = fromChain === "sol" ? solAddr : evmAddr;
    if (!owner || !xFrom || !fromNet.wchain) return;
    let on = true;
    wapi<{ holdings: Holding[] }>("balances", { chain: fromNet.wchain, owner, extra: isXNative(fromNet, xFrom.address) ? [] : [xFrom.address] })
      .then((d) => { if (!on) return; const h = d.holdings.find((x) => toX(fromNet, x).address.toLowerCase() === xFrom.address.toLowerCase()); setHave(h?.amount ?? 0); })
      .catch(() => {});
    return () => { on = false; };
  }, [fromNet, xFrom, evmAddr, solAddr, fromChain]);
  function pickCoin(side: Side, net: XChain, t: XToken) {
    if (side === "from") { setFromNet(net); setXFrom(t); setAmount(""); } else { setToNet(net); setXTo(t); }
    if (router === "okx") setRouter("bitget");
  }
  function flip() { const n = fromNet, t = xFrom; setFromNet(toNet); setXFrom(xTo); setToNet(n); setXTo(t); setAmount(""); }
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

      <div className="sw-card sc-card" style={{ padding: 12 }}>
        <SwapPanels
          io={{
            amount, setAmount: (v: string) => setAmount(v),
            balance: have, onMax: have ? () => setAmount(String(fromTok.contract ? have : Math.max(0, have - (fromChain === "sol" ? 0.01 : fromChain === "eth" ? 0.003 : 0.002)))) : null,
            inUsd: null,
            out: routes[pick] ? Number(routes[pick].out).toLocaleString(undefined, { maximumFractionDigits: 6 }) : <span className="tx-dim">0</span>,
            outUsd: null,
            toExtra: (
              <label className="stack" style={{ gap: 4, marginTop: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>Send to {receive && receive === defReceive ? "(your wallet)" : ""}</span>
                <div className="row" style={{ gap: 6 }}>
                  <input style={{ flex: 1, minWidth: 0 }} value={receive} onChange={(e) => { setReceive(e.target.value.trim()); setReceiveTouched(true); }} placeholder={toChain === "sol" ? "Paste a Solana address" : "Paste a 0x… address"} />
                  <button type="button" className="btn small" onClick={async () => { try { const t = (await navigator.clipboard.readText()).trim(); if (t) { setReceive(t); setReceiveTouched(true); } } catch { /* no clipboard access */ } }}>Paste</button>
                  {receiveTouched && defReceive && receive !== defReceive && <button type="button" className="btn small" onClick={() => { setReceive(defReceive); setReceiveTouched(false); }}>Mine</button>}
                </div>
              </label>
            ),
          } as CardIO}
          from={{ net: fromNet, token: xFrom }} to={{ net: toNet, token: xTo }} logos={logos}
          owners={{ evm: evmAddr || null, sol: solAddr || null }} allow={signalOk} allowTo={signalOk} fromAll
          onPick={pickCoin} onFlip={flip} />
      </div>

      <div className="card stack">
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
