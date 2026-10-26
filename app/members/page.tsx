import Link from "next/link";
import FollowButton from "@/components/members/FollowButton";
import MemberName from "@/components/members/MemberName";
import { CHANNELS } from "@/lib/groups";
import { ACTIVITY, ago, loadProfiles } from "@/lib/members";
import { supabaseServer, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Members · AUTISTIK Hub" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Tab = "feed" | "find" | "followers" | "following";

export default async function MembersPage({ searchParams }: { searchParams: { tab?: string; q?: string; id?: string } }) {
  const user = await currentUser();
  if (!user) {
    return (
      <div className="stack" style={{ maxWidth: 640 }}>
        <div className="page-head"><div className="label">Members</div><h1>Follow each other</h1>
          <p className="muted">Every member gets a one-of-a-kind meme name when they join. Sign in to follow people and see what they&apos;re up to.</p></div>
        <div className="row"><Link className="btn primary" href="/login?next=/members">Sign in / Join</Link></div>
      </div>
    );
  }
  const sb = supabaseServer();
  const tab: Tab = (["feed", "find", "followers", "following"] as const).find((t) => t === searchParams.tab) || "feed";
  const who = searchParams.id && UUID.test(searchParams.id) ? searchParams.id : user.id;
  const q = String(searchParams.q || "").replace(/^\s*@/, "").replace(/[%,()\\*]/g, " ").trim().slice(0, 40);

  const { data: mine } = await sb.from("follows").select("followee_id").eq("follower_id", user.id);
  const following = new Set((mine || []).map((f: any) => f.followee_id as string));

  let people: Awaited<ReturnType<typeof loadProfiles>> = [];
  let feed: { id: string; author_id: string; channel: string; body: string; created_at: string }[] = [];
  let joins: { session_id: string; user_id: string; joined_at: string; session: { title: string } | null }[] = [];
  let whoName = "";
  type ActRow = { user_id: string; at: string; kind: string; label: string | null; link: string | null };
  let extra: ActRow[] = [];
  let latest = new Map<string, ActRow[]>();

  if (tab === "feed" && following.size) {
    const ids = [...following];
    const [{ data: p }, { data: j }] = await Promise.all([
      sb.from("posts").select("id,author_id,channel,body,created_at").in("author_id", ids).eq("hidden", false).order("created_at", { ascending: false }).limit(40),
      sb.from("session_joins").select("session_id,user_id,joined_at,session:sessions(title)").in("user_id", ids).order("joined_at", { ascending: false }).limit(20),
    ]);
    feed = (p || []) as any; joins = (j || []) as any;
    const { data: ar } = await sb.rpc("member_activity_many", { p_ids: ids.slice(0, 200), p_per: 5, p_total: 60 });
    extra = ((ar || []) as ActRow[]).filter((a) => a.kind !== "post" && a.kind !== "live");
    people = await loadProfiles(sb, [...new Set([...feed.map((x) => x.author_id), ...joins.map((x) => x.user_id), ...extra.map((x) => x.user_id)])]);
  } else if (tab === "find") {
    // Search by nickname or @handle (handles arrive with members-live.sql; before that, nicknames only).
    const find = (byHandle: boolean) => loadProfiles(sb, undefined, (x) => (q ? (byHandle ? x.or(`alias.ilike.%${q}%,handle.ilike.%${q}%`) : x.ilike("alias", `%${q}%`)) : x).order("created_at", { ascending: false }).limit(60));
    people = await find(true);
    if (!people.length && q) people = await find(false);
    people.sort((a, b) => Number(!!b.is_team) - Number(!!a.is_team));
  } else if (tab === "followers" || tab === "following") {
    const { data: f } = tab === "followers"
      ? await sb.from("follows").select("follower_id").eq("followee_id", who).limit(500)
      : await sb.from("follows").select("followee_id").eq("follower_id", who).limit(500);
    people = await loadProfiles(sb, (f || []).map((x: any) => x.follower_id || x.followee_id));
    if (who !== user.id) whoName = (await loadProfiles(sb, [who]))[0]?.alias || "";
  }

  if (tab !== "feed" && people.length) {
    const { data: ar } = await sb.rpc("member_activity_many", { p_ids: people.map((p) => p.id).slice(0, 200), p_per: 2, p_total: 200 });
    for (const a of (ar || []) as ActRow[]) latest.set(a.user_id, [...(latest.get(a.user_id) || []), a]);
  }

  // "People to follow": the team first, then the members others follow most, then the newest. Not you, not people you already follow.
  let suggested: Awaited<ReturnType<typeof loadProfiles>> = [];
  if (tab === "feed") {
    const pool = (await loadProfiles(sb, undefined, (x) => x.order("created_at", { ascending: false }).limit(60))).filter((p) => p.id !== user.id && !following.has(p.id));
    const { data: fl } = pool.length ? await sb.from("follows").select("followee_id").in("followee_id", pool.map((p) => p.id)).limit(5000) : { data: [] as any[] };
    const n = new Map<string, number>();
    for (const f of fl || []) n.set(f.followee_id, (n.get(f.followee_id) || 0) + 1);
    suggested = pool.sort((a, b) => Number(!!b.is_team) - Number(!!a.is_team) || (n.get(b.id) || 0) - (n.get(a.id) || 0)).slice(0, 8);
  }
  const byId = new Map(people.map((p) => [p.id, p]));

  type Item = { at: string; who: string; el: React.ReactNode; key: string };
  const items: Item[] = [
    ...feed.map((x) => ({ at: x.created_at, who: x.author_id, key: "p" + x.id, el: <>
      <span className="where" style={{ fontSize: ".82em" }}>{CHANNELS[x.channel] ? `${CHANNELS[x.channel].group.name} › #${CHANNELS[x.channel].name}` : "Community"}</span>
      <p style={{ overflowWrap: "anywhere" }}>{x.body.length > 280 ? x.body.slice(0, 280) + "…" : x.body}</p>
    </> })),
    ...extra.map((x) => ({ at: x.at, who: x.user_id, key: "a" + x.user_id + x.at + x.kind, el: <p>{(ACTIVITY[x.kind]?.icon || "•")} <span className="muted">{ACTIVITY[x.kind]?.verb}</span> {x.link ? <Link href={x.link}>{x.label}</Link> : x.label}</p> })),
    ...joins.map((x) => ({ at: x.joined_at, who: x.user_id, key: "j" + x.session_id + x.user_id, el: <p>Joined the live session <Link href="/live"><b>{x.session?.title || "Live session"}</b></Link></p> })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const tabs: [Tab, string][] = [["feed", "Following feed"], ["find", "Find members"], ["followers", "Followers"], ["following", "Following"]];
  const card = (p: (typeof people)[number]) => (
    <div key={p.id} className="stack" style={{ gap: 4 }}>
      <div className="member-row">
        <MemberName m={p} avatar />
        {p.id === user.id ? <span className="muted" style={{ fontSize: ".85em" }}>You</span> : <FollowButton id={p.id} initial={following.has(p.id)} small />}
      </div>
      {(latest.get(p.id) || []).slice(0, 2).map((a, i) => (
        <div key={i} className="muted" style={{ fontSize: ".85em", paddingLeft: 42, overflowWrap: "anywhere" }}>
          {ACTIVITY[a.kind]?.icon || "•"} {ACTIVITY[a.kind]?.verb} {a.link ? <Link href={a.link}>{a.label}</Link> : a.label} · {ago(a.at)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <div className="page-head"><div className="label">Members</div><h1>Follow each other</h1>
        <p className="muted">Like X: everyone has a nickname and an @handle you can search. Team accounts wear a gold <span className="team-badge">✓ TEAM</span> badge, so you always know it&apos;s really us.</p></div>
      <nav className="chips" aria-label="Members">
        {tabs.map(([t, name]) => <Link key={t} className="chip" aria-current={tab === t ? "page" : undefined} href={`/members?tab=${t}`}>{name}{t === "following" && following.size ? ` (${following.size})` : ""}</Link>)}
        <Link className="chip" href="/live">Live hub</Link>
      </nav>

      {tab === "feed" && !!suggested.length && (
        <div className="card stack">
          <h2>People to follow</h2>
          <div className="member-list">{suggested.map(card)}</div>
          <Link className="muted" href="/members?tab=find">See everyone →</Link>
        </div>
      )}

      {tab === "feed" && (
        <div className="card stack">
          <h2>From people you follow</h2>
          {!following.size && <div className="empty">You aren&apos;t following anyone yet. <Link href="/members?tab=find">Find members</Link> and press <b>+ Follow</b>.</div>}
          {!!following.size && !items.length && <div className="empty">Nobody you follow has posted or joined a live session yet.</div>}
          {items.map((it) => {
            const p = byId.get(it.who);
            return (
              <div key={it.key} className="stack feed-item" style={{ gap: 4 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>{p ? <MemberName m={p} avatar /> : <b>Member</b>}<time className="muted" style={{ fontSize: ".82em" }} dateTime={it.at}>{ago(it.at)}</time></div>
                {it.el}
              </div>
            );
          })}
        </div>
      )}

      {tab === "find" && (
        <div className="card stack">
          <form className="row" action="/members" method="get" style={{ gap: 8 }}>
            <input type="hidden" name="tab" value="find" />
            <input type="search" name="q" defaultValue={String(searchParams.q || "").slice(0, 41)} placeholder="Search a nickname or @handle" aria-label="Search members" style={{ flex: 1, minWidth: 0 }} />
            <button className="btn primary" type="submit">Search</button>
          </form>
          {!people.length && <div className="empty">No members match that name.</div>}
          <div className="member-list">{people.map(card)}</div>
        </div>
      )}

      {(tab === "followers" || tab === "following") && (
        <div className="card stack">
          <h2>{whoName ? `${tab === "followers" ? "Followers of" : "Followed by"} ${whoName}` : tab === "followers" ? "Your followers" : "People you follow"}</h2>
          {!people.length && <div className="empty">{tab === "followers" ? "No followers yet." : "Not following anyone yet."}</div>}
          <div className="member-list">{people.map(card)}</div>
        </div>
      )}
    </div>
  );
}
