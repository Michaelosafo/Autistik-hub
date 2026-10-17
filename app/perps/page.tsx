import SectionTabs, { LAUNCH_TABS } from "@/components/SectionTabs";
import PerpsVenues from "@/components/PerpsVenues";
import { usd } from "@/lib/market";
import { PERP_COINS, PERP_VENUES, perpPrices } from "@/lib/perps";

export const revalidate = 60;
export const metadata = {
  title: "Perps · AUTISTIK Hub",
  description: "Live perpetual futures prices and the exchanges to trade them on.",
};

const pct = (n: number | null | undefined, digits = 1) => (n == null ? "–" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`);

export default async function PerpsPage() {
  const { source, prices } = await perpPrices();
  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <SectionTabs tabs={LAUNCH_TABS} active="/perps" label="Launch" />
      <div className="page-head">
        <h1>Perps</h1>
        <p className="muted">Trade futures: bet on a coin going up (long) or down (short). Leverage makes wins and losses bigger.</p>
      </div>

      <div className="card stack">
        <h2>Live futures prices</h2>
        <div role="table" aria-label="Live futures prices">
          <div className="board-row head trade-row" role="row"><span>Coin</span><span className="n">Price</span><span className="n">24h</span><span className="n hide-sm">{source === "futures" ? "Funding / hour" : "24h volume"}</span></div>
          {PERP_COINS.map((c) => {
            const p = prices[c.symbol];
            return (
              <div key={c.symbol} className="board-row trade-row" role="row">
                <span className="tname"><div><b>{c.symbol}-PERP</b><br /><span className="muted" style={{ fontSize: ".82em" }}>{c.name}</span></div></span>
                <span className="n">{usd(p?.price)}</span>
                <span className={"n " + ((p?.change24h ?? 0) >= 0 ? "up" : "down")}>{pct(p?.change24h)}</span>
                <span className="n hide-sm">{source === "futures" ? pct(p?.fundingPct, 4) : usd(p?.volume24h)}</span>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: ".8em" }}>
          {source === "futures" ? "Futures prices from Hyperliquid, updated every minute. Funding is what longs pay shorts each hour (negative: shorts pay longs)."
            : source === "spot" ? "Futures prices are unavailable right now, so these are normal prices from CoinGecko."
            : "Prices are unavailable right now. Try again in a minute."}
        </p>
      </div>

      <PerpsVenues venues={PERP_VENUES} />

      <div className="notice warn" style={{ fontSize: ".9em" }}>
        <b>Futures are high risk.</b> With leverage, a small price move can close your trade and take your whole deposit (liquidation).
        Most people who trade futures lose money. Always set a stop-loss, and never trade money you need for rent, food or bills.
        Nothing here is financial advice, and the AUTISTIK team never manages trades for anyone. If someone offers to trade for you, it&apos;s a scam.
      </div>
    </div>
  );
}
