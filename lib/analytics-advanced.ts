/**
 * The scanner's advanced read for one tracked token (server only): buy or sell call with its reasons, the day-trade
 * and long-term signals, buy / sell zones, trade plans with entries and targets, the bundle check, who might sell
 * next and the 24-hour flow. Same maths as the full token page (app/analytics/[chain]/[token]/page.tsx); used by the
 * dashboard's Advanced panels (components/HyperScanner.tsx via /api/scanner/advanced).
 */
import { ACHAINS, type AChain } from "@/lib/analytics";
import { stateOf } from "@/lib/analytics-alerts";
import { bundleCheck } from "@/lib/analytics-bundle";
import { insights } from "@/lib/analytics-insights";
import { holdOutlook, tradeCall, tradingPlans, whoMightSell } from "@/lib/analytics-signals";
import { zones } from "@/lib/analytics-zones";
import { getCandles, getPairStats } from "@/lib/market";
import { supabaseService } from "@/lib/supabase/server";

export async function advancedFor(chain: AChain, tokenIn: string) {
  const sb = supabaseService();
  const c = ACHAINS[chain];
  const { data: t } = await sb.from("tracked_tokens").select("*").eq("chain", chain)[c.kind === "solana" ? "eq" : "ilike"]("token", tokenIn).maybeSingle();
  if (!t) return null;
  const [{ data: holders }, { data: events }, { data: links }, { data: trades }, move, candles] = await Promise.all([
    sb.from("token_holders").select("*").eq("chain", chain).eq("token", t.token).order("rank", { ascending: true, nullsFirst: false }),
    sb.from("holder_events").select("*").eq("chain", chain).eq("token", t.token).order("created_at", { ascending: false }).limit(500),
    sb.from("token_links").select("a,b,kind").eq("chain", chain).eq("token", t.token).limit(500),
    sb.from("token_trades").select("wallet,side,amount,balance_after,pct_after,at,tx_hash,block").eq("chain", chain).eq("token", t.token)
      .gt("at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("at", { ascending: false }).limit(1000),
    getPairStats(c.dex, t.token).catch(() => null),
    getCandles(chain, t.pair).catch(() => []),
  ]);
  const H = (holders || []) as any[], E = (events || []) as any[], L = (links || []) as any[], T = (trades || []) as any[];
  const sigIn = { holders: H, events: E, trades: T, links: L, dev: t.dev, security: t.security };
  const call = tradeCall(sigIn as any);
  const hold = holdOutlook(sigIn as any, call);
  const plans = tradingPlans(call, hold, move);
  const { groups, suspects } = whoMightSell(sigIn as any);
  const bundle = bundleCheck({ holders: H, trades: T, links: L, dev: t.dev } as any);
  const zone = zones({
    candles: candles as any, move, call, long: hold.long, security: t.security, holders: H,
    devSold: T.some((x) => x.wallet === t.dev && x.side === "sell") || E.some((e) => e.is_dev && e.kind !== "buy"),
    bundle,
  } as any);
  const know = insights({ holders: H, events: E, links: L, security: t.security, fullList: t.holder_source === "moralis" } as any);
  const top = H.filter((h) => h.in_top && !h.is_contract);
  const topShare = top.reduce((a, h) => a + (Number(h.pct) || 0), 0);
  const day = (at: string) => Date.now() - Date.parse(at) < 86_400_000;
  return {
    path: `/analytics/${chain}/${t.token}`,
    symbol: t.symbol || null, dev: t.dev || null, explorer: c.explorer, token: t.token,
    call: { kind: call.kind, emoji: call.emoji, title: call.title, summary: call.summary, score: call.score, reasons: call.reasons },
    now: { short: stateOf(plans.short, call, "short"), long: stateOf(plans.long, call, "long") },
    zone, plans, bundle, know: know.slice(0, 6),
    groups: groups.slice(0, 3).map((g: any) => ({ wallets: g.wallets.length, pct: g.pct, withDev: g.withDev, risk: g.risk })),
    suspects: suspects.slice(0, 5).map((x: any) => ({ wallet: x.wallet, pct: x.pct, isDev: x.isDev, risk: x.risk })),
    stats: {
      topShare: top.length ? topShare : null,
      buys24: move?.buysH24 ?? null, sells24: move?.sellsH24 ?? null,
      topSells24: E.filter((e) => e.kind !== "buy" && day(e.created_at)).length,
      holders: (t.security as any)?.holderCount ?? null,
    },
  };
}
