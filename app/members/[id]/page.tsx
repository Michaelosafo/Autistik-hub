import Link from "next/link";
import { notFound } from "next/navigation";
import ProfileEdit from "@/components/ProfileEdit";
import FollowButton from "@/components/members/FollowButton";
import ActivityList from "@/components/members/ActivityList";
import MemberName from "@/components/members/MemberName";
import { loadProfiles, memberActivity, memberCard } from "@/lib/members";
import HoldingsCard from "@/components/members/HoldingsCard";
import HoldingsShare from "@/components/members/HoldingsShare";
import { sharedHoldings } from "@/lib/holdings";
import { badgesFor } from "@/lib/badges";
import { CHANNELS, GROUPS } from "@/lib/groups";
import { supabaseServer, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Member · AUTISTIK Hub" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MemberPage({ params, searchParams }: { params: { id: string }; searchParams: { share?: string } }) {
  const sb = supabaseServer();
  const user = await currentUser();
  if (!user) {
    return (
      <div className="stack" style={{ maxWidth: 640 }}>
        <div className="page-head"><div className="label">Member profile</div><h1>Members only</h1>
          <p className="muted">Profiles are only visible to Hub members, to keep everyone&apos;s privacy.</p></div>
        <div className="row"><Link className="btn primary" href={`/login?next=/members/${encodeURIComponent(params.id)}`}>Sign in / Join</Link></div>
      </div>
    );
  }
  if (!UUID.test(params.id)) notFound();

  const [[prof], { data: pts }, { data: pro }, { data: groups }, { data: posts }, { data: st }, card, activity] = await Promise.all([
    loadProfiles(sb, [params.id]),
    sb.from("member_points").select("posts,sessions,support,points").eq("user_id", params.id).maybeSingle(),
    sb.from("practitioners").select("role").eq("user_id", params.id).maybeSingle(),
    sb.from("group_members").select("group_id").eq("user_id", params.id),
    sb.from("posts").select("id,channel,body,created_at,hidden").eq("author_id", params.id).eq("hidden", false).order("created_at", { ascending: false }).limit(10),
    sb.from("app_settings").select("qualify_points,round_name").eq("id", 1).maybeSingle(),
    memberCard(sb, params.id),
    memberActivity(sb, params.id, 30),
  ]);
  const holdings = prof ? await sharedHoldings(params.id, user.id, searchParams.share) : null;
  if (!prof) notFound();

  const mine = prof.id === user.id;
  const p = { posts: pts?.posts ?? 0, sessions: pts?.sessions ?? 0, support: pts?.support ?? 0, points: pts?.points ?? 0 };
  const badges = badgesFor({ ...p, isAdmin: prof.is_admin, practitioner: !!pro, qualify: st?.qualify_points ?? 50, joined: prof.created_at });
  const joinedGroups = GROUPS.filter((g) => (groups || []).some((x: any) => x.group_id === g.id));
  let wallet: string | null = null;
  if (mine) {
    const { data: w } = await sb.from("wallets").select("address").eq("user_id", user.id).maybeSingle();
    wallet = w?.address ?? null;
  }

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <div className={prof.is_team ? "card profile-head team" : "card profile-head"}>
        <div className="avatar big" aria-hidden="true" style={{ background: prof.color || "#6141D4" }}>{prof.alias.charAt(0)}</div>
        <div className="stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
          <div className="label">{mine ? "Your profile" : prof.is_team ? `AUTISTIK team${prof.team_title ? ` · ${prof.team_title}` : ""}` : "Member profile"}</div>
          <h1 style={{ overflowWrap: "anywhere" }}><MemberName m={prof} link={false} handle={false} /></h1>
          {prof.handle && <span className="mhandle big">@{prof.handle}</span>}
          <span className="muted" style={{ fontSize: ".9em" }}>Joined {new Date(prof.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}{pro ? ` · ${pro.role}` : ""}</span>
          {card && (
            <div className="follow-stats">
              <Link href={`/members?tab=followers&id=${prof.id}`}><b>{card.followers}</b> follower{card.followers === 1 ? "" : "s"}</Link>
              <Link href={`/members?tab=following&id=${prof.id}`}><b>{card.following}</b> following</Link>
              <span><b>{card.lives}</b> live session{card.lives === 1 ? "" : "s"}</span>
              {card.wallet && <span className="chip-flag ok" title="This name is tied to a verified wallet. The address stays private.">✓ Wallet connected</span>}
              {card.follows_me && !mine && <span className="badge v">Follows you</span>}
            </div>
          )}
        </div>
        {card && !mine && <div className="profile-act"><FollowButton id={prof.id} initial={card.i_follow} /></div>}
      </div>
      {badges.length > 0 && (
        <div className="card stack">
          <h2>Badges</h2>
          <div className="badges">
            {badges.map((b) => <span key={b.id} className="badge-pill" title={b.why}><span aria-hidden="true">{b.emoji}</span> {b.label}<span className="sr-only">: {b.why}</span></span>)}
          </div>
        </div>
      )}

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card stack">
          <h2>{st?.round_name || "This round"}</h2>
          <table><tbody>
            <tr><th>Points</th><td className="num"><b>{p.points}</b></td></tr>
            <tr><th>Posts</th><td className="num">{p.posts}</td></tr>
            <tr><th>Sessions</th><td className="num">{p.sessions}</td></tr>
            <tr><th>Hearts received</th><td className="num">{p.support}</td></tr>
          </tbody></table>
          {mine && <Link href="/rewards" style={{ fontSize: ".9em" }}>How points work →</Link>}
        </div>
        <div className="card stack">
          <h2>Groups</h2>
          {joinedGroups.length ? (
            <div className="stack" style={{ gap: 6 }}>{joinedGroups.map((g) => <Link key={g.id} href={`/community?g=${g.id}`} data-g={g.id} className="group-link"><b>{g.name}</b> <span className="muted">· {g.tag}</span></Link>)}</div>
          ) : <p className="muted">{mine ? "You haven't joined a group yet." : "Hasn't joined a group yet."} {mine && <Link href="/community">Find a group</Link>}</p>}
        </div>
      </div>

      {mine && (
        <div className="grid2" style={{ alignItems: "start" }}>
          <ProfileEdit alias={prof.alias} color={prof.color || "#6141D4"} handle={prof.handle ?? null} />
          <div className="card stack">
            <h2>Private to you</h2>
            <table><tbody>
              <tr><th>Wallet</th><td className="mono" style={{ overflowWrap: "anywhere" }}>{wallet || <Link href="/rewards">Link a wallet</Link>}</td></tr>
            </tbody></table>
            <p className="muted" style={{ fontSize: ".85em" }}>Only you can see this box. Other members see your nickname, @handle, badges, groups and activity, and that a wallet is connected. Never your email or wallet address. Your holdings only if you share them (below).</p>
          </div>
        </div>
      )}

      {(holdings || mine) && (
        <div className="grid2" style={{ alignItems: "start" }}>
          {holdings ? <HoldingsCard items={holdings} mine={mine} how={mine ? ({ public: "Everyone can see", followers: "Followers can see" } as Record<string, string>)[prof.holdings_share || ""] || "Only you can see" : searchParams.share ? "Shared with you" : prof.holdings_share === "followers" ? "Shared with followers" : "Shared publicly"} />
            : <div className="card stack"><h2>Holdings</h2><div className="empty"><Link href="/rewards">Link a wallet</Link> to see your holdings here.</div></div>}
          {mine && prof.holdings_share !== undefined && <HoldingsShare uid={prof.id} initial={(prof.holdings_share as any) || "private"} />}
        </div>
      )}

      <div className="card stack">
        <h2>Activity</h2>
        {activity ? (
          <>
            <ActivityList items={activity} empty={mine ? "Nothing yet. Scan a coin, join a live session or follow someone and it shows here." : "Nothing to show yet."} />
            <p className="muted" style={{ fontSize: ".82em" }}>Shows coins scanned, launches, locks, posts, live sessions and follows. Swaps and trades are never shown, and holdings only when the member chooses to share them.</p>
          </>
        ) : (
          <>
            {!posts?.length && <div className="empty">No posts yet.</div>}
            {(posts || []).map((x: any) => (
              <div key={x.id} className="stack" style={{ gap: 2, borderTop: "1px solid var(--line)", paddingTop: 10 }} data-g={CHANNELS[x.channel]?.group.id}>
                <span className="where" style={{ fontSize: ".82em" }}>{CHANNELS[x.channel]?.group.name} › #{CHANNELS[x.channel]?.name} · {new Date(x.created_at).toLocaleDateString()}</span>
                <p style={{ overflowWrap: "anywhere" }}>{x.body.length > 280 ? x.body.slice(0, 280) + "…" : x.body}</p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
