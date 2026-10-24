import { json } from "@/lib/ai";
import { getBoard, trending } from "@/lib/board";
import { CHAINS } from "@/lib/launchpad";
import { isLiveNow, type LiveSession } from "@/lib/live";
import { currentUser, supabaseServer, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The right-hand column of the three-column layout (components/RailShell.tsx): trending Launch Pad tokens, live
 * sessions, and AUTISTIK news (the team's latest community posts). Tokens and sessions are public and cached for a
 * minute; news is members-only, like the community itself, so it's read with the visitor's own session.
 */
type Side = {
  trending: { chain: string; chainName: string; token: string; name: string; symbol: string; priceUsd: number | null; change24h: number | null; imageUrl: string | null; promoted: boolean }[];
  live: { id: string; title: string; host: string | null; starts_at: string; now: boolean }[];
};
let cache: { at: number; data: Side } | null = null;

async function publicSide(): Promise<Side> {
  if (cache && Date.now() - cache.at < 60_000) return cache.data;
  const [board, sessions] = await Promise.all([
    getBoard(80).catch(() => []),
    supabaseServer().from("sessions").select("id,title,host,kind,starts_at,join_link,description,is_live,ended")
      .gte("starts_at", new Date(Date.now() - 4 * 3600e3).toISOString()).order("starts_at").limit(12)
      .then((r) => (r.data || []) as LiveSession[], () => [] as LiveSession[]),
  ]);
  const now = Date.now();
  const data: Side = {
    trending: trending(board).slice(0, 5).map((t) => ({
      chain: t.chain, chainName: CHAINS[t.chain]?.name ?? t.chain, token: t.token, name: t.name, symbol: t.symbol,
      priceUsd: t.market?.priceUsd ?? null, change24h: t.market?.change24h ?? null, imageUrl: t.market?.imageUrl ?? null, promoted: !!t.promotedUntil,
    })),
    live: sessions.filter((s) => !s.ended && (isLiveNow(s, now) || Date.parse(s.starts_at) > now)).slice(0, 3)
      .map((s) => ({ id: s.id, title: s.title, host: s.host, starts_at: s.starts_at, now: isLiveNow(s, now) })),
  };
  cache = { at: Date.now(), data };
  return data;
}

export async function GET() {
  const [side, user] = await Promise.all([publicSide(), currentUser().catch(() => null)]);
  let news: { id: string; body: string; channel: string; created_at: string }[] | null = null;
  if (user) {
    // The team's posts: authors who are admins. Read through the member's own session (posts are members-only).
    const { data: team } = await supabaseService().from("profiles").select("id").eq("is_admin", true).limit(20);
    const ids = (team || []).map((t: any) => t.id);
    if (ids.length) {
      const { data } = await supabaseServer().from("posts").select("id,body,channel,created_at").in("author_id", ids).eq("hidden", false)
        .order("created_at", { ascending: false }).limit(4);
      news = (data || []).map((p: any) => ({ id: p.id, channel: p.channel, created_at: p.created_at, body: String(p.body).slice(0, 160) }));
    } else news = [];
  }
  return json({ ...side, news });
}
