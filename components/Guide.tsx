import Link from "next/link";

/**
 * "How it works" for beginners, in the same look as Create a coin: numbered step cards, always visible,
 * a short tip and one clear next action.
 */
export default function Guide({ title, steps, tip, action }: { id?: string; title: string; steps: React.ReactNode[]; tip?: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <section className="ln-guide" aria-label={title}>
      <ol className="ln-steps">{steps.map((s, i) => <li key={i}><i>{i + 1}</i><span><small className="ln-step-t">{s}</small></span></li>)}</ol>
      {(tip || action) && (
        <p className="ln-alt">{tip}{tip && action ? " " : ""}{action && <Link href={action.href}>{action.label}</Link>}</p>
      )}
    </section>
  );
}
