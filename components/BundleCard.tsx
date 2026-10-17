import { walletUrl } from "@/lib/explorer";
import type { Bundle } from "@/lib/analytics-bundle";

const COLORS = ["#E5484D", "#F5A524", "#8E4EC6", "#0091FF", "#12A594", "#D6409F"];
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

/** 🫧 Bundle check: are the holders really different people? With a bubble map of linked wallets. */
export default function BundleCard({ b, explorer, token }: { b: Bundle; explorer: string; token: string }) {
  const color = (g: number) => (g ? COLORS[(g - 1) % COLORS.length] : "var(--line)");
  return (
    <div className={"card stack bundle-card " + b.level}>
      <div className="label">🫧 Bundle check</div>
      <div className="zone-top">
        <h2>{b.title}</h2>
        <span className="zone-strength">{b.bundledPct.toFixed(1)}% of supply in linked wallets</span>
      </div>
      <p>{b.summary}</p>

      {b.bubbles.length > 0 && (
        <figure className="bubble-map">
          <svg viewBox="0 0 600 400" role="img" aria-label="Bubble map of the biggest holders. Linked wallets share a colour and a line.">
            {b.lines.map((l, i) => {
              const p = b.bubbles[l.a], q = b.bubbles[l.b];
              return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={color(p.group)} strokeWidth={2} strokeOpacity={0.7} />;
            })}
            {b.bubbles.map((x) => (
              <a key={x.wallet} href={walletUrl(explorer, token, x.wallet)} target="_blank" rel="noopener noreferrer">
                <title>{`${short(x.wallet)}${x.isDev ? " (dev)" : ""}: ${x.pct.toFixed(2)}% of supply${x.group ? ` · linked group ${x.group}` : ""}`}</title>
                <circle cx={x.x} cy={x.y} r={x.r} fill={x.group ? color(x.group) : "var(--surface-2)"} fillOpacity={x.group ? 0.85 : 1}
                  stroke={x.isDev ? "#C9A227" : x.group ? color(x.group) : "var(--line)"} strokeWidth={x.isDev ? 4 : 1.5} />
                {x.r >= 16 && <text x={x.x} y={x.y + 4} textAnchor="middle" fontSize={11} fontWeight={800} fill={x.group ? "#fff" : "var(--ink)"}>{x.pct >= 1 ? x.pct.toFixed(1) : x.pct.toFixed(2)}%</text>}
              </a>
            ))}
          </svg>
          <figcaption className="muted">Each bubble is a wallet, sized by how much it holds. <b>Same colour + line = linked wallets.</b> Gold ring = the dev. Tap a bubble to open the wallet.</figcaption>
        </figure>
      )}

      <ul className="signals">{b.reasons.map((r, i) => <li key={i} className={b.level === "high" ? "bad" : b.level === "some" ? "warn" : "good"}>{r}</li>)}</ul>
      {b.groups.length > 0 && (
        <div className="conn-list">
          {b.groups.map((g, i) => (
            <div key={i} className="conn-group" style={{ borderLeftColor: COLORS[i % COLORS.length] }}>
              <b>Group {i + 1}: {g.wallets.length} wallets · {g.pct.toFixed(2)}% of supply{g.withDev ? " · includes the dev" : ""}</b>
              <small className="muted">Linked because they {g.how.join(", ")}.</small>
            </div>
          ))}
        </div>
      )}
      <p className="fin-note">⚠️ Links are found from on-chain activity we can see. Some bundles hide better than that, so treat 🟢 as &quot;nothing found&quot;, not a guarantee.</p>
    </div>
  );
}
