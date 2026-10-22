import TokenLogo from "@/components/TokenLogo";
import type { Shown } from "@/lib/holdings";

const usd = (v: number) => v >= 1000 ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`;
const amt = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1000 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 });

/** Holdings a member chose to share (BNB Chain). Amounts only, never the address. */
export default function HoldingsCard({ items, mine, how }: { items: Shown[]; mine: boolean; how: string }) {
  const total = items.reduce((t, h) => t + (h.valueUsd ?? 0), 0);
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Holdings</h2>
        <span className="badge v">{how}</span>
      </div>
      {!items.length ? <div className="empty">{mine ? "Nothing in your linked wallet on BNB Chain yet." : "Nothing to show yet."}</div> : (
        <>
          {total > 0 && <div className="hold-total">{usd(total)}<small> on BNB Chain</small></div>}
          <ul className="holdings">
            {items.map((h) => (
              <li key={h.symbol + h.name}>
                <TokenLogo src={h.logo} symbol={h.symbol} />
                <span className="stack" style={{ gap: 0, minWidth: 0 }}><b>{h.symbol}</b><small className="muted">{h.name}</small></span>
                <span className="num">{amt(h.amount)}{h.valueUsd != null && <small className="muted"> · {usd(h.valueUsd)}</small>}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
