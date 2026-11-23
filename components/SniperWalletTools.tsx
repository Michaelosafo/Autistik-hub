"use client";
import { liqQuery } from "@/lib/desk-query";
/**
 * Sniper wallet card, kept simple: the address, its USDT and gas coin, and its snipe amount.
 * net "bsc" (SniperBnbSol): the BNB Chain address, USDT + BNB. net "solana" (SniperLobbySol): the wallet's Solana
 * address, USDT + SOL, and create / import / show its Solana key. Snipes spend USDT; BNB / SOL only pay fees.
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
  const r = await fetch(`/api/ai-futures/${action}${liqQuery()}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

export default function SniperWalletTools({ slot, address: evmAddress, amounts, setChainAmount, net: netIn }: {
  slot: number; address: string; others?: { slot: number; address: string }[]; busy?: boolean; act?: Act;
  /** This wallet's snipe amount per chain, in $ (USDT). Only "bsc" is used. */
  amounts?: Record<string, number>; setChainAmount?: (chain: string, value: number | null) => void;
  net?: string;
}) {
  const sol = netIn === "solana";
  // SniperEth / SniperRobinhood: the same EVM address, its dollar coin and ETH on that chain.
  const v2 = netIn === "ethereum" || netIn === "robinhood";
  const net = sol ? "solana" : v2 ? (netIn as string) : "bsc", GAS = sol ? "SOL" : v2 ? "ETH" : "BNB";
  const STABLE = netIn === "robinhood" ? "USDG" : "USDT";
  const STD = sol ? "SPL" : netIn === "ethereum" ? "ERC20" : netIn === "robinhood" ? "Robinhood Chain" : "BEP20";
  const NETNAME = sol ? "Solana" : netIn === "ethereum" ? "Ethereum" : netIn === "robinhood" ? "Robinhood Chain" : "BNB Chain";
  const gasNeed = sol ? 0.01 : netIn === "ethereum" ? 0.003 : netIn === "robinhood" ? 0.0003 : GAS_BNB;
  const [solAddr, setSolAddr] = useState<string | null | undefined>(undefined); // undefined = still loading
  const [working, setWorking] = useState(false);
  const [again, setAgain] = useState(0);
  const address = sol ? solAddr || "" : evmAddress;
  const [hold, setHold] = useState<Holdings | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sol) return;
    let gone = false;
    ask<{ sol: string | null }>("sniper-card", { slot }).then((d) => { if (!gone) setSolAddr(d.sol || null); }).catch(() => { if (!gone) setSolAddr(null); });
    return () => { gone = true; };
  }, [slot, sol, again]);

  useEffect(() => {
    if (sol && !solAddr) { setHold(null); return; }
    let gone = false;
    setLoading(true);
    (v2
      ? ask<{ usd: number; sym: string; eth: number }>("sniper-v2-balances", { slot, net }).then((d): Holdings => ({ coin: "ETH", explorer: "", assets: [
          { address: "usd", symbol: d.sym, name: d.sym, decimals: 6, raw: "0", amount: d.usd, valueUsd: d.usd },
          { address: "eth", symbol: "ETH", name: "ETH", decimals: 18, raw: "0", amount: d.eth, valueUsd: null },
        ] }))
      : ask<Holdings>("sniper-balances", { slot, chain: net, extra: [] }))
      .then((d) => { if (!gone) setHold(d); })
      .catch((e) => { if (!gone) setErr((e as Error).message); })
      .finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [slot, net, sol, v2, solAddr]);

  async function solKey(action: "sniper-sol-create" | "sniper-sol-import") {
    let key = "";
    if (action === "sniper-sol-import") {
      key = prompt(`Paste the private key of your own Solana wallet for wallet ${slot} (Phantom / Solflare: Settings → Manage accounts → Show private key). It's stored encrypted.`)?.trim() || "";
      if (!key) return;
    }
    setWorking(true); setErr("");
    try { await ask(action, key ? { slot, key } : { slot }); setAgain((n) => n + 1); }
    catch (e) { setErr((e as Error).message); }
    finally { setWorking(false); }
  }
  async function showSolKey() {
    if (!confirm(`Show wallet ${slot}'s Solana private key? Anyone who sees it can take the money. Use it to import the wallet into Phantom or Solflare.`)) return;
    try {
      const r = await ask<{ key: string }>("sniper-sol-reveal", { slot });
      prompt(`Wallet ${slot} Solana private key. Phantom → Add wallet → Import private key. Keep it secret:`, r.key);
    } catch (e) { setErr((e as Error).message); }
  }

  const find = (sym: string) => (hold?.assets || []).find((a) => a.symbol.toUpperCase() === sym);
  const usdt = find(STABLE)?.amount ?? 0;
  const bnb = find(GAS)?.amount ?? 0;
  const bnbUsd = find(GAS)?.valueUsd ?? null;
  const cur = Number(amounts?.[net] || 0);

  function editAmount() {
    if (!setChainAmount) return;
    const v = prompt(`${STABLE} wallet ${slot} spends on each ${NETNAME} snipe (${GAS} is only used for fees). Leave empty to clear it:`, cur ? String(cur) : "");
    if (v == null) return;
    const x = Number(v);
    if (v.trim() && !(x > 0)) { setErr("Type an amount greater than zero, or leave it empty."); return; }
    setErr("");
    setChainAmount(net, v.trim() ? x : null);
  }

  if (sol && !solAddr) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        {solAddr === undefined ? <small className="muted">Reading the Solana address…</small> : <>
          <small className="muted">This wallet has no Solana address yet.</small>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="btn small" disabled={working} onClick={() => solKey("sniper-sol-create")}>{working ? "Working…" : "＋ Create Solana address"}</button>
            <button type="button" className="btn small ghost" disabled={working} onClick={() => solKey("sniper-sol-import")}>Import my Solana key</button>
          </div>
        </>}
        {err && <small className="aic-warn" role="alert">{err}</small>}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <code title={address}>{short(address)}</code>
        <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(address).then(() => setCopied(true), () => {}); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied ✓" : "Copy address"}</button>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        {loading && !hold ? <small className="muted">Reading balances…</small> : <>
          <span><b>{STABLE}</b> {usd(usdt)}</span>
          <span><b>{GAS}</b> {amt(bnb)}{bnbUsd != null ? <span className="muted"> ({usd(bnbUsd)})</span> : null} <small className="muted">fees</small></span>
        </>}
      </div>
      {hold && bnb < gasNeed && <small className="aic-warn">Needs about {gasNeed} {GAS} for fees.</small>}
      {setChainAmount && (
        <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <small>💵 <b>Snipe amount: {cur ? `${usd(cur)} ${STABLE}` : "not set"}</b>{hold && cur > usdt ? <span className="aic-warn"> · only {usd(usdt)} {STABLE} here</span> : null}</small>
          <button type="button" className="btn small" onClick={editAmount}>Set amount</button>
        </div>
      )}
      <small className="muted">Fund it with <b>{STABLE} on {NETNAME} ({STD})</b> to snipe, plus a little {GAS} for fees.</small>
      {sol && <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><button type="button" className="btn small ghost" onClick={showSolKey}>Show Solana private key</button></div>}
      {err && <small className="aic-warn" role="alert">{err}</small>}
    </div>
  );
}
