import { usd, type Sign, type Zones } from "@/lib/analytics-zones";

const dot = (l: number) => (l > 0 ? "good" : l < 0 ? "bad" : "warn");

/** The buy / sell zone card: a simple price ladder, how strong the signal is, and the reasons in plain words. */
export default function ZoneCard({ z, symbol }: { z: Zones; symbol: string }) {
  // Price ladder scale: from just under the buy range to just over the sell range (and the current price).
  const pts = [z.price, ...(z.buy || []), ...(z.sell || [])].filter((v): v is number => v != null && isFinite(v));
  const lo = Math.min(...pts) * 0.97, hi = Math.max(...pts) * 1.03;
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  const width = (r: [number, number]) => `${Math.max(2, ((r[1] - r[0]) / (hi - lo)) * 100)}%`;
  const box = (icon: string, name: string, signs: Sign[]) => (
    <section className="zone-box">
      <div className="label">{icon} {name}</div>
      {!signs.length ? <small className="muted">Nothing stands out yet.</small> : (
        <ul className="signals">{signs.map((x, i) => <li key={i} className={dot(x.lean)}>{x.text}</li>)}</ul>
      )}
    </section>
  );
  return (
    <div className={"card stack zone-card " + z.kind}>
      <div className="label">🎯 Buy or sell zone for ${symbol}</div>
      <div className="zone-top">
        <h2>{z.title}</h2>
        <span className={"zone-strength " + z.strength.label.toLowerCase()} title="How many of the signs below agree">
          {z.strength.label} signal · {z.strength.agree} of {z.strength.total} signs agree
        </span>
      </div>
      <p>{z.summary}</p>
      {pts.length >= 2 && hi > lo && (
        <div className="ladder" aria-label="Price ladder">
          {z.buy && <span className="lz buy" style={{ left: at(z.buy[0]), width: width(z.buy) }} />}
          {z.sell && <span className="lz sell" style={{ left: at(z.sell[0]), width: width(z.sell) }} />}
          {z.price != null && <span className="lp" style={{ left: at(z.price) }}><b>Now {usd(z.price)}</b></span>}
        </div>
      )}
      <div className="zone-ranges">
        {z.buy && <div className="zr buy"><span>🟢 Buy range</span><b>{usd(z.buy[0])} – {usd(z.buy[1])}</b></div>}
        {z.sell && <div className="zr sell"><span>🔴 Sell range</span><b>{usd(z.sell[0])} – {usd(z.sell[1])}</b></div>}
      </div>
      <div className="zone-grid">
        {box("🧠", "What people are feeling", z.people)}
        {box("📈", "What the chart says", z.chart)}
        {box("🏗️", "What the project is made of", z.project)}
      </div>
      <p className="fin-note">⚠️ Not financial advice. These are the patterns people usually follow, not promises. Prices can always do something else.</p>
    </div>
  );
}
