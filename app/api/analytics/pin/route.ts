import { json } from "@/lib/ai";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/ratelimit";
import { isAChain, isChainAddress } from "@/lib/analytics";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { checkSignals } from "@/lib/analytics-alerts";
import { FREE_PINS, PRO_PINS } from "@/lib/pro";
import { isPro } from "@/lib/pro-server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Pin or unpin a token. Pinned tokens send buy / take-profit / sell / wait alerts; pinning also watches the token
// so it gets checked every 10 minutes and its sell alerts arrive too.
export async function POST(req: Request) {
  const slow = await rateLimit(req, "analytics-pin", 60, 600);
  if (slow) return slow;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return json({ error: "Please sign in to pin tokens." }, 401);
  const body = await req.json().catch(() => null);
  const chain = body?.chain, token = String(body?.token || "");
  if (!isAChain(chain) || !isChainAddress(chain, token)) return json({ error: "Unknown token." }, 400);
  const sb = supabaseService();
  if (body?.on === false) {
    await sb.from("token_pins").delete().eq("user_id", user.id).eq("chain", chain).eq("token", token);
    logActivity(user.id, "unpin", `${token.slice(0, 8)}… on ${chain}`, `/analytics/${chain}/${token}`);
    return json({ pinned: false });
  }
  const { data: t } = await sb.from("tracked_tokens").select("token").eq("chain", chain).eq("token", token).maybeSingle();
  if (!t) return json({ error: "Scan this token first." }, 404);
  const { count } = await sb.from("token_pins").select("token", { count: "exact", head: true }).eq("user_id", user.id);
  const pro = await isPro(user.id);
  const max = pro ? PRO_PINS : FREE_PINS;
  if ((count ?? 0) >= max) return json({ error: pro ? `You can pin up to ${max} tokens. Unpin one first.` : `Free members can pin ${max} tokens. Get AUTISTIK Pro to pin up to ${PRO_PINS}, or unpin one first.`, needPro: !pro }, 400);
  await sb.from("token_pins").upsert({ user_id: user.id, chain, token }, { onConflict: "user_id,chain,token", ignoreDuplicates: true });
  await sb.from("launch_watchers").upsert({ user_id: user.id, chain, token }, { onConflict: "user_id,chain,token", ignoreDuplicates: true });
  // Work out the zone and signals now, so My pins shows them straight away (no alert for this first reading).
  await checkSignals(chain, token, []).catch(() => 0);
  logActivity(user.id, "pin", `${token.slice(0, 8)}… on ${chain}`, `/analytics/${chain}/${token}`);
  return json({ pinned: true });
}
