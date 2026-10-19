"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * "How it works" for beginners: three plain steps at the top of a section. Open on the first visit, then folded into
 * a small button (remembered per page on this device). Nothing on the page is hidden by it.
 */
export default function Guide({ id, title, steps, tip }: { id: string; title: string; steps: React.ReactNode[]; tip?: React.ReactNode }) {
  const key = `guide-${id}`;
  const [open, setOpen] = useState(false);
  useEffect(() => { try { setOpen(localStorage.getItem(key) !== "closed"); } catch { setOpen(true); } }, [key]);
  const set = (o: boolean) => { setOpen(o); try { localStorage.setItem(key, o ? "open" : "closed"); } catch { /* private mode */ } };
  if (!open) return <button type="button" className="guide-pill" onClick={() => set(true)}>How it works</button>;
  return (
    <section className="guide" aria-label={title}>
      <div className="guide-head"><b>{title}</b><button type="button" className="guide-x" onClick={() => set(false)} aria-label="Fold this guide">Got it</button></div>
      <ol className="guide-steps">{steps.map((s, i) => <li key={i}><span className="guide-n">{i + 1}</span><span>{s}</span></li>)}</ol>
      {tip && <p className="guide-tip">{tip}</p>}
      <Link className="guide-more" href="/start">New to crypto? Start here →</Link>
    </section>
  );
}
