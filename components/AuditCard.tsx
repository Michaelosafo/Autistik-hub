import Link from "next/link";
import type { Audit } from "@/lib/analytics-audit";

const ICON = { ok: "✓", warn: "!", bad: "✗", unknown: "?" } as const;

/** The advanced audit: an A–F grade and every check. `compact` (Overview) shows only the problems and a link to all. */
export default function AuditCard({ a, compact, more }: { a: Audit; compact?: boolean; more?: string }) {
  const problems = a.groups.flatMap((g) => g.checks.filter((c) => c.level === "bad" || c.level === "warn").map((c) => ({ ...c, group: g.title })))
    .sort((x, y) => (x.level === "bad" ? 0 : 1) - (y.level === "bad" ? 0 : 1));
  return (
    <section className={`card audit grade-${a.grade}`} aria-label="Advanced audit">
      <div className="audit-head">
        <span className="audit-grade" aria-label={`Grade ${a.grade}`}>{a.grade}</span>
        <div className="grow">
          <small>Advanced audit{a.score != null ? ` · ${a.score}/100` : ""}</small>
          <b>{a.headline}</b>
          <span className="audit-counts"><i className="bad">{a.bad} red flags</i><i className="warn">{a.warn} warnings</i><i className="ok">{a.ok} passed</i></span>
        </div>
      </div>
      {compact ? (
        <>
          {problems.length > 0 && (
            <ul className="audit-list">
              {problems.slice(0, 6).map((c) => <li key={c.group + c.label} className={c.level}><span aria-hidden="true">{ICON[c.level]}</span><span><b>{c.label}</b> {c.detail}</span></li>)}
            </ul>
          )}
          {more && <Link href={more} scroll={false} className="audit-more">See all {a.bad + a.warn + a.ok} checks →</Link>}
        </>
      ) : (
        <div className="audit-groups">
          {a.groups.map((g) => (
            <div key={g.title} className="audit-group">
              <h3>{g.title}</h3>
              <ul className="audit-list">
                {g.checks.map((c) => <li key={c.label + c.detail} className={c.level}><span aria-hidden="true">{ICON[c.level]}</span><span><b>{c.label}</b> {c.detail}</span></li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      <small className="muted">From GoPlus contract checks, a live buy/sell simulation (honeypot.is), DexScreener and our holder scan. Checks can miss things: not financial advice.</small>
    </section>
  );
}
