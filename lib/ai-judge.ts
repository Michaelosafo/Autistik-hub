/**
 * Judgment for the Futures, Forex, Turbo and Sniper traders (server only). Three things a careful human trader does:
 *
 * 1. A second opinion before every trade: Claude looks at the whole setup (chart, news, funding, this coin's recent
 *    results, the trader's style) like a senior trader and either vetoes it or says how confident it is. Confidence
 *    sizes the bet: a shaky setup gets a smaller bet, a strong one a slightly bigger one (never past the risk limits).
 * 2. Learning from results: after 4 losses in a row it pauses 2 hours; a coin that lost its last 3 trades in a day is
 *    left alone for 24 hours; if news-led or chart-led trades keep losing, that kind is skipped; and when the recent
 *    win rate is poor every bet shrinks (and grows a little when it's good).
 * 3. A daily profit lock: once the account is up the day's target (10% by default), no new trades until tomorrow, so
 *    a good day isn't given back.
 *
 * None of this can make every trade a winner. It's there to avoid bad trades, keep losses small and keep good days.
 */
import { supabaseService } from "@/lib/supabase/server";
import { T } from "@/lib/ai-trader-ctx";
import { anthropic, cheap, FAST_MODEL } from "@/lib/ai";

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const sb = () => supabaseService();

export type Verdict = { go: boolean; confidence: number; why: string };

// A setup the AI turned down isn't asked about again for 15 minutes (saves time and AI cost).
const vetoed = new Map<string, number>();

/**
 * The AI's second opinion on one trade. If the AI can't answer: the trade goes ahead at a cautious size, unless
 * mustAnswer (Sniper: no answer on a brand-new coin means no buy).
 */
export async function secondOpinion(key: string, style: string, facts: Record<string, unknown>, mustAnswer = false): Promise<Verdict> {
  const k = `${T()}:${key}`;
  if ((vetoed.get(k) || 0) > Date.now()) return { go: false, confidence: 0, why: "turned down in the last 15 minutes" };
  try {
    const msg = await Promise.race([
      anthropic().messages.create({
        model: FAST_MODEL, max_tokens: 600, ...cheap(FAST_MODEL),
        system: `You are a disciplined senior trader reviewing a trade your bot wants to take. Style: ${style}. Approve only setups with a real edge: the signals agree, the move isn't already over, the risk/reward is sound and nothing in the facts screams danger (fake coin, exhausted pump, fighting a strong trend, news already priced in, a coin that keeps losing). Reply ONLY with JSON: {"go":true|false,"confidence":0..1,"why":"max 20 words"}.`,
        messages: [{ role: "user", content: JSON.stringify(facts).slice(0, 3500) }],
      }),
      new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 9000)),
    ]);
    const text = (msg as any).content?.filter((c: any) => c.type === "text").map((c: any) => c.text || "").join("") || "";
    if (!text.includes("{")) throw new Error(`no JSON in reply (stop: ${(msg as any).stop_reason})`);
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const v: Verdict = { go: j.go === true, confidence: Math.max(0, Math.min(1, n(j.confidence))), why: String(j.why || "").slice(0, 160) };
    if (!v.go || v.confidence < 0.45) { vetoed.set(k, Date.now() + 15 * 60_000); return { ...v, go: false }; }
    return v;
  } catch (e) {
    console.error(`AI second opinion failed: ${(e as Error).message}`);
    return mustAnswer ? { go: false, confidence: 0, why: "AI check unavailable, so no buy" } : { go: true, confidence: 0.5, why: "AI check unavailable, cautious size" };
  }
}

/** How much to scale a bet from the AI's confidence: 0.6x (just passed) to 1.2x (very strong). */
export const confidenceSize = (c: number) => Math.max(0.6, Math.min(1.2, 0.6 + (c - 0.45) * (0.6 / 0.55)));

type Closed = { coin: string; pnl_usd: number; closed_at: string; why: string | null };

/** What recent results say: pause, skip this coin / kind of trade, and a bet-size multiplier. */
export async function lessons(mode: string, coin?: string, newsDriven?: boolean): Promise<{ stop: string | null; size: number }> {
  const { data } = await sb().from("ai_futures_positions").select("coin,pnl_usd,closed_at,why").eq("fut_id", T()).eq("mode", mode).eq("status", "closed").order("closed_at", { ascending: false }).limit(40);
  const list = (data || []) as Closed[];
  // 1. Losing streak: 4 in a row, the last within 2 hours.
  let streak = 0;
  for (const p of list) { if (n(p.pnl_usd) < 0) streak++; else break; }
  if (streak >= 4 && list[0] && Date.now() - Date.parse(list[0].closed_at) < 2 * 36e5) return { stop: `${streak} losses in a row: taking a 2-hour break`, size: 0 };
  // 2. This coin lost its last 3 trades within a day.
  if (coin) {
    const mine = list.filter((p) => p.coin === coin).slice(0, 3);
    if (mine.length === 3 && mine.every((p) => n(p.pnl_usd) < 0) && Date.now() - Date.parse(mine[0].closed_at) < 24 * 36e5) return { stop: "lost its last 3 trades: leaving it alone for a day", size: 0 };
  }
  // 3. This kind of trade (news-led or chart-led) keeps losing: at least 6 of them, under 30% won.
  if (newsDriven != null) {
    const kind = list.filter((p) => /^news|news:/i.test(String(p.why || "")) === newsDriven).slice(0, 15);
    if (kind.length >= 6 && kind.filter((p) => n(p.pnl_usd) > 0).length / kind.length < 0.3) return { stop: `${newsDriven ? "news" : "chart"}-led trades keep losing lately: skipping them`, size: 0 };
  }
  // 4. Recent win rate sets the bet size.
  const last = list.slice(0, 20);
  if (last.length < 8) return { stop: null, size: 1 };
  const wr = last.filter((p) => n(p.pnl_usd) > 0).length / last.length;
  return { stop: null, size: wr < 0.3 ? 0.5 : wr < 0.45 ? 0.75 : wr > 0.6 ? 1.15 : 1 };
}

/** The daily profit lock: up the day's target since the start of the day (UTC) → no new trades today. */
export function profitLocked(s: { profit_lock_pct?: number | null; day_start_usd: number | null }, total: number): string | null {
  const pct = n(s.profit_lock_pct ?? 10);
  const start = n(s.day_start_usd);
  if (!(pct > 0) || !(start > 0)) return null;
  const up = (total / start - 1) * 100;
  return up >= pct ? `Up ${up.toFixed(1)}% today (profit lock at ${pct}%): keeping it, no new trades until tomorrow (UTC)` : null;
}

/** This coin's last few results, for the second opinion. */
export async function coinHistory(mode: string, coin: string) {
  const { data } = await sb().from("ai_futures_positions").select("side,pnl_usd,reason,closed_at").eq("fut_id", T()).eq("mode", mode).eq("coin", coin).eq("status", "closed").order("closed_at", { ascending: false }).limit(5);
  return ((data || []) as any[]).map((p) => `${p.side} ${n(p.pnl_usd) >= 0 ? "won" : "lost"} $${Math.abs(n(p.pnl_usd)).toFixed(2)} (${p.reason})`);
}
