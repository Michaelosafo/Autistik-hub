import type { Trust } from "@/lib/trust-score";

/** 🛡️ The token's overall trust score, summing up the scan's safety checks. Sits at the top of every scan. */
export default function TrustScore({ t }: { t: Trust }) {
  const icon = { ok: "✓", warn: "!", bad: "⚠" } as const;
  return (
    <div className={"trust " + t.level}>
      <div className="trust-top">
        <span className="trust-ring" style={{ ["--r" as any]: t.score ?? 0 }} aria-label={t.score == null ? "Trust score unknown" : `Trust score ${t.score} out of 100`}>
          <b>{t.score ?? "?"}</b><small>/100</small>
        </span>
        <div className="grow">
          <div className="label">Trust score</div>
          <h2>{t.title}</h2>
          <p className="muted">Based on {t.known} of {t.total} safety checks. A guide, not a promise.</p>
        </div>
      </div>
      {t.checks.length > 0 && (
        <ul className="trust-checks">
          {t.checks.map((c) => <li key={c.key} className={c.state}><i aria-hidden>{icon[c.state]}</i><span><b>{c.name}</b><small>{c.text}</small></span></li>)}
        </ul>
      )}
    </div>
  );
}
