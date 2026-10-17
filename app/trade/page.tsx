import SectionTabs, { LAUNCH_TABS } from "@/components/SectionTabs";
import { usd } from "@/lib/market";
import { EXCHANGES, MEMES, memePrices } from "@/lib/trade";

export const revalidate = 60;
export const metadata = {
  title: "Trade · AUTISTIK Hub",
  description: "Top meme coin prices and the exchanges to trade them on.",
};

export default async function TradePage() {
  const prices = await memePrices();
  const anyRef = EXCHANGES.some((e) => e.ref);
  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <SectionTabs tabs={LAUNCH_TABS} active="/trade" label="Launch" />
      <div className="page-head">
        <div className="label">Trending · Trade</div>
        <h1>Trade the top meme coins</h1>
        <p className="muted">Live prices of the biggest meme coins, and the exchanges where you can buy them. Using our links supports AUTISTIK at no extra cost to you.</p>
      </div>

      <div className="card stack">
        <h2>Top meme coins</h2>
        <div role="table" aria-label="Top meme coins">
          <div className="board-row head trade-row" role="row"><span>Coin</span><span className="n">Price</span><span className="n">24h</span><span className="n hide-sm">Market cap</span></div>
          {MEMES.map((m) => {
            const p = prices[m.id];
            return (
              <div key={m.id} className="board-row trade-row" role="row">
                <span className="tname"><div><b>{m.name}</b><br /><span className="muted" style={{ fontSize: ".82em" }}>{m.symbol}</span></div></span>
                <span className="n">{usd(p?.price)}</span>
                <span className={"n " + ((p?.change24h ?? 0) >= 0 ? "up" : "down")}>{p?.change24h == null ? "–" : `${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(1)}%`}</span>
                <span className="n hide-sm">{usd(p?.marketCap)}</span>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: ".8em" }}>Prices from CoinGecko, updated every minute.</p>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <h2>Where to trade</h2>
        <div className="grid2" style={{ gap: 12 }}>
          {EXCHANGES.map((e) => (
            <div key={e.id} className="card stack" style={{ gap: 8 }}>
              <h3>{e.name}</h3>
              <p className="muted" style={{ fontSize: ".9em" }}>{e.blurb}</p>
              <div className="row"><a className="btn primary small" href={e.ref || e.site} target="_blank" rel="noopener noreferrer sponsored">Open {e.name}</a></div>
            </div>
          ))}
        </div>
        {anyRef && <p className="muted" style={{ fontSize: ".82em" }}>Some of these are referral links: if you sign up through them, AUTISTIK may earn a share of the exchange&apos;s fees. It costs you nothing extra.</p>}
      </div>

      <div className="notice warn" style={{ fontSize: ".9em" }}>
        <b>Please read before trading.</b> Meme coins can lose most of their value in hours. Only use money you can afford to lose.
        Leverage (futures, &quot;10x&quot;, &quot;margin&quot;) is much riskier: read the Perps tab first. Check that crypto trading is legal where you live.
        Nothing here is financial advice. Never share your password, seed phrase or 2FA codes with anyone, including people claiming to be from AUTISTIK.
      </div>
    </div>
  );
}
