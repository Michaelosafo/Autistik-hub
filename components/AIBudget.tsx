import { AI_PASS_USD } from "@/lib/aipass";
import { supabaseService } from "@/lib/supabase/server";

// US dollars per million tokens (input, output). Check docs.claude.com for current prices.
const PRICES: [RegExp, number, number][] = [
  [/haiku-5/, 0.1, 0.5],
  [/haiku-4/, 1, 5],
  [/sonnet/, 2, 10],
  [/opus-5-5/, 4, 20],
  [/opus/, 5, 25],
  [/fable|mythos/, 10, 50],
];
const price = (model: string) => PRICES.find(([re]) => re.test(model)) ?? [null, 2, 10];
const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Owner-only: this month's AI Pass income next to what the AI actually cost (from token counts on every request). */
export default async function AIBudget() {
  const sb = supabaseService();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const today = now.toISOString().slice(0, 10);
  const [{ data: costs, error }, { count: passes }, { count: activePasses }, { data: usageToday }] = await Promise.all([
    sb.from("ai_costs").select("*").gte("day", monthStart.slice(0, 10)),
    sb.from("ai_passes").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
    sb.from("ai_passes").select("id", { count: "exact", head: true }).gt("ends_at", now.toISOString()),
    sb.from("ai_usage").select("user_id").eq("day", today),
  ]);
  if (error) return <div className="card"><h2>AI budget</h2><p className="muted">Run <code>supabase/ai-budget.sql</code> in Supabase to start tracking AI costs.</p></div>;

  const byFeature: Record<string, number> = {};
  const byModel: Record<string, { req: number; cost: number }> = {};
  let cost = 0, requests = 0;
  for (const r of costs || []) {
    const [, pin, pout] = price(r.model);
    const c = (Number(r.input_tokens) * pin + Number(r.output_tokens) * pout) / 1e6;
    cost += c; requests += r.requests;
    byFeature[r.feature] = (byFeature[r.feature] || 0) + c;
    byModel[r.model] = { req: (byModel[r.model]?.req || 0) + r.requests, cost: (byModel[r.model]?.cost || 0) + c };
  }
  const income = (passes || 0) * AI_PASS_USD;
  const balance = income - cost;
  const label: Record<string, string> = { chat: "Believer & Purity chat", draw: "Pictures", launch: "Autistik (Launch)" };

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>AI budget · {now.toLocaleString("en-US", { month: "long", year: "numeric" })}</h2>
        <a className="btn small" href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer">Top up Claude credit</a>
      </div>
      <div className="stats">
        <div><span className="label">AI Pass income</span><b>{usd(income)}</b><span className="muted" style={{ fontSize: ".8em" }}>{passes || 0} passes this month</span></div>
        <div><span className="label">AI cost (estimate)</span><b>{usd(cost)}</b><span className="muted" style={{ fontSize: ".8em" }}>{requests.toLocaleString("en-US")} AI requests</span></div>
        <div><span className="label">Balance</span><b className={balance >= 0 ? "up" : "down"}>{balance >= 0 ? "+" : "−"}{usd(Math.abs(balance))}</b><span className="muted" style={{ fontSize: ".8em" }}>{balance >= 0 ? "passes cover the AI" : "AI costs more than passes"}</span></div>
        <div><span className="label">Today</span><b>{new Set((usageToday || []).map((u: any) => u.user_id)).size}</b><span className="muted" style={{ fontSize: ".8em" }}>members used AI · {activePasses || 0} active passes</span></div>
      </div>
      {!!Object.keys(byFeature).length && (
        <table><tbody>
          {Object.entries(byFeature).sort((a, b) => b[1] - a[1]).map(([f, c]) => <tr key={f}><th>{label[f] || f}</th><td className="num">{usd(c)}</td></tr>)}
          {Object.entries(byModel).map(([m, v]) => <tr key={m}><th className="muted">{m}</th><td className="num muted">{v.req.toLocaleString("en-US")} requests · {usd(v.cost)}</td></tr>)}
        </tbody></table>
      )}
      <p className="muted" style={{ fontSize: ".82em" }}>
        AI Pass payments arrive in BNB in your treasury wallet; Claude credit is paid by card, so the two can&apos;t move automatically. Turn on <b>auto-reload</b> in the Claude console so the AI never stops, and use this panel to check the passes cover it. The cost is an estimate from token counts at list prices.
      </p>
    </div>
  );
}
