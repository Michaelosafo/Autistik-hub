import Link from "next/link";
import { getMarkets } from "@/lib/market";
import { LISTINGS, buyLink } from "@/lib/listings";

const usd = (v: number | null) => (v == null ? "–" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(3)}`);

/** Coins listed on AUTISTIK, each with a one-tap Buy that opens the easy Buy screen in the wallet. */
export default async function NewListings() {
  const m = await getMarkets(LISTINGS.map((l) => ({ chain: l.chain, token: l.token })));
  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="section-head"><div><div className="label">Listed on AUTISTIK</div><h2 style={{ marginTop: 4 }}>New listings</h2></div><Link className="btn small" href="/wallet">Open wallet</Link></div>
      <div className="nl-grid">
        {LISTINGS.map((l) => {
          const k = m[l.token.toLowerCase()];
          return (
            <div key={l.token} className="nl-card">
              <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                {k?.imageUrl ? <img src={k.imageUrl} alt="" width={44} height={44} className="nl-logo" /> : <span className="nl-logo nl-ph">{l.symbol.slice(0, 2)}</span>}
                <div className="grow" style={{ minWidth: 0 }}><b>{l.symbol}</b><small className="muted">{l.name} · BNB Chain</small></div>
                <span className="nl-new">New</span>
              </div>
              <div className="nl-nums">
                <div><span>Price</span><b>{usd(k?.priceUsd ?? null)}</b></div>
                <div><span>24h</span><b className={(k?.change24h ?? 0) >= 0 ? "up" : "down"}>{k?.change24h == null ? "–" : `${k.change24h >= 0 ? "+" : ""}${k.change24h.toFixed(1)}%`}</b></div>
                <div><span>Liquidity</span><b>{usd(k?.liquidityUsd ?? null)}</b></div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Link className="btn primary grow nl-buy" href={buyLink(l)}>Buy {l.symbol}</Link>
                <Link className="btn small" href={`/analytics/${l.chain}/${l.token}`}>Chart</Link>
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: ".82em" }}>Tap Buy, pick a dollar amount, confirm. First time? The wallet makes you one with just your email. Coins can lose all their value; never share your seed phrase or private key.</p>
    </section>
  );
}
