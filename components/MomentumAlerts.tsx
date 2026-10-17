"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { enablePush, hasPush } from "@/lib/push-client";
import { DEFAULT_PREFS, MOMENTUM_CHAINS, type AlertPrefs } from "@/lib/momentum";

const STRENGTH = [
  { v: 80, label: "🔥🔥 Only the strongest (80+)" },
  { v: 70, label: "🔥 Hot (70+)" },
  { v: 60, label: "⚡ Hot & strong building (60+)" },
  { v: 50, label: "⚡ Everything building (50+)" },
];
const POOL = [
  { v: 15_000, label: "$15K+ (riskiest)" },
  { v: 30_000, label: "$30K+" },
  { v: 100_000, label: "$100K+ (safer)" },
  { v: 500_000, label: "$500K+ (safest)" },
];
const CAP = [
  { v: 1_000_000, label: "Under $1M (biggest upside, most risk)" },
  { v: 5_000_000, label: "Under $5M" },
  { v: 20_000_000, label: "Under $20M" },
  { v: 100_000_000, label: "Under $100M" },
  { v: null, label: "Any size" },
];

/** 🔔 Momentum alerts: choose which fast movers reach your phone, plus follow-ups at 1.5x, 2x and the stop. */
export default function MomentumAlerts({ signedIn }: { signedIn: boolean }) {
  const [p, setP] = useState<AlertPrefs | null>(null);
  const [perDay, setPerDay] = useState(3);
  const [pro, setPro] = useState(false);
  const [saved, setSaved] = useState<AlertPrefs | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/momentum/alerts", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (!d?.signedIn) return;
      setP(d.prefs); setSaved(d.prefs); setPerDay(d.perDay); setPro(!!d.pro);
    }).catch(() => setP(DEFAULT_PREFS));
  }, [signedIn]);

  if (!signedIn) return (
    <div className="card row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <span>🔔 <b>Momentum alerts:</b> get a phone alert the moment a token heats up, then at 1.5x, 2x or the stop.</span>
      <Link className="btn small primary" href="/login?next=/momentum">Sign in to turn on</Link>
    </div>
  );
  if (!p) return <div className="card muted">Loading your alerts…</div>;

  async function save(next: AlertPrefs) {
    setBusy(true); setMsg("");
    const r = await fetch("/api/momentum/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error || "Couldn't save. Try again."); return; }
    setP(next); setSaved(next);
    if (next.enabled && !(await hasPush())) {
      const res = await enablePush();
      setMsg(res === "push" ? "✅ Saved. Alerts will reach this device, even with the site closed."
        : res === "local" ? "✅ Saved. Alerts show in 🔔 while the site is open. Add the Hub to your home screen for phone alerts."
        : "✅ Saved, but notifications are blocked. Turn them on in your browser settings to get alerts.");
    } else setMsg(next.enabled ? "✅ Saved. We check every 5 minutes." : "Alerts are off.");
  }
  const set = <K extends keyof AlertPrefs>(k: K, v: AlertPrefs[K]) => setP({ ...p, [k]: v });
  const toggleChain = (c: string) => set("chains", p.chains.includes(c) ? p.chains.filter((x) => x !== c) : [...p.chains, c]);
  const changed = JSON.stringify(p) !== JSON.stringify(saved);

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span>🔔 <b>Momentum alerts</b> {saved?.enabled ? <span className="chip-flag ok">On</span> : <span className="chip-flag bad">Off</span>}
          <br /><small className="muted">A phone alert when a token matching your settings heats up, with the buy range, targets and stop. Up to {perDay} a day{pro ? " (Pro)" : ""}.</small></span>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn small" onClick={() => setOpen(!open)}>{open ? "Close" : "⚙️ Settings"}</button>
          <button type="button" className={"btn small" + (saved?.enabled ? "" : " primary")} disabled={busy} onClick={() => save({ ...p, enabled: !saved?.enabled })}>{saved?.enabled ? "Turn off" : "Turn on"}</button>
        </div>
      </div>
      {open && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="stack" style={{ gap: 4 }}>
            <b>Chains</b>
            <div className="chips">
              {MOMENTUM_CHAINS.map((c) => (
                <button key={c.key} type="button" className="chip" aria-pressed={p.chains.includes(c.key)} onClick={() => toggleChain(c.key)} style={p.chains.includes(c.key) ? { borderColor: "var(--teal)", background: "var(--teal-soft)" } : undefined}>
                  {p.chains.includes(c.key) ? "✓ " : ""}{c.name}
                </button>
              ))}
            </div>
          </div>
          <label className="stack" style={{ gap: 4 }}><b>How strong</b>
            <select value={p.min_score} onChange={(e) => set("min_score", Number(e.target.value))}>{STRENGTH.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
          </label>
          <label className="stack" style={{ gap: 4 }}><b>Smallest pool</b>
            <select value={p.min_liquidity} onChange={(e) => set("min_liquidity", Number(e.target.value))}>{POOL.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
          </label>
          <label className="stack" style={{ gap: 4 }}><b>Market cap</b>
            <select value={p.max_mcap ?? ""} onChange={(e) => set("max_mcap", e.target.value === "" ? null : Number(e.target.value))}>{CAP.map((o) => <option key={String(o.v)} value={o.v ?? ""}>{o.label}</option>)}</select>
          </label>
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={p.follow_ups} onChange={(e) => set("follow_ups", e.target.checked)} />
            <span>Follow-ups: tell me when an alerted token hits <b>1.5x</b>, <b>2x</b> or the <b>−20% stop</b></span>
          </label>
          {!pro && <small className="muted">Free: {perDay} alerts a day. <Link href="/pro">💎 AUTISTIK Pro</Link> gets up to 40.</small>}
          <button type="button" className="btn primary" disabled={busy || !changed || !p.chains.length} onClick={() => save({ ...p, enabled: true })}>{busy ? "Saving…" : "Save & turn on"}</button>
        </div>
      )}
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}
