"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Who = { id: string; alias: string; handle: string | null; color: string | null; is_team?: boolean; is_verified?: boolean };
type S = {
  signedIn: boolean;
  profile?: { alias: string; handle: string | null; color: string | null; is_team: boolean; team_title: string | null; is_verified: boolean } | null;
  following?: number; followers?: number; recent?: Who[];
  wallet?: { short: string; totalUsd: number | null; funds: { symbol: string; amount: number; valueUsd: number | null }[] } | null;
};

const usd = (n: number | null | undefined) => (n == null ? "–" : n < 0.01 && n > 0 ? "<$0.01" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }));
const amt = (n: number) => (n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toLocaleString("en-US", { maximumFractionDigits: 4 }));

/** The top of the App home: who you are, your badge, who you follow and what your wallet holds. */
export default function AppMe() {
  const [s, setS] = useState<S | null>(null);
  useEffect(() => { fetch("/api/me/summary", { cache: "no-store" }).then((r) => r.json()).then(setS).catch(() => setS({ signedIn: false })); }, []);

  if (!s) return <div className="ah-me" aria-busy="true"><div className="ah-me-load">Loading your account…</div></div>;
  if (!s.signedIn || !s.profile) {
    return (
      <div className="ah-me">
        <div className="ah-me-head"><div><b>Welcome to AUTISTIK</b><small>Sign in to see who you follow, your wallet and your badge.</small></div></div>
        <div className="ah-coin-cta"><Link className="ah-btn gold" href="/login?next=/app">Sign in / Join</Link><Link className="ah-btn" href="/analytics">Scan a coin</Link></div>
      </div>
    );
  }
  const p = s.profile;
  return (
    <div className="ah-me">
      <div className="ah-me-head">
        <span className="ah-me-av" aria-hidden="true" style={{ background: p.color || "#6141D4" }}>{p.alias.charAt(0)}</span>
        <div style={{ minWidth: 0 }}>
          <b>{p.alias}{p.is_team ? <span className="team-badge" style={{ marginLeft: 8 }}>✓ TEAM{p.team_title ? ` · ${p.team_title}` : ""}</span> : p.is_verified ? <span className="verified-badge" style={{ marginLeft: 8 }}>✓ VERIFIED</span> : null}</b>
          <small>{p.handle ? `@${p.handle}` : "Your AUTISTIK name"}</small>
        </div>
        <Link className="ah-btn ghost" href="/me">Profile</Link>
      </div>

      <div className="ah-me-grid">
        <section className="ah-me-box" aria-label="Wallet">
          <small>Funds in your wallet</small>
          {s.wallet ? (
            <>
              <strong>{usd(s.wallet.totalUsd)}</strong>
              <ul>
                {s.wallet.funds.length ? s.wallet.funds.map((f) => <li key={f.symbol}><span>{amt(f.amount)} {f.symbol}</span><span>{usd(f.valueUsd)}</span></li>) : <li><span>Nothing here yet</span></li>}
              </ul>
              <div className="ah-me-foot"><span className="mono">{s.wallet.short}</span><Link href="/wallet">Open wallet →</Link></div>
            </>
          ) : (
            <><strong>–</strong><p>Your free AUTISTIK wallet is being set up.</p><div className="ah-me-foot"><Link href="/wallet">Open wallet →</Link></div></>
          )}
        </section>

        <section className="ah-me-box" aria-label="Following">
          <small>Following</small>
          <strong>{s.following ?? 0}<em> · {s.followers ?? 0} followers</em></strong>
          <ul>
            {s.recent?.length ? s.recent.map((m) => (
              <li key={m.id}><Link href={`/members/${m.id}`}>{m.alias}{m.is_team ? <span className="team-badge" style={{ marginLeft: 6 }}>✓ TEAM</span> : m.is_verified ? <span className="verified-badge" style={{ marginLeft: 6 }}>✓</span> : null}</Link><span>{m.handle ? `@${m.handle}` : ""}</span></li>
            )) : <li><span>You aren&apos;t following anyone yet</span></li>}
          </ul>
          <div className="ah-me-foot"><Link href="/members">{s.following ? "See who you follow →" : "Find people to follow →"}</Link></div>
        </section>
      </div>
    </div>
  );
}
