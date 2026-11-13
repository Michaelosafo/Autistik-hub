import { CHAINS, type ChainKey } from "@/lib/launchpad";

export type Summary = { attended: number; comments: number; commenters: number; drops: { chain: string; token: string; symbol: string | null; total: string; recipients: number; tx: string }[] };

const n = (v: number) => v.toLocaleString("en-US");
const amount = (t: string) => { const v = Number(t); return isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 4 }) : t; };

/** After a live: how many people joined, the talk in the comments, how long it ran, and every token drop sent. */
export default function LiveSummary({ s, mins, isPrivate }: { s: Summary; mins: number; isPrivate?: boolean }) {
  const sent = s.drops.reduce((a, d) => a + (Number(d.recipients) || 0), 0);
  return (
    <section className="card stack lv-sum" aria-label="Live summary">
      <b>Live summary{isPrivate ? " · 🔒 private" : ""}</b>
      <div className="lv-sum-grid">
        <div><span aria-hidden="true">👥</span><b>{n(s.attended)}</b><small>{s.attended === 1 ? "person joined" : "people joined"}</small></div>
        <div><span aria-hidden="true">💬</span><b>{n(s.comments)}</b><small>{s.comments === 1 ? "comment" : "comments"}{s.commenters ? ` from ${n(s.commenters)}` : ""}</small></div>
        <div><span aria-hidden="true">⏱️</span><b>{mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`}</b><small>on air</small></div>
        <div><span aria-hidden="true">🎁</span><b>{n(s.drops.length)}</b><small>{s.drops.length === 1 ? "token drop" : "token drops"}{sent ? ` · ${n(sent)} sends` : ""}</small></div>
      </div>
      {s.drops.length > 0 && (
        <div className="lv-sum-drops">
          <small className="muted">Tokens sent during the live</small>
          {s.drops.map((d) => {
            const c = CHAINS[d.chain as ChainKey];
            return (
              <div key={d.tx} className="lv-sum-drop">
                <span><b>{amount(d.total)} {d.symbol || (d.token === "native" ? c?.coin ?? "" : "tokens")}</b> to {n(d.recipients)} {d.recipients === 1 ? "person" : "people"}{c ? ` · ${c.name}` : ""}</span>
                {c?.explorer && <a href={`${c.explorer}/tx/${d.tx}`} target="_blank" rel="noopener noreferrer" className="btn small">View transfer</a>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
