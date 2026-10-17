/**
 * Buy / take-profit / sell / wait alerts for pinned tokens. Runs with the 10-minute check: works out each pinned
 * token's short-term and long-term signal the same way the token page does, and when one changes, alerts everyone
 * who pinned it (🔔 list + phone push). A guide only, never financial advice.
 */
import { supabaseService } from "@/lib/supabase/server";
import { ACHAINS, isAChain } from "@/lib/analytics";
import { getPairStats } from "@/lib/market";
import { holdOutlook, tradeCall, tradingPlans, type Plan, type Verdict } from "@/lib/analytics-signals";
import { notify } from "@/lib/push";

export type SignalState = "buy" | "take_profit" | "sell" | "wait" | "avoid";
const COOLDOWN_MS = 30 * 60_000; // at most one alert per token and time frame every 30 minutes

/** One word for where a plan stands right now. */
export function stateOf(plan: Plan, call: Verdict, horizon: "short" | "long"): SignalState {
  if (call.kind === "avoid") return "avoid";
  if (plan.exit.now) return plan.exit.reasons.some((r) => r.level === "bad") && plan.entry.level === "weak" ? "sell" : "take_profit";
  if (plan.entry.level === "good") return "buy";
  if (horizon === "short" ? call.kind === "sell" : plan.outlook.level === "weak") return "sell";
  return "wait";
}

const HEAD: Record<SignalState, string> = {
  buy: "🟢 BUY SIGNAL", take_profit: "💰 TAKE PROFIT", sell: "🔴 SELL SIGNAL", wait: "⏳ WAIT", avoid: "🚫 AVOID",
};

/** The alert text for a new signal. */
export function message(symbol: string, horizon: "short" | "long", state: SignalState, plan: Plan) {
  const frame = horizon === "short" ? "day trade" : "long term";
  // The reason that best explains the signal: a good sign for a buy, a warning for wait or avoid.
  const pick = state === "take_profit" || state === "sell" ? plan.exit.reasons : plan.entry.reasons;
  const why = (state === "buy" ? pick.find((r) => r.level === "good") : state === "wait" || state === "avoid" ? pick.find((r) => r.level !== "good") : pick[0])?.text || pick[0]?.text || "";
  const extra = state === "buy" ? (horizon === "short" ? " Targets: +15% and +30%, stop-loss −10%." : " Take profit in steps: 2x, 3x, 5x.")
    : state === "take_profit" ? " Lock in some profit." : state === "sell" ? " Protect your money." : "";
  return {
    title: `${HEAD[state]} · $${symbol} (${frame})`,
    body: `${why}${extra} Not financial advice.`.trim(),
    strong: state !== "wait",
  };
}

export async function runSignals(deadlineMs: number) {
  const sb = supabaseService();
  const { data: pins } = await sb.from("token_pins").select("user_id,chain,token").limit(5000);
  const byToken = new Map<string, { chain: string; token: string; users: string[] }>();
  for (const p of pins || []) {
    const k = `${p.chain}:${p.token}`;
    const e = byToken.get(k) || { chain: p.chain, token: p.token, users: [] };
    e.users.push(p.user_id);
    byToken.set(k, e);
  }
  let sent = 0, checked = 0;
  for (const { chain, token, users } of byToken.values()) {
    if (Date.now() > deadlineMs) break;
    if (!isAChain(chain)) continue;
    try {
      const [{ data: t }, { data: holders }, { data: events }, { data: links }, { data: trades }, { data: prev }, move] = await Promise.all([
        sb.from("tracked_tokens").select("symbol,dev,security").eq("chain", chain).eq("token", token).maybeSingle(),
        sb.from("token_holders").select("*").eq("chain", chain).eq("token", token),
        sb.from("holder_events").select("*").eq("chain", chain).eq("token", token).order("created_at", { ascending: false }).limit(500),
        sb.from("token_links").select("a,b,kind").eq("chain", chain).eq("token", token).limit(500),
        sb.from("token_trades").select("wallet,side,amount,balance_after,pct_after,at,block").eq("chain", chain).eq("token", token)
          .gt("at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("at", { ascending: false }).limit(1000),
        sb.from("token_signals").select("horizon,state,notified_at").eq("chain", chain).eq("token", token),
        getPairStats(ACHAINS[chain].dex, token),
      ]);
      if (!t) continue;
      const input = { holders: (holders || []) as any, events: (events || []) as any, trades: (trades || []) as any, links: (links || []) as any, dev: t.dev, security: t.security };
      const call = tradeCall(input);
      const plans = tradingPlans(call, holdOutlook(input, call), move);
      checked++;
      for (const horizon of ["short", "long"] as const) {
        const state = stateOf(plans[horizon], call, horizon);
        const old = (prev || []).find((r: any) => r.horizon === horizon);
        if (old?.state === state) continue;
        const now = new Date().toISOString();
        // The first reading is just remembered; alerts start from the first change.
        const due = !!old && (!old.notified_at || Date.now() - Date.parse(old.notified_at) > COOLDOWN_MS);
        const msg = message(t.symbol || "TOKEN", horizon, state, plans[horizon]);
        await sb.from("token_signals").upsert({ chain, token, horizon, state, reason: msg.body.slice(0, 300), changed_at: now, ...(due ? { notified_at: now } : { notified_at: old?.notified_at ?? null }) }, { onConflict: "chain,token,horizon" });
        if (!due) continue;
        await notify(users.map((user_id) => ({ user_id, title: msg.title, body: msg.body, link: `/analytics/${chain}/${token}`, strong: msg.strong })));
        sent += users.length;
      }
    } catch (e) { console.error("signals failed", chain, token, (e as Error).message); }
  }
  return { pinned: byToken.size, checked, sent };
}
