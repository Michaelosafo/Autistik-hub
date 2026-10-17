import { anthropic, aiErrorMessage, cheap, json, logCost, MODEL } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { isAChain, isChainAddress, ACHAINS } from "@/lib/analytics";
import { analyse } from "@/lib/analytics-alerts";
import { confluence, trackRecord, whales } from "@/lib/analytics-pro";
import { usd } from "@/lib/analytics-zones";
import { PRO_REPORTS_PER_DAY } from "@/lib/pro";
import { isPro } from "@/lib/pro-server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are the AUTISTIK Hub analyst. Write a short, very simple report about one crypto token for an everyday member, many of whom are autistic: plain words, short sentences, no jargon (explain any term in a few words), no hype, no emojis except the section icons.
Use ONLY the facts given. Never invent prices, news or numbers. If the facts disagree, say so plainly. Never promise profit.
Use exactly these sections, each 1–3 short sentences or bullets:
📍 What's happening
🧠 What people are feeling
📈 What the charts say
🎯 The plan (entry range, take-profit targets, stop-loss: use the zone prices given; if it's a bad time, say "wait" and what to wait for)
⚠️ Risks
✅ Bottom line (one sentence: buy in small parts / wait / take profit / avoid)
End with: "Not financial advice."`;

// A plain-English analyst report for one token, written from all the Pro signals. Pro members only.
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "The analyst is coming soon." }, 503);
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return json({ error: "Please sign in." }, 401);
  if (!(await isPro(user.id))) return json({ error: "The analyst report is part of AUTISTIK Pro.", needPro: true }, 402);
  const slow = await rateLimit(null, "pro-report", PRO_REPORTS_PER_DAY, 86400, user.id);
  if (slow) return json({ error: `You've used today's ${PRO_REPORTS_PER_DAY} reports. More tomorrow.` }, 429);
  const body = await req.json().catch(() => null);
  const chain = body?.chain, token = String(body?.token || "");
  if (!isAChain(chain) || !isChainAddress(chain, token)) return json({ error: "Unknown token." }, 400);

  const a = await analyse(chain, token);
  if (!a) return json({ error: "Scan this token first." }, 404);
  const { t, zone: z, plans, call, move, input, hold, candles } = a;
  const base = { move, call, long: hold.long, security: t.security, holders: input.holders };
  const [frames, record] = await Promise.all([confluence(chain, t.pair, base, z), trackRecord(chain, token)]);
  const w = whales(input.trades, Number(t.total_supply) || 0);
  const facts = {
    token: `${t.symbol} on ${ACHAINS[chain].name}`, price: usd(z.price), hoursOfHistory: candles.length,
    zone: { verdict: z.title, strength: `${z.strength.label} (${z.strength.agree} of ${z.strength.total} signs agree)`,
      buyRange: z.buy && `${usd(z.buy[0])} – ${usd(z.buy[1])}`, sellRange: z.sell && `${usd(z.sell[0])} – ${usd(z.sell[1])}`,
      floor: usd(z.floor), ceiling: usd(z.ceiling), rsi: z.rsi },
    people: z.people.map((x) => x.text), chart: z.chart.map((x) => x.text), project: z.project.map((x) => x.text),
    timeframes: { reads: frames.frames.map((f) => `${f.label}: ${f.title}`), verdict: frames.verdict },
    whales: w.verdict,
    priceMoves: move && { last5min: move.m5, last1h: move.h1, last6h: move.h6, last24h: move.h24, buysLastHour: move.buysH1, sellsLastHour: move.sellsH1, poolUsd: move.liquidityUsd },
    dayTrade: { entry: plans.short.entry.title, takeProfit: plans.short.exit.title, targets: plans.short.targets.map((x) => `${x.label} ${x.pct > 0 ? "+" : ""}${x.pct}% (${usd(x.price)}): ${x.note}`) },
    longTerm: { entry: plans.long.entry.title, takeProfit: plans.long.exit.title, outlook: hold.long.title },
    overallRead: call.title,
    trackRecord: record.token.total ? `${record.token.right} of ${record.token.total} past signals on this token were right after 24h` : "No graded signals on this token yet",
  };
  try {
    const msg = await anthropic().messages.create({
      model: MODEL, max_tokens: 900, system: SYSTEM,
      messages: [{ role: "user", content: `Facts (JSON):\n${JSON.stringify(facts)}` }],
      ...cheap(MODEL),
    } as any);
    logCost(MODEL, "chat", msg.usage);
    const report = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
    return json({ report: report || "Couldn't write a report right now. Try again in a minute." });
  } catch (e) {
    return json({ error: aiErrorMessage(e, "The analyst") }, 502);
  }
}
