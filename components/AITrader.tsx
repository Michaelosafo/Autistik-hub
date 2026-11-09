"use client";
/**
 * Admin: the AI trader. Turn it on or off, practice (pretend BNB) or live (its own wallet), how much per trade, how
 * many coins at once, the safety gates, default stop-loss / take profit / trailing stop, and each coin's own
 * stop-loss and take profit. Shows open coins with live profit, closed trades and everything it did.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtAmount, fmtUsd } from "@/lib/num-format";

type S = {
  enabled: boolean; mode: "paper" | "live"; paper_cash: number; paper_start: number; per_trade: number; max_positions: number; min_liquidity: number;
  max_tax: number; min_age_hours: number; stop_loss: number; take_profit: number; trail: number; max_hold_hours: number; daily_loss_limit: number;
  use_ai: boolean; last_run: string; last_note: string | null;
};
type P = {
  id: string; mode: string; token: string; symbol: string | null; name: string | null; logo: string | null; status: string; spent: number; qty: number;
  entry_usd: number; high_usd: number; last_usd: number | null; stop_loss: number; take_profit: number; trail: number; why: string | null;
  buy_tx: string | null; sell_tx: string | null; received: number | null; pnl: number | null; pnl_pct: number | null; close_reason: string | null; opened_at: string; closed_at: string | null;
};
type Data = { settings: S; open: P[]; closed: P[]; log: { id: number; at: string; kind: string; text: string }[]; wallet: { address: string | null; bnb: number | null }; liveReady: boolean; stats: { trades: number; wins: number; winRate: number | null; pnl: number } };

const ago = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const sign = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
async function post(action: string, body: unknown) {
  const r = await fetch(`/api/ai-trader/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d;
}

const FIELDS: { k: keyof S; label: string; unit: string; step: string; hint: string }[] = [
  { k: "per_trade", label: "Per trade", unit: "BNB", step: "0.01", hint: "How much it spends on each coin" },
  { k: "max_positions", label: "Coins at once", unit: "", step: "1", hint: "Most coins it holds at the same time" },
  { k: "stop_loss", label: "Stop-loss", unit: "%", step: "1", hint: "Sells if a coin falls this much below the buy price" },
  { k: "take_profit", label: "Take profit", unit: "%", step: "5", hint: "Sells when a coin is up this much" },
  { k: "trail", label: "Trailing stop", unit: "%", step: "1", hint: "Once up 10%+, sells if it drops this much from its high (0 = off)" },
  { k: "max_hold_hours", label: "Max hold", unit: "hours", step: "1", hint: "Sells anything held longer than this" },
  { k: "min_liquidity", label: "Min liquidity", unit: "$", step: "1000", hint: "Skips coins with a smaller pool" },
  { k: "max_tax", label: "Max tax", unit: "%", step: "1", hint: "Skips coins with a higher buy or sell tax" },
  { k: "min_age_hours", label: "Min coin age", unit: "hours", step: "1", hint: "Skips coins newer than this" },
  { k: "daily_loss_limit", label: "Daily loss limit", unit: "BNB", step: "0.05", hint: "Pauses itself after losing this much in 24 hours" },
];

export default function AITrader() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState<Partial<Record<keyof S, string>>>({});
  const load = () => fetch("/api/ai-trader/status", { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);

  async function act(name: string, action: string, body: unknown, done?: string) {
    setBusy(name); setMsg("");
    try { const r = await post(action, body); setMsg(done || r.note || r.skipped || "Done."); await load(); }
    catch (e) { setMsg((e as Error).message); }
    setBusy("");
  }

  if (err && !d) return <div className="card"><b>AI trader</b><p className="muted">{err}</p></div>;
  if (!d) return <div className="card"><small className="muted">Loading the AI trader…</small></div>;
  const s = d.settings;
  const live = s.mode === "live";
  const cash = live ? d.wallet.bnb : s.paper_cash;
  const invested = d.open.filter((p) => p.mode === s.mode).reduce((a, p) => a + Number(p.spent), 0);
  const value = d.open.filter((p) => p.mode === s.mode).reduce((a, p) => a + Number(p.spent) * ((Number(p.last_usd) || Number(p.entry_usd)) / Number(p.entry_usd)), 0);

  return (
    <div className="stack ait">
      <div className="page-head">
        <Link href="/admin" className="muted">← Admin</Link>
        <div className="label">Admin · testing</div>
        <h1>🤖 AI trader</h1>
        <p className="muted">It looks at coins trending and new on BNB Chain, keeps only ones that pass the safety checks (safety label, honeypot, taxes, liquidity, age), lets the AI pick the best, buys, and sells on stop-loss, take profit, trailing stop or max hold time. It checks every 5 minutes.</p>
      </div>

      <section className={"card ait-top" + (s.enabled ? " on" : "")}>
        <div className="ait-state">
          <span className={"ait-dot" + (s.enabled ? " on" : "")} aria-hidden="true" />
          <div><b>{s.enabled ? "Running" : "Paused"}</b> · {live ? "LIVE (real BNB)" : "Practice (pretend BNB)"}<br /><small className="muted">{s.last_note || "Hasn't run yet."} {s.last_run && Date.parse(s.last_run) > 0 ? `· ${ago(s.last_run)}` : ""}</small></div>
        </div>
        <div className="ait-btns">
          <button type="button" className={"btn " + (s.enabled ? "" : "primary")} disabled={!!busy} onClick={() => act("toggle", "settings", { enabled: !s.enabled }, s.enabled ? "Paused. Open coins are still watched for exits when you run it." : "Running. It will check every 5 minutes.")}>{s.enabled ? "⏸ Pause" : "▶ Start"}</button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => act("run", "run", {})}>{busy === "run" ? "Running…" : "Run now"}</button>
        </div>
      </section>

      <section className="ait-stats">
        <div><small>{live ? "Wallet BNB" : "Practice BNB"}</small><b>{cash == null ? "–" : fmtAmount(cash)}</b></div>
        <div><small>In coins</small><b>{fmtAmount(invested)} BNB</b><em className={value - invested >= 0 ? "up" : "down"}>{sign(value - invested)} BNB now</em></div>
        <div><small>Closed trades</small><b>{d.stats.trades}</b><em>{d.stats.winRate == null ? "–" : `${d.stats.winRate}% won`}</em></div>
        <div><small>Profit (closed)</small><b className={d.stats.pnl >= 0 ? "up" : "down"}>{sign(d.stats.pnl)} BNB</b>{!live && <em>from {s.paper_start} BNB start</em>}</div>
      </section>

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <b>Mode</b>
          <div className="ait-seg" role="radiogroup" aria-label="Mode">
            <button type="button" role="radio" aria-checked={!live} className={!live ? "on" : ""} disabled={!!busy} onClick={() => act("mode", "settings", { mode: "paper" }, "Practice mode: pretend BNB, real prices.")}>Practice</button>
            <button type="button" role="radio" aria-checked={live} className={live ? "on live" : ""} disabled={!!busy || !d.liveReady} onClick={() => { if (confirm("Switch to LIVE? It will trade real BNB from the AI trader wallet.")) act("mode", "settings", { mode: "live" }, "Live mode on."); }}>Live</button>
          </div>
        </div>
        {d.liveReady
          ? <small className="muted">AI trader wallet: <code>{d.wallet.address}</code> · {d.wallet.bnb != null ? `${fmtAmount(d.wallet.bnb)} BNB` : "–"}. Send BNB (BNB Chain) to this address to fund it. Only this wallet is ever traded.</small>
          : <small className="muted">Live is off until a wallet is set up: create a brand-new wallet used only for this, add its private key in Vercel as <code>AI_TRADER_KEY</code> (Settings › Environment Variables), redeploy, then fund it with a small amount of BNB. Never use your main wallet.</small>}
        {!live && <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => { const v = prompt("Reset the practice account to how much pretend BNB?", "1"); if (v) act("reset", "reset", { start: Number(v) }, "Practice account reset."); }}>Reset practice account</button>}
      </section>

      <section className="card stack">
        <b>Rules</b>
        <div className="ait-form">
          {FIELDS.map((f) => (
            <label key={f.k}>
              <span>{f.label}</span>
              <span className="ait-in"><input inputMode="decimal" step={f.step} value={form[f.k] ?? String(s[f.k])} onChange={(e) => setForm({ ...form, [f.k]: e.target.value })} />{f.unit && <em>{f.unit}</em>}</span>
              <small>{f.hint}</small>
            </label>
          ))}
          <label className="ait-check"><input type="checkbox" checked={s.use_ai} onChange={(e) => act("ai", "settings", { use_ai: e.target.checked })} /> <span>Let the AI pick among the safe coins (off: highest momentum score wins)</span></label>
        </div>
        <button type="button" className="btn primary" style={{ alignSelf: "flex-start" }} disabled={!!busy || !Object.keys(form).length} onClick={() => act("save", "settings", Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)])), "Rules saved. New coins use the new stop-loss and take profit.").then(() => setForm({}))}>Save rules</button>
      </section>

      {msg && <div className="notice" role="status">{msg}</div>}

      <section className="card stack">
        <b>Open coins ({d.open.length})</b>
        {!d.open.length ? <small className="muted">Nothing open. It buys when a coin passes every check.</small> : d.open.map((p) => <Open key={p.id} p={p} busy={!!busy} onAct={act} />)}
      </section>

      <section className="card stack">
        <b>Closed trades</b>
        {!d.closed.length ? <small className="muted">None yet.</small> : (
          <div className="ait-table">
            {d.closed.map((p) => (
              <div key={p.id} className="ait-tr">
                <span><b>{p.symbol}</b> <small className="muted">{p.mode === "paper" ? "practice" : "live"} · {p.closed_at ? ago(p.closed_at) : ""}</small><br /><small className="muted">{p.close_reason}</small></span>
                <span className="n">{fmtAmount(Number(p.spent))} → {fmtAmount(Number(p.received) || 0)} BNB</span>
                <span className={"n " + ((Number(p.pnl) || 0) >= 0 ? "up" : "down")}><b>{sign(Number(p.pnl_pct) || 0)}%</b></span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card stack">
        <b>What it did</b>
        <div className="ait-log">{d.log.map((l) => <div key={l.id} className={"ait-l " + l.kind}><small>{ago(l.at)}</small><span>{l.text}</span></div>)}</div>
      </section>
      <p className="fin-note">This is an experiment. Automated trading can lose money fast, especially with new coins. Test in practice mode first and only fund the live wallet with what you can afford to lose.</p>
    </div>
  );
}

/** One open coin: live profit, why it was bought, and its own stop-loss / take profit / trailing stop. */
function Open({ p, busy, onAct }: { p: P; busy: boolean; onAct: (n: string, a: string, b: unknown, done?: string) => Promise<void> }) {
  const [sl, setSl] = useState(String(p.stop_loss));
  const [tp, setTp] = useState(String(p.take_profit));
  const [tr, setTr] = useState(String(p.trail));
  const now = Number(p.last_usd) || Number(p.entry_usd);
  const ch = (now / Number(p.entry_usd) - 1) * 100;
  return (
    <div className="ait-pos">
      <div className="ait-pos-h">
        {p.logo ? <img src={p.logo} alt="" width={34} height={34} /> : <span className="ait-ph">{(p.symbol || "?").slice(0, 2)}</span>}
        <div className="grow"><b>{p.symbol}</b> <small className="muted">{p.mode === "paper" ? "practice" : "live"} · bought {ago(p.opened_at)}</small><br /><small className="muted">{fmtAmount(Number(p.spent))} BNB · entry {fmtUsd(Number(p.entry_usd))} · now {fmtUsd(now)} · high {fmtUsd(Number(p.high_usd))}</small></div>
        <b className={ch >= 0 ? "up" : "down"}>{sign(ch)}%</b>
      </div>
      {p.why && <small className="ait-why">{p.why}</small>}
      <div className="ait-pos-f">
        <label>Stop-loss <span className="ait-in"><input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} /><em>%</em></span></label>
        <label>Take profit <span className="ait-in"><input inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} /><em>%</em></span></label>
        <label>Trailing <span className="ait-in"><input inputMode="decimal" value={tr} onChange={(e) => setTr(e.target.value)} /><em>%</em></span></label>
        <button type="button" className="btn small" disabled={busy} onClick={() => onAct("edit", "edit", { id: p.id, stop_loss: Number(sl), take_profit: Number(tp), trail: Number(tr) }, `${p.symbol}: saved.`)}>Save</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => { if (confirm(`Sell all ${p.symbol} now?`)) onAct("close", "close", { id: p.id }, `${p.symbol} sold.`); }}>Sell now</button>
        <a className="btn small" href={`/analytics/bsc/${p.token}`} target="_blank" rel="noopener noreferrer">Scan ↗</a>
      </div>
    </div>
  );
}
