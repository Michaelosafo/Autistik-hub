import Link from "next/link";
import { getMarkets, type Market } from "@/lib/market";
import { LISTINGS, buyLink } from "@/lib/listings";
import { getBoard } from "@/lib/board";
import { CHAINS, type ChainKey } from "@/lib/launchpad";
import { isWChain } from "@/lib/wallet-chains";

const usd = (v: number | null) => (v == null ? "–" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(3)}`);

type Card = { chain: ChainKey; token: string; symbol: string; name: string; market: Market | undefined; chart: string };

/**
 * Coins listed on AUTISTIK, each with a one-tap Buy that opens the easy Buy screen in the wallet. Every token launched
 * or listed on the Launch Pad shows here by itself, newest first, then the coins the team lists.
 */
export default async function NewListings() {
  const [board, m] = await Promise.all([
    getBoard(8).catch(() => []),
    getMarkets(LISTINGS.map((l) => ({ chain: l.chain, token: l.token }))),
  ]);
  const cards: Card[] = [
    ...board.map((t) => ({ chain: t.chain, token: t.token, symbol: t.symbol, name: t.name, market: t.market ?? undefined, chart: `/launchpad/${t.chain}/${t.token}` })),
    ...LISTINGS.map((l) => ({ chain: l.chain, token: l.token, symbol: l.symbol, name: l.name, market: m[l.token.toLowerCase()], chart: `/analytics/${l.chain}/${l.token}` })),
  ].filter((c, i, all) => all.findIndex((x) => x.chain === c.chain && x.token.toLowerCase() === c.token.toLowerCase()) === i).slice(0, 8);
  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="section-head"><div><div className="label">Listed on AUTISTIK</div><h2 style={{ marginTop: 4 }}>New listings</h2></div><Link className="btn small" href="/launchpad">See all tokens</Link></div>
      <div className="nl-grid">
        {cards.map((l) => {
          const k = l.market;
          return (
            <div key={l.chain + l.token} className="nl-card">
              <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                {k?.imageUrl ? <img src={k.imageUrl} alt="" width={44} height={44} className="nl-logo" /> : <span className="nl-logo nl-ph">{l.symbol.slice(0, 2)}</span>}
                <div className="grow" style={{ minWidth: 0 }}><b>{l.symbol}</b><small className="muted">{l.name} · {CHAINS[l.chain].name}</small></div>
                <span className="nl-new">New</span>
              </div>
              <div className="nl-nums">
                <div><span>Price</span><b>{usd(k?.priceUsd ?? null)}</b></div>
                <div><span>24h</span><b className={(k?.change24h ?? 0) >= 0 ? "up" : "down"}>{k?.change24h == null ? "–" : `${k.change24h >= 0 ? "+" : ""}${k.change24h.toFixed(1)}%`}</b></div>
                <div><span>Liquidity</span><b>{usd(k?.liquidityUsd ?? null)}</b></div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {/* The wallet trades on its own networks; for the rest, Buy opens the token's page. */}
                <Link className="btn primary grow nl-buy" href={isWChain(l.chain) ? buyLink(l) : l.chart}>Buy {l.symbol}</Link>
                <Link className="btn small" href={l.chart}>Chart</Link>
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: ".82em" }}>Tap Buy, pick a dollar amount, confirm. First time? The wallet makes you one with just your email. Tokens launched on AUTISTIK are made by community members, not the AUTISTIK team. Coins can lose all their value; never share your seed phrase or private key.</p>
    </section>
  );
}
