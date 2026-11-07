"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

const VOLUMES = [10_000, 50_000, 250_000, 1_000_000];
const usd = (n: number) => n >= 1000 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(n < 10 ? 2 : 0)}`;

/**
 * The Dev guide: a small button above the launch choice. It opens a pop-up with what a dev gets, an earnings
 * calculator and (for admins) the admin privileges, so none of it sits in the launch form itself.
 */
export default function DevPerks({ admin = false }: { admin?: boolean }) {
  const [vol, setVol] = useState(50_000);
  const [share, setShare] = useState(0);
  const [open, setOpen] = useState(false);
  // Instant: every trade pays the pool 1%, half of it is the creator's (some of that optionally to holders).
  const yours = vol * 0.005;
  const toHolders = (yours * share) / 100;
  const keep = yours - toHolders;
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  return (
    <>
    <button type="button" className="btn small perk-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>📘 Dev guide · read before you launch</button>
    {open && (
    <div className="perk-modal" role="presentation" onClick={() => setOpen(false)}>
    <section className="dev-perks perk-sheet" role="dialog" aria-modal="true" aria-labelledby="dev-perks-h" onClick={(e) => e.stopPropagation()}>
      <div className="perk-bar">
        <b id="dev-perks-h">📘 Dev guide: why launch with AUTISTIK</b>
        <button type="button" className="btn small" onClick={() => setOpen(false)} autoFocus>Close ✕</button>
      </div>
      <div className="stack" style={{ gap: 12, marginTop: 12 }}>
      <small className="muted">Free to launch · you only pay the network fee</small>
      <div className="perk-grid">
        <div className="perk"><span>💸</span><b>Half of every trade fee</b><small>Each trade pays 1%: half is yours, sent straight to your wallet automatically.</small></div>
        <div className="perk"><span>⚡</span><b>Live in one tap</b><small>No liquidity, no bonding curve. A name and a picture, and it trades.</small></div>
        <div className="perk"><span>🎁</span><b>Reward your holders</b><small>Optional: share your fees with holders in BNB, ETH, USDT, CAKE or any token.</small></div>
        <div className="perk"><span>🔒</span><b>Rug-proof by design</b><small>Liquidity locked forever. Buyers see it, and trust it.</small></div>
        <div className="perk"><span>🤖</span><b>Bot shield</b><small>Snipers blocked for the first 5 minutes: max 1% per buy.</small></div>
        <div className="perk"><span>🚀</span><b>First buy, before bots</b><small>Buy up to 5% at the starting price in the same transaction.</small></div>
        <div className="perk"><span>📈</span><b>Your own coin page</b><small>Chart, chat, holders, safety scan and the Board, from minute one.</small></div>
        <div className="perk"><span>🌍</span><b>4 networks</b><small>BNB Chain, Ethereum, Robinhood Chain and Solana.</small></div>
      </div>
      <div className="perk-calc">
        <b>🧮 What could you earn?</b>
        <small className="muted">If your coin trades this much a day:</small>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Daily trading volume">
          {VOLUMES.map((v) => <button key={v} type="button" role="radio" aria-checked={vol === v} className={"btn small" + (vol === v ? " primary" : "")} onClick={() => setVol(v)}>{v >= 1e6 ? "$1M" : `$${v / 1000}K`}</button>)}
        </div>
        <small className="muted">Share with holders:</small>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Share for holders">
          {[0, 25, 50, 100].map((n) => <button key={n} type="button" role="radio" aria-checked={share === n} className={"btn small" + (share === n ? " primary" : "")} onClick={() => setShare(n)}>{n === 0 ? "Keep all" : `${n}%`}</button>)}
        </div>
        <div className="perk-out">
          <div><small>You, per day</small><b>{usd(keep)}</b></div>
          <div><small>You, per month</small><b>{usd(keep * 30)}</b></div>
          {share > 0 && <div><small>Holders, per month</small><b>{usd(toHolders * 30)}</b></div>}
        </div>
        <small className="muted">An example, not a promise: most new coins trade little or nothing. Instant launch: 0.5% of trading volume goes to the creator. <Link href="/lockers/trust">How we keep it safe</Link></small>
      </div>
      {admin && (
        <div className="perk-calc lc-admin">
          <b>🛠️ Your admin privileges</b>
          <ul className="lc-facts" style={{ margin: 0 }}>
            <li><b>Pick any starting market cap</b> for your Instant launches (everyone else gets the normal one). Choose it in the 🛠️ box on the Instant form, then press <b>🚀 Start</b>.</li>
            <li><b>No $20 AUTISTIK check</b>: you launch with the admin permit.</li>
            <li><b>First buy before anyone</b>: up to 5% of the coins at your price, in the same transaction.</li>
            <li><b>Your creator fees</b> (50% of the 1% pool fee) go to the launching wallet automatically; the team share goes to the team wallet.</li>
            <li><b>Admin tools</b> at the bottom of the Create page: deploy contracts, allow team wallets, list tokens.</li>
          </ul>
        </div>
      )}
      </div>
    </section>
    </div>
    )}
    </>
  );
}
