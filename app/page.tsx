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

const TICKER = ["Not a disease", "A community", "Different, not less", "Nothing about us without us", "Every mind on the spectrum", "Not broken", "Neurodiversity is strength", "Autistic and proud"];

// Everything AUTISTIK offers, in one place. [icon, title, what it does, link, button]
const UTILITIES: [string, string, string, string, string][] = [
  ["i-rocket", "Launch Pad", "Launch your own token with Autistik, our launch agent. Liquidity locked or burned so buyers can trust it.", "/launchpad/new", "Launch a token"],
  ["i-trend", "Trending", "See the tokens people are buying and watching, with live prices. Pay to trend or list your token.", "/launchpad", "See trending"],
  ["i-com", "Community", "Two friendly groups: Spectrum Lounge to hang out, and Support & Questions for hard days and help.", "/community", "Find your group"],
  ["i-kai", "Companion assistants", "Believer and Purity: two assistant friends who talk, plan, explain social situations and draw pictures with you.", "/companions", "Start a chat"],
  ["i-ses", "Live sessions", "Talks, Q&As and support circles with practitioners the AUTISTIK team has checked.", "/sessions", "See sessions"],
  ["i-rew", "Rewards & airdrops", "Earn points by taking part. Link your wallet and claim $AUTISTIK airdrops each round.", "/rewards", "My rewards"],
  ["i-buy", "Buy $AUTISTIK", "The community token on BNB Chain. Holders support the Hub and get a say in what we build.", "/buy", "Buy $AUTISTIK"],
  ["i-learn", "Understanding autism", "Plain-language facts about autism, written with autistic people. Share it with family and friends.", "/autism", "Learn more"],
];

const STEPS: [string, string, string, string][] = [
  ["lounge", "1. Tell Autistik", "Chat with Autistik, our launch agent. Pick a chain, a name, a ticker and how much to add to the pool. No code, no forms.", "💬"],
  ["calm", "2. Sign once", "Check your launch plan and sign one transaction in your own wallet. We never hold your keys or your money.", "✍️"],
  ["spark", "3. Trade & trend", "Your token goes live on PancakeSwap or Uniswap, shows on DexScreener, and can trend here for everyone to see.", "🔥"],
];

const SAFE = ["Liquidity locked 6 months, 1 year, or burned", "Tax capped at 10%, no minting", "Every launch checked on-chain", "Listed on DexScreener automatically"];

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

      <div>
        <div className="hero">
          <div className="hero-copy">
            <div className="eyebrow">Autism awareness × Web3 community</div>
            <h1>Autism is not a disease. <span className="grad">It&apos;s a community.</span></h1>
            <p>Autistic minds aren&apos;t broken and don&apos;t need a cure. They need understanding, connection and a place to belong. Here you&apos;ll find two friendly groups, two companion assistants called Believer and Purity, live talks with practitioners, a launch pad for your own token, and airdrops for the people who show up.</p>
            <div className="row">
              <Link className="btn primary" href={user ? "/community" : "/login?mode=join"}>{user ? "Join a group" : "Join the Hub"}</Link>
              <Link className="btn ghost" href="/start">New here? Start here</Link>
              <Link className="btn ghost" href="/autism">What is autism?</Link>
            </div>
            <div className="an-metrics">
              <div><b>{board.length}</b><span>tokens trending</span></div>
              <div><b>{GROUPS.length}</b><span>groups</span></div>
              <div><b>2</b><span>AI companions</span></div>
              <div><b>24/7</b><span>live</span></div>
            </div>
          </div>
          <div className="hero-art"><Art kind="hero" photo={PHOTOS.hero.src} alt={PHOTOS.hero.alt} /></div>
        </div>
        <div className="ticker" aria-hidden="true"><div>{[...TICKER, ...TICKER].map((t, i) => <span key={i}><i>∞</i> {t.toUpperCase()}</span>)}</div></div>
      </div>

      <div className="truths">
        <div className="truth" data-g="lounge"><b>Not a disease</b><p>Autism is a lifelong neurological difference in how a brain senses, thinks and communicates. There&apos;s nothing to catch and nothing to cure.</p></div>
        <div className="truth" data-g="calm"><b>A spectrum, not a scale</b><p>Every autistic person has a different mix of strengths and support needs. &quot;Mild&quot; and &quot;severe&quot; don&apos;t tell the story.</p></div>
        <div className="truth" data-g="spark"><b>Nothing about us without us</b><p>Autistic people lead here. Supporters, families and practitioners join in to listen and help.</p></div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <div><div className="label">Utilities</div><h2 style={{ marginTop: 4 }}>What you can do on AUTISTIK</h2></div>
        <div className="utils">
          {UTILITIES.map(([icon, title, text, href, cta]) => (
            <Link key={title} href={href} className="util">
              <svg aria-hidden="true"><use href={"#" + icon} /></svg>
              <b>{title}</b>
              <p className="muted">{text}</p>
              <span className="util-cta">{cta} →</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="hero launch-hero">
        <div className="hero-copy">
          <div className="eyebrow">AUTISTIK Launch Pad</div>
          <h2>Launch your token in minutes. <span className="grad">Liquidity locked.</span></h2>
          <p>Tell Autistik your token&apos;s name and ticker, sign once in your wallet, and it goes live on PancakeSwap or Uniswap with its liquidity locked, so buyers can trust it. Simple, honest, and built by an autism community.</p>
          <div className="row">
            <Link className="btn primary" href="/launchpad/new">Launch a token</Link>
            <Link className="btn ghost" href="/launchpad">See trending</Link>
          </div>
        </div>
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
        <div><b>Need a friendly chat?</b><p className="muted" style={{ fontSize: ".9em" }}>Believer and Purity, our companion assistants, are here to talk, plan or draw with you.</p></div>
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
