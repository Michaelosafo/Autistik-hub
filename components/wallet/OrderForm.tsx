"use client";
import { useEffect, useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, http, parseAbi } from "viem";
import { EXPIRY_DAYS, ORDER_FEE_BPS, ORDER_TYPES, STOP_SLIPPAGE_DEFAULT, cancelMessage, orderDomain, orderTokenIn } from "@/lib/orders";
import { NATIVE, isNative, toUnits, type WChain, type WToken } from "@/lib/wallet-chains";
import type { Signer } from "./types";
import { amt, friendlyError, raw2num, waitEvm, type Holding, type Market } from "./util";

type Row = { id: string; kind: "limit" | "stop"; side: "buy" | "sell"; symbol_in: string; symbol_out: string; decimals_in: number; decimals_out: number; amount_in: string; min_out: string; price: string; status: string; note: string | null; tx_hash: string | null; out_amount: string | null; created_at: string; token_in: string; contract: string };

let configCache: Promise<Record<string, string>> | null = null;
const contracts = () => (configCache ??= fetch("/api/orders/config", { cache: "no-store" }).then((r) => r.json()).then((d) => d.contracts || {}).catch(() => ({})));
async function post<T = any>(action: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/orders/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong. Please try again.");
  return d;
}
const WRAP_ABI = parseAbi(["function deposit() payable"]);
const fix = (n: number, d: number) => (isFinite(n) && n > 0 ? n.toFixed(Math.min(d, 12)) : "0");

/**
 * Limit and stop-loss orders. Signing an order is free; the only transactions are approving the exact amount (and, for
 * buys with BNB/ETH, wrapping it). The order fills automatically when the price is reached.
 */
export default function OrderForm({ c, signer, owner, side, kind, base, quote, market, balanceOf, onDone }: {
  c: WChain; signer: Signer; owner: string; side: "buy" | "sell"; kind: "limit" | "stop"; base: WToken; quote: WToken;
  market: Market | null; balanceOf: (a: string) => Holding | undefined; onDone: () => void;
}) {
  const [contract, setContract] = useState<string | null | undefined>(undefined);
  const quoteUsd = /^USD/.test(quote.symbol) ? 1 : balanceOf(quote.address)?.priceUsd ?? null;
  const marketPrice = market?.priceUsd && quoteUsd ? market.priceUsd / quoteUsd : null;
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState(STOP_SLIPPAGE_DEFAULT);
  const [days, setDays] = useState<number>(30);
  const [step, setStep] = useState(""); const [err, setErr] = useState(""); const [ok, setOk] = useState("");

  useEffect(() => { if (c.kind === "evm") contracts().then((m) => setContract(m[c.key] ?? null)); }, [c]);
  useEffect(() => { if (marketPrice && !price) setPrice(String(Number(marketPrice.toPrecision(6)))); }, [marketPrice]); // eslint-disable-line react-hooks/exhaustive-deps

  if (c.kind === "solana") return <div className="tx-note">Limit and stop-loss orders on Solana are coming next. Market orders work now.</div>;
  if (contract === undefined) return <div className="tx-dim">Loading…</div>;
  if (!contract) return <div className="tx-note">Limit and stop-loss orders open on {c.name} very soon. Market orders work now.</div>;

  const P = Number(price), A = Number(amount);
  const payToken = side === "sell" ? base : quote;
  const getToken = side === "sell" ? quote : base;
  const tokenIn = orderTokenIn(c, payToken.address);
  const tokenOut = isNative(c, getToken.address) ? NATIVE : getToken.address;
  const outQty = P > 0 && A > 0 ? (side === "sell" ? A * P : A / P) : 0;
  const bal = balanceOf(payToken.address);
  const wrappedBal = isNative(c, payToken.address) ? balanceOf(c.wrapped!) : undefined;
  const available = (bal?.amount ?? 0) + (wrappedBal?.amount ?? 0);
  const vs = marketPrice && P > 0 ? ((P - marketPrice) / marketPrice) * 100 : null;
  const instant = vs != null && (kind === "limit" ? (side === "sell" ? vs <= 0 : vs >= 0) : (side === "sell" ? vs >= 0 : vs <= 0));
  const problem = !P ? "Enter a price." : !A ? "Enter an amount." : A > available + 1e-12 ? `Not enough ${payToken.symbol}.` : "";
  const explain = kind === "limit"
    ? side === "sell" ? `Sells your ${base.symbol} when the price reaches ${price || "…"} ${quote.symbol} or higher.` : `Buys ${base.symbol} when the price drops to ${price || "…"} ${quote.symbol} or lower.`
    : side === "sell" ? `If the price falls to ${price || "…"} ${quote.symbol}, sells your ${base.symbol} to limit your loss (down to ${slip}% below the stop in a fast drop).` : `Buys ${base.symbol} once the price rises to ${price || "…"} ${quote.symbol} (breakout), paying up to ${slip}% above.`;

  function part(p: number) { const s = (available * p) / 100 * (p === 100 && isNative(c, payToken.address) ? 0.995 : 1); setAmount(s > 0 ? String(Math.floor(s * 1e8) / 1e8) : ""); }

  async function place() {
    setErr(""); setOk("");
    const ev = signer.evm!;
    const pc: any = createPublicClient({ chain: c.viem, transport: http(c.rpc) });
    try {
      const decIn = payToken.decimals, decOut = getToken.decimals;
      const amountIn = toUnits(amount, decIn)!;
      const target = toUnits(fix(outQty, decOut), decOut)!;
      const minOut = kind === "limit" ? target : (target * BigInt(100 - slip)) / 100n;
      // Buying with BNB/ETH: orders spend WBNB/WETH, so wrap whatever is missing first.
      if (isNative(c, payToken.address)) {
        const have: bigint = await pc.readContract({ address: c.wrapped!, abi: erc20Abi, functionName: "balanceOf", args: [ev.address] });
        if (have < amountIn) {
          setStep(`Wrapping ${amt(raw2num((amountIn - have).toString(), 18))} ${c.native.symbol} to use in the order…`);
          const h = await ev.send(c.chainId!, { to: c.wrapped!, value: (amountIn - have).toString(), data: encodeFunctionData({ abi: WRAP_ABI, functionName: "deposit" }) });
          await waitEvm(c, h);
        }
      }
      // Approve exactly this order plus your other open orders on the same token. Nothing more.
      const { orders } = await post<{ orders: Row[] }>("list", { chain: c.key, maker: ev.address });
      const open = orders.filter((o) => (o.status === "open" || o.status === "filling") && o.token_in.toLowerCase() === tokenIn.toLowerCase() && o.contract.toLowerCase() === contract!.toLowerCase());
      const need = open.reduce((s, o) => s + BigInt(o.amount_in), amountIn);
      const allowance: bigint = await pc.readContract({ address: tokenIn as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [ev.address, contract as `0x${string}`] });
      if (allowance < need) {
        setStep("Allow the order contract to use this amount (one transaction)…");
        const h = await ev.send(c.chainId!, { to: tokenIn as `0x${string}`, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [contract as `0x${string}`, need] }) });
        await waitEvm(c, h);
      }
      setStep("Sign your order (free, no transaction)…");
      const message = { maker: ev.address, tokenIn: tokenIn as `0x${string}`, tokenOut: tokenOut as `0x${string}`, amountIn, minOut,
        expiry: BigInt(Math.floor(Date.now() / 1000) + days * 86400), nonce: BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)) };
      const signature = await ev.signTyped(c.chainId!, { domain: orderDomain(c.chainId!, contract!), types: ORDER_TYPES, primaryType: "Order", message });
      setStep("Placing your order…");
      await post("create", {
        chain: c.key, kind, side, price: String(P), triggerOut: target.toString(), signature,
        symbolIn: payToken.symbol === c.native.symbol ? `W${c.native.symbol}` : payToken.symbol, symbolOut: getToken.symbol, decimalsIn: decIn, decimalsOut: decOut,
        order: { ...message, amountIn: amountIn.toString(), minOut: minOut.toString(), expiry: message.expiry.toString(), nonce: message.nonce.toString() },
      });
      setOk(`${kind === "limit" ? "Limit" : "Stop-loss"} order placed. It fills automatically when the price is reached.`);
      setAmount(""); onDone();
    } catch (e: any) { setErr(friendlyError(e, c.native.symbol)); }
    setStep("");
  }

  return (
    <div className="stack tx-form" style={{ gap: 10 }}>
      <div className="tx-field">
        <div className="row tx-field-top"><span>{kind === "limit" ? "Limit price" : "Stop price"} ({quote.symbol})</span>{marketPrice && <button type="button" className="aw-link" onClick={() => setPrice(String(Number(marketPrice.toPrecision(6))))}>Market {Number(marketPrice.toPrecision(5))}</button>}</div>
        <div className="row tx-field-mid"><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder="0.00" aria-label="Price" /><span className="tx-unit">{quote.symbol}</span></div>
        {vs != null && <small className={instant ? "down" : "tx-dim"}>{vs >= 0 ? "+" : ""}{vs.toFixed(2)}% vs market{instant ? (kind === "limit" ? ": fills right away" : ": would trigger right away") : ""}</small>}
      </div>
      <div className="tx-field">
        <div className="row tx-field-top"><span>{side === "sell" ? "Amount" : "Spend"}</span><span>Available <b>{amt(available)} {payToken.symbol}</b></span></div>
        <div className="row tx-field-mid"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder="0.00" aria-label="Amount" /><span className="tx-unit">{payToken.symbol}</span></div>
      </div>
      <div className="tx-parts">{[25, 50, 75, 100].map((p) => <button key={p} type="button" onClick={() => part(p)}>{p === 100 ? "Max" : `${p}%`}</button>)}</div>
      {kind === "stop" && (
        <label className="row tx-inline"><span>Room for a fast move</span>
          <select value={slip} onChange={(e) => setSlip(Number(e.target.value))}>{[2, 5, 10, 15, 20].map((s) => <option key={s} value={s}>{s}%</option>)}</select>
        </label>
      )}
      <label className="row tx-inline"><span>Expires in</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{EXPIRY_DAYS.map((d) => <option key={d} value={d}>{d === 1 ? "1 day" : `${d} days`}</option>)}</select>
      </label>
      <div className="aw-details">
        <div><span>{kind === "limit" ? "You get at least" : "You get about"}</span><b>{amt(outQty)} {getToken.symbol}</b></div>
        <div><span>Trading fee</span><b>{ORDER_FEE_BPS / 100}% when filled</b></div>
      </div>
      <small className="tx-dim">{explain} Your tokens stay in your wallet until then. Cancel any time.</small>
      {step ? <div className="aw-step"><span className="aw-spin" />{step}</div>
        : <button type="button" className={"tx-cta " + side} disabled={!!problem} onClick={place}>{problem || `${kind === "limit" ? "Place limit" : "Place stop-loss"} ${side === "buy" ? "buy" : "sell"}`}</button>}
      {err && <div className="aw-risk danger">{err}</div>}
      {ok && <div className="aw-risk ok">{ok}</div>}
    </div>
  );
}

/** The member's orders on this network, with cancel. */
export function OpenOrders({ c, signer, owner }: { c: WChain; signer: Signer; owner: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState("");
  const load = () => post<{ orders: Row[] }>("list", { chain: c.key, maker: owner }).then((d) => setRows(d.orders)).catch(() => setRows([]));
  useEffect(() => { if (c.kind === "evm") { load(); const t = setInterval(load, 20_000); return () => clearInterval(t); } setRows([]); }, [c.key, owner]); // eslint-disable-line react-hooks/exhaustive-deps
  if (c.kind === "solana") return <div className="tx-dim">Solana orders are coming next.</div>;
  if (!rows) return <div className="tx-dim">Loading orders…</div>;
  if (!rows.length) return <div className="tx-dim">No orders on {c.name} yet. Place a Limit or Stop-loss order from the order panel.</div>;
  async function cancel(id: string) {
    setMsg(""); setBusy(id);
    try {
      const signature = await signer.evm!.signMessage(cancelMessage(id));
      await post("cancel", { id, signature });
      setMsg("Order cancelled. You can also remove the approval in your wallet if you like.");
      load();
    } catch (e: any) { setMsg(friendlyError(e, c.native.symbol)); }
    setBusy("");
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="tx-table" role="table" aria-label="Orders">
        <div className="tx-tr head tx-orders" role="row"><span>Order</span><span className="n">Price</span><span className="n hide-sm">Amount</span><span>Status</span><span /></div>
        {rows.map((o) => (
          <div key={o.id} className="tx-tr tx-orders" role="row">
            <span><b className={o.side === "buy" ? "up" : "down"}>{o.kind === "limit" ? "Limit" : "Stop"} {o.side === "buy" ? "buy" : "sell"}</b><br /><small className="tx-dim">{o.side === "sell" ? `${o.symbol_in}/${o.symbol_out}` : `${o.symbol_out}/${o.symbol_in}`}</small></span>
            <span className="n">{Number(o.price).toPrecision(5)}</span>
            <span className="n hide-sm">{amt(raw2num(o.amount_in, o.decimals_in))} {o.symbol_in}</span>
            <span><b>{o.status === "open" ? "Open" : o.status === "filling" ? "Filling" : o.status === "filled" ? "Filled" : o.status === "cancelled" ? "Cancelled" : o.status === "expired" ? "Expired" : "Failed"}</b>
              {o.status === "filled" && o.out_amount ? <><br /><small className="up">{amt(raw2num(o.out_amount, o.decimals_out))} {o.symbol_out}</small></> : o.note && o.status === "open" ? <><br /><small className="tx-dim">{o.note}</small></> : null}</span>
            <span className="n">{o.status === "open" ? <button type="button" className="btn small" disabled={busy === o.id} onClick={() => cancel(o.id)}>{busy === o.id ? "…" : "Cancel"}</button>
              : o.tx_hash ? <a href={`${c.explorer}/tx/${o.tx_hash}`} target="_blank" rel="noopener noreferrer">View ↗</a> : null}</span>
          </div>
        ))}
      </div>
      {msg && <small className="tx-dim">{msg}</small>}
    </div>
  );
}
