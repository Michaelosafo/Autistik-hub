import Link from "next/link";
import { getAddress } from "viem";
import SectionCards, { LAUNCH_CARDS } from "@/components/SectionCards";
import TokenLogo from "@/components/TokenLogo";
import PinButton from "@/components/PinButton";
import MomentumAlerts from "@/components/MomentumAlerts";
import AutoRefresh from "@/components/AutoRefresh";
import ProHero from "@/components/ProHero";
import { isWChain } from "@/lib/wallet-chains";
import { MOMENTUM_CHAINS, chainName, isMomentumChain, usd, type Pick } from "@/lib/momentum";
import { momentum, trackRecord } from "@/lib/momentum-server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const metadata = { title: "Momentum · AUTISTIK Hub", description: "Tokens with unusual volume and buying right now, with suggested buy and sell levels." };

const pct = (v: number | undefined) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}%`);
const age = (h: number | null) => (h == null ? "–" : h < 1 ? "<1h" : h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`);
const addr = (p: Pick) => (p.chain === "solana" ? p.token : (() => { try { return getAddress(p.token); } catch { return p.token; } })());

export default async function MomentumPage({ searchParams }: { searchParams: { chain?: string; show?: string } }) {
  const chain = isMomentumChain(searchParams.chain) ? searchParams.chain : null;
  const all = searchParams.show === "all";
  const user = await currentUser();
  const [picks, record, pins] = await Promise.all([
    momentum(chain ? [chain] : undefined),
    trackRecord().catch(() => null),
    user ? supabaseServer().from("token_pins").select("chain,token").eq("user_id", user.id).then((r) => r.data || []) : Promise.resolve([] as any[]),
  ]);
  const pinned = new Set(pins.map((p: any) => `${p.chain}:${String(p.token).toLowerCase()}`));
  const shown = picks.filter((p) => all || p.level === "hot" || p.level === "building").slice(0, 30);
  const href = (c: string | null, a = all) => `/momentum?${new URLSearchParams({ ...(c ? { chain: c } : {}), ...(a ? { show: "all" } : {}) })}`;

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <AutoRefresh seconds={120} />
      <SectionCards items={LAUNCH_CARDS} active="/momentum" label="Launch" />
      <ProHero tone="gold" kicker="AUTISTIK · MOMENTUM SCANNER" title="🚀 Fast movers" live="Scanning"
        text="Tokens where volume and buying are suddenly much higher than normal, scored for how likely a quick move up (like 2x) is, with a suggested buy range, take-profit steps and a stop."
        stats={[[picks.filter((p) => p.level === "hot").length, "hot now"], [picks.filter((p) => p.level === "building").length, "building"], [record && record.picks ? `${Math.round((record.hit2x / record.picks) * 100)}%` : "–", "hot picks hit 2x (7d)"], ["2 min", "refresh"]]} />
      <div className="notice warn" style={{ fontSize: ".9em" }}>
        ⚠️ <b>Suggestions only, not financial advice.</b> Fast movers are the riskiest tokens there are: many drop as fast as they rise. Only use money you can afford to lose, take profit in steps and always use a stop.
      </div>

      {record && record.picks > 0 && (
        <div className="card stack" style={{ gap: 6 }}>
          <b>📈 Honest track record: Hot picks from the last 7 days</b>
          <div className="mo-stats">
            <span><b>{record.picks}</b> picks</span>
            <span className="up"><b>{record.hit2x}</b> reached 2x ({Math.round((record.hit2x / record.picks) * 100)}%)</span>
            <span className="up"><b>{record.hit15}</b> reached 1.5x ({Math.round((record.hit15 / record.picks) * 100)}%)</span>
            <span className="down"><b>{record.hitStop}</b> hit the −20% stop first ({Math.round((record.hitStop / record.picks) * 100)}%)</span>
            {record.best && record.best.x >= 1.2 && <span>Best: <b>${record.best.symbol} {record.best.x.toFixed(1)}x</b></span>}
          </div>
          <small className="muted">Each pick is followed for 48 hours from the price when it was picked. Past results don&apos;t promise future ones.</small>
        </div>
      )}

      <MomentumAlerts signedIn={!!user} />

      <nav className="chips" aria-label="Chain">
        <Link className="chip" href={href(null)} aria-current={!chain ? "page" : undefined}>All chains</Link>
        {MOMENTUM_CHAINS.map((c) => <Link key={c.key} className="chip" href={href(c.key)} aria-current={chain === c.key ? "page" : undefined}>{c.name}</Link>)}
        <Link className="chip" href={href(chain, !all)}>{all ? "Only Hot & Building" : "Show all"}</Link>
      </nav>

      {!shown.length && <div className="card muted">Nothing is heating up on {chain ? chainName(chain) : "these chains"} right now. Check back soon, or turn on alerts above and we&apos;ll tell you.</div>}

      {shown.map((p) => {
        const token = addr(p);
        return (
          <article key={p.chain + p.pool} id={p.pool.toLowerCase()} className={`card stack mo-card ${p.level}`} style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <div className="row" style={{ gap: 10, alignItems: "center", minWidth: 0 }}>
                <TokenLogo src={p.image} symbol={p.symbol} big />
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0 }}>${p.symbol} <small className="muted" style={{ fontWeight: 400 }}>{p.name}</small></h3>
                  <small className="muted">{chainName(p.chain)} · {usd(p.price)} · <span className={(p.change.m5 ?? 0) >= 0 ? "up" : "down"}>5m {pct(p.change.m5)}</span> · <span className={(p.change.h1 ?? 0) >= 0 ? "up" : "down"}>1h {pct(p.change.h1)}</span> · <span className={(p.change.h24 ?? 0) >= 0 ? "up" : "down"}>24h {pct(p.change.h24)}</span></small>
                </div>
              </div>
              <div className={`mo-score ${p.level}`} title="Momentum score out of 100">{p.score}<small>/100</small></div>
            </div>
            <b>{p.label}</b>
            <div className="mo-stats">
              <span>Volume 1h <b>{usd(p.volume.h1)}</b> ({p.volX.toFixed(1)}x normal)</span>
              <span>Buyers <b>{Math.round(p.buyerShare * 100)}%</b></span>
              <span>Pool <b>{usd(p.liquidity)}</b></span>
              <span>Mcap <b>{usd(p.mcap)}</b></span>
              <span>Age <b>{age(p.ageHours)}</b></span>
            </div>
            <div className={`mo-plan ${p.action}`}>
              <b>💡 Suggestion: {p.actionText}</b>
              {p.buy && (p.action === "buy" || p.action === "dip") && (
                <div className="mo-levels">
                  <span>🎯 Take profit 1: <b>{usd(p.tp1)}</b> (1.5x, sell about a third)</span>
                  <span>🚀 Take profit 2: <b>{usd(p.tp2)}</b> (2x, sell another third)</span>
                  <span>🛑 Stop: <b>{usd(p.stop)}</b> (−20%, get out)</span>
                </div>
              )}
              <small className="muted">Time frame: hours to a few days. Move your stop up to your buy price once take profit 1 is hit.</small>
            </div>
            <ul className="mo-why">
              {p.signs.slice(0, 4).map((s, i) => <li key={i} className={s.lean > 0 ? "up" : s.lean < 0 ? "down" : ""}>{s.lean > 0 ? "✓" : s.lean < 0 ? "✗" : "•"} {s.text}</li>)}
              {p.risks.map((r, i) => <li key={"r" + i} className="down">⚠ {r}</li>)}
            </ul>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
              {isWChain(p.chain) && <Link className="btn small primary" href={`/wallet?chain=${p.chain}&buy=${token}`}>💳 Buy</Link>}
              <Link className="btn small" href={`/analytics/${p.chain}/${token}`}>📊 Full analysis</Link>
              <PinButton signedIn={!!user} chain={p.chain} token={token} pinned={pinned.has(`${p.chain}:${token.toLowerCase()}`)} />
              <a className="btn small" href={`https://dexscreener.com/${p.chain}/${p.pool}`} target="_blank" rel="noopener noreferrer">DexScreener ↗</a>
            </div>
          </article>
        );
      })}
      <p className="muted" style={{ fontSize: ".85em" }}>Data: GeckoTerminal (trending pools, volume, buyers) and GoPlus (safety). Score: volume vs its normal pace, trading vs pool size, buyers vs sellers, price trend (overheated moves lose points), room to grow and safety. Not financial advice.</p>
    </div>
  );
}
