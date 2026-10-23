import { getAddress } from "viem";
import { rateLimit } from "@/lib/ratelimit";
import { json } from "@/lib/ai";
import { supabaseService, currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who can I send tokens to? Look up a member by name, @handle or pasted wallet address.
 * In a live session you can reach the members who joined it, plus the team. On the Wallet page (scope=all) you can
 * reach any AUTISTIK member who has a wallet. Either way a name always leads to that member's own wallet, even after
 * they rename themselves. A pasted 0x address is accepted as is.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return json({ error: "Please sign in first." }, 401);
  const slow = await rateLimit(req, "tip-find", 60, 600, user.id);
  if (slow) return slow;
  const url = new URL(req.url);
  const session = url.searchParams.get("session") || "";
  // scope=all: anyone in the AUTISTIK ecosystem (every member with a wallet), for sending from the Wallet page.
  const everyone = url.searchParams.get("scope") === "all";
  const q = String(url.searchParams.get("q") || "").trim().replace(/^@/, "").slice(0, 60);
  if (!q) return json({ people: [] });
  const sb = supabaseService();

  const { data: mine } = await sb.from("wallets").select("address").eq("user_id", user.id).maybeSingle();
  if (!mine) return json({ error: "Connect your wallet first." }, 403);

  // People you can reach: members who joined this session, plus the team.
  let allowed = new Set<string>();
  if (/^[0-9a-f-]{36}$/i.test(session)) {
    const [{ data: j }, { data: me }] = await Promise.all([
      sb.from("session_joins").select("user_id").eq("session_id", session).limit(5000),
      sb.from("session_joins").select("user_id").eq("session_id", session).eq("user_id", user.id).maybeSingle(),
    ]);
    if (me) allowed = new Set((j || []).map((r: any) => r.user_id as string));
  }
  const { data: team } = await sb.from("profiles").select("id").eq("is_team", true).limit(200);
  for (const t of team || []) allowed.add(t.id);

  let profiles: any[] = [];
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
    const addr = getAddress(q);
    const { data: w } = await sb.from("wallets").select("user_id").eq("address_lower", addr.toLowerCase()).maybeSingle();
    if (w) {
      const { data: p } = await sb.from("profiles").select("id,alias,handle,color,is_team").eq("id", w.user_id).maybeSingle();
      if (p) profiles = [p];
    }
    if (!profiles.length) return json({ people: [{ id: null, alias: `${addr.slice(0, 6)}…${addr.slice(-4)}`, handle: null, wallet: addr, member: false }] });
    if (!everyone && !allowed.has(profiles[0].id)) return json({ people: [{ id: null, alias: `${addr.slice(0, 6)}…${addr.slice(-4)}`, handle: null, wallet: addr, member: false }] });
  } else {
    const safe = q.replace(/[%,()\\*]/g, " ").trim();
    const { data: p } = await sb.from("profiles").select("id,alias,handle,color,is_team").or(`alias.ilike.%${safe}%,handle.ilike.%${safe}%`).limit(40);
    profiles = (p || []).filter((x: any) => (everyone || allowed.has(x.id)) && x.id !== user.id).slice(0, 8);
  }
  if (!profiles.length) return json({ people: [] });
  const { data: w } = await sb.from("wallets").select("user_id,address").in("user_id", profiles.map((p) => p.id));
  const wal = new Map((w || []).map((x: any) => [x.user_id, x.address as string]));
  const people = profiles.filter((p) => wal.has(p.id) && p.id !== user.id).map((p) => ({ id: p.id, alias: p.alias, handle: p.handle, color: p.color, is_team: p.is_team, wallet: wal.get(p.id)!, member: true }));
  return json({ people });
}
