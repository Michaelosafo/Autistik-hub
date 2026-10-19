"use client";
import { useEffect, useRef, useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http } from "viem";
import { IMPACT_BLOCK, IMPACT_CONFIRM, IMPACT_WARN, KYBER_ROUTER, MAX_SLIPPAGE_BPS, isNative, toUnits, type WChain, type WChainKey, type WToken } from "@/lib/wallet-chains";
import type { Signer } from "./types";
import { addTrade, amt, api, friendlyError, raw2num, RiskBox, sendSol, short, store, TokenPicker, usd, waitEvm, type Holding, type Quote, type TokenInfo } from "./util";

/** Kept back for network fees when "Max" is used on the chain's own coin. */
export const GAS_RESERVE: Record<WChainKey, string> = { bsc: "0.002", ethereum: "0.003", base: "0.0003", arbitrum: "0.0003", solana: "0.01" };

/**
 * A market trade: pay `from`, get `to` at the best price right now. Used by the Buy/Sell panel (tokens fixed) and by
 * Convert (any token to any token, with pickers).
 */
export default function MarketForm({ c, signer, owner, from, to, side, tokens, balanceOf, onAdd, onFrom, onTo, onDone }: {
  c: WChain; signer: Signer; owner: string; from: WToken | null; to: WToken | null; side: "buy" | "sell" | "convert";
  tokens: WToken[]; balanceOf: (a: string) => Holding | undefined; onAdd: (t: WToken) => void;
  onFrom?: (t: WToken) => void; onTo?: (t: WToken) => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [infoTo, setInfoTo] = useState<TokenInfo | null>(null);
  const [infoFrom, setInfoFrom] = useState<TokenInfo | null>(null);
  const [q, setQ] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState(""); const [quoting, setQuoting] = useState(false);
  const [slip, setSlip] = useState<number | "auto">("auto");
  const [ack, setAck] = useState(false); const [review, setReview] = useState(false);
  const [step, setStep] = useState(""); const [done, setDone] = useState<string | null>(null); const [err, setErr] = useState("");
  const limit = store.get<number | null>("aw-limit", null);

  useEffect(() => { setInfoTo(null); if (to) api<{ token: TokenInfo }>("token", { chain: c.key, address: to.address }).then((d) => setInfoTo(d.token)).catch(() => {}); }, [c.key, to?.address]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setInfoFrom(null); if (from) api<{ token: TokenInfo }>("token", { chain: c.key, address: from.address }).then((d) => setInfoFrom(d.token)).catch(() => {}); }, [c.key, from?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const rawIn = from ? toUnits(amount || "", from.decimals) : null;
  const bal = from ? balanceOf(from.address) : undefined;
  const tooMuch = !!(rawIn && bal && rawIn > BigInt(bal.raw));
  const tax = Math.max(infoTo?.risk.buyTax || 0, infoFrom?.risk.sellTax || 0);
  const stable = /USD/.test(from?.symbol || "") && /USD/.test(to?.symbol || "");
  const autoSlip = tax > 0 ? Math.min(MAX_SLIPPAGE_BPS, Math.ceil((tax + 2) * 100)) : stable ? 50 : 100;
  const slipBps = slip === "auto" ? autoSlip : slip;

  // A fresh price after typing stops.
  const seq = useRef(0);
  useEffect(() => {
    setQ(null); setQErr(""); setAck(false); setReview(false);
    if (!from || !to || !rawIn || rawIn <= 0n) { setQuoting(false); return; }
    const id = ++seq.current; setQuoting(true);
    const t = setTimeout(() => {
      api<{ quote: Quote }>("quote", { chain: c.key, tokenIn: from.address, tokenOut: to.address, amount: rawIn.toString() })
        .then((d) => id === seq.current && setQ(d.quote)).catch((e) => id === seq.current && setQErr(e.message)).finally(() => id === seq.current && setQuoting(false));
    }, 500);
    return () => clearTimeout(t);
  }, [c.key, from?.address, to?.address, amount]); // eslint-disable-line react-hooks/exhaustive-deps

  const out = q && to ? raw2num(q.amountOut, to.decimals) : 0;
  const minOut = out * (1 - slipBps / 10_000);
  const impact = q?.impact ?? null;
  const danger = infoTo?.risk.level === "danger" || infoFrom?.risk.level === "danger";
  const blocked = infoTo?.risk.honeypot ? "This token looks like a honeypot (you couldn't sell it). Buying is blocked for your safety."
    : impact != null && impact >= IMPACT_BLOCK ? `This trade would move the price ${impact.toFixed(0)}%. Try a smaller amount.`
    : limit && q?.inUsd && q.inUsd > limit ? `This trade (${usd(q.inUsd)}) is over your limit of ${usd(limit)} per trade. Change it in Security.`
    : tooMuch ? `Not enough ${from?.symbol}.` : "";
  const needAck = danger || (impact != null && impact >= IMPACT_CONFIRM);

  function part(p: number) {
    if (!bal || !from) return;
    let r = (BigInt(bal.raw) * BigInt(p)) / 100n;
    if (p === 100 && isNative(c, from.address)) { const keep = toUnits(GAS_RESERVE[c.key], from.decimals) || 0n; r = r > keep ? r - keep : 0n; }
    const s = Number(r) / 10 ** from.decimals;
    setAmount(s > 0 ? String(Math.floor(s * 1e8) / 1e8) : "0");
  }

  async function go() {
    if (!q || !from || !to) return;
    setErr(""); setDone(null);
    try {
      let hash: string;
      if (c.kind === "solana") {
        setStep("Preparing your trade…");
        const { tx } = await api<{ tx: { tx: string } }>("build", { chain: c.key, quote: q, from: owner, slippageBps: slipBps });
        setStep("Approve in your wallet…");
        hash = await sendSol(signer, tx.tx);
      } else {
        const ev = signer.evm!;
        setStep("Preparing your trade…");
        const { tx } = await api<{ tx: { to: `0x${string}`; data: `0x${string}`; value: string; spender: `0x${string}` | null } }>("build", { chain: c.key, quote: q, from: owner, slippageBps: slipBps });
        // Never send to a contract we don't expect, even if the server were tampered with.
        const allowed = [KYBER_ROUTER, c.v2Router].filter(Boolean).map((a) => getAddress(a!));
        if (!allowed.includes(getAddress(tx.to))) throw new Error("Unexpected swap contract. Stopped for your safety.");
        if (tx.spender) {
          const pc: any = createPublicClient({ chain: c.viem, transport: http(c.rpc) });
          const have: bigint = await pc.readContract({ address: from.address as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [ev.address, tx.spender] });
          if (have < BigInt(q.amountIn)) {
            // The exact amount only: no unlimited approvals left lying around.
            setStep(`Step 1 of 2: allow this trade to use ${amount} ${from.symbol}…`);
            const h = await ev.send(c.chainId!, { to: from.address as `0x${string}`, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [tx.spender, BigInt(q.amountIn)] }) });
            await waitEvm(c, h);
          }
          setStep("Step 2 of 2: confirm the trade in your wallet…");
        } else setStep("Confirm the trade in your wallet…");
        hash = await ev.send(c.chainId!, { to: tx.to, data: tx.data, value: tx.value });
        setStep("Waiting for the network…");
        await waitEvm(c, hash as `0x${string}`);
      }
      addTrade({ at: Date.now(), chain: c.key, side, pay: `${amount} ${from.symbol}`, get: `${amt(out)} ${to.symbol}`, hash });
      setDone(hash); setAmount(""); setReview(false); onDone();
    } catch (e: any) { setErr(friendlyError(e, c.native.symbol)); }
    setStep("");
  }

  const cta = side === "buy" ? `Buy ${to?.symbol || ""}` : side === "sell" ? `Sell ${from?.symbol || ""}` : "Convert";
  return (
    <div className="stack tx-form" style={{ gap: 10 }}>
      <div className="tx-field">
        <div className="row tx-field-top"><span>{side === "buy" ? "Spend" : side === "sell" ? "Sell amount" : "From"}</span>{bal && <span>Available <b>{amt(bal.amount)} {from?.symbol}</b></span>}</div>
        <div className="row tx-field-mid">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder="0.00" aria-label="Amount" />
          {onFrom ? <TokenPicker c={c} tokens={tokens} value={from} onPick={onFrom} onAdd={onAdd} label="From" balanceOf={balanceOf} /> : <span className="tx-unit">{from?.symbol}</span>}
        </div>
      </div>
      <div className="tx-parts">{[25, 50, 75, 100].map((p) => <button key={p} type="button" onClick={() => part(p)} disabled={!bal}>{p === 100 ? "Max" : `${p}%`}</button>)}</div>
      <div className="tx-field">
        <div className="row tx-field-top"><span>{side === "convert" ? "To (about)" : "You get (about)"}</span>{q?.outUsd ? <span>{usd(q.outUsd)}</span> : null}</div>
        <div className="row tx-field-mid">
          <div className="tx-out">{quoting ? <span className="tx-dim">Finding best price…</span> : q ? amt(out) : <span className="tx-dim">0.00</span>}</div>
          {onTo ? <TokenPicker c={c} tokens={tokens} value={to} onPick={onTo} onAdd={onAdd} label="To" balanceOf={balanceOf} /> : <span className="tx-unit">{to?.symbol}</span>}
        </div>
      </div>

      {side !== "sell" && infoTo && to && !isNative(c, to.address) && <RiskBox r={infoTo.risk} symbol={to.symbol} />}
      {qErr && <div className="scan-err">{qErr}</div>}

      {q && to && from && (
        <div className="aw-details">
          <div><span>Price</span><b>1 {from.symbol} = {amt(out / Number(amount || 1))} {to.symbol}</b></div>
          <div><span>Price impact</span><b className={impact != null && impact >= IMPACT_WARN ? "down" : ""}>{impact == null ? "–" : `${impact.toFixed(2)}%`}</b></div>
          <div><span>Minimum received</span><b>{amt(minOut)} {to.symbol}</b></div>
          <div><span>Slippage</span><span className="aw-slip">
            {(["auto", 50, 100, 300] as const).map((s) => <button key={s} type="button" className={slip === s ? "on" : ""} onClick={() => setSlip(s)}>{s === "auto" ? `Auto ${autoSlip / 100}%` : `${s / 100}%`}</button>)}
          </span></div>
          <div><span>Trading fee</span><b>{q.feeBps ? `${q.feeBps / 100}%` : "0%"}</b></div>
          {q.gasUsd != null && <div><span>Network fee</span><b>≈ {usd(q.gasUsd)}</b></div>}
          <div><span>Route</span><b>{q.kind === "kyber" ? "KyberSwap, all DEXs" : q.kind === "jupiter" ? "Jupiter, all Solana DEXs" : "PancakeSwap / Uniswap"}</b></div>
        </div>
      )}
      {impact != null && impact >= IMPACT_WARN && impact < IMPACT_BLOCK && <div className="aw-risk warn">This trade moves the price {impact.toFixed(1)}%: you get noticeably less than the market price.</div>}
      {blocked && q && <div className="aw-risk danger">{blocked}</div>}
      {needAck && !blocked && q && <label className="row aw-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand the risks and want to continue.</label>}

      {!review ? (
        <button type="button" className={"tx-cta " + side} disabled={!q || !!blocked || (needAck && !ack) || quoting} onClick={() => setReview(true)}>
          {!amount ? "Enter an amount" : quoting ? "Finding best price…" : blocked && q ? "Can't trade" : cta}
        </button>
      ) : q && from && to && (
        <div className="aw-review stack">
          <b>Confirm your order</b>
          <div className="aw-details">
            <div><span>Pay</span><b>{amount} {from.symbol}</b></div>
            <div><span>Receive at least</span><b>{amt(minOut)} {to.symbol}</b></div>
            <div><span>To</span><b>Your wallet {short(owner)}</b></div>
            <div><span>Network</span><b>{c.name}</b></div>
          </div>
          {step ? <div className="aw-step"><span className="aw-spin" />{step}</div> : (
            <div className="row" style={{ gap: 8 }}><button type="button" className="btn" onClick={() => setReview(false)}>Back</button><button type="button" className={"tx-cta grow " + side} onClick={go}>Confirm</button></div>
          )}
        </div>
      )}
      {err && <div className="aw-risk danger">{err}</div>}
      {done && <div className="aw-risk ok">Order filled. <a href={`${c.explorer}/tx/${done}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a></div>}
    </div>
  );
}
