import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { isPro } from "@/lib/pro-server";
import { getPrefs } from "@/lib/momentum-server";
import { FREE_ALERTS_PER_DAY, PRO_ALERTS_PER_DAY, isMomentumChain } from "@/lib/momentum";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your momentum alert settings. */
export async function GET() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return json({ signedIn: false });
  const [prefs, pro] = await Promise.all([getPrefs(user.id), isPro(user.id)]);
  return json({ signedIn: true, prefs, pro, perDay: pro ? PRO_ALERTS_PER_DAY : FREE_ALERTS_PER_DAY });
}

/** Saves your momentum alert settings. */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "momentum-alerts", 30, 600);
  if (slow) return slow;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return json({ error: "Please sign in to get alerts." }, 401);
  const b = await req.json().catch(() => null);
  const chains = Array.isArray(b?.chains) ? [...new Set(b.chains.filter(isMomentumChain))] : [];
  const minScore = Math.round(Number(b?.min_score));
  const minLiq = Number(b?.min_liquidity);
  const maxCap = b?.max_mcap == null || b?.max_mcap === "" ? null : Number(b.max_mcap);
  if (!chains.length) return json({ error: "Pick at least one chain." }, 400);
  if (!(minScore >= 40 && minScore <= 100)) return json({ error: "Minimum strength must be 40–100." }, 400);
  if (!(minLiq >= 15_000 && minLiq <= 100_000_000)) return json({ error: "Minimum pool size must be at least $15K." }, 400);
  if (maxCap != null && !(maxCap > 0)) return json({ error: "Maximum market cap must be a positive number." }, 400);
  const row = { user_id: user.id, enabled: b?.enabled !== false, chains, min_score: minScore, min_liquidity: minLiq, max_mcap: maxCap, follow_ups: b?.follow_ups !== false, updated_at: new Date().toISOString() };
  const { error } = await supabaseService().from("momentum_alerts").upsert(row, { onConflict: "user_id" });
  if (error) return json({ error: "Couldn't save. Try again." }, 500);
  logActivity(user.id, "momentum-alerts", row.enabled ? `Momentum alerts on (${chains.join(", ")}, ${minScore}+)` : "Momentum alerts off", "/momentum");
  return json({ ok: true });
}
