"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * "How it works" for beginners: a small button that opens three plain steps (and stays open if they want it).
 * Nothing on the page is hidden by it.
 */
export default function Guide({ id, title, steps, tip, action }: { id: string; title: string; steps: React.ReactNode[]; tip?: React.ReactNode; action?: { href: string; label: string } }) {
  const key = `guide-${id}`;
  const [open, setOpen] = useState(false);
  useEffect(() => { try { setOpen(localStorage.getItem(key) === "open"); } catch { setOpen(false); } }, [key]);
  const set = (o: boolean) => { setOpen(o); try { localStorage.setItem(key, o ? "open" : "closed"); } catch { /* private mode */ } };
  if (!open) return <button type="button" className="guide-pill" onClick={() => set(true)}>How it works</button>;
  return (
    <section className="guide" aria-label={title}>
      <div className="guide-head"><b>{title}</b><button type="button" className="guide-x" onClick={() => set(false)} aria-label="Fold this guide">Got it</button></div>
      <ol className="guide-steps">{steps.map((s, i) => <li key={i}><span className="guide-n">{i + 1}</span><span>{s}</span></li>)}</ol>
      {tip && <p className="guide-tip">{tip}</p>}
      {action && <Link className="guide-go" href={action.href}>{action.label}</Link>}
      <Link className="guide-more" href="/start">New to crypto? Start here →</Link>
    </section>
  );
}
