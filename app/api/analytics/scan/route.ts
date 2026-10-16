import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { isAChain, scanToken } from "@/lib/analytics";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Adds a token to Analytics (top 40 wallets + dev) and watches it for the member, so they get sell alerts.
export async function POST(req: Request) {
  const slow = await rateLimit(req, "analytics-scan", 30, 600);
  if (slow) return slow;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return json({ error: "Please sign in to scan tokens." }, 401);
  const perUser = await rateLimit(null, "analytics-scan-user", 15, 3600, user.id);
  if (perUser) return perUser;

  const body = await req.json().catch(() => null);
  const chain = body?.chain;
  const token = String(body?.token || "").trim();
  if (!isAChain(chain)) return json({ error: "Pick BNB Chain or Ethereum." }, 400);
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return json({ error: "Paste the token's contract address (it starts with 0x)." }, 400);

  const err = await scanToken(chain, token, { userId: user.id, force: body?.refresh === true });
  if (err) return json({ error: err }, 400);
  const { data: t } = await supabaseService().from("tracked_tokens").select("token").eq("chain", chain).ilike("token", token).maybeSingle();
  const addr = t?.token || token;
  // Watching the token is what sends the sell alerts.
  await supabaseService().from("launch_watchers").upsert({ user_id: user.id, chain, token: addr }, { onConflict: "user_id,chain,token", ignoreDuplicates: true });
  return json({ path: `/analytics/${chain}/${addr}` });
}
