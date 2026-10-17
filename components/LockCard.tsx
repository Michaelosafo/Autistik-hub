import Link from "next/link";
import type { LpLock, LockView } from "@/lib/locker-server";
import { untilText } from "@/lib/locker";

const pct = (v: number) => (v > 0 && v < 0.1 ? "<0.1%" : `${v >= 10 ? Math.round(v) : v.toFixed(1)}%`);
const amt = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: Number(v) < 1 ? 6 : 0 });

/** 🔒 Is the liquidity locked or burned, and are any tokens locked? Shown on token pages and in the Lockers check. */
export default function LockCard({ lp, locks, chain, token, lockerLive }: { lp: LpLock | null; locks: LockView[]; chain: string; token: string; lockerLive: boolean }) {
  const safe = lp ? Math.min(100, lp.locked + lp.burned) : null;
  const active = locks.filter((l) => !l.done);
  const level = safe == null ? "unknown" : safe >= 90 ? "good" : safe >= 50 ? "some" : "bad";
  const title = level === "good" ? `🔒 Liquidity is safe: ${pct(safe!)} locked or burned`
    : level === "some" ? `🟠 Liquidity partly locked: ${pct(safe!)}`
    : level === "bad" ? `🔓 Liquidity NOT locked: only ${pct(safe!)} locked or burned`
    : "🔒 Liquidity lock: unknown";
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <Link className="muted" href={`/lockers?chain=${chain}&token=${token}`} style={{ fontSize: ".88em" }}>All locks →</Link>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {level === "good" ? "The pool's money can't be pulled out, so a classic rug pull isn't possible while it stays locked."
          : level === "some" ? "Part of the pool's money could still be pulled out. Check who holds the rest."
          : level === "bad" ? "Whoever holds the pool tokens could pull the money out at any time (rug pull). Be careful."
          : "We couldn't read the pool's lock status for this token (common on Solana and new pools)."}
      </p>
      {lp && (lp.burned > 0 || lp.lockers.length > 0) && (
        <div className="badges">
          {lp.burned > 0.05 && <span className="badge-pill">🔥 Burned {pct(lp.burned)}</span>}
          {lp.lockers.map((l, i) => (
            <span key={i} className="badge-pill">🔒 {l.name} {pct(l.pct)}{l.until ? ` · ${l.until * 1000 > Date.now() ? "until " + new Date(l.until * 1000).toLocaleDateString() : "expired"}` : ""}</span>
          ))}
        </div>
      )}
      {active.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <b>In the AUTISTIK Locker</b>
          {active.slice(0, 6).map((l) => (
            <div key={l.id} className="row" style={{ justifyContent: "space-between", gap: 8, fontSize: ".92em" }}>
              <span>{l.isLp ? "💧" : "🪙"} {amt(l.left)} {l.name}{l.pctOfSupply != null && l.pctOfSupply >= 0.1 && !l.isLp ? ` (${pct(l.pctOfSupply)} of supply)` : ""}{l.vesting ? " · unlocks in steps" : ""}</span>
              <span className="muted">{l.unlockDate * 1000 > Date.now() ? `until ${new Date(l.unlockDate * 1000).toLocaleDateString()} (${untilText(l.unlockDate)})` : "unlockable now"}</span>
            </div>
          ))}
        </div>
      )}
      {lockerLive && level !== "good" && <Link className="btn small" href="/lockers">🔒 Lock liquidity or tokens with the AUTISTIK Locker</Link>}
      <small className="muted">Lock data: GoPlus and the AUTISTIK Locker, read from the chain.</small>
    </div>
  );
}
