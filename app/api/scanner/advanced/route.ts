import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { isAChain, isChainAddress, scanToken } from "@/lib/analytics";
import { advancedFor } from "@/lib/analytics-advanced";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The dashboard's advanced scan (signed-in members): tracks the token like the full analysis does (top wallets, dev,
 * trades, sell alerts), then returns the buy / sell read, entry zones, trade plans, bundle check and who might sell.
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "scanner-advanced", 30, 600);
  if (slow) return slow;
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to run the advanced scan." }, 401);
  const perUser = await rateLimit(null, "analytics-scan-user", 15, 3600, user.id);
  if (perUser) return perUser;
  const b = await req.json().catch(() => null);
  const chain = String(b?.chain || ""), token = String(b?.token || "").trim();
  if (!isAChain(chain) || !isChainAddress(chain, token)) return json({ error: "Scan a token first." }, 400);
  const err = await scanToken(chain, token, { userId: user.id });
  if (err) return json({ error: err }, 400);
  const out = await advancedFor(chain, token);
  if (!out) return json({ error: "Couldn't read this token's holders yet. Try again in a minute." }, 404);
  // Same as the full scan: it shows in Recent searches and sends sell alerts.
  await supabaseService().from("launch_watchers").upsert({ user_id: user.id, chain, token: out.token, created_at: new Date().toISOString() }, { onConflict: "user_id,chain,token" });
  return json(out);
}
