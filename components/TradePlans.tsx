"use client";
import { useEffect, useState } from "react";
import type { Plan } from "@/lib/analytics-signals";

const usd = (v: number | null) => {
  if (v == null || !isFinite(v)) return "–";
  if (v >= 1) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  // Tiny prices: show 4 significant digits, e.g. $0.00001234.
  return "$" + v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
};
const ICON = { good: "✅", ok: "⏳", weak: "❌" };

/** Long-term vs short-term plan: good entry or not, when to take profit, and simple price targets. */
export default function TradePlans({ plans, symbol }: { plans: { long: Plan; short: Plan }; symbol: string }) {
  const [tab, setTab] = useState<"long" | "short">("long");
  useEffect(() => { try { const t = localStorage.getItem("plan-tab"); if (t === "long" || t === "short") setTab(t); } catch {} }, []);
  const pick = (t: "long" | "short") => { setTab(t); try { localStorage.setItem("plan-tab", t); } catch {} };
  const p = plans[tab];
  return (
    <div className="plans">
      <div className="plan-tabs" role="tablist" aria-label="Pick your style">
        <button type="button" role="tab" aria-selected={tab === "long"} onClick={() => pick("long")}><b>📅 Long term</b><span>Hold for weeks or months</span></button>
        <button type="button" role="tab" aria-selected={tab === "short"} onClick={() => pick("short")}><b>⚡ Short term</b><span>Day trade for quick profit</span></button>
      </div>
      <div className="plan-grid" role="tabpanel">
        <section className={"plan-box " + p.entry.level}>
          <div className="label">🎯 Good entry?</div>
          <b className="plan-title">{ICON[p.entry.level]} {p.entry.title}</b>
          <ul className="signals">{p.entry.reasons.map((r, i) => <li key={i} className={r.level}>{r.text}</li>)}</ul>
        </section>
        <section className={"plan-box " + (p.exit.now ? "now" : "good")}>
          <div className="label">💰 When to take profit</div>
          <b className="plan-title">{p.exit.now ? "🔔 " : "🙌 "}{p.exit.title}</b>
          <ul className="signals">{p.exit.reasons.map((r, i) => <li key={i} className={r.level}>{r.text}</li>)}</ul>
        </section>
      </div>
      <div className="plan-targets">
        <div className="label">📍 Targets if you buy now{p.price ? ` at ${usd(p.price)}` : ""}</div>
        <div className="plan-rows">
          {p.targets.map((t) => (
            <div key={t.label} className={"plan-row" + (t.pct < 0 ? " stop" : "")}>
              <b>{t.label}</b>
              <span className="mono">{t.pct > 0 ? "+" : ""}{t.pct}%</span>
              <span className="mono">{p.price ? usd(t.price) : "–"}</span>
              <small>{t.note}</small>
            </div>
          ))}
        </div>
        <small className="muted">{tab === "short"
          ? `Day trades move fast. Set your take-profit and stop-loss as soon as you buy ${symbol}, and stick to them.`
          : `Taking profit in steps means you win even if it drops later. Never sell everything at once unless the dev or holders run.`}</small>
      </div>
    </div>
  );
}
