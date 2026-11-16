import { json } from "@/lib/ai";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST = 200; // listeners shown in the room (the count covers everyone)

/** The room count and the listener list, worked out once every 10 seconds per room (not once per member). */
const cache = new Map<string, { at: number; count: number; people: any[] }>();

/**
 * Check-in for a live (every ~30 s while in the room). In a big live, plain listeners stay off the room's live
 * presence (it would send every join to all 1,000 people); this keeps the count and the list right instead.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return json({ error: "Unknown room." }, 404);
  const user = await currentUser().catch(() => null);
  if (!user) return json({ error: "Sign in first." }, 401);
  const b: any = await req.json().catch(() => ({}));
  const sb = supabaseService();
  const { data: room } = await sb.from("live_rooms").select("id,ended_at").eq("id", params.id).maybeSingle();
  if (!room || room.ended_at) return json({ ended: true }, 410);
  // Only someone who opened the room (the page records that, and checks private access) can check in.
  const { error, count: n } = await sb.from("live_room_attendance").update({ last_seen: new Date().toISOString(), hidden: !!b.hidden }, { count: "exact" }).eq("room_id", params.id).eq("user_id", user.id);
  if (error || !n) return json({ error: "Open the live first." }, 403);

  const c = cache.get(params.id);
  if (c && Date.now() - c.at < 10_000) return json({ count: c.count, people: c.people });
  const since = new Date(Date.now() - 75_000).toISOString();
  const [{ count }, { data: rows }] = await Promise.all([
    sb.from("live_room_attendance").select("user_id", { count: "exact", head: true }).eq("room_id", params.id).gte("last_seen", since),
    sb.from("live_room_attendance").select("user_id,hidden,last_seen").eq("room_id", params.id).gte("last_seen", since).order("first_at", { ascending: true }).limit(LIST),
  ]);
  const ids = (rows || []).map((r: any) => r.user_id);
  const { data: profs } = ids.length ? await sb.from("profiles").select("id,alias,color,avatar_url,is_verified,is_team,verified_badge").in("id", ids) : { data: [] as any[] };
  const pm = new Map((profs || []).map((p: any) => [p.id, p]));
  const people = (rows || []).map((r: any) => {
    const p: any = pm.get(r.user_id) || {};
    return r.hidden ? { id: r.user_id, alias: "Hidden listener", color: "#6b6480", avatar_url: null, hid: true }
      : { id: r.user_id, alias: p.alias || "Member", color: p.color ?? null, avatar_url: p.avatar_url ?? null, ver: !!p.is_verified && !p.is_team, vb: p.verified_badge ?? null };
  });
  const out = { at: Date.now(), count: count || people.length, people };
  cache.set(params.id, out);
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return json({ count: out.count, people });
}
