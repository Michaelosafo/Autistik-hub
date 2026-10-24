import { json } from "@/lib/ai";
import { CHAINS } from "@/lib/launchpad";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Home timeline in the three-column layout (components/HomeFeed.tsx).
 *  - For you: Spectrum Lounge posts (members only, read with the member's own session) mixed with new token launches.
 *  - Following: Lounge posts from people the member follows.
 * Support & Questions posts (calm.*) never appear here: they stay inside Community, where people expect them.
 */
type Item =
  | { kind: "post"; id: string; at: string; body: string; channel: string; note: string | null; author: { id: string; alias: string; color: string } | null }
  | { kind: "launch"; id: string; at: string; chain: string; chainName: string; token: string; name: string; symbol: string };

export async function GET(req: Request) {
  const tab = new URL(req.url).searchParams.get("tab") === "following" ? "following" : "foryou";
  const sb = supabaseServer();
  const user = await currentUser().catch(() => null);
  const items: Item[] = [];

  if (user) {
    let authors: string[] | null = null;
    if (tab === "following") {
      const { data: f } = await sb.from("follows").select("followee_id").eq("follower_id", user.id).limit(500);
      authors = (f || []).map((r: any) => r.followee_id);
      if (!authors.length) return json({ items: [], signedIn: true, followsNobody: true });
    }
    let q = sb.from("posts").select("id,author_id,channel,body,content_note,created_at").like("channel", "lounge.%").eq("hidden", false)
      .order("created_at", { ascending: false }).limit(40);
    if (authors) q = q.in("author_id", authors);
    const { data: posts } = await q;
    const ids = [...new Set((posts || []).map((p: any) => p.author_id))];
    const { data: profiles } = ids.length ? await sb.from("profiles").select("id,alias,color").in("id", ids) : { data: [] as any[] };
    const who = new Map<string, { id: string; alias: string; color: string }>(
      (profiles || []).map((p: any) => [String(p.id), { id: String(p.id), alias: String(p.alias), color: String(p.color) }]),
    );
    for (const p of posts || []) {
      items.push({ kind: "post", id: p.id, at: p.created_at, body: p.body, channel: p.channel, note: p.content_note, author: who.get(p.author_id) ?? null });
    }
  }

  if (tab === "foryou") {
    const { data: launches } = await sb.from("launches").select("chain,token,name,symbol,created_at,tx_hash").order("created_at", { ascending: false }).limit(15);
    for (const l of launches || []) {
      items.push({ kind: "launch", id: String(l.tx_hash || l.token), at: l.created_at, chain: l.chain, chainName: CHAINS[l.chain as keyof typeof CHAINS]?.name ?? l.chain, token: l.token, name: l.name, symbol: l.symbol });
    }
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return json({ items: items.slice(0, 50), signedIn: !!user });
}
