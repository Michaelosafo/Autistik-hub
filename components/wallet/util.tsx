"use client";
import { useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http } from "viem";
import { KYBER_ROUTER, isTokenAddress, type WChain, type WToken } from "@/lib/wallet-chains";
import type { Signer } from "./types";
import { reportActivity } from "@/lib/activity-client";

export type Risk = { level: "ok" | "warn" | "danger" | "unknown"; notes: string[]; buyTax: number; sellTax: number; honeypot: boolean };
export type TokenInfo = WToken & { priceUsd: number | null; risk: Risk };
export type Holding = WToken & { raw: string; amount: number; priceUsd: number | null; valueUsd: number | null };
export type Quote = { kind: string; chain: string; tokenIn: string; tokenOut: string; amountIn: string; amountOut: string; inUsd: number | null; outUsd: number | null; impact: number | null; feeBps: number; gasUsd: number | null; route: any };
export type Market = { pair: string | null; dex: string | null; priceUsd: number | null; priceNative: number | null; change24: number | null; change1h: number | null; volume24: number | null; liquidity: number | null; mcap: number | null; buys24: number | null; sells24: number | null; logo: string | null };
export type Trade = { at: number; chain: string; side: "buy" | "sell" | "convert"; pay: string; get: string; hash: string };

export async function api<T = any>(action: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/wallet/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong. Please try again.");
  return d;
}
export const usd = (v: number | null | undefined) => v == null || !isFinite(v) ? "–" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : v > 0 ? `$${v.toPrecision(4).replace(/\.?0+$/, "")}` : "$0";
export const amt = (v: number) => !isFinite(v) || v === 0 ? "0" : v < 0.0001 ? v.toPrecision(3) : v < 1 ? v.toFixed(6).replace(/0+$/, "") : v < 10_000 ? v.toLocaleString("en-US", { maximumFractionDigits: 4 }) : v.toLocaleString("en-US", { maximumFractionDigits: 0 });
export const pct = (v: number | null | undefined) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
export const raw2num = (raw: string, d: number) => Number(BigInt(raw)) / 10 ** d;
export const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
export function addTrade(t: Trade) {
  store.set("aw-history", [t, ...store.get<Trade[]>("aw-history", [])].slice(0, 50));
  reportActivity("swap", t.chain, t.hash, `${t.side === "convert" ? "Swapped" : t.side === "buy" ? "Bought" : "Sold"} ${t.pay} → ${t.get}`);
}

export function Logo({ t, size = 34 }: { t: { symbol: string; logo?: string | null }; size?: number }) {
  const [bad, setBad] = useState(false);
  return t.logo && !bad
    ? <img className="aw-logo" src={t.logo} alt="" width={size} height={size} onError={() => setBad(true)} />
    : <span className="aw-logo ph" style={{ width: size, height: size }}>{t.symbol.slice(0, 2).toUpperCase()}</span>;
}

export function TokenPicker({ c, tokens, value, onPick, onAdd, label, balanceOf, big }: {
  c: WChain; tokens: WToken[]; value: WToken | null; onPick: (t: WToken) => void; onAdd: (t: WToken) => void; label: string; balanceOf: (a: string) => Holding | undefined; big?: boolean;
}) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const found = tokens.filter((t) => !q || t.symbol.toLowerCase().includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase()) || t.address.toLowerCase() === q.toLowerCase());
  async function paste(a: string) {
    setErr(""); setBusy(true);
    try { const d = await api<{ token: TokenInfo }>("token", { chain: c.key, address: a }); onAdd(d.token); onPick(d.token); setOpen(false); setQ(""); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <>
      <button type="button" className={big ? "tx-pairbtn" : "aw-pick"} onClick={() => setOpen(true)} aria-label={label}>
        {value ? <><Logo t={value} size={big ? 30 : 24} /><b>{value.symbol}</b></> : <b>Select</b>}<span aria-hidden="true" className="tx-caret">▾</span>
      </button>
      {open && (
        <div className="aw-sheet" role="dialog" aria-label={label} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="aw-sheet-in">
            <div className="row" style={{ justifyContent: "space-between" }}><b>{label}</b><button type="button" className="btn small" onClick={() => setOpen(false)}>Close</button></div>
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); const v = e.target.value.trim(); if (isTokenAddress(c, v) && !tokens.some((t) => t.address.toLowerCase() === v.toLowerCase())) paste(v); }}
              placeholder="Search, or paste any token address" spellCheck={false} autoComplete="off" />
            {busy && <small className="muted">Looking up token…</small>}
            {err && <small className="scan-err">{err}</small>}
            <div className="aw-list">
              {found.map((t) => { const h = balanceOf(t.address); return (
                <button key={t.address} type="button" className="aw-row" onClick={() => { onPick(t); setOpen(false); setQ(""); }}>
                  <Logo t={t} size={30} /><span className="grow"><b>{t.symbol}</b><small>{t.name}</small></span>
                  {h && h.amount > 0 && <span className="aw-num"><b>{amt(h.amount)}</b></span>}
                </button>
              ); })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function RiskBox({ r, symbol }: { r: Risk; symbol: string }) {
  if (r.level === "ok") return <div className="aw-risk ok">{symbol} passed the safety checks.</div>;
  if (r.level === "unknown") return <div className="aw-risk warn">No safety data for {symbol} yet. New tokens are risky: start small.</div>;
  return <div className={"aw-risk " + r.level}><b>{r.level === "danger" ? "High risk" : "Note"}: {symbol}</b><ul>{r.notes.map((n) => <li key={n}>{n}</li>)}</ul></div>;
}

/** Waits for an EVM transaction, from the browser. */
export async function waitEvm(c: WChain, hash: `0x${string}`) {
  const pc: any = createPublicClient({ chain: c.viem, transport: http(c.rpc) });
  const r = await pc.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error("The transaction failed on the network. Nothing was traded (only the network fee was used).");
}
/** Signs a Solana transaction in the member's wallet, sends it, and waits for it to confirm. */
export async function sendSol(signer: Signer, txBase64: string): Promise<string> {
  const signed = await signer.sol!.sign(txBase64);
  const { signature } = await api<{ signature: string }>("sol-send", { tx: signed });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { status } = await api<{ status: string }>("sol-status", { sig: signature }).catch(() => ({ status: "pending" }));
    if (status === "done") return signature;
    if (status === "failed") throw new Error("The transaction failed on Solana. Nothing was traded.");
  }
  return signature;
}
export const friendlyError = (e: any, native: string) => {
  const m = String(e?.shortMessage || e?.message || e);
  return /reject|denied|cancel/i.test(m) ? "You cancelled it. Nothing was sent." : /insufficient funds|exceeds balance/i.test(m) ? `Not enough ${native} to pay the network fee.` : m.slice(0, 220);
};

/**
 * Runs a quoted trade from the member's own wallet: build it on the server, check it goes only to a known swap
 * contract, approve exactly the amount (tokens only), send, and wait. Returns the transaction hash.
 */
export async function runTrade(c: WChain, signer: Signer, owner: string, q: Quote, from: WToken, slippageBps: number, step: (s: string) => void): Promise<string> {
  if (c.kind === "solana") {
    step("Preparing your trade…");
    const { tx } = await api<{ tx: { kind?: string; tx: string; requestId?: string; gasless?: boolean; sponsored?: boolean } }>("build", { chain: c.key, quote: q, from: owner, slippageBps });
    if (tx.kind === "ultra") {
      step(tx.gasless ? "Approve in your wallet… (network fee: free)" : "Approve in your wallet…");
      const signed = await signer.sol!.sign(tx.tx);
      step("Swapping…");
      const { signature } = await api<{ signature: string }>("sol-ultra", { tx: signed, requestId: tx.requestId, sponsored: !!tx.sponsored, from: owner });
      return signature;
    }
    step("Approve in your wallet…");
    return sendSol(signer, tx.tx);
  }
  const ev = signer.evm!;
  step("Preparing your trade…");
  const { tx } = await api<{ tx: { to: `0x${string}`; data: `0x${string}`; value: string; spender: `0x${string}` | null } }>("build", { chain: c.key, quote: q, from: owner, slippageBps });
  // Never send to a contract we don't expect, even if the server were tampered with.
  const allowed = [KYBER_ROUTER, c.v2Router].filter(Boolean).map((a) => getAddress(a!));
  if (!allowed.includes(getAddress(tx.to))) throw new Error("Unexpected swap contract. Stopped for your safety.");
  if (tx.spender) {
    const pc: any = createPublicClient({ chain: c.viem, transport: http(c.rpc) });
    const have: bigint = await pc.readContract({ address: from.address as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [ev.address, tx.spender] });
    if (have < BigInt(q.amountIn)) {
      // The exact amount only: no unlimited approvals left lying around.
      step(`Step 1 of 2: allow this trade to use your ${from.symbol}…`);
      const h = await ev.send(c.chainId!, { to: from.address as `0x${string}`, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [tx.spender, BigInt(q.amountIn)] }) });
      await waitEvm(c, h);
    }
    step("Step 2 of 2: confirm in your wallet…");
  } else step("Confirm in your wallet…");
  const hash = await ev.send(c.chainId!, { to: tx.to, data: tx.data, value: tx.value });
  step("Waiting for the network…");
  await waitEvm(c, hash);
  return hash;
}
