import Link from "next/link";
import { TOKEN_ADDRESS } from "@/lib/groups";
import { buyLink } from "@/lib/listings";
import TokenLogo from "@/components/TokenLogo";
import { getBoard, trending, type BoardToken } from "@/lib/board";
import { CHAINS } from "@/lib/launchpad";
import { getMarkets, usd } from "@/lib/market";

export const metadata = { title: "App · AUTISTIK Hub", description: "Every AUTISTIK tool in one place: trade, discover, launch, lock and earn." };
export const revalidate = 60;

// Line icons (24×24, drawn with the current colour), one per tool.
const ICONS: Record<string, React.ReactNode> = {
  buy: <><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6.2" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></>,
  swap: <><path d="M7 4 3 8l4 4" /><path d="M3 8h13a4 4 0 0 1 4 4" /><path d="m17 20 4-4-4-4" /><path d="M21 16H8a4 4 0 0 1-4-4" /></>,
  wallet: <><path d="M4 7a2 2 0 0 1 2-2h11v4" /><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M16 14h2" /></>,
  perps: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  trending: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  momentum: <><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></>,
  watch: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  scan: <><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  launch: <><path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2" /><path d="M9 15 6 12c1.5-4 5-8 13-9-1 8-5 11.5-9 13z" /><circle cx="15" cy="9" r="1.6" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 15v2" /></>,
  stake: <><path d="M12 21V11" /><path d="M12 11C12 7 9 5 5 5c0 4 3 6 7 6z" /><path d="M12 13c0-4 3-6 7-6 0 4-3 6-7 6z" /></>,
  arena: <><circle cx="12" cy="12" r="9" /><path d="m12 7 4 3-1.5 4.5h-5L8 10z" /><path d="M12 3v4M21 10l-5 0M3 10h5M9.5 14.5 7 19M14.5 14.5 17 19" /></>,
  rewards: <><rect x="3" y="8" width="18" height="5" rx="1" /><path d="M5 13v8h14v-8M12 8v13" /><path d="M12 8S10.5 3 8 3.5 7 8 12 8zM12 8s1.5-5 4-4.5S17 8 12 8z" /></>,
};

type Tool = { href: string; icon: keyof typeof ICONS; name: string; text: string; tag?: "New" | "Popular" };
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
const ACTIONS: { href: string; icon: keyof typeof ICONS; name: string }[] = [
  { href: "/wallet?quick=1", icon: "buy", name: "Buy" },
  { href: "/swap", icon: "swap", name: "Swap" },
  { href: "/wallet", icon: "wallet", name: "Wallet" },
  { href: "/analytics", icon: "scan", name: "Scan" },
];

const Icon = ({ name }: { name: keyof typeof ICONS }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
);
const pct = (v: number | null | undefined) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const tone = (v: number | null | undefined) => (v == null ? "" : v >= 0 ? "up" : "down");

/** The App's home, laid out like an exchange: $AUTISTIK's market up top, quick actions, every tool, and live markets. */
export default async function AppHome() {
  const [markets, board] = await Promise.all([
    getMarkets([{ chain: "bsc", token: TOKEN_ADDRESS }]).catch(() => ({} as Record<string, never>)),
    getBoard(60).catch(() => [] as BoardToken[]),
  ]);
  const m = markets[TOKEN_ADDRESS.toLowerCase()];
  const top = trending(board).slice(0, 5);
  return (
    <div className="ah">
      <section className="ah-hero" aria-label="$AUTISTIK market">
        <div className="ah-mkt">
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
        <nav className="ah-actions" aria-label="Quick actions">
          {ACTIONS.map((a) => (
            <Link key={a.name} href={a.href} className="ah-act"><span className="ah-icon"><Icon name={a.icon} /></span><b>{a.name}</b></Link>
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
                    <span className="ah-icon"><Icon name={t.icon} /></span>
                    <span className="ah-txt"><b>{t.name}{t.tag && <em className={"ah-tag " + t.tag.toLowerCase()}>{t.tag}</em>}</b><small>{t.text}</small></span>
                    <svg className="ah-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="ah-side">
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
            <span className="ah-icon"><Icon name="scan" /></span>
            <div><b>Check before you buy</b><small>Holders, dev wallets and honeypot checks for any coin, in plain words.</small></div>
            <Link className="ah-btn" href="/analytics">Open scanner</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
