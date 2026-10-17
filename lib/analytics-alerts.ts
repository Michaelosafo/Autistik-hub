/**
 * Buy / take-profit / sell / wait alerts for pinned tokens. Runs with the 10-minute check: works out each pinned
 * token's short-term and long-term signal the same way the token page does, and when one changes, alerts everyone
 * who pinned it (🔔 list + phone push). A guide only, never financial advice.
 */
import { supabaseService } from "@/lib/supabase/server";
import { ACHAINS, isAChain, type AChain } from "@/lib/analytics";
import { getCandles, getPairStats } from "@/lib/market";
import { holdOutlook, tradeCall, tradingPlans, type Plan, type Verdict } from "@/lib/analytics-signals";
import { notify } from "@/lib/push";
import { bundleCheck } from "@/lib/analytics-bundle";
import { proUsersOf } from "@/lib/pro-server";
import { usd, zones, type ZoneKind, type Zones } from "@/lib/analytics-zones";

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

/** What a zone means as an alert state. */
export const ZONE_STATE: Record<ZoneKind, SignalState> = { buy: "buy", sell: "take_profit", falling: "sell", middle: "wait", breakout: "wait", avoid: "avoid" };

/** Alert text for a new buy / sell zone. */
export function zoneMessage(symbol: string, z: Zones) {
  const why = (z.kind === "buy" ? [...z.people, ...z.chart].find((x) => x.lean > 0) : [...z.people, ...z.chart].find((x) => x.lean < 0))?.text || z.summary;
  const range = z.kind === "buy" && z.buy ? ` Buy range ${usd(z.buy[0])}–${usd(z.buy[1])}.` : z.kind === "sell" && z.sell ? ` Sell range ${usd(z.sell[0])}–${usd(z.sell[1])}.` : "";
  const title = z.kind === "buy" ? `🟢 $${symbol} is in the BUY range` : z.kind === "sell" ? `🔴 $${symbol} reached the SELL range`
    : z.kind === "falling" ? `⚠️ $${symbol} is falling below its floor` : z.kind === "avoid" ? `🚫 $${symbol}: avoid` : `🟡 $${symbol} is back in the middle`;
  return { title, body: `Price ${usd(z.price)}.${range} ${why} Strength: ${z.strength.label} (${z.strength.agree} of ${z.strength.total} signs agree). Not financial advice.`, strong: z.kind !== "middle" && z.kind !== "breakout" };
}

/** Everything the analysis needs for one token, worked out the same way as its page. */
export async function analyse(chain: AChain, token: string) {
  const sb = supabaseService();
  const [{ data: t }, { data: holders }, { data: events }, { data: links }, { data: trades }, move] = await Promise.all([
    sb.from("tracked_tokens").select("symbol,dev,security,pair,total_supply").eq("chain", chain).eq("token", token).maybeSingle(),
    sb.from("token_holders").select("*").eq("chain", chain).eq("token", token),
    sb.from("holder_events").select("*").eq("chain", chain).eq("token", token).order("created_at", { ascending: false }).limit(500),
    sb.from("token_links").select("a,b,kind").eq("chain", chain).eq("token", token).limit(500),
    sb.from("token_trades").select("wallet,side,amount,balance_after,pct_after,at,block").eq("chain", chain).eq("token", token)
      .gt("at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("at", { ascending: false }).limit(1000),
    getPairStats(ACHAINS[chain].dex, token),
  ]);
  if (!t) return null;
  const candles = await getCandles(chain, t.pair);
  const input = { holders: (holders || []) as any, events: (events || []) as any, trades: (trades || []) as any, links: (links || []) as any, dev: t.dev, security: t.security };
  const call = tradeCall(input);
  const hold = holdOutlook(input, call);
  const plans = tradingPlans(call, hold, move);
  const devSold = !!t.dev && input.trades.some((x: any) => x.wallet === t.dev && x.side === "sell") || input.events.some((e: any) => e.is_dev && e.kind !== "buy");
  const bundle = bundleCheck({ holders: input.holders, trades: input.trades, links: input.links, dev: t.dev });
  const zone = zones({ candles, move, call, long: hold.long, security: t.security, holders: input.holders, devSold, bundle });
  return { t, call, plans, zone, move, input, hold, candles };
}

/**
 * Works out a token's signals and saves them. When one changes, everyone in `users` gets an alert (at most once per
 * token and time frame every 30 minutes; the first reading is only remembered). Returns how many alerts were sent.
 */
export async function checkSignals(chain: AChain, token: string, users: string[]) {
  const sb = supabaseService();
  const [a, { data: prev }] = await Promise.all([analyse(chain, token), sb.from("token_signals").select("horizon,state,notified_at,detail").eq("chain", chain).eq("token", token)]);
  if (!a) return 0;
  const { t, call, plans, zone, move, input } = a;
  const z = zone;
  const oldZone: any = (prev || []).find((x: any) => x.horizon === "zone");
  const checkedAt = new Date().toISOString();
  const rows = [
    { horizon: "zone" as const, state: ZONE_STATE[z.kind], msg: zoneMessage(t.symbol || "TOKEN", z),
      detail: { kind: z.kind, title: z.title, price: z.price, buy: z.buy, sell: z.sell, strength: z.strength, rsi: z.rsi, liq: move?.liquidityUsd ?? null, checkedAt } },
    ...(["short", "long"] as const).map((h) => { const st = stateOf(plans[h], call, h); return { horizon: h, state: st, msg: message(t.symbol || "TOKEN", h, st, plans[h]), detail: null }; }),
  ];
  // Track record: remember each new zone with its price, and grade the ones from 24 hours ago with today's price.
  if (z.price && oldZone?.detail?.kind !== z.kind) await sb.from("signal_history").insert({ chain, token, kind: z.kind, price: z.price });
  if (z.price) await sb.from("signal_history").update({ outcome_price: z.price, outcome_at: checkedAt })
    .eq("chain", chain).eq("token", token).is("outcome_price", null).lt("at", new Date(Date.now() - 86_400_000).toISOString());

  let sent = 0;
  // Pro alerts: a whale moving 1%+ of the supply since the last check, or the pool's money dropping fast.
  const pros = await proUsersOf(users);
  if (pros.length && oldZone?.detail) {
    const sym = t.symbol || "TOKEN", link = `/analytics/${chain}/${token}`, supply = Number(t.total_supply) || 0;
    const prevLiq = Number(oldZone.detail.liq) || 0, liq = move?.liquidityUsd ?? 0;
    const pro: { title: string; body: string }[] = [];
    if (prevLiq > 0 && liq > 0 && liq < prevLiq * 0.8) {
      pro.push({ title: `🚨 $${sym}: pool money dropped ${Math.round((1 - liq / prevLiq) * 100)}%`, body: `Liquidity went from ${usd(prevLiq)} to ${usd(liq)} in minutes. This can be a rug pull or a big holder leaving. Protect your money. Not financial advice.` });
    }
    const since = Date.parse(oldZone.detail.checkedAt || 0) || Date.now() - 600_000;
    for (const x of (input.trades as any[]).filter((x) => Date.parse(x.at) > since && supply && Number(x.amount) >= supply * 0.01).slice(0, 2)) {
      const pct = ((Number(x.amount) / supply) * 100).toFixed(2);
      pro.push({ title: `🐋 Whale ${x.side === "buy" ? "bought" : "sold"} ${pct}% of $${sym}`, body: `${x.wallet.slice(0, 6)}…${x.wallet.slice(-4)} ${x.side === "buy" ? "bought" : "sold"} ${pct}% of the supply. ${x.side === "buy" ? "Big buyers often lead the next move up." : "Big sellers can push the price down."} Not financial advice.` });
    }
    for (const m of pro) { await notify(pros.map((user_id) => ({ user_id, title: m.title, body: m.body, link, strong: true }))); sent += pros.length; }
  }
  for (const r of rows) {
    const old = (prev || []).find((x: any) => x.horizon === r.horizon);
    const now = new Date().toISOString();
    if (old?.state === r.state) {
      // Same signal: just keep the prices fresh.
      if (r.detail) await sb.from("token_signals").update({ detail: r.detail }).eq("chain", chain).eq("token", token).eq("horizon", r.horizon);
      continue;
    }
    const due = !!old && users.length > 0 && (!old.notified_at || Date.now() - Date.parse(old.notified_at) > COOLDOWN_MS);
    await sb.from("token_signals").upsert({ chain, token, horizon: r.horizon, state: r.state, reason: r.msg.body.slice(0, 300), detail: r.detail, changed_at: now, notified_at: due ? now : old?.notified_at ?? null }, { onConflict: "chain,token,horizon" });
    if (!due) continue;
    await notify(users.map((user_id) => ({ user_id, title: r.msg.title, body: r.msg.body, link: `/analytics/${chain}/${token}`, strong: r.msg.strong })));
    sent += users.length;
  }
  return sent;
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
    try { sent += await checkSignals(chain, token, users); checked++; }
    catch (e) { console.error("signals failed", chain, token, (e as Error).message); }
  }
  return { pinned: byToken.size, checked, sent };
}
