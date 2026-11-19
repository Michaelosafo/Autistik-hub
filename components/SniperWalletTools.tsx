"use client";
/**
 * Sniper wallets: send to another of your own wallets, or swap inside one wallet.
 * The server holds the keys. This page only shows balances, a quote, and a confirmation.
 */
import { useEffect, useState } from "react";

type Act = (name: string, action: string, body: unknown, done?: string) => Promise<void>;
type Asset = { address: string; symbol: string; name: string; decimals: number; raw: string; amount: number; valueUsd: number | null };
type Holdings = { coin: string; explorer: string; assets: Asset[] };
type Xfer = { chain: string; coin: string; fromSlot: number; toSlot: number; from: string; to: string; symbol: string; amount: string; gasNative: string; gasUsd: number | null; explorer: string };
type Withdraw = { slot: number; from: string; to: string; symbol: string; amount: string; gasNative: string; coin: string; gasUsd: number | null };
type Quote = { via: string; symbolIn: string; symbolOut: string; amountIn: string; amountOut: string; minOut: string; minOutRaw: string; slippageBps: number; impact: number | null; gasUsd: number | null; address: string };
type Card = { evm: string; sol: string | null; chains: { id: string; name: string; symbol: string; address: string | null; explorer: string }[] };
type Bridge = { via: string; fromSlot: number; toSlot: number; fromChain: string; toChain: string; from: string; to: string; symbolIn: string; symbolOut: string; amountIn: string; amountOut: string; amountOutRaw: string; feeUsd: number | null; gasUsd: number | null; seconds: number | null };

const NETS = [
  { id: "bsc", name: "BNB" },
  { id: "ethereum", name: "Ethereum" },
  { id: "base", name: "Base" },
  { id: "arbitrum", name: "Arbitrum" },
  { id: "solana", name: "Solana" },
] as const;
const SLIPS = [50, 100, 300, 500, 1200] as const;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const amt = (n: number) => (n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : n > 0 ? n.toPrecision(4) : "0");

async function ask<T>(action: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/ai-futures/${action}?desk=liq`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

export default function SniperWalletTools({ slot, address, others, busy, act }: {
  slot: number; address: string; others: { slot: number; address: string }[]; busy: boolean; act: Act;
}) {
  const [open, setOpen] = useState<"send" | "swap" | "withdraw" | "bridge" | null>(null);
  const [chain, setChain] = useState<(typeof NETS)[number]["id"]>("bsc");
  const [hold, setHold] = useState<Holdings | null>(null);
  const [extra, setExtra] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [to, setTo] = useState<number | null>(null);
  const [asset, setAsset] = useState("BNB");
  const [amount, setAmount] = useState("");
  const [xfer, setXfer] = useState<Xfer | null>(null);
  const [pay, setPay] = useState("BNB");
  const [recv, setRecv] = useState("USDT");
  const [slip, setSlip] = useState(100);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [dest, setDest] = useState("");
  const [wd, setWd] = useState<Withdraw | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [copied, setCopied] = useState(false);
  const [bridgeTo, setBridgeTo] = useState<number | null>(null);
  const [bridgeChain, setBridgeChain] = useState<(typeof NETS)[number]["id"]>("solana");
  const [bridgeOut, setBridgeOut] = useState("SOL");
  const [bridge, setBridge] = useState<Bridge | null>(null);

  useEffect(() => {
    let gone = false;
    ask<Card>("sniper-card", { slot }).then((d) => { if (!gone) setCard(d); }).catch(() => {});
    return () => { gone = true; };
  }, [slot]);

  useEffect(() => {
    if (chain === "solana" && card && !card.sol) { setHold(null); return; }
    let gone = false;
    setLoading(true); setErr("");
    const more = chain === "solana" ? (extra.trim() ? [extra.trim()] : []) : (/^0x[0-9a-fA-F]{40}$/.test(extra.trim()) ? [extra.trim()] : []);
    ask<Holdings>("sniper-balances", { slot, chain, extra: more }).then((d) => { if (!gone) setHold(d); }).catch((e) => { if (!gone && open) setErr(e.message); }).finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [chain, slot, extra, card?.sol, open]);

  const assets = hold?.assets || [];
  const coin = hold?.coin || (chain === "bsc" ? "BNB" : "ETH");
  const pick = (id: string) => assets.find((a) => a.symbol === id || a.address.toLowerCase() === id.toLowerCase());

  async function preview(max: boolean) {
    if (!to) { setErr("Pick one of your wallets to send to."); return; }
    setErr(""); setXfer(null); setLoading(true);
    try {
      const body = { from: slot, to, chain, asset: asset === "other" ? extra.trim() : asset, amount: max ? "max" : Number(amount) };
      setXfer(await ask<Xfer>("sniper-transfer-preview", body));
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }
  async function reviewWithdraw(max: boolean) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(dest.trim())) { setErr("Enter a BNB Chain address (0x and 40 letters)."); return; }
    setErr(""); setWd(null); setLoading(true);
    try {
      if (max) setAmount("");
      setWd(await ask<Withdraw>("sniper-withdraw-preview", { slot, chain: "bsc", asset, amount: max ? "max" : Number(amount), to: dest.trim() }));
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }
  function confirmWithdraw() {
    if (!wd) return;
    const body = { slot, chain: "bsc", asset, amount: amount.trim() ? Number(amount) : "max", to: dest.trim() };
    setWd(null); setOpen(null);
    act(`wd${slot}`, "sniper-withdraw", body);
  }
  function confirmSend() {
    if (!xfer || !to) return;
    const body = { from: slot, to, chain, asset: asset === "other" ? extra.trim() : asset, amount: amount.trim() ? Number(amount) : "max" };
    setXfer(null); setOpen(null);
    act(`tf${slot}`, "sniper-transfer", body);
  }
  async function getQuote(max = false) {
    setErr(""); setQuote(null); setLoading(true);
    try {
      const tokenIn = pay === "other" ? extra.trim() : pay;
      const tokenOut = recv === "other" ? extra.trim() : recv;
      if (max) setAmount("");
      setQuote(await ask<Quote>("sniper-swap-quote", { slot, chain, tokenIn, tokenOut, amount: max ? "max" : Number(amount), slippageBps: slip }));
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }
  async function addSol() {
    setErr(""); setLoading(true);
    try {
      const made = await ask<{ address: string }>("sniper-sol-create", { slot });
      setCard(await ask<Card>("sniper-card", { slot }));
      setErr("");
      void made;
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }
  async function reviewBridge(max: boolean) {
    const destSlot = bridgeTo ?? slot;
    if (bridgeChain === chain && destSlot === slot) { setErr("Pick another wallet or a different network."); return; }
    setErr(""); setBridge(null); setLoading(true);
    try {
      if (max) setAmount("");
      setBridge(await ask<Bridge>("sniper-bridge-quote", { from: slot, to: destSlot, fromChain: chain, toChain: bridgeChain, assetIn: pay, assetOut: bridgeOut, amount: max ? "max" : Number(amount) }));
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }
  function confirmBridge() {
    if (!bridge) return;
    const body = { from: slot, to: bridge.toSlot, fromChain: chain, toChain: bridge.toChain, assetIn: pay, assetOut: bridge.symbolOut, amount: amount.trim() ? Number(amount) : "max", minOutRaw: bridge.amountOutRaw };
    setBridge(null); setOpen(null);
    act(`br${slot}`, "sniper-bridge", body);
  }
  function confirmSwap() {
    if (!quote) return;
    const tokenIn = pay === "other" ? extra.trim() : pay;
    const tokenOut = recv === "other" ? extra.trim() : recv;
    const impact = quote.impact != null && quote.impact >= 10;
    if (impact && !confirm(`This swap moves the price by about ${quote.impact!.toFixed(1)}%. Send it anyway?`)) return;
    const body = { slot, chain, tokenIn, tokenOut, amount: amount.trim() ? Number(amount) : "max", slippageBps: slip, minOutRaw: quote.minOutRaw, confirmImpact: impact };
    setQuote(null); setOpen(null);
    act(`sw${slot}`, "sniper-swap", body);
  }

  const here = card?.chains.find((c) => c.id === chain);
  const addr = here?.address || (chain === "solana" ? null : address);
  const destNets = NETS.filter((n) => n.id !== chain);

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {NETS.map((n) => <button key={n.id} type="button" className={"btn small" + (chain === n.id ? " primary" : " ghost")} onClick={() => { setChain(n.id); setXfer(null); setQuote(null); setBridge(null); if ((n.id === "solana" && open === "send") || (n.id !== "bsc" && open === "withdraw")) setOpen(null); setAsset(n.id === "bsc" ? "BNB" : n.id === "solana" ? "SOL" : "ETH"); setPay(n.id === "bsc" ? "BNB" : n.id === "solana" ? "SOL" : "ETH"); const next = NETS.find((x) => x.id !== n.id); if (next) { setBridgeChain(next.id); setBridgeOut(next.id === "solana" ? "SOL" : next.id === "bsc" ? "BNB" : "ETH"); } }}>{n.name}</button>)}
      </div>
      {addr ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <code style={{ wordBreak: "break-all" }}>{addr}</code>
          <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(addr).then(() => setCopied(true), () => {}); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied ✓" : "Copy address"}</button>
          {here?.explorer && <a className="btn small ghost" href={`${here.explorer}/address/${addr}`} target="_blank" rel="noreferrer">Explorer</a>}
        </div>
      ) : (
        <button type="button" className="btn small" disabled={busy || loading} onClick={addSol}>{loading ? "Creating…" : "Add Solana address"}</button>
      )}
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {loading && <small className="muted">Reading balances…</small>}
        {assets.map((a) => <span key={a.address + a.symbol} className="muted"><b>{a.symbol}</b> {amt(a.amount)}</span>)}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {chain !== "solana" && others.length > 0 && <button type="button" className={"btn small" + (open === "send" ? " primary" : "")} disabled={busy} onClick={() => { setOpen(open === "send" ? null : "send"); setXfer(null); setErr(""); }}>↔ Transfer</button>}
        <button type="button" className={"btn small" + (open === "bridge" ? " primary" : "")} disabled={busy || (chain === "solana" && !addr)} onClick={() => { setOpen(open === "bridge" ? null : "bridge"); setBridge(null); setErr(""); }}>Bridge</button>
        <button type="button" className={"btn small" + (open === "withdraw" ? " primary" : "")} disabled={busy} onClick={() => { setChain("bsc"); setOpen(open === "withdraw" ? null : "withdraw"); setWd(null); setErr(""); }}>{busy ? "Working…" : "Withdraw"}</button>
        <button type="button" className={"btn small" + (open === "swap" ? " primary" : "")} disabled={busy || (chain === "solana" && !addr)} onClick={() => { setOpen(open === "swap" ? null : "swap"); setQuote(null); setErr(""); }}>{busy && open === "swap" ? "Swapping…" : "Swap"}</button>
      </div>
      {open && (
        <div className="stack" style={{ gap: 6, padding: "8px 10px", borderRadius: 10, border: "1px dashed var(--line, rgba(127,127,127,.35))" }}>
          {open === "withdraw" ? <small className="muted"><b>BNB Chain.</b> Send from this wallet to an address you type. A direct transfer.</small> : (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <small><b>Network:</b></small>
              {NETS.map((n) => <button key={n.id} type="button" className={"btn small" + (chain === n.id ? " primary" : " ghost")} onClick={() => { setChain(n.id); setXfer(null); setQuote(null); setAsset(n.id === "bsc" ? "BNB" : "ETH"); setPay(n.id === "bsc" ? "BNB" : "ETH"); }}>{n.name}</button>)}
            </div>
          )}
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {loading && <small className="muted">Reading balances…</small>}
            {assets.map((a) => <button key={a.address + a.symbol} type="button" className={"btn small" + ((open === "swap" ? pay : asset) === a.symbol ? " primary" : " ghost")} onClick={() => { if (open === "swap") setPay(a.symbol); else { setAsset(a.symbol); setWd(null); } }}>{a.symbol} {amt(a.amount)}</button>)}
          </div>
          <input className="input" style={{ fontFamily: "monospace" }} placeholder="Or paste a token address to include it" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Token address" autoComplete="off" spellCheck={false} />

          {open === "send" && (
            <>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <small><b>To your wallet:</b></small>
                {others.map((x) => <button key={x.slot} type="button" className={"btn small" + (to === x.slot ? " primary" : " ghost")} onClick={() => setTo(x.slot)}>#{x.slot} {short(x.address)}</button>)}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input className="input" style={{ flex: "1 1 120px" }} inputMode="decimal" placeholder={`Amount of ${asset === "other" ? "token" : asset}`} value={amount} onChange={(e) => { setAmount(e.target.value); setXfer(null); }} aria-label="Amount to send" />
                <button type="button" className="btn small" disabled={loading || busy || !to} onClick={() => preview(false)}>Review</button>
                <button type="button" className="btn small" disabled={loading || busy || !to} onClick={() => { setAmount(""); preview(true); }}>Review max</button>
              </div>
              {xfer && (
                <div className="notice stack" style={{ gap: 4 }}>
                  <b>Confirm transfer</b>
                  <small>Amount: <b>{xfer.amount} {xfer.symbol}</b></small>
                  <small>From: wallet #{xfer.fromSlot} <span className="mono">{short(xfer.from)}</span></small>
                  <small>To: wallet #{xfer.toSlot} <span className="mono">{short(xfer.to)}</span> (one of your wallets)</small>
                  <small>Estimated gas: <b>{xfer.gasNative} {xfer.coin}</b>{xfer.gasUsd != null ? ` (≈ $${xfer.gasUsd.toFixed(3)})` : ""}</small>
                  <small className="muted">A direct transfer on {NETS.find((n) => n.id === xfer.chain)?.name}. Nothing else sits in the middle.</small>
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn small primary" disabled={busy} onClick={confirmSend}>{busy ? "Sending…" : "Confirm send"}</button>
                    <button type="button" className="btn small ghost" onClick={() => setXfer(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </>
          )}

          {open === "withdraw" && (
            <>
              <input className="input" style={{ fontFamily: "monospace" }} placeholder="Send to address 0x…" value={dest} onChange={(e) => { setDest(e.target.value); setWd(null); }} aria-label="Destination address" autoComplete="off" spellCheck={false} />
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input className="input" style={{ flex: "1 1 120px" }} inputMode="decimal" placeholder={`Amount of ${asset}`} value={amount} onChange={(e) => { setAmount(e.target.value); setWd(null); }} aria-label="Amount to withdraw" />
                <button type="button" className="btn small" disabled={loading || busy || !dest.trim()} onClick={() => reviewWithdraw(false)}>Review</button>
                <button type="button" className="btn small" disabled={loading || busy || !dest.trim()} onClick={() => reviewWithdraw(true)}>Review max</button>
              </div>
              {wd && (
                <div className="notice stack" style={{ gap: 4 }}>
                  <b>Confirm withdrawal</b>
                  <small>Amount: <b>{wd.amount} {wd.symbol}</b></small>
                  <small>From: wallet #{wd.slot} <span className="mono">{short(wd.from)}</span></small>
                  <small>To: <span className="mono">{wd.to}</span></small>
                  <small>Estimated gas: <b>{wd.gasNative} {wd.coin}</b>{wd.gasUsd != null ? ` (≈ $${wd.gasUsd.toFixed(3)})` : ""}{wd.symbol === "BNB" ? ". Max leaves this fee in the wallet." : ""}</small>
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn small primary" disabled={busy} onClick={confirmWithdraw}>{busy ? "Sending…" : "Confirm withdraw"}</button>
                    <button type="button" className="btn small ghost" onClick={() => setWd(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </>
          )}

          {open === "swap" && (
            <>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <small><b>Receive:</b></small>
                {["BNB", "ETH", "SOL", "USDT", "USDC"].filter((s) => s === "BNB" ? chain === "bsc" : s === "SOL" ? chain === "solana" : s === "ETH" ? chain !== "bsc" && chain !== "solana" : true).map((s) => <button key={s} type="button" className={"btn small" + (recv === s ? " primary" : " ghost")} onClick={() => { setRecv(s); setQuote(null); }}>{s}</button>)}
                <button type="button" className={"btn small" + (recv === "other" ? " primary" : " ghost")} onClick={() => { setRecv("other"); setQuote(null); }}>Other…</button>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <small><b>Slippage:</b></small>
                {SLIPS.map((s) => <button key={s} type="button" className={"btn small" + (slip === s ? " primary" : " ghost")} onClick={() => { setSlip(s); setQuote(null); }}>{s / 100}%</button>)}
              </div>
              <small className="muted">Paying {pick(pay)?.symbol || pay}{pick(pay) ? ` (you have ${amt(pick(pay)!.amount)})` : ""}. The swap comes back to this same wallet ({short(address)}).</small>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input className="input" style={{ flex: "1 1 120px" }} inputMode="decimal" placeholder="Amount to swap" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); }} aria-label="Amount to swap" />
                <button type="button" className="btn small" disabled={loading || busy} onClick={() => getQuote()}>Get quote</button>
                <button type="button" className="btn small" disabled={loading || busy} onClick={() => getQuote(true)}>Quote max</button>
              </div>
              {quote && (
                <div className="notice stack" style={{ gap: 4 }}>
                  <b>Confirm swap</b>
                  <small>Pay: <b>{quote.amountIn} {quote.symbolIn}</b> from wallet #{slot}</small>
                  <small>Expected: <b>{quote.amountOut} {quote.symbolOut}</b></small>
                  <small>Minimum you accept: <b>{quote.minOut} {quote.symbolOut}</b> ({quote.slippageBps / 100}% slippage). Less than that and the swap is cancelled.</small>
                  <small>Back to: <span className="mono">{short(quote.address)}</span> · {quote.via}{quote.gasUsd != null ? ` · gas about $${quote.gasUsd.toFixed(3)}` : ""}{quote.impact != null ? ` · price impact ${quote.impact.toFixed(1)}%` : ""}</small>
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn small primary" disabled={busy} onClick={confirmSwap}>{busy ? "Swapping…" : "Confirm swap"}</button>
                    <button type="button" className="btn small ghost" onClick={() => setQuote(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </>
          )}
          {open === "bridge" && (
            <>
              <small className="muted">Relay sends from this wallet straight to one of your wallets on another network. No extra hop is added.</small>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <small><b>To:</b></small>
                <button type="button" className={"btn small" + (bridgeTo === null || bridgeTo === slot ? " primary" : " ghost")} onClick={() => { setBridgeTo(slot); setBridge(null); }}>This wallet</button>
                {others.map((x) => <button key={x.slot} type="button" className={"btn small" + (bridgeTo === x.slot ? " primary" : " ghost")} onClick={() => { setBridgeTo(x.slot); setBridge(null); }}>#{x.slot}</button>)}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <small><b>Network:</b></small>
                {destNets.map((n) => <button key={n.id} type="button" className={"btn small" + (bridgeChain === n.id ? " primary" : " ghost")} onClick={() => { setBridgeChain(n.id); setBridgeOut(n.id === "solana" ? "SOL" : n.id === "bsc" ? "BNB" : "ETH"); setBridge(null); }}>{n.name}</button>)}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <small><b>Arrive as:</b></small>
                {(bridgeChain === "solana" ? ["SOL", "USDT", "USDC"] : bridgeChain === "bsc" ? ["BNB", "USDT", "USDC"] : ["ETH", "USDT", "USDC"]).map((s) => <button key={s} type="button" className={"btn small" + (bridgeOut === s ? " primary" : " ghost")} onClick={() => { setBridgeOut(s); setBridge(null); }}>{s}</button>)}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input className="input" style={{ flex: "1 1 120px" }} inputMode="decimal" placeholder={`Amount of ${pay}`} value={amount} onChange={(e) => { setAmount(e.target.value); setBridge(null); }} aria-label="Amount to bridge" />
                <button type="button" className="btn small" disabled={loading || busy} onClick={() => reviewBridge(false)}>Review</button>
                <button type="button" className="btn small" disabled={loading || busy} onClick={() => reviewBridge(true)}>Review max</button>
              </div>
              {bridge && (
                <div className="notice stack" style={{ gap: 4 }}>
                  <b>Confirm bridge</b>
                  <small>Send: <b>{bridge.amountIn} {bridge.symbolIn}</b> from wallet #{bridge.fromSlot}</small>
                  <small>From: <span className="mono">{bridge.from}</span></small>
                  <small>You receive about: <b>{bridge.amountOut} {bridge.symbolOut}</b></small>
                  <small>To wallet #{bridge.toSlot}: <span className="mono">{bridge.to}</span></small>
                  <small>Fees about {bridge.feeUsd != null ? `$${bridge.feeUsd.toFixed(3)}` : "—"}{bridge.gasUsd != null ? ` (gas $${bridge.gasUsd.toFixed(3)})` : ""}{bridge.seconds ? ` · about ${bridge.seconds}s` : ""}. {bridge.via}.</small>
                  <small className="muted">Paid to that wallet's own address on the other network. One bridge, no mixer.</small>
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn small primary" disabled={busy} onClick={confirmBridge}>{busy ? "Sending…" : "Confirm bridge"}</button>
                    <button type="button" className="btn small ghost" onClick={() => setBridge(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </>
          )}
          {err && <small className="aic-warn" role="alert">{err}</small>}
        </div>
      )}
      {!open && err && <small className="aic-warn" role="alert">{err}</small>}
    </div>
  );
}
