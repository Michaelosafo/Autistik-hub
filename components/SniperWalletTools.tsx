"use client";
/**
 * ⚡ Sniper wallet card (BNB Chain only), kept simple: the address, its USDT and BNB, and its snipe amount.
 * Snipes spend USDT; BNB is only for gas. No swap, bridge, send or withdraw here.
 */
import { useEffect, useState } from "react";

type Act = (name: string, action: string, body: unknown, done?: string) => Promise<void>;
type Asset = { address: string; symbol: string; name: string; decimals: number; raw: string; amount: number; valueUsd: number | null };
type Holdings = { coin: string; explorer: string; coinUsd?: number | null; assets: Asset[] };

/** BNB a wallet should keep for the buy's gas. */
const GAS_BNB = 0.0015;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number) => `$${n >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toFixed(2)}`;
const amt = (n: number) => (n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : n > 0 ? n.toPrecision(4) : "0");

async function ask<T>(action: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/ai-futures/${action}?desk=liq`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

export default function SniperWalletTools({ slot, address, amounts, setChainAmount }: {
  slot: number; address: string; others?: { slot: number; address: string }[]; busy?: boolean; act?: Act;
  /** This wallet's snipe amount per chain, in $ (USDT). Only "bsc" is used. */
  amounts?: Record<string, number>; setChainAmount?: (chain: string, value: number | null) => void;
  net?: string;
}) {
  const [hold, setHold] = useState<Holdings | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let gone = false;
    setLoading(true);
    ask<Holdings>("sniper-balances", { slot, chain: "bsc", extra: [] })
      .then((d) => { if (!gone) setHold(d); })
      .catch((e) => { if (!gone) setErr((e as Error).message); })
      .finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [slot]);

  const find = (sym: string) => (hold?.assets || []).find((a) => a.symbol.toUpperCase() === sym);
  const usdt = find("USDT")?.amount ?? 0;
  const bnb = find("BNB")?.amount ?? 0;
  const bnbUsd = find("BNB")?.valueUsd ?? null;
  const cur = Number(amounts?.bsc || 0);

  function editAmount() {
    if (!setChainAmount) return;
    const v = prompt(`USDT wallet ${slot} spends on each snipe (BNB is only used for gas). Leave empty to clear it:`, cur ? String(cur) : "");
    if (v == null) return;
    const x = Number(v);
    if (v.trim() && !(x > 0)) { setErr("Type an amount greater than zero, or leave it empty."); return; }
    setErr("");
    setChainAmount("bsc", v.trim() ? x : null);
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <code title={address}>{short(address)}</code>
        <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(address).then(() => setCopied(true), () => {}); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied ✓" : "Copy address"}</button>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        {loading && !hold ? <small className="muted">Reading balances…</small> : <>
          <span><b>USDT</b> {usd(usdt)}</span>
          <span><b>BNB</b> {amt(bnb)}{bnbUsd != null ? <span className="muted"> ({usd(bnbUsd)})</span> : null} <small className="muted">gas</small></span>
        </>}
      </div>
      {hold && bnb < GAS_BNB && <small className="aic-warn">Needs about {GAS_BNB} BNB for gas.</small>}
      {setChainAmount && (
        <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <small>💵 <b>Snipe amount: {cur ? `${usd(cur)} USDT` : "not set"}</b>{hold && cur > usdt ? <span className="aic-warn"> · only {usd(usdt)} USDT here</span> : null}</small>
          <button type="button" className="btn small" onClick={editAmount}>Set amount</button>
        </div>
      )}
      <small className="muted">Fund it with <b>USDT on BNB Chain (BEP20)</b> to snipe, plus a little BNB for gas.</small>
      {err && <small className="aic-warn" role="alert">{err}</small>}
    </div>
  );
}
