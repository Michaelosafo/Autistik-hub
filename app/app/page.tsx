import Link from "next/link";
import { TOKEN_ADDRESS } from "@/lib/groups";
import { buyLink } from "@/lib/listings";
import { getMarkets } from "@/lib/market";

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

type Tool = { href: string; icon: keyof typeof ICONS; name: string; text: string };
const GROUPS: { name: string; tools: Tool[] }[] = [
  { name: "Wallet", tools: [
    { href: "/wallet", icon: "wallet", name: "Wallet", text: "Balances, send and receive" },
    { href: "/arena", icon: "arena", name: "Game arena", text: "Holders on a pitch" },
    { href: "/analytics", icon: "scan", name: "Token scanner", text: "Holders and safety" },
    { href: "/analytics/pins", icon: "watch", name: "Watchlist", text: "Coins you follow" },
  ] },
  { name: "Trade", tools: [
    { href: "/wallet?quick=1", icon: "buy", name: "Buy", text: "Any coin, in dollars" },
    { href: "/swap", icon: "swap", name: "Swap", text: "Best price, every DEX" },
    { href: "/perps", icon: "perps", name: "Perpetuals", text: "Long or short" },
  ] },
  { name: "Discover", tools: [
    { href: "/launchpad", icon: "trending", name: "Trending", text: "What's being bought" },
    { href: "/momentum", icon: "momentum", name: "Momentum", text: "Coins gaining speed" },
  ] },
  { name: "Build", tools: [
    { href: "/launchpad/new", icon: "launch", name: "Launch Pad", text: "Launch a token, no code" },
    { href: "/lockers", icon: "lock", name: "Lockers", text: "Lock liquidity or tokens" },
  ] },
  { name: "Earn", tools: [
    { href: "/stake", icon: "stake", name: "Stake", text: "Earn BNB, up to 3x" },
    { href: "/rewards", icon: "rewards", name: "Rewards", text: "Points and airdrops" },
  ] },
];

const usd = (v: number | null | undefined) =>
  v == null ? "–" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(4)}`;

/** The App's home: $AUTISTIK at a glance, then every tool, grouped. */
export default async function AppHome() {
  const m = (await getMarkets([{ chain: "bsc", token: TOKEN_ADDRESS }]).catch(() => ({} as Record<string, never>)))[TOKEN_ADDRESS.toLowerCase()];
  const ch = m?.change24h;
  return (
    <div className="ah">
      <section className="ah-coin" aria-label="$AUTISTIK">
        <div className="ah-coin-id">
          {m?.imageUrl ? <img src={m.imageUrl} alt="" width={44} height={44} /> : <span className="ah-coin-ph"><svg width="30" height="15" aria-hidden="true"><use href="#i-inf" /></svg></span>}
          <div>
            <b>$AUTISTIK</b>
            <small>Powers every AUTISTIK tool · BNB Chain</small>
          </div>
        </div>
        <dl className="ah-stats">
          <div><dt>Price</dt><dd>{usd(m?.priceUsd)}</dd></div>
          <div><dt>24h</dt><dd className={ch == null ? "" : ch >= 0 ? "up" : "down"}>{ch == null ? "–" : `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`}</dd></div>
          <div><dt>Market cap</dt><dd>{usd(m?.marketCap)}</dd></div>
          <div><dt>Liquidity</dt><dd>{usd(m?.liquidityUsd)}</dd></div>
        </dl>
        <div className="ah-coin-cta">
          <Link className="ah-btn gold" href={buyLink({ chain: "bsc", token: TOKEN_ADDRESS })}>Buy</Link>
          <Link className="ah-btn" href="/stake">Stake</Link>
        </div>
      </section>

      {GROUPS.map((g) => (
        <section key={g.name} className="ah-group" aria-label={g.name}>
          <h2>{g.name}</h2>
          <div className="ah-grid">
            {g.tools.map((t) => (
              <Link key={t.href} href={t.href} className="ah-tool">
                <span className="ah-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[t.icon]}</svg></span>
                <span className="ah-txt"><b>{t.name}</b><small>{t.text}</small></span>
                <svg className="ah-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
