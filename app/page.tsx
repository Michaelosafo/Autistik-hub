import Link from "next/link";
import AdBar from "@/components/AdBar";
import Art from "@/components/Art";
import TrendingNow from "@/components/TrendingNow";
import { GROUPS } from "@/lib/groups";
import { PHOTOS } from "@/lib/site";
import { supabaseServer } from "@/lib/supabase/server";
import { ads, getBoard, trending } from "@/lib/board";
import { toAds } from "@/lib/ads";

export const dynamic = "force-dynamic";

const STEPS: [string, string, string, string][] = [
  ["lounge", "1. Tell Autistik", "Chat with Autistik, our launch agent. Pick a chain, a name, a ticker and how much to add to the pool. No code, no forms.", "💬"],
  ["calm", "2. Sign once", "Check your launch plan and sign one transaction in your own wallet. We never hold your keys or your money.", "✍️"],
  ["spark", "3. Trade & trend", "Your token goes live on PancakeSwap or Uniswap, shows on DexScreener, and can trend here for everyone to see.", "🔥"],
];

const SAFE = ["Liquidity locked 6 months, 1 year, or burned", "No tax, no minting, no owner keys", "Every launch checked on-chain", "Listed on DexScreener automatically"];

export default async function Home() {
  const sb = supabaseServer();
  const [{ data: { user } }, board] = await Promise.all([sb.auth.getUser(), getBoard(60)]);
  const counts: Record<string, number> = {};
  if (user) {
    const { data: gm } = await sb.from("group_members").select("group_id");
    for (const r of gm || []) counts[r.group_id] = (counts[r.group_id] || 0) + 1;
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <AdBar ads={toAds(ads(board))} />

      <div className="hero">
        <div className="hero-copy">
          <div className="eyebrow">AUTISTIK Launch Pad</div>
          <h1>Launch your token in minutes. <span className="grad">Liquidity locked.</span></h1>
          <p>Tell Autistik your token&apos;s name and ticker, sign once in your wallet, and it goes live on PancakeSwap or Uniswap with its liquidity locked, so buyers can trust it. Simple, honest, and built by an autism community.</p>
          <div className="row">
            <Link className="btn primary" href="/launchpad/new">🚀 Launch a token</Link>
            <Link className="btn ghost" href="/launchpad">🔥 See trending</Link>
          </div>
        </div>
        <div className="hero-art"><Art kind="hero" photo={PHOTOS.hero.src} alt={PHOTOS.hero.alt} /></div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <div><div className="label">How it works</div><h2 style={{ marginTop: 4 }}>Three steps. That&apos;s it.</h2></div>
        <div className="truths">
          {STEPS.map(([g, title, text, icon]) => (
            <div key={title} className="truth" data-g={g}><b>{icon} {title}</b><p>{text}</p></div>
          ))}
        </div>
        <div className="chips">{SAFE.map((s) => <span key={s} className="chip">✓ {s}</span>)}</div>
      </div>

      <TrendingNow list={trending(board)} limit={5} />

      <div className="stack" style={{ gap: 12 }}>
        <div className="section-head"><div><div className="label">Community</div><h2 style={{ marginTop: 4 }}>Find your group</h2></div><Link className="btn small" href="/community">Open community</Link></div>
        <div className="groups-grid">
          {GROUPS.map((g) => (
            <div key={g.id} className="gcard" data-g={g.id}>
              <Art kind="group" id={g.id} photo={PHOTOS[g.id]?.src} alt={PHOTOS[g.id]?.alt} />
              <div className="gbody">
                <div><div className="tag">{g.tag}</div><h3 style={{ marginTop: 3 }}>{g.name}</h3></div>
                <p className="muted" style={{ fontSize: ".9em" }}>{g.desc}</p>
                <ul>{g.channels.map((c) => <li key={c.id}><span style={{ color: "var(--g)", fontWeight: 700 }}># </span>{c.title}</li>)}</ul>
                <div className="row">
                  <span className="muted" style={{ fontSize: ".84em" }}>{counts[g.id] ? `${counts[g.id]} member${counts[g.id] > 1 ? "s" : ""}` : "New group"}</span>
                  <Link className="btn g small" href={user ? `/community?g=${g.id}` : "/login?mode=join"}>{user ? "Open" : "Join"}</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card row" style={{ justifyContent: "space-between" }}>
        <div><b>Need a friendly chat?</b><p className="muted" style={{ fontSize: ".9em" }}>Believer and Purity, our AI companions, are here to talk, plan or draw with you.</p></div>
        <div className="row">
          <Link className="btn small" href="/companions?c=believer">Talk to Believer</Link>
          <Link className="btn small" href="/companions?c=purity">Talk to Purity</Link>
        </div>
      </div>

      <p className="muted" style={{ fontSize: ".9em", textAlign: "center" }}>
        Autism is not a disease. It&apos;s a community. <Link href="/autism">Learn more</Link> · Tokens can lose all their value; nothing here is financial advice.
      </p>
    </div>
  );
}
