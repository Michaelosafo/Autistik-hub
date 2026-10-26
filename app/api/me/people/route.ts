import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = "id,alias,handle,color,avatar_url,is_team,is_verified";

/**
 * Find people for the panel. With ?q= it searches names and @handles; without it, it lists the people who follow
 * you that you don't follow back yet. Only public profile fields are returned.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return json({ signedIn: false, people: [] });
  const slow = await rateLimit(req, "me-people", 60, 600, user.id);
  if (slow) return slow;
  const sb = supabaseService();
  const q = (new URL(req.url).searchParams.get("q") || "").replace(/^\s*@/, "").replace(/[%,()\\*_.:]/g, " ").trim().slice(0, 40);

  const [{ data: mine }, { data: fans }] = await Promise.all([
    sb.from("follows").select("followee_id").eq("follower_id", user.id).limit(2000),
    sb.from("follows").select("follower_id,created_at").eq("followee_id", user.id).order("created_at", { ascending: false }).limit(500),
  ]);
  const iFollow = new Set((mine || []).map((f: any) => f.followee_id as string));
  const followsMe = new Set((fans || []).map((f: any) => f.follower_id as string));
  const back = [...followsMe].filter((id) => !iFollow.has(id) && id !== user.id);

  let rows: any[] = [];
  if (q) {
    const { data } = await sb.from("profiles").select(COLS).or(`alias.ilike.%${q}%,handle.ilike.%${q}%`).neq("id", user.id).limit(20);
    rows = data || [];
    // People who follow you, then the team, then the rest.
    rows.sort((a, b) => Number(followsMe.has(b.id)) - Number(followsMe.has(a.id)) || Number(!!b.is_team) - Number(!!a.is_team));
  } else if (back.length) {
    const { data } = await sb.from("profiles").select(COLS).in("id", back.slice(0, 30));
    const order = new Map(back.map((id, i) => [id, i]));
    rows = (data || []).sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  return json({
    signedIn: true,
    toFollowBack: back.length,
    people: rows.slice(0, 12).map((p: any) => ({ ...p, following: iFollow.has(p.id), followsYou: followsMe.has(p.id) })),
  });
}
