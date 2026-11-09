import { json } from "@/lib/ai";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What's trending on TIK right now: posts people are replying to and liking. Score = replies x3 + likes, counting the
 * last 24 hours, with the last hour counting double. A post needs a little real activity (score 3+) to trend.
 * Public counts only (no names of who liked or replied).
 */
export async function GET() {
  const sb = supabaseService();
  const now = Date.now();
  const day = new Date(now - 864e5).toISOString();
  const hour = now - 36e5;
  const [{ data: replies }, { data: likes }] = await Promise.all([
    sb.from("tiks").select("reply_to,created_at").not("reply_to", "is", null).eq("hidden", false).gte("created_at", day).limit(5000),
    sb.from("tik_likes").select("tik_id,created_at").gte("created_at", day).limit(10000),
  ]);
  const m = new Map<string, { replies: number; likes: number; recent: number; score: number }>();
  const add = (id: string, at: string, kind: "replies" | "likes") => {
    const e = m.get(id) || { replies: 0, likes: 0, recent: 0, score: 0 };
    const w = kind === "replies" ? 3 : 1;
    const fresh = Date.parse(at) >= hour;
    e[kind]++; e.score += fresh ? w * 2 : w; if (fresh) e.recent++;
    m.set(id, e);
  };
  for (const r of replies || []) add(r.reply_to as string, r.created_at, "replies");
  for (const l of likes || []) add(l.tik_id, l.created_at, "likes");
  if (!m.size) return json({ trending: [] }, 200);
  // Only top-level, visible posts trend (likes on a reply count toward nothing here).
  const ids = [...m.keys()].slice(0, 1000);
  const { data: posts } = await sb.from("tiks").select("id").in("id", ids).is("reply_to", null).eq("hidden", false);
  const ok = new Set((posts || []).map((p) => p.id));
  const trending = [...m].filter(([id, e]) => ok.has(id) && e.score >= 3)
    .sort((a, b) => b[1].score - a[1].score).slice(0, 12)
    .map(([id, e], i) => ({ id, rank: i + 1, ...e }));
  return new Response(JSON.stringify({ trending }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=20, s-maxage=20" } });
}
