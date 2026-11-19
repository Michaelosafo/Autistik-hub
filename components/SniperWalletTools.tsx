"use client";
/**
 * Sniper wallets: send to another of your own wallets, or swap inside one wallet.
 * The server holds the keys. This page only shows balances, a quote, and a confirmation.
 */
import { useEffect, useState } from "react";

type Act = (name: string, action: string, body: unknown, done?: string) => Promise<void>;
type Asset = { address: string; symbol: string; name: string; decimals: number; raw: string; amount: number; valueUsd: number | null };
type Holdings = { coin: string; explorer: string; coinUsd?: number | null; assets: Asset[] };
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
const usd = (n: number | null | undefined) => (n == null ? "" : `$${n >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toFixed(2)}`);
/** "$12.30 / 0.0200" (dollars first, then the coin amount). */
const both = (a: { amount: number; valueUsd: number | null }) => (a.valueUsd != null ? `${usd(a.valueUsd)} / ${amt(a.amount)}` : amt(a.amount));
const amt = (n: number) => (n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : n > 0 ? n.toPrecision(4) : "0");

async function ask<T>(action: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/ai-futures/${action}?desk=liq`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

type NetId = (typeof NETS)[number]["id"];

export default function SniperWalletTools({ slot, address, others, busy, act, amounts, setChainAmount, net }: {
  slot: number; address: string; others: { slot: number; address: string }[]; busy: boolean; act: Act;
  /** This wallet's snipe amount per chain, in that chain's coin. */
  amounts?: Record<string, number>; setChainAmount?: (chain: string, value: number | null) => void;
  /** The network picked above all the wallet cards. When given, this card follows it (no tabs of its own). */
  net?: NetId;
}) {
  const [open, setOpen] = useState<"send" | "swap" | "withdraw" | "bridge" | null>(null);
  const [chain, setChain] = useState<NetId>(net || "bsc");
  const [more, setMore] = useState(false);
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
  // Wallets to bridge to: tap to tick one or several. Several = the same $ to each.
  const [bridgeTos, setBridgeTos] = useState<number[]>([]);
  const [bridgeChain, setBridgeChain] = useState<(typeof NETS)[number]["id"]>("solana");
  const [bridgeOut, setBridgeOut] = useState("SOL");
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const bridge = bridges[0] || null;
  const setBridge = (b: Bridge | null) => setBridges(b ? [b] : []);
  const [sending, setSending] = useState("");
  const [bridgeAmt, setBridgeAmt] = useState<number | "max">("max");
  // Every one of your wallets' addresses (EVM + Solana), for picking where a bridge lands.
  const [cards, setCards] = useState<Record<number, Card>>({});

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

  useEffect(() => {
    if (open !== "bridge") return;
    let gone = false;
    const want = [slot, ...others.map((o) => o.slot)];
    Promise.all(want.map((x) => ask<Card>("sniper-card", { slot: x }).then((c) => [x, c] as const).catch(() => null))).then((r) => {
      if (gone) return;
      const m: Record<number, Card> = {};
      for (const x of r) if (x) m[x[0]] = x[1];
      setCards(m);
    });
    return () => { gone = true; };
  }, [open, slot, others.map((o) => o.slot).join(","), card?.sol]);

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
  async function showSolKey() {
    if (!confirm(`Show wallet ${slot}'s Solana private key? Anyone who sees it can take the money. Use it to import the wallet into Phantom or Solflare.`)) return;
    try {
      const r = await ask<{ key: string }>("sniper-sol-reveal", { slot });
      const copied = await navigator.clipboard?.writeText(r.key).then(() => true, () => false);
      prompt(`Wallet ${slot} Solana private key${copied ? " (also copied, ready to paste)" : ""}. Phantom → Add wallet → Import private key. Keep it secret:`, r.key);
    } catch (e) { setErr((e as Error).message); }
  }
  async function importSol() {
    const k = prompt(`Paste the private key of your own Solana wallet for wallet ${slot} (Phantom / Solflare: Settings → Manage accounts → Show private key). It's stored encrypted.${card?.sol ? " It replaces the current Solana address, which must be empty." : ""}`);
    if (!k?.trim()) return;
    setErr(""); setLoading(true);
    try {
      await ask("sniper-sol-import", { slot, key: k.trim() });
      setCard(await ask<Card>("sniper-card", { slot }));
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }
  function editAmount() {
    if (!setChainAmount) return;
    const name = NETS.find((n) => n.id === chain)?.name || chain;
    const sym = here?.symbol || coin;
    const cur = amounts?.[chain];
    void sym;
    const v = prompt(`$ wallet ${slot} spends on each snipe on ${name} (paid in ${here?.symbol || coin} or USDT/USDC). Leave empty to clear it:`, cur ? String(cur) : "");
    if (v == null) return;
    const x = Number(v);
    if (v.trim() && !(x > 0)) { setErr("Type an amount greater than zero, or leave it empty."); return; }
    setChainAmount(chain, v.trim() ? x : null);
  }

  /** $ for one unit of the coin being bridged (BNB / ETH / SOL from today's price, USDT / USDC = 1). */
  function payPrice() {
    const up = pay.toUpperCase();
    if (up === "USDT" || up === "USDC") return 1;
    if (up === coin.toUpperCase() && hold?.coinUsd) return hold.coinUsd;
    const a = pick(pay);
    return a && a.amount > 0 && a.valueUsd ? a.valueUsd / a.amount : 0;
  }
  /** Where wallet x would receive the bridge on the picked network (its Solana or EVM address), if it has one. */
  function destOf(x: number): string | null {
    const c = cards[x];
    return bridgeChain === "solana" ? c?.sol || null : c?.evm || (x === slot ? address : others.find((o) => o.slot === x)?.address) || null;
  }
  /** Wallet x can receive: it has an address there, and it isn't this wallet on the network it's already on. */
  const canLand = (x: number) => !!destOf(x) && !(x === slot && bridgeChain === chain);
  async function reviewBridge(max: boolean) {
    // Only the wallets the member ticked. Nothing is picked for them.
    const dests = bridgeTos.filter(canLand);
    if (!dests.length) { setErr(`Tick the ${NETS.find((n) => n.id === bridgeChain)?.name} wallet(s) to receive it first.`); return; }
    if (bridgeChain === chain && dests.includes(slot)) { setErr("This wallet is already on this network: untick it or pick a different network."); return; }
    if (max && dests.length > 1) { setErr("Max works with one wallet. For several, type the $ each wallet gets."); return; }
    let coinAmt: number | "max" = "max";
    if (!max) {
      const dollars = Number(amount);
      if (!(dollars > 0)) { setErr(dests.length > 1 ? "Type how many $ each wallet gets." : "Type how many $ to bridge, or tap Review max."); return; }
      const p = payPrice();
      if (!(p > 0)) { setErr(`No ${pay} price right now. Try again in a moment.`); return; }
      coinAmt = +(dollars / p).toFixed(8);
      const have = pick(pay)?.amount;
      if (dests.length > 1 && have != null && coinAmt * dests.length > have) { setErr(`Not enough ${pay}: ${dests.length} × $${dollars} needs ${amt(coinAmt * dests.length)} ${pay}, this wallet has ${amt(have)}.`); return; }
    }
    setErr(""); setBridges([]); setLoading(true);
    try {
      if (max) setAmount("");
      setBridgeAmt(coinAmt);
      const got: Bridge[] = [];
      for (const d of dests) got.push(await ask<Bridge>("sniper-bridge-quote", { from: slot, to: d, fromChain: chain, toChain: bridgeChain, assetIn: pay, assetOut: bridgeOut, amount: coinAmt }));
      setBridges(got);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }
  async function confirmBridge() {
    if (!bridges.length) return;
    const list = bridges;
    setBridges([]); setOpen(null);
    // One after another, each with the exact coin amount that was quoted.
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (list.length > 1) setSending(`Bridging ${i + 1} of ${list.length} (to wallet #${b.toSlot})…`);
      await act(`br${slot}`, "sniper-bridge", { from: slot, to: b.toSlot, fromChain: chain, toChain: b.toChain, assetIn: pay, assetOut: b.symbolOut, amount: bridgeAmt, minOutRaw: b.amountOutRaw });
    }
    setSending("");
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

  function switchTo(id: NetId) {
    const c = id === "bsc" ? "BNB" : id === "solana" ? "SOL" : "ETH";
    setChain(id); setXfer(null); setQuote(null); setBridge(null); setWd(null); setErr("");
    if ((id === "solana" && open === "send") || (id !== "bsc" && open === "withdraw")) setOpen(null);
    setAsset(c); setPay(c);
    const next = NETS.find((x) => x.id !== id);
    if (next) { setBridgeChain(next.id); setBridgeOut(next.id === "solana" ? "SOL" : next.id === "bsc" ? "BNB" : "ETH"); }
  }
  useEffect(() => { if (net && net !== chain) switchTo(net); }, [net]); // eslint-disable-line react-hooks/exhaustive-deps

  const here = card?.chains.find((c) => c.id === chain);
  const addr = here?.address || (chain === "solana" ? null : address);
  const destNets = NETS.filter((n) => n.id !== chain);

  return (
    <div className="stack" style={{ gap: 6 }}>
      {!net && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {NETS.map((n) => <button key={n.id} type="button" className={"btn small" + (chain === n.id ? " primary" : " ghost")} onClick={() => switchTo(n.id)}>{n.name}</button>)}
        </div>
      )}
      {addr ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <code style={{ wordBreak: "break-all" }}>{addr}</code>
          <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(addr).then(() => setCopied(true), () => {}); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied ✓" : "Copy address"}</button>
          {here?.explorer && <a className="btn small ghost" href={`${here.explorer}/address/${addr}`} target="_blank" rel="noreferrer">Explorer</a>}
        </div>
      ) : (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn small" disabled={busy || loading} onClick={addSol}>{loading ? "Working…" : "＋ Create Solana address"}</button>
          <button type="button" className="btn small ghost" disabled={busy || loading} onClick={importSol}>Import my Solana key</button>
        </div>
      )}
      {setChainAmount && (
        <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <small>💵 <b>Buy amount: {amounts?.[chain] ? `$${amounts[chain]}` : "not set"}</b>{amounts?.[chain] && hold?.coinUsd ? <span className="muted"> ≈ {amt(amounts[chain] / hold.coinUsd)} {here?.symbol || coin}</span> : null} <span className="muted">on {NETS.find((n) => n.id === chain)?.name}</span></small>
          <button type="button" className="btn small" disabled={busy} onClick={editAmount}>Set amount</button>
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {loading && <small className="muted">Reading balances…</small>}
        {assets.map((a) => <span key={a.address + a.symbol} className="muted"><b>{a.symbol}</b> {both(a)}</span>)}
        {assets.length > 0 && <span><b>≈ {usd(assets.reduce((t, a) => t + (a.valueUsd || 0), 0))} in all</b></span>}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button type="button" className={"btn small" + (open === "swap" ? " primary" : "")} disabled={busy || !addr} onClick={() => { setOpen(open === "swap" ? null : "swap"); setQuote(null); setErr(""); }}>{busy && open === "swap" ? "Swapping…" : "Swap"}</button>
        {chain !== "solana" && others.length > 0 && <button type="button" className={"btn small" + (open === "send" ? " primary" : "")} disabled={busy} onClick={() => { setOpen(open === "send" ? null : "send"); setXfer(null); setErr(""); }}>↔ Transfer</button>}
        <button type="button" className={"btn small ghost" + (more ? " primary" : "")} onClick={() => setMore(!more)}>{more ? "Less ▴" : "More ▾"}</button>
      </div>
      {more && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className={"btn small" + (open === "bridge" ? " primary" : "")} disabled={busy || !addr} onClick={() => { setOpen(open === "bridge" ? null : "bridge"); setBridge(null); setErr(""); }}>🌉 Bridge to another chain</button>
          {chain === "bsc" && <button type="button" className={"btn small" + (open === "withdraw" ? " primary" : "")} disabled={busy} onClick={() => { setOpen(open === "withdraw" ? null : "withdraw"); setWd(null); setErr(""); }}>{busy ? "Working…" : "Withdraw"}</button>}
          {chain === "solana" && addr && <button type="button" className="btn small ghost" disabled={busy || loading} onClick={showSolKey}>Show Solana private key</button>}
          {chain === "solana" && addr && <button type="button" className="btn small ghost" disabled={busy || loading} onClick={importSol}>Use my own Solana key</button>}
        </div>
      )}
      {open && (
        <div className="stack" style={{ gap: 6, padding: "8px 10px", borderRadius: 10, border: "1px dashed var(--line, rgba(127,127,127,.35))" }}>
          {open === "withdraw" ? <small className="muted"><b>BNB Chain.</b> Send from this wallet to an address you type. A direct transfer.</small> : net ? null : (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <small><b>Network:</b></small>
              {NETS.map((n) => <button key={n.id} type="button" className={"btn small" + (chain === n.id ? " primary" : " ghost")} onClick={() => { const c = n.id === "bsc" ? "BNB" : n.id === "solana" ? "SOL" : "ETH"; setChain(n.id); setXfer(null); setQuote(null); setBridge(null); setAsset(c); setPay(c); if (bridgeChain === n.id) { const nx = NETS.find((x) => x.id !== n.id)!; setBridgeChain(nx.id); setBridgeOut(nx.id === "solana" ? "SOL" : nx.id === "bsc" ? "BNB" : "ETH"); } }}>{n.name}</button>)}
            </div>
          )}
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {loading && <small className="muted">Reading balances…</small>}
            {assets.map((a) => <button key={a.address + a.symbol} type="button" className={"btn small" + ((open === "swap" || open === "bridge" ? pay : asset) === a.symbol ? " primary" : " ghost")} onClick={() => { if (open === "swap" || open === "bridge") { setPay(a.symbol); setBridge(null); } else { setAsset(a.symbol); setWd(null); } }}>{a.symbol} {both(a)}</button>)}
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
              <small className="muted">Relay sends from this wallet on <b>{NETS.find((n) => n.id === chain)?.name}</b> ({addr ? short(addr) : "no address"}) straight to one of your wallets&apos; address on the other network. No extra hop.</small>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <small><b>Bridge to:</b></small>
                {destNets.map((n) => <button key={n.id} type="button" className={"btn small" + (bridgeChain === n.id ? " primary" : " ghost")} onClick={() => { setBridgeChain(n.id); setBridgeOut(n.id === "solana" ? "SOL" : n.id === "bsc" ? "BNB" : "ETH"); setBridge(null); }}>{n.name}</button>)}
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <small><b>Your {NETS.find((n) => n.id === bridgeChain)?.name} wallets to receive it:</b> <span className="muted">tap one or several (several = the same $ to each)</span></small>
                {[slot, ...others.map((o) => o.slot)].map((x) => {
                  const c = cards[x];
                  const dest = destOf(x);
                  const sel = bridgeTos.includes(x);
                  if (!c && bridgeChain === "solana") return <small key={x} className="muted">#{x} · reading…</small>;
                  if (!dest) return <small key={x} className="muted">#{x}{x === slot ? " (this wallet)" : ""} · no Solana address yet: open wallet #{x} → Solana → Create or Import</small>;
                  return <button key={x} type="button" className={"btn small" + (sel ? " primary" : " ghost")} style={{ justifyContent: "flex-start" }} onClick={() => { const cur = bridgeTos; setBridgeTos(cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x].sort((a, b) => a - b)); setBridges([]); }}>{sel ? "☑" : "☐"} #{x}{x === slot ? " (this wallet)" : ""} · {short(dest)}</button>;
                })}
                {others.length > 0 && (
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn small ghost" onClick={() => { const all = [slot, ...others.map((o) => o.slot)].filter(canLand); setBridgeTos(all.sort((a, b) => a - b)); setBridges([]); }}>Tick all</button>
                    <button type="button" className="btn small ghost" onClick={() => { setBridgeTos([]); setBridges([]); }}>Clear</button>
                  </div>
                )}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <small><b>Arrive as:</b></small>
                {(bridgeChain === "solana" ? ["SOL", "USDT", "USDC"] : bridgeChain === "bsc" ? ["BNB", "USDT", "USDC"] : ["ETH", "USDT", "USDC"]).map((s) => <button key={s} type="button" className={"btn small" + (bridgeOut === s ? " primary" : " ghost")} onClick={() => { setBridgeOut(s); setBridge(null); }}>{s}</button>)}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input className="input" style={{ flex: "1 1 120px" }} inputMode="decimal" placeholder={bridgeTos.length > 1 ? "$ each wallet gets" : "$ to bridge"} value={amount} onChange={(e) => { setAmount(e.target.value); setBridges([]); }} aria-label="Dollars to bridge" />
                {Number(amount) > 0 && payPrice() > 0 && <small className="muted">≈ {amt(Number(amount) / payPrice())} {pay}{bridgeTos.length > 1 ? ` each · $${(Number(amount) * bridgeTos.length).toFixed(2)} in all to ${bridgeTos.length} wallets` : ""}</small>}
                <button type="button" className="btn small" disabled={loading || busy} onClick={() => reviewBridge(false)}>{loading ? "Quoting…" : "Review"}</button>
                {bridgeTos.length <= 1 && <button type="button" className="btn small" disabled={loading || busy} onClick={() => reviewBridge(true)}>Review max</button>}
              </div>
              {bridges.length > 1 && (
                <div className="notice stack" style={{ gap: 4 }}>
                  <b>Confirm {bridges.length} bridges</b>
                  <small>From wallet #{slot} on {NETS.find((n) => n.id === chain)?.name}: <b>{bridges[0].amountIn} {bridges[0].symbolIn}{payPrice() > 0 ? ` ($${(Number(String(bridges[0].amountIn).replace(/,/g, "")) * payPrice()).toFixed(2)})` : ""}</b> to each, <b>{amt(Number(String(bridges[0].amountIn).replace(/,/g, "")) * bridges.length)} {bridges[0].symbolIn}</b> in all.</small>
                  {bridges.map((b) => <small key={b.toSlot}>→ #{b.toSlot} <span className="mono">{short(b.to)}</span> gets about <b>{b.amountOut} {b.symbolOut}</b>{b.feeUsd != null ? <span className="muted"> · fee ${b.feeUsd.toFixed(3)}</span> : null}</small>)}
                  <small>Fees about ${bridges.reduce((t, b) => t + (b.feeUsd || 0), 0).toFixed(3)} in all{bridges[0].seconds ? ` · about ${bridges[0].seconds}s each` : ""}. {bridges[0].via}. Sent one after another.</small>
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn small primary" disabled={busy} onClick={confirmBridge}>{busy ? "Sending…" : `Confirm ${bridges.length} bridges`}</button>
                    <button type="button" className="btn small ghost" onClick={() => setBridges([])}>Cancel</button>
                  </div>
                </div>
              )}
              {bridges.length === 1 && bridge && (
                <div className="notice stack" style={{ gap: 4 }}>
                  <b>Confirm bridge</b>
                  <small>Send: <b>{payPrice() > 0 ? `$${(Number(String(bridge.amountIn).replace(/,/g, "")) * payPrice()).toFixed(2)} = ` : ""}{bridge.amountIn} {bridge.symbolIn}</b> from wallet #{bridge.fromSlot}</small>
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
      {sending && <small className="aic-note" role="status">{sending}</small>}
      {!open && err && <small className="aic-warn" role="alert">{err}</small>}
    </div>
  );
}
