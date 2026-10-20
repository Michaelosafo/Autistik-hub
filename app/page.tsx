import Link from "next/link";
import Art from "@/components/Art";
import CopyAddress from "@/components/CopyAddress";
import NewListings from "@/components/NewListings";
import TrendingNow from "@/components/TrendingNow";
import { GROUPS, TOKEN_ADDRESS } from "@/lib/groups";
import { getMarkets } from "@/lib/market";
import { LINKS, PHOTOS } from "@/lib/site";
import { getBoard, trending } from "@/lib/board";

export const dynamic = "force-dynamic";

const TICKER = ["Not a disease", "A community", "Different, not less", "Nothing about us without us", "Every mind on the spectrum", "Not broken", "Neurodiversity is strength", "Autistic and proud"];

// The App's tools, each opening its own screen. [title, what it does, link, tag]
const PRODUCTS: [string, string, string, string][] = [
  ["Swap", "Trade any token on BNB Chain, Base, Ethereum, Arbitrum and Solana at the best price across every DEX.", "/swap", "Trade"],
  ["Stake", "Stake $AUTISTIK and earn BNB from platform fees. Lock longer for up to 3x the rewards.", "/stake", "Earn"],
  ["Lockers", "Lock liquidity or team tokens on-chain so buyers can trust a project.", "/lockers", "Lock"],
  ["Launch Pad", "Launch your own token in minutes with liquidity locked or burned. No code.", "/launchpad/new", "Launch"],
  ["Token scanner", "Holders, whales, dev wallets and safety checks for any coin, in plain words.", "/analytics", "Scanner"],
  ["Wallet", "Your own self-custody wallet with limit and stop-loss orders. Your keys, your coins.", "/wallet", "Wallet"],
];

const COMMUNITY: [string, string, string][] = [
  ["Groups", "Spectrum Lounge to hang out, Support & Questions for hard days.", "/community"],
  ["Companions", "Believer and Purity: two assistant friends to talk, plan and draw with.", "/companions"],
  ["Live sessions", "Talks and support circles with checked practitioners.", "/sessions"],
  ["AUTISTIK Fund", "Direct support for autistic people and families.", "/fund"],
];

const usd = (v: number | null | undefined) => (v == null ? "–" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(3)}`);

/** The website's front page: what AUTISTIK is, with one button into the App. */
export default async function Home() {
  const [board, markets] = await Promise.all([getBoard(60), getMarkets([{ chain: "bsc", token: TOKEN_ADDRESS }])]);
  const m = markets[TOKEN_ADDRESS.toLowerCase()];

  return (
    <div className="lp">
      <header className="lp-bar">
        <Link href="/" className="lp-logo" aria-label="AUTISTIK home"><svg width="44" height="22" aria-hidden="true"><use href="#i-inf" /></svg><b>AUTISTIK</b></Link>
        <nav className="lp-nav" aria-label="Website">
          <a href="#products">Products</a><a href="#token">Token</a><a href="#community">Community</a><Link href="/fund">Fund</Link><Link href="/autism">About autism</Link>
        </nav>
        <Link href="/companions" className="lp-launch bot" aria-label="Chat with the AUTISTIK bot"><Art kind="robot" who="autistik" mood="motivation" className="bot-av" /><span>Ask the bot</span></Link>
        <Link href="/swap" className="lp-launch">Open App <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg></Link>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <div className="lp-eyebrow">Autism awareness × Web3</div>
          <h1>Autism is not a disease. <span>It&apos;s a community.</span></h1>
          <p>AUTISTIK is a home for autistic people and supporters, with its own token and simple, safe tools to swap, stake, lock and launch coins.</p>
          <div className="lp-ctas">
            <Link href="/swap" className="lp-btn gold xl">Enter the App <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></Link>
            <Link href={`/swap?chain=bsc&buy=${TOKEN_ADDRESS}`} className="lp-btn">Buy $AUTISTIK</Link>
          </div>
        </div>
        <div className="lp-hero-art"><Art kind="hero" photo={PHOTOS.hero.src} alt={PHOTOS.hero.alt} /></div>
      </section>

      <section className="lp-stats" aria-label="AUTISTIK in numbers">
        <div><b>{usd(m?.priceUsd)}</b><span>$AUTISTIK price</span></div>
        <div><b>{usd(m?.marketCap)}</b><span>Market cap</span></div>
        <div><b>{usd(m?.liquidityUsd)}</b><span>Liquidity</span></div>
        <div><b>{board.length}</b><span>Tokens trending</span></div>
        <div><b>{GROUPS.length}</b><span>Community groups</span></div>
      </section>

      <div className="ticker" aria-hidden="true"><div>{[...TICKER, ...TICKER].map((t, i) => <span key={i}><i>∞</i> {t.toUpperCase()}</span>)}</div></div>

      <section id="products" className="lp-sec">
        <div className="lp-sec-head"><div className="lp-eyebrow">The App</div><h2>Everything in one place</h2><p>Open any tool and connect MetaMask, Trust Wallet, Binance Wallet, OKX or any WalletConnect wallet.</p></div>
        <div className="lp-products">
          {PRODUCTS.map(([title, text, href, tag]) => (
            <Link key={href} href={href} className="lp-product">
              <span className="lp-tag">{tag}</span>
              <b>{title}</b>
              <p>{text}</p>
              <span className="lp-open">Open {title} →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="lp-sec"><NewListings /></section>

      <section id="token" className="lp-sec lp-token">
        <div>
          <div className="lp-eyebrow">The token</div>
          <h2>$AUTISTIK on BNB Chain</h2>
          <p>Holders support the Hub and get a say in what we build. Stake it to earn a share of the platform&apos;s trading fees.</p>
          <CopyAddress address={TOKEN_ADDRESS} />
          <div className="lp-ctas">
            <Link href={`/swap?chain=bsc&buy=${TOKEN_ADDRESS}`} className="lp-btn gold">Buy $AUTISTIK</Link>
            <Link href="/stake" className="lp-btn">Stake</Link>
            <Link href={`/analytics/bsc/${TOKEN_ADDRESS}`} className="lp-btn ghost">Chart &amp; holders</Link>
          </div>
          <small className="lp-fine">Use the official contract only. Never share your seed phrase or private key.</small>
        </div>
      </section>

      <section className="lp-sec"><TrendingNow list={trending(board)} limit={5} /></section>

      <section id="community" className="lp-sec">
        <div className="lp-sec-head"><div className="lp-eyebrow">Community</div><h2>Built with autistic people</h2><p>Nothing about us without us. Autistic people lead here; supporters, families and practitioners join in.</p></div>
        <div className="lp-products four">
          {COMMUNITY.map(([title, text, href]) => (
            <Link key={href} href={href} className="lp-product soft"><b>{title}</b><p>{text}</p><span className="lp-open">Open →</span></Link>
          ))}
        </div>
      </section>

      <section className="lp-sec lp-fund">
        <div>
          <div className="lp-eyebrow">AUTISTIK Fund</div>
          <h2>Funded by the community, built for individuals</h2>
          <p>A portion of $AUTISTIK trading activity is set aside to support people on the autism spectrum with therapy, equipment, education and everyday essentials. The Fund opens soon: register your interest now (you can do it for someone you care for).</p>
          <div className="lp-ctas"><Link href="/fund" className="lp-btn gold">About the Fund</Link><Link href="/fund#register" className="lp-btn ghost">Register interest</Link></div>
        </div>
      </section>

      <section className="lp-band">
        <h2>Ready to start?</h2>
        <p>Swap, stake and scan in a few taps. New to crypto? We&apos;ll walk you through it.</p>
        <div className="lp-ctas"><Link href="/swap" className="lp-btn gold xl">Enter the App <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></Link><Link href="/start" className="lp-btn ghost">New here? Start here</Link></div>
      </section>

      <footer className="lp-foot">
        <div className="lp-foot-cols">
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
