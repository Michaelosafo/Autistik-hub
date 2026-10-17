import Link from "next/link";
import ProPay from "@/components/ProPay";
import { FREE_PINS, PRO_FEATURES, PRO_PINS, PRO_USD, PRO_DAYS } from "@/lib/pro";
import { trackRecord } from "@/lib/analytics-pro";

export const dynamic = "force-dynamic";
export const metadata = { title: "AUTISTIK Pro · AUTISTIK Hub", description: "Advanced token analysis, paid in $AUTISTIK." };

export default async function ProPage() {
  const rec = await trackRecord("", "").catch(() => null);
  const all = rec?.all;
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <Link href="/analytics" className="muted">← Stats</Link>
      <div className="card stack pro-hero">
        <div className="label" style={{ color: "#E9B65A" }}>💎 AUTISTIK Pro</div>
        <h1 style={{ margin: 0 }}>Better information, better decisions</h1>
        <p className="muted">Everything on Stats, plus the advanced reads serious traders use. Paid in $AUTISTIK: ${PRO_USD} for {PRO_DAYS} days.</p>
        {all?.total ? <p><b>Our track record:</b> buy and sell signals were right {Math.round((all.right / all.total) * 100)}% of the time after 24 hours ({all.right} of {all.total}).</p> : null}
        <ProPay />
      </div>
      <div className="card stack">
        <h2>What you get</h2>
        <ul className="pro-feats">{PRO_FEATURES.map((f) => <li key={f.name}><b>{f.icon} {f.name}</b><span>{f.text}</span></li>)}</ul>
        <p className="muted" style={{ fontSize: ".85em" }}>Free members keep the buy/sell zones, the 3 reasons boxes, {FREE_PINS} pins and alerts. Pro adds the rest and up to {PRO_PINS} pins.</p>
      </div>
      <p className="fin-note">⚠️ Pro gives you more and better signals, not certainty. Nothing here is financial advice. Never put in more than you can afford to lose. Passes aren&apos;t refundable.</p>
    </div>
  );
}
