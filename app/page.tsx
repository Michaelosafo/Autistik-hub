import { fmtUsd } from "@/lib/num-format";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import LangPicker from "@/components/LangPicker";
import Art from "@/components/Art";
import CopyAddress from "@/components/CopyAddress";
import MeButton from "@/components/MeButton";
import Avatar from "@/components/Avatar";
import TypeText from "@/components/TypeText";
import TypeLoop from "@/components/TypeLoop";
import TypeSoundToggle from "@/components/TypeSoundToggle";
import { SeqReveal, Words } from "@/components/Sequence";
import { LogoBadge } from "@/components/LogoMark";
import Wordmark from "@/components/Wordmark";
import TokenLogo from "@/components/TokenLogo";
import ToolIcon, { type IconName } from "@/components/ToolIcon";
import { GROUPS, TOKEN_ADDRESS } from "@/lib/groups";
import { getMarkets, type Market } from "@/lib/market";
import { LISTINGS, buyLink } from "@/lib/listings";
import { CHAINS, type ChainKey } from "@/lib/launchpad";
import { isWChain } from "@/lib/wallet-chains";
import { LINKS, PHOTOS } from "@/lib/site";
import { getBoard, trending, type BoardToken } from "@/lib/board";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";

// The vision in plain words, for someone new to autism, crypto or both. [question, answer, icon]
// The hero's second line keeps typing through these.
const HERO_LOOP = ["It's a different way of thinking.", "It's a source of strength.", "It's a community.", "It's a way of being."];

const WHY: { q: string; a: string; icon: IconName }[] = [
  { q: "What is AUTISTIK?", a: "A website and app where autistic people, their families and supporters connect, learn and find support, with simple, secure crypto (digital money) tools explained in plain language.", icon: "groups" },
  { q: "Why autism?", a: "Autism is a different way of experiencing the world, not something to be fixed. Many autistic people are still misunderstood, left out at school, at work and online, and find it hard to get the right support. We focus on this one cause so we can do it well: a welcoming place to belong, and practical help when it's needed.", icon: "heart" },
  { q: "How does it help?", a: "A portion of all trading activity on AUTISTIK flows into the AUTISTIK Fund, which will cover therapy, equipment, education and everyday essentials for autistic people and their families. The Fund opens soon.", icon: "rewards" },
  { q: "Who is it for?", a: "Autistic adults, families, carers, supporters, practitioners and organisations, including people who have never used crypto before. Joining the community is free.", icon: "chat" },
  { q: "Who builds it?", a: "AUTISTIK is built by and for the autistic community and the people who care about them. Autistic people lead, with families, supporters and practitioners alongside. Nothing about us without us.", icon: "live" },
  { q: "Is it safe?", a: "We will never ask for your password or recovery phrase, health information is never stored on the blockchain, and any token can be checked with our scanner before you buy. Calm mode and larger text make the site easier to use.", icon: "scan" },
];

// How using AUTISTIK turns into support, in three steps. [title, text]
const STEPS: [string, string][] = [
  ["Join and take part", "Members connect in the community groups, and anyone can buy, swap or stake tokens on AUTISTIK."],
  ["Activity builds the Fund", "A portion of that trading activity is set aside in the AUTISTIK Fund."],
  ["The Fund reaches people", "Therapy, equipment, education and everyday essentials for autistic individuals and their families."],
];

// The App's main tools, each opening its own screen.
const PRODUCTS: { title: string; text: string; href: string; tag: string; icon: IconName; points: string[] }[] = [
  { title: "Swap", text: "Trade any token at the best available price across leading DEXs.", href: "/swap", tag: "Trade", icon: "swap", points: ["BNB Chain, Base, Ethereum, Arbitrum, Solana", "Cross-chain in one step"] },
  { title: "Stake", text: "Stake $AUTISTIK and earn BNB from platform fees.", href: "/stake", tag: "Earn", icon: "stake", points: ["Paid in BNB", "Up to 3x for longer locks"] },
  { title: "Lockers", text: "Lock liquidity or team tokens on-chain, so buyers can trust a project.", href: "/lockers", tag: "Lock", icon: "lock", points: ["Liquidity and team tokens", "Public proof for buyers"] },
  { title: "Launch Pad", text: "Launch your own token in minutes, with no code.", href: "/launchpad/new", tag: "Launch", icon: "launch", points: ["Liquidity locked or burned", "Live on the board straight away"] },
  { title: "Token scanner", text: "Holders, whales, developer wallets and safety checks for any token.", href: "/analytics", tag: "Scanner", icon: "scan", points: ["Honeypot and tax checks", "Explained in plain words"] },
  { title: "Wallet", text: "Your own self-custody wallet: your keys, your coins.", href: "/wallet", tag: "Wallet", icon: "wallet", points: ["Every network in one place", "Limit and stop-loss orders"] },
];

const COMMUNITY: { title: string; text: string; href: string; icon: IconName }[] = [
  { title: "Groups", text: "Spectrum Lounge for everyday conversation, and Support & Questions for the harder days.", href: "/community", icon: "groups" },
  { title: "Companions", text: "Believer and Purity, two AI companions to talk, plan and create with.", href: "/companions", icon: "chat" },
  { title: "Live sessions", text: "Talks and support circles led by verified practitioners.", href: "/sessions", icon: "live" },
  { title: "AUTISTIK Fund", text: "Direct support for autistic people and their families.", href: "/fund", icon: "heart" },
];

// What the Fund pays for. [icon, title, text]
const FUND: [IconName, string, string][] = [
  ["heart", "Therapy", "Sessions with verified practitioners"],
  ["tool", "Equipment", "Sensory and assistive tools"],
  ["book", "Education", "Courses, tutoring and training"],
  ["basket", "Everyday essentials", "Help with day-to-day costs"],
];

const pct = (v: number | null | undefined) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const tone = (v: number | null | undefined) => (v == null ? "" : v >= 0 ? "up" : "down");
const usd = (v: number | null | undefined) => (v == null ? "–" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1 ? `$${v.toFixed(2)}` : fmtUsd(v));

/** The website's front page: what AUTISTIK is, with one button into the App. */
export default async function Home() {
  const [board, markets, user, { owner }] = await Promise.all([
    getBoard(60).catch(() => [] as BoardToken[]),
    getMarkets(LISTINGS.map((l) => ({ chain: l.chain, token: l.token }))).catch(() => ({} as Record<string, Market>)),
    currentUser().catch(() => null),
    adminState(),
  ]);
  // Your picture at the top (the AUTISTIK logo until you add a photo).
  const mine = user ? await supabaseServer().from("profiles").select("alias, avatar_url").eq("id", user.id).single()
    .then((r) => (r.error ? null : (r.data as { alias: string; avatar_url: string | null })), () => null) : null;
  const m = markets[TOKEN_ADDRESS.toLowerCase()];
  // Newest launches first, then the coins the team lists; each coin once.
  const listed: Row[] = [
    ...board.slice(0, 6).map((t) => ({ chain: t.chain, token: t.token, symbol: t.symbol, name: t.name, market: t.market, href: `/launchpad/${t.chain}/${t.token}` })),
    ...LISTINGS.map((l) => ({ chain: l.chain as ChainKey, token: l.token, symbol: l.symbol, name: l.name, market: markets[l.token.toLowerCase()] ?? null, href: `/analytics/${l.chain}/${l.token}` })),
  ].filter((r, i, all) => all.findIndex((x) => x.chain === r.chain && x.token.toLowerCase() === r.token.toLowerCase()) === i).slice(0, 6);
  const hot: Row[] = trending(board).slice(0, 6).map((t) => ({ chain: t.chain, token: t.token, symbol: t.symbol, name: t.name, market: t.market, href: `/launchpad/${t.chain}/${t.token}` }));

  return (
    <div className="lp">
      <header className="lp-bar">
        {/* Top left, kept together: the AUTISTIK logo first, then your picture with "My Profile" under it
            (signed out, the same spot opens sign-in). */}
        <div className="lp-id">
          <Link href="/mood" className="lp-logo" aria-label="Open TIK" title="Open TIK"><LogoBadge size={30} /></Link>
          {user ? <MeButton alias={mine?.alias || "Member"} avatarUrl={mine?.avatar_url ?? null} label="My Profile" />
            : <Link href="/login?next=/" className="me-pic labelled" aria-label="My Profile: sign in"><span className="me-pic-img"><Avatar className="me-av" alias="Me" url={null} logo /></span><span className="me-pic-l" aria-hidden="true">My Profile</span></Link>}
        </div>
        <nav className="lp-nav" aria-label="Website">
          <a href="#products">Products</a><a href="#token">Token</a><a href="#community">Community</a><Link href="/fund">Fund</Link><Link href="/autism">About autism</Link>
        </nav>
        <LangPicker />
        <ThemeToggle />
        {/* Home switches sides: from the main page it opens the App, whose Home button comes back here. */}
        <Link href="/app" className="lp-signin lp-home" aria-label="Home: open the AUTISTIK App"><svg aria-hidden="true"><use href="#i-home" /></svg><span>Home</span></Link>
        {user && owner && <Link href="/admin" className="lp-signin lp-admin" aria-label="Admin: everything happening on the site"><svg aria-hidden="true"><use href="#i-adm" /></svg><span>Admin</span></Link>}
        <Link href="/app" className="lp-openapp" aria-label="Open the AUTISTIK App"><i aria-hidden="true"><svg><use href="#i-grid" /></svg></i><span>Open App</span></Link>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-mark"><Wordmark className="lp-wordmark" /></div>
        <div className="lp-hero-copy">
          <div className="lp-eyebrow"><TypeText text="A global autism community, powered by crypto" speed={16} /></div>
          <h1><span className="lp-punch"><TypeText text="Autism is not a disease." delay={650} sound human /></span><span className="lp-loop"><TypeLoop intro delay={1450} words={HERO_LOOP} /></span></h1>
          <p><Words delay={1500} text="AUTISTIK brings autistic people, their families and supporters together in one global community, with simple, secure crypto tools built in. A share of all trading activity funds real-world support for autistic people." /></p>
          <p className="lp-why"><b>How it works:</b> <Words delay={1900} text="every swap, stake and token launch on AUTISTIK contributes to the AUTISTIK Fund, set up to cover therapy, equipment, education and everyday essentials. Plain language throughout, and never any pressure." /></p>
          <div className="lp-ctas" data-sq="up" style={{ ["--sd" as string]: "2300ms" }}>
            <Link href="/app?menu=1" className="lp-btn gold xl">Open menu <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></Link>
            <Link href={`/swap?chain=bsc&buy=${TOKEN_ADDRESS}`} className="lp-btn">Buy $AUTISTIK</Link>
          </div>
          {!user && <p className="lp-member">Part of the community? <Link href="/login?next=/">Sign in</Link> or <Link href="/login?mode=join&amp;next=/">join free</Link> to chat in the groups and save your settings.</p>}
        </div>
        <div className="lp-hero-art" data-sq="up" style={{ ["--sd" as string]: "250ms" }}><Art kind="hero" photo={PHOTOS.hero.src} alt={PHOTOS.hero.alt} /></div>
      </section>

      <section data-sq="up" style={{ ["--sd" as string]: "150ms" }} className="lp-stats" aria-label="AUTISTIK in numbers">
        <div><b>{usd(m?.priceUsd)}</b><span>$AUTISTIK price</span></div>
        <div><b>{usd(m?.marketCap)}</b><span>Market cap</span></div>
        <div><b>{usd(m?.liquidityUsd)}</b><span>Liquidity</span></div>
        <div><b>{board.length}</b><span>Tokens trending</span></div>
        <div><b>{GROUPS.length}</b><span>Community groups</span></div>
      </section>


      <section id="why" className="lp-sec">
        <div className="lp-head">
          <div><div className="lp-eyebrow"><TypeText text="Why AUTISTIK" /></div><h2><TypeText delay={350} text="Our mission" /></h2><p><Words delay={700} text="Who we are, who we serve and how everyday activity on AUTISTIK becomes real support. No crypto experience needed." /></p></div>
          <Link href="/start" className="lp-more">New here? Start here <Arrow /></Link>
        </div>
        <div data-sq="up" style={{ ["--sd" as string]: "300ms" }} className="lp-why-grid">
          {WHY.map((w) => (
            <div key={w.q} className="lp-why-card">
              <span className="lp-ico"><ToolIcon name={w.icon} /></span>
              <h3>{w.q}</h3>
              <p>{w.a}</p>
            </div>
          ))}
        </div>
        <ol data-sq="up" style={{ ["--sd" as string]: "200ms" }} className="lp-steps" aria-label="How it works">
          {STEPS.map(([t, x], i) => <li key={t}><span>{i + 1}</span><div><b>{t}</b><small>{x}</small></div></li>)}
        </ol>
      </section>

      <section id="products" className="lp-sec">
        <div className="lp-head">
          <div><div className="lp-eyebrow"><TypeText text="The App" /></div><h2><TypeText delay={300} text="Everything you need, in one place" /></h2><p><Words delay={900} text="Trade, earn, launch and stay protected from one app. Connect MetaMask, Trust Wallet, Binance Wallet, OKX or any WalletConnect wallet, or create a wallet with just your email." /></p></div>
          <Link href="/app" className="lp-more">Open the App <Arrow /></Link>
        </div>
        <div data-sq="up" style={{ ["--sd" as string]: "300ms" }} className="lp-tools">
          {PRODUCTS.map((p) => (
            <Link key={p.href} href={p.href} className="lp-tool">
              <div className="lp-tool-top"><span className="lp-ico"><ToolIcon name={p.icon} /></span><span className="lp-tag">{p.tag}</span></div>
              <b>{p.title}</b>
              <p>{p.text}</p>
              <ul>{p.points.map((x) => <li key={x}>{x}</li>)}</ul>
              <span className="lp-open">Open {p.title} <Arrow /></span>
            </Link>
          ))}
        </div>
      </section>

      <section id="markets" className="lp-sec">
        <div className="lp-head">
          <div><div className="lp-eyebrow"><TypeText text="Markets" /></div><h2><TypeText delay={300} text="Live markets on AUTISTIK" /></h2><p><Words delay={800} text="Real-time prices for every token listed or launched on AUTISTIK. Select any token to view its chart, holders and safety report." /></p></div>
          <Link href="/launchpad" className="lp-more">All tokens <Arrow /></Link>
        </div>
        <div data-sq="up" style={{ ["--sd" as string]: "300ms" }} className="lp-mkts">
          <MarketTable title="New listings" rows={listed} buy />
          <MarketTable title="Trending" rows={hot} empty="Nothing trending yet. Launch the first coin, or pay to list yours." />
        </div>
        <p className="lp-fine">Tokens launched on AUTISTIK are made by community members, not the AUTISTIK team. Coins can lose all their value; never share your seed phrase or private key.</p>
      </section>

      <section id="token" className="lp-sec">
        <div className="lp-token">
          <div className="lp-token-copy">
            <div className="lp-eyebrow"><TypeText text="The token" /></div>
            <h2><TypeText delay={300} text="$AUTISTIK on BNB Chain" /></h2>
            <p><Words delay={800} text="Holders support the platform and help shape what we build next. Stake $AUTISTIK to earn a share of platform trading fees, paid in BNB." /></p>
            <CopyAddress address={TOKEN_ADDRESS} />
            <div className="lp-ctas" data-sq="up" style={{ ["--sd" as string]: "400ms" }}>
              <Link href={`/swap?chain=bsc&buy=${TOKEN_ADDRESS}`} className="lp-btn gold">Buy $AUTISTIK</Link>
              <Link href="/stake" className="lp-btn">Stake</Link>
              <Link href={`/analytics/bsc/${TOKEN_ADDRESS}`} className="lp-btn ghost">Chart &amp; holders</Link>
            </div>
            <small className="lp-fine">Use the official contract only. Never share your seed phrase or private key.</small>
          </div>
          <dl data-sq="up" style={{ ["--sd" as string]: "300ms" }} className="lp-token-stats">
            <div className="wide"><dt>Price</dt><dd>{usd(m?.priceUsd)} <span className={tone(m?.change24h)}>{pct(m?.change24h)}</span></dd></div>
            <div><dt>Market cap</dt><dd>{usd(m?.marketCap)}</dd></div>
            <div><dt>Liquidity</dt><dd>{usd(m?.liquidityUsd)}</dd></div>
            <div><dt>24h volume</dt><dd>{m ? usd(m.volume24h) : "–"}</dd></div>
            <div><dt>24h trades</dt><dd>{m ? m.txns24h.toLocaleString("en-US") : "–"}</dd></div>
          </dl>
        </div>
      </section>

      <section id="community" className="lp-sec">
        <div className="lp-head">
          <div><div className="lp-eyebrow"><TypeText text="Community" /></div><h2><TypeLoop intro delay={300} words={["Built with autistic people.", "Led by autistic people.", "Made for autistic people."]} /></h2><p><Words delay={1000} text="Nothing about us without us. Autistic people lead this community, with families, supporters and practitioners alongside them." /></p></div>
          <Link href="/community" className="lp-more">Join the groups <Arrow /></Link>
        </div>
        <div data-sq="up" style={{ ["--sd" as string]: "300ms" }} className="lp-tools four">
          {COMMUNITY.map((c) => (
            <Link key={c.href} href={c.href} className="lp-tool soft">
              <div className="lp-tool-top"><span className="lp-ico violet"><ToolIcon name={c.icon} /></span></div>
              <b>{c.title}</b>
              <p>{c.text}</p>
              <span className="lp-open">Open <Arrow /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-fund">
          <div>
            <div className="lp-eyebrow"><TypeText text="AUTISTIK Fund" /></div>
            <h2><TypeText delay={350} text="Community-funded. Individually focused." /></h2>
            <p><Words delay={1000} text="A share of $AUTISTIK trading activity is set aside to support people on the autism spectrum. The Fund opens soon. Register your interest today, for yourself or for someone you care for." /></p>
            <div className="lp-ctas" data-sq="up" style={{ ["--sd" as string]: "400ms" }}><Link href="/fund" className="lp-btn gold">About the Fund</Link><Link href="/fund#register" className="lp-btn ghost">Register interest</Link></div>
          </div>
          <ul data-sq="up" style={{ ["--sd" as string]: "300ms" }} className="lp-fund-list">
            {FUND.map(([icon, title, text]) => <li key={title}><span className="lp-ico teal"><ToolIcon name={icon} /></span><span><b>{title}</b><small>{text}</small></span></li>)}
          </ul>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-band">
          <div><h2><TypeLoop intro words={["Ready to start?", "Ready to swap?", "Ready to stake?", "Ready to belong?"]} /></h2><p><Words delay={600} text="Swap, stake and scan in a few taps. New to crypto? We'll guide you through every step." /></p></div>
          <div className="lp-ctas" data-sq="up" style={{ ["--sd" as string]: "400ms" }}><Link href="/app?menu=1" className="lp-btn gold xl">Open menu <Arrow /></Link><Link href="/start" className="lp-btn ghost">New here? Start here</Link></div>
        </div>
      </section>

      <SeqReveal />
      <TypeSoundToggle />
      <footer className="lp-foot">
        <div className="lp-foot-cols">
          <div className="lp-foot-brand">
            <Link href="/mood" className="lp-logo" aria-label="Open TIK" title="Open TIK"><LogoBadge size={30} /></Link>
            <p>A home for autistic people and those who support them, with simple, secure crypto tools.</p>
          </div>
          <div><b>App</b><Link href="/swap">Swap</Link><Link href="/stake">Stake</Link><Link href="/lockers">Lockers</Link><Link href="/launchpad/new">Launch Pad</Link><Link href="/analytics">Scanner</Link></div>
          <div><b>Community</b><Link href="/community">Groups</Link><Link href="/companions">Companions</Link><Link href="/sessions">Live sessions</Link><Link href="/fund">Fund</Link></div>
          <div><b>Learn</b><Link href="/autism">About autism</Link><Link href="/start">Start here</Link><Link href="/buy">How to buy</Link><Link href="/safety">Safety &amp; privacy</Link></div>
          <div><b>Follow</b><a href={LINKS.x} target="_blank" rel="noopener noreferrer">X (Twitter)</a><a href={LINKS.telegram} target="_blank" rel="noopener noreferrer">Telegram</a><a href={`mailto:${LINKS.email}`}>{LINKS.email}</a><Link href="/login">Sign in</Link></div>
        </div>
        <p>Nothing on AUTISTIK is financial advice. Crypto is risky: do your own research and never put in more than you can afford to lose.</p>
      </footer>
    </div>
  );
}

const Arrow = () => <svg className="lp-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;

type Row = { chain: ChainKey; token: string; symbol: string; name: string; market: Market | null; href: string };

/** One market list, laid out like an exchange's: token, price, 24h change, liquidity, and an optional Buy. */
function MarketTable({ title, rows, buy, empty }: { title: string; rows: Row[]; buy?: boolean; empty?: string }) {
  return (
    <div className="lp-mkt">
      <h3>{title}</h3>
      {!rows.length ? <p className="lp-mkt-empty">{empty}</p> : (
        <div role="table" aria-label={title}>
          <div className="lp-mrow head" role="row"><span>Token</span><span>Price</span><span>24h</span><span className="hide-sm">Liquidity</span>{buy && <span />}</div>
          {rows.map((r) => (
            <div key={r.chain + r.token} className={"lp-mrow" + (buy ? " buy" : "")} role="row">
              <Link href={r.href} className="lp-mname"><TokenLogo src={r.market?.imageUrl} symbol={r.symbol} /><span><b>{r.symbol}</b><small>{r.name} · {CHAINS[r.chain].name}</small></span></Link>
              <span>{usd(r.market?.priceUsd)}</span>
              <span className={tone(r.market?.change24h)}>{pct(r.market?.change24h)}</span>
              <span className="hide-sm">{usd(r.market?.liquidityUsd)}</span>
              {buy && <Link href={isWChain(r.chain) ? buyLink(r) : r.href} className="lp-buy">Buy</Link>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
