import { json } from "@/lib/ai";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A person's card in a live room: who they are, followers, their latest posts, coins they launched, and the coins they
 * watch, but only if they share it (their holdings setting: everyone, or followers). Never their wallet.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!UUID.test(id)) return json({ error: "Unknown person." }, 400);
  const viewer = await currentUser();
  const sb = supabaseService();
  const [{ data: p }, followers, following, iFollow, { data: posts }, { data: launched }] = await Promise.all([
    sb.from("profiles").select("id,alias,handle,color,avatar_url,is_verified,is_team,team_title,holdings_share,created_at,verified_badge").eq("id", id).maybeSingle(),
    sb.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", id).then((r) => r.count ?? 0),
    sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", id).then((r) => r.count ?? 0),
    viewer ? sb.from("follows").select("followee_id").eq("follower_id", viewer.id).eq("followee_id", id).maybeSingle().then((r) => !!r.data) : Promise.resolve(false),
    sb.from("tiks").select("id,body,image_url,created_at").eq("author_id", id).eq("hidden", false).is("reply_to", null).order("created_at", { ascending: false }).limit(5),
    sb.from("launches").select("chain,token,symbol,name").eq("user_id", id).order("created_at", { ascending: false }).limit(6),
  ]);
  if (!p) return json({ error: "Unknown person." }, 404);
  const me = viewer?.id === id;
  const share = String(p.holdings_share || "private");
  const canSeeWatch = me || share === "everyone" || (share === "followers" && iFollow);
  let watching: { chain: string; token: string; symbol: string | null }[] = [];
  if (canSeeWatch) {
    const { data: w } = await sb.from("launch_watchers").select("chain,token").eq("user_id", id).order("created_at", { ascending: false }).limit(8);
    const list = (w || []) as any[];
    if (list.length) {
      const { data: names } = await sb.from("launches").select("chain,token,symbol").in("token", list.map((x) => x.token));
      watching = list.map((x) => ({ chain: x.chain, token: x.token, symbol: (names || []).find((n: any) => n.token === x.token && n.chain === x.chain)?.symbol ?? null }));
    }
  }
  const { holdings_share: _h, ...pub } = p as any;
  return json({ ...pub, followers, following, iFollow, me, posts: posts || [], launched: launched || [], watching, watchShared: canSeeWatch });
}
