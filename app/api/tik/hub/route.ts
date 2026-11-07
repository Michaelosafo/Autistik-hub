import { json } from "@/lib/ai";
import { CHAINS } from "@/lib/launchpad";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything on TIK's Home in one call: AUTISTIK news, what's happening across the site, tokens people are looking at,
 * tokens with a clean safety scan, and people to follow. Public data only; nobody's wallet or private details.
 */
type Act = { kind: string; at: string; who?: { id: string; alias: string; color: string; avatar_url: string | null; v: boolean; vb: number | null } | null; text: string; href: string };

const chainName = (c: string) => (CHAINS as any)[c]?.name || c;

/** A scan counts as clean only when the checks we can see all pass (unknowns don't count as passing). */
function clean(s: any): boolean {
  if (!s || typeof s !== "object") return false;
  const no = (v: any) => v === false;
  return no(s.honeypot) && !s.cannotBuy && s.cannotSellAll !== true && (s.risks?.length ?? 0) === 0
    && Number(s.buyTax ?? 99) <= 5 && Number(s.sellTax ?? 99) <= 5 && s.openSource === true
    && s.mintable !== true && s.hiddenOwner !== true && s.canTakeBack !== true && s.sameCreatorHoneypot !== true
    && s.taxChangeable !== true && Number(s.holderCount ?? 0) >= 100;
}

export async function GET() {
  const user = await currentUser().catch(() => null);
  const sb = supabaseService();
  const day2 = new Date(Date.now() - 2 * 864e5).toISOString();
  const day3 = new Date(Date.now() - 3 * 864e5).toISOString();
  const week = new Date(Date.now() - 7 * 864e5).toISOString();

  const [news, launches, rooms, recs, drops, tiks, joined, views, tracked, myFollows] = await Promise.all([
    sb.from("tik_news").select("id,title,body,url,pinned,created_at").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(6),
    sb.from("launches").select("chain,token,name,symbol,user_id,created_at,style").order("created_at", { ascending: false }).limit(8),
    sb.from("live_rooms").select("id,host_id,title,created_at,ended_at").order("created_at", { ascending: false }).limit(8),
    sb.from("live_recordings").select("id,host_id,title,created_at").order("created_at", { ascending: false }).limit(5),
    sb.from("live_room_drops").select("id,host_id,room_id,symbol,recipients,created_at").order("created_at", { ascending: false }).limit(5),
    sb.from("tiks").select("id,author_id,body,created_at").is("reply_to", null).eq("hidden", false).order("created_at", { ascending: false }).limit(10),
    sb.from("profiles").select("id,created_at").order("created_at", { ascending: false }).limit(5),
    sb.from("page_views").select("path,visitor,user_id").gte("at", day3).or("path.like./launchpad/%,path.like./analytics/%").limit(5000),
    sb.from("tracked_tokens").select("chain,token,name,symbol,image_url,security,checked_at").gte("checked_at", week).order("checked_at", { ascending: false }).limit(300),
    user ? sb.from("follows").select("followee_id").eq("follower_id", user.id).limit(1000) : Promise.resolve({ data: [] as any[] }),
  ]);

  // ---- Who's who (one lookup for everyone mentioned)
  const ids = new Set<string>();
  for (const r of launches.data || []) r.user_id && ids.add(r.user_id);
  for (const r of rooms.data || []) ids.add(r.host_id);
  for (const r of recs.data || []) ids.add(r.host_id);
  for (const r of drops.data || []) ids.add(r.host_id);
  for (const r of tiks.data || []) ids.add(r.author_id);
  for (const r of joined.data || []) ids.add(r.id);
  const { data: people } = ids.size ? await sb.from("profiles").select("id,alias,color,avatar_url,is_verified,is_team,verified_badge").in("id", [...ids]) : { data: [] as any[] };
  const P = new Map((people || []).map((p: any) => [p.id, { id: p.id, alias: p.alias, color: p.color, avatar_url: p.avatar_url, v: !!(p.is_verified || p.is_team), vb: p.verified_badge }]));

  // ---- Activity
  const act: Act[] = [];
  for (const r of launches.data || []) act.push({ kind: "launch", at: r.created_at, who: P.get(r.user_id) || null, text: `launched $${r.symbol} on ${chainName(r.chain)}${r.style === "instant" ? " · Instant" : ""}`, href: `/launchpad/${r.chain}/${r.token}` });
  for (const r of rooms.data || []) act.push({ kind: r.ended_at ? "live-ended" : "live", at: r.created_at, who: P.get(r.host_id) || null, text: `${r.ended_at ? "hosted" : "is live"}: ${r.title}`, href: `/spaces/${r.id}` });
  for (const r of recs.data || []) act.push({ kind: "recording", at: r.created_at, who: P.get(r.host_id) || null, text: `saved a recording: ${r.title}`, href: `/members/${r.host_id}` });
  for (const r of drops.data || []) act.push({ kind: "drop", at: r.created_at, who: P.get(r.host_id) || null, text: `dropped ${r.symbol || "tokens"} to ${r.recipients} ${r.recipients === 1 ? "person" : "people"} in a live`, href: `/spaces/${r.room_id}` });
  for (const r of tiks.data || []) act.push({ kind: "tik", at: r.created_at, who: P.get(r.author_id) || null, text: String(r.body || "").replace(/\s+/g, " ").slice(0, 110) || "posted a Tik", href: `/mood?tik=${r.id}` });
  for (const r of joined.data || []) act.push({ kind: "joined", at: r.created_at, who: P.get(r.id) || null, text: "joined AUTISTIK 👋", href: `/members/${r.id}` });
  act.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  // ---- Tokens people are looking at (distinct viewers, last 3 days)
  const T = new Map<string, any>();
  for (const t of tracked.data || []) T.set(`${t.chain}:${t.token.toLowerCase()}`, t);
  const L = new Map<string, any>();
  for (const l of launches.data || []) L.set(`${l.chain}:${l.token.toLowerCase()}`, l);
  const seen = new Map<string, { chain: string; token: string; who: Set<string> }>();
  for (const v of views.data || []) {
    const m = /^\/(?:launchpad|analytics)\/([a-z]+)\/(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})(?:[/?#]|$)/.exec(v.path || "");
    if (!m) continue;
    const key = `${m[1]}:${m[2].toLowerCase()}`;
    const e = seen.get(key) || { chain: m[1], token: m[2], who: new Set<string>() };
    e.who.add(v.user_id || v.visitor || "?");
    seen.set(key, e);
  }
  const watching = [...seen.entries()].sort((a, b) => b[1].who.size - a[1].who.size).slice(0, 8).map(([key, e]) => {
    const t = T.get(key), l = L.get(key);
    return { chain: e.chain, token: e.token, name: t?.name || l?.name || null, symbol: t?.symbol || l?.symbol || null, logo: t?.image_url || null, viewers: e.who.size, clean: t ? clean(t.security) : null, href: e.token.startsWith("0x") || e.chain !== "solana" ? `/analytics/${e.chain}/${e.token}` : `/analytics/solana/${e.token}` };
  });

  // ---- Clean scans (checked this week)
  const cleanList = (tracked.data || []).filter((t) => clean(t.security)).slice(0, 8).map((t) => ({
    chain: t.chain, token: t.token, name: t.name, symbol: t.symbol, logo: t.image_url, holders: Number((t.security as any)?.holderCount ?? 0), href: `/analytics/${t.chain}/${t.token}`,
  }));

  // ---- People to follow: team and verified first, then the most followed, minus people you already follow.
  const skip = new Set<string>([...(myFollows.data || []).map((f: any) => f.followee_id), ...(user ? [user.id] : [])]);
  const [{ data: stars }, { data: fol }] = await Promise.all([
    sb.from("profiles").select("id,alias,handle,color,avatar_url,is_verified,is_team,team_title,verified_badge").or("is_team.eq.true,is_verified.eq.true").limit(40),
    sb.from("follows").select("followee_id").gte("created_at", new Date(Date.now() - 60 * 864e5).toISOString()).limit(3000),
  ]);
  const count = new Map<string, number>();
  for (const f of fol || []) count.set(f.followee_id, (count.get(f.followee_id) || 0) + 1);
  const popIds = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => !skip.has(id)).slice(0, 12);
  const { data: pop } = popIds.length ? await sb.from("profiles").select("id,alias,handle,color,avatar_url,is_verified,is_team,team_title,verified_badge").in("id", popIds) : { data: [] as any[] };
  const suggest: any[] = [];
  const add = (p: any, why: string) => { if (!skip.has(p.id) && !suggest.some((s) => s.id === p.id)) suggest.push({ id: p.id, alias: p.alias, handle: p.handle, color: p.color, avatar_url: p.avatar_url, v: !!(p.is_verified || p.is_team), vb: p.verified_badge, why }); };
  for (const p of (stars || []).filter((p: any) => p.is_team)) add(p, p.team_title ? `AUTISTIK team · ${p.team_title}` : "AUTISTIK team");
  for (const p of (stars || []).filter((p: any) => !p.is_team)) add(p, "Verified");
  for (const id of popIds) { const p = (pop || []).find((x: any) => x.id === id); if (p) add(p, `${count.get(id)} new followers`); }

  return json({
    news: news.data || [],
    activity: act.filter((a) => a.who || a.kind === "launch").slice(0, 24),
    watching,
    clean: cleanList,
    people: suggest.slice(0, 8),
    signedIn: !!user,
  });
}
