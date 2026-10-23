import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { supabaseService } from "@/lib/supabase/server";
import { linkBuiltinWallet, privyServerReady } from "@/lib/privy-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Owner only. Gives every existing member who has no wallet yet their free AUTISTIK wallet, so they can receive
 * tokens by name without having to sign in again. Works through up to 25 members per call; press again until it says 0 left.
 */
export async function POST() {
  const { owner } = await adminState();
  if (!owner) return json({ error: "Owner only." }, 403);
  if (!privyServerReady()) return json({ error: "The AUTISTIK wallet isn't set up (PRIVY_APP_SECRET)." }, 503);
  const sb = supabaseService();
  const [{ data: profs }, { data: have }] = await Promise.all([
    sb.from("profiles").select("id").limit(5000),
    sb.from("wallets").select("user_id").limit(10000),
  ]);
  const got = new Set((have || []).map((w: any) => w.user_id as string));
  const todo = (profs || []).map((p: any) => p.id as string).filter((id) => !got.has(id));
  const stop = Date.now() + 45_000;
  let linked = 0, skipped = 0;
  for (const id of todo.slice(0, 25)) {
    if (Date.now() > stop) break;
    const { data } = await sb.auth.admin.getUserById(id);
    const u = data?.user;
    if (!u?.email || !u.email_confirmed_at) { skipped++; continue; }
    const a = await linkBuiltinWallet(id, u.email);
    if (a) linked++; else skipped++;
  }
  return json({ linked, skipped, left: Math.max(0, todo.length - linked - skipped) });
}
