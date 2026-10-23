import Link from "next/link";
import { TOKEN_ADDRESS } from "@/lib/groups";
import { buyLink } from "@/lib/listings";
import TokenLogo from "@/components/TokenLogo";
import AppMe from "@/components/AppMe";
import ToolIcon, { type IconName } from "@/components/ToolIcon";
import { getBoard, trending, type BoardToken } from "@/lib/board";
import { CHAINS } from "@/lib/launchpad";
import { getMarkets, usd } from "@/lib/market";

export const metadata = { title: "App · AUTISTIK Hub", description: "Every AUTISTIK tool in one place: trade, discover, launch, lock and earn." };
export const revalidate = 60;

type Tool = { href: string; icon: IconName; name: string; text: string; tag?: "New" | "Popular" };
const GROUPS: { name: string; text: string; tools: Tool[] }[] = [
  { name: "Wallet", text: "Your coins on every network", tools: [
    { href: "/wallet", icon: "wallet", name: "Wallet", text: "Balances, send and receive" },
    { href: "/arena", icon: "arena", name: "Game arena", text: "Holders on a pitch", tag: "New" },
    { href: "/analytics", icon: "scan", name: "Token scanner", text: "Holders and safety" },
    { href: "/analytics/pins", icon: "watch", name: "Watchlist", text: "Coins you follow" },
  ] },
  { name: "Trade", text: "Best price across every DEX", tools: [
    { href: "/wallet?quick=1", icon: "buy", name: "Buy", text: "Any coin, in dollars" },
    { href: "/swap", icon: "swap", name: "Swap", text: "Best price, every DEX", tag: "Popular" },
    { href: "/perps", icon: "perps", name: "Perpetuals", text: "Long or short" },
  ] },
  { name: "Discover", text: "Find coins early", tools: [
    { href: "/launchpad", icon: "trending", name: "Trending", text: "What's being bought" },
    { href: "/momentum", icon: "momentum", name: "Momentum", text: "Coins gaining speed" },
  ] },
  { name: "Build", text: "Launch and protect a token", tools: [
    { href: "/launchpad/new", icon: "launch", name: "Launch Pad", text: "Launch a token, no code" },
    { href: "/lockers", icon: "lock", name: "Lockers", text: "Lock liquidity or tokens" },
  ] },
  { name: "Earn", text: "Put your coins to work", tools: [
    { href: "/stake", icon: "stake", name: "Stake", text: "Earn BNB, up to 3x" },
    { href: "/rewards", icon: "rewards", name: "Rewards", text: "Points and airdrops" },
  ] },
];

// The four things people do most, one tap each.
const ACTIONS: { href: string; icon: IconName; name: string }[] = [
  { href: "/wallet?quick=1", icon: "buy", name: "Buy" },
  { href: "/swap", icon: "swap", name: "Swap" },
  { href: "/wallet", icon: "wallet", name: "Wallet" },
  { href: "/analytics", icon: "scan", name: "Scan" },
];

const pct = (v: number | null | undefined) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const tone = (v: number | null | undefined) => (v == null ? "" : v >= 0 ? "up" : "down");

/** The App's home: your account up top (badge, who you follow, wallet funds), quick actions, every tool, and live markets. */
export default async function AppHome() {
  const [markets, board] = await Promise.all([
    getMarkets([{ chain: "bsc", token: TOKEN_ADDRESS }]).catch(() => ({} as Record<string, never>)),
    getBoard(60).catch(() => [] as BoardToken[]),
  ]);
  const m = markets[TOKEN_ADDRESS.toLowerCase()];
  const top = trending(board).slice(0, 5);
  return (
    <div className="ah">
      <section className="ah-hero" aria-label="Your account">
        <AppMe />
        <nav className="ah-actions" aria-label="Quick actions">
          {ACTIONS.map((a) => (
            <Link key={a.name} href={a.href} className="ah-act"><span className="ah-icon"><ToolIcon name={a.icon} /></span><b>{a.name}</b></Link>
          ))}
        </nav>
      </section>

      <div className="ah-body">
        <div className="ah-groups">
          {GROUPS.map((g) => (
            <section key={g.name} className="ah-panel" aria-label={g.name}>
              <header className="ah-panel-head"><h2>{g.name}</h2><small>{g.text}</small></header>
              <div className="ah-grid">
                {g.tools.map((t) => (
                  <Link key={t.href} href={t.href} className="ah-tool">
                    <span className="ah-icon"><ToolIcon name={t.icon} /></span>
                    <span className="ah-txt"><b>{t.name}{t.tag && <em className={"ah-tag " + t.tag.toLowerCase()}>{t.tag}</em>}</b><small>{t.text}</small></span>
                    <svg className="ah-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="ah-side">
          <section className="ah-panel" aria-label="$AUTISTIK market">
        <div className="ah-mkt ah-mkt-side">
          <div className="ah-mkt-id">
            {m?.imageUrl ? <img src={m.imageUrl} alt="" width={40} height={40} /> : <span className="ah-coin-ph"><svg width="26" height="13" aria-hidden="true"><use href="#i-inf" /></svg></span>}
            <div><b>AUTISTIK<span>/USD</span></b><small><i className="ah-live" aria-hidden="true" />BNB Chain · live</small></div>
          </div>
          <div className="ah-price">
            <strong>{usd(m?.priceUsd)}</strong>
            <span className={"ah-chg " + tone(m?.change24h)}>{pct(m?.change24h)} <em>24h</em></span>
          </div>
          <dl className="ah-stats">
            <div><dt>Market cap</dt><dd>{usd(m?.marketCap)}</dd></div>
            <div><dt>Liquidity</dt><dd>{usd(m?.liquidityUsd)}</dd></div>
            <div><dt>24h volume</dt><dd>{m ? usd(m.volume24h) : "–"}</dd></div>
            <div><dt>24h trades</dt><dd>{m ? m.txns24h.toLocaleString("en-US") : "–"}</dd></div>
          </dl>
          <div className="ah-coin-cta">
            <Link className="ah-btn gold" href={buyLink({ chain: "bsc", token: TOKEN_ADDRESS })}>Buy $AUTISTIK</Link>
            <Link className="ah-btn" href="/stake">Stake</Link>
            <Link className="ah-btn ghost" href={`/analytics/bsc/${TOKEN_ADDRESS}`}>Chart</Link>
          </div>
        </div>
          </section>
          <section className="ah-panel" aria-label="Trending markets">
            <header className="ah-panel-head"><h2>Trending</h2><Link href="/launchpad">See all</Link></header>
            {top.length ? (
              <div className="ah-mkts" role="table" aria-label="Trending tokens">
                <div className="ah-mrow head" role="row"><span>Token</span><span>Price</span><span>24h</span></div>
                {top.map((t) => (
                  <Link key={t.chain + t.token} href={`/launchpad/${t.chain}/${t.token}`} className="ah-mrow" role="row">
                    <span className="ah-mname"><TokenLogo src={t.market?.imageUrl} symbol={t.symbol} /><span><b>{t.symbol}</b><small>{CHAINS[t.chain].name}</small></span></span>
                    <span>{usd(t.market?.priceUsd)}</span>
                    <span className={tone(t.market?.change24h)}>{pct(t.market?.change24h)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="ah-empty">No tokens trending yet. <Link href="/launchpad/new">Launch the first one</Link>.</p>
            )}
          </section>
          <section className="ah-panel ah-safe" aria-label="Safety">
            <span className="ah-icon"><ToolIcon name="scan" /></span>
            <div><b>Check before you buy</b><small>Holders, dev wallets and honeypot checks for any coin, in plain words.</small></div>
            <Link className="ah-btn" href="/analytics">Open scanner</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
