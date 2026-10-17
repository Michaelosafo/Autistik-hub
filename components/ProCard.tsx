import Link from "next/link";
import ProReport from "@/components/ProReport";
import { PRO_FEATURES, PRO_USD } from "@/lib/pro";
import type { Confluence, TrackRecord } from "@/lib/analytics-pro";
import { walletUrl } from "@/lib/explorer";

const pct = (r: { right: number; total: number }) => (r.total ? Math.round((r.right / r.total) * 100) : null);
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

type Props = {
  pro: boolean; chain: string; token: string; explorer: string; record: TrackRecord;
  frames?: Confluence; whales?: { buyers: any[]; sellers: any[]; verdict: string; mood: number };
};

/** 💎 AUTISTIK Pro on a token page: the advanced reads for members, a locked preview for everyone else. */
export default function ProCard({ pro, chain, token, explorer, record, frames, whales }: Props) {
  const all = pct(record.all), mine = pct(record.token);
  const trackLine = record.all.total
    ? `Our buy and sell signals were right ${all}% of the time 24 hours later (${record.all.right} of ${record.all.total}).`
    : "We're grading every signal 24 hours later. The track record appears here as results come in.";
  if (!pro) return (
    <div className="card stack pro-card locked">
      <div className="label">💎 AUTISTIK Pro</div>
      <h2>Get more accurate decisions</h2>
      <p className="muted">{trackLine}</p>
      <ul className="pro-feats">{PRO_FEATURES.map((f) => <li key={f.name}><b>{f.icon} {f.name}</b><span>{f.text}</span></li>)}</ul>
      <Link className="btn primary" href="/pro">💎 Unlock Pro with $AUTISTIK (${PRO_USD} a month)</Link>
    </div>
  );
  return (
    <div className="card stack pro-card">
      <div className="label">💎 AUTISTIK Pro analysis</div>
      {frames && (
        <section className="stack" style={{ gap: 8 }}>
          <b>⏱️ 3 timeframes</b>
          <div className="tf-row">{frames.frames.map((f) => <span key={f.frame} className={"tf-chip " + f.kind}><small>{f.label}</small>{f.title}</span>)}</div>
          <p className={"tf-verdict a" + frames.agree}>{frames.verdict}</p>
        </section>
      )}
      {whales && (
        <section className="stack" style={{ gap: 8 }}>
          <b>🐋 Whale radar (last 24 hours)</b>
          <p className={whales.mood > 0 ? "good-txt" : whales.mood < 0 ? "bad-txt" : ""}>{whales.verdict}</p>
          {(whales.buyers.length > 0 || whales.sellers.length > 0) && (
            <div className="whale-grid">
              {[...whales.buyers.map((w) => ({ ...w, up: true })), ...whales.sellers.map((w) => ({ ...w, up: false }))].map((w) => (
                <a key={w.wallet} href={walletUrl(explorer, token, w.wallet)} target="_blank" rel="noopener noreferrer" className={"whale " + (w.up ? "up" : "down")}>
                  <span className="mono">{short(w.wallet)}</span><b>{w.up ? "bought" : "sold"} {Math.abs(w.pct).toFixed(2)}%</b>
                </a>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="stack" style={{ gap: 6 }}>
        <b>📊 Track record</b>
        <p>{mine != null ? `On this token: right ${mine}% of the time (${record.token.right} of ${record.token.total} signals). ` : ""}{trackLine}</p>
      </section>
      <section className="stack" style={{ gap: 6 }}>
        <b>🤖 Analyst report</b>
        <ProReport chain={chain} token={token} />
      </section>
      <p className="fin-note">⚠️ Not financial advice. More signals agreeing means better odds, never a guarantee.</p>
    </div>
  );
}
