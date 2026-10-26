import Link from "next/link";
import type { ReactNode } from "react";

const TABS = [
  { href: "/stake", name: "Stake", blurb: "Earn BNB from platform fees",
    icon: <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /> },
  { href: "/susu", name: "Susu", blurb: "Save a little every day",
    icon: <><rect x="3" y="7" width="18" height="13" rx="3" /><path d="M16 13.5h.01M3 11h18M8 7V4h8v3" /></> },
  { href: "/rewards", name: "Rewards", blurb: "Points & $AUTISTIK airdrops",
    icon: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v8h14v-8M12 8v12M12 8c-1.5-3-5-3.5-5-1.5S10 8 12 8zM12 8c1.5-3 5-3.5 5-1.5S14 8 12 8z" /></> },
];

/**
 * The Earn pages' shared top (Stake, Susu, Rewards), in the same look as Create a coin: title, a line of what it is,
 * the three Earn tabs, how it works in steps, and the key facts.
 */
export default function EarnTop({ active, title, text, right, steps, facts }: {
  active: "/stake" | "/susu" | "/rewards"; title: string; text: ReactNode; right?: ReactNode;
  steps: { t: string; d: ReactNode }[]; facts?: ReactNode[];
}) {
  return (
    <>
      <header className="bd-top ln-top">
        <div>
          <h1>{title}</h1>
          <p className="muted">{text}</p>
        </div>
        {right && <div className="ln-top-r">{right}</div>}
      </header>
      <nav className="earn-tabs" aria-label="Earn">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined}>
            <i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg></i>
            <span><b>{t.name}</b><small>{t.blurb}</small></span>
          </Link>
        ))}
      </nav>
      <ol className="ln-steps" aria-label="How it works">
        {steps.map((s, i) => <li key={i}><i>{i + 1}</i><span><b>{s.t}</b><small>{s.d}</small></span></li>)}
      </ol>
      {facts && facts.length > 0 && <div className="ln-facts">{facts.map((f, i) => <span key={i}>{f}</span>)}</div>}
    </>
  );
}
