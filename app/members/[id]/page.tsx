import Link from "next/link";
import Avatar from "@/components/Avatar";
import { notFound } from "next/navigation";
import BadgeApply from "@/components/BadgeApply";
import ProfileEdit from "@/components/ProfileEdit";
import BadgePicker from "@/components/BadgePicker";
import VerifiedBadge from "@/components/VerifiedBadge";
import Recordings from "@/components/rooms/Recordings";
import FollowButton from "@/components/members/FollowButton";
import ShareProfile from "@/components/members/ShareProfile";
import ActivityList from "@/components/members/ActivityList";
import { ActivityPrivacy, MessageButton } from "@/components/members/ProfileButtons";
import { loadProfiles, memberActivity, memberCard } from "@/lib/members";
import HoldingsCard from "@/components/members/HoldingsCard";
import HoldingsShare from "@/components/members/HoldingsShare";
import { sharedHoldings } from "@/lib/holdings";
import { GROUPS } from "@/lib/groups";
import { supabaseServer, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Member · AUTISTIK Hub" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A member's profile: photo, name with their verified badge, @username, followers / following / lives, Follow,
 * Message and Share; then a short info list, groups and activity (if they let you see it). Your own profile also has
 * your settings: name, badge, who sees your activity, holdings sharing.
 */
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

  const [[prof], { data: pro }, { data: groups }, { data: vis }, card, activity] = await Promise.all([
    loadProfiles(sb, [params.id]),
    sb.from("practitioners").select("role").eq("user_id", params.id).maybeSingle(),
    sb.from("group_members").select("group_id").eq("user_id", params.id),
    sb.from("profiles").select("activity_visibility").eq("id", params.id).maybeSingle(),
    memberCard(sb, params.id),
    memberActivity(sb, params.id, 30),
  ]);
  const holdings = prof ? await sharedHoldings(params.id, user.id, searchParams.share) : null;
  if (!prof) notFound();

  const mine = prof.id === user.id;
  const p = prof as any;
  const verified = !!(p.is_verified || prof.is_team);
  const visibility = (vis as any)?.activity_visibility || "everyone";
  const joinedGroups = GROUPS.filter((g) => (groups || []).some((x: any) => x.group_id === g.id));
  let wallet: string | null = null;
  if (mine) {
    const { data: w } = await sb.from("wallets").select("address").eq("user_id", user.id).maybeSingle();
    wallet = w?.address ?? null;
  }
  const canSeeActivity = mine || visibility === "everyone" || (visibility === "followers" && !!card?.i_follow);

  return (
    <div className="pp">
      <section className={"pp-head" + (prof.is_team ? " team" : "")}>
        <div className="pp-cover" aria-hidden="true" />
        <Avatar className="avatar pp-av" alias={prof.alias} color={prof.color} url={prof.avatar_url} />
        <h1 className="pp-name">{prof.alias}{verified && <VerifiedBadge n={p.verified_badge} size={22} className="vbadge-name" title={prof.is_team ? "AUTISTIK team" : "Verified by AUTISTIK"} />}</h1>
        <div className="pp-sub">
          {prof.handle && <span>@{prof.handle}</span>}
          {prof.is_team && <span className="pp-tag gold">AUTISTIK team{prof.team_title ? ` · ${prof.team_title}` : ""}</span>}
          {pro && <span className="pp-tag">{pro.role}</span>}
          {card?.follows_me && !mine && <span className="pp-tag">Follows you</span>}
        </div>
        {card && (
          <div className="pp-stats">
            <Link href={`/members?tab=followers&id=${prof.id}`}><b>{card.followers}</b><small>Followers</small></Link>
            <Link href={`/members?tab=following&id=${prof.id}`}><b>{card.following}</b><small>Following</small></Link>
            <span><b>{card.lives}</b><small>Lives</small></span>
          </div>
        )}
        <div className="pp-acts">
          {mine ? <a className="pp-btn primary" href="#pp-edit">Edit profile</a> : card && <FollowButton id={prof.id} initial={card.i_follow} />}
          {!mine && <MessageButton id={prof.id} />}
          <ShareProfile handle={prof.handle ?? null} id={prof.id} name={prof.alias} className="pp-btn" />
        </div>
      </section>

      <section className="pp-list">
        {prof.handle && <div className="pp-row"><span>Username</span><b>@{prof.handle}</b></div>}
        <div className="pp-row"><span>Joined</span><b>{new Date(prof.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b></div>
        {card?.wallet && <div className="pp-row"><span>Wallet</span><b className="pp-ok">✓ Connected</b></div>}
        {mine && <div className="pp-row"><span>Your wallet (only you see this)</span><b className="mono">{wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : <Link href="/wallet">Set up</Link>}</b></div>}
        {joinedGroups.length > 0 && (
          <div className="pp-row col"><span>Groups</span>
            <div className="pp-groups">{joinedGroups.map((g) => <Link key={g.id} href={`/community?g=${g.id}`} data-g={g.id}>{g.name}</Link>)}</div>
          </div>
        )}
      </section>

      <section className="pp-card">
        <h2>Activity</h2>
        {canSeeActivity && activity ? (
          <ActivityList items={activity} empty={mine ? "Nothing yet. Scan a coin, join a live session or follow someone and it shows here." : "Nothing to show yet."} />
        ) : (
          <p className="muted">{visibility === "followers" ? `Only ${prof.alias}'s followers can see their activity. Follow to see it.` : `${prof.alias} keeps their activity private.`}</p>
        )}
      </section>

      <Recordings userId={params.id} mine={mine} />

      {(holdings || mine) && (
        holdings ? <HoldingsCard items={holdings} mine={mine} how={mine ? ({ public: "Everyone can see", followers: "Followers can see" } as Record<string, string>)[prof.holdings_share || ""] || "Only you can see" : searchParams.share ? "Shared with you" : prof.holdings_share === "followers" ? "Shared with followers" : "Shared publicly"} />
          : <section className="pp-card"><h2>Holdings</h2><div className="empty"><Link href="/wallet">Set up your wallet</Link> to see your holdings here.</div></section>
      )}

      {mine && (
        <section className="pp-card" id="pp-edit">
          <h2>Your settings</h2>
          <ActivityPrivacy uid={prof.id} initial={visibility} />
          {prof.holdings_share !== undefined && <HoldingsShare uid={prof.id} initial={(prof.holdings_share as any) || "private"} />}
          <ProfileEdit alias={prof.alias} color={prof.color || "#6141D4"} handle={prof.handle ?? null} />
          {verified && <BadgePicker current={p.verified_badge ?? null} name={prof.alias} />}
          <BadgeApply verified={!!p.is_verified} team={!!prof.is_team} />
        </section>
      )}
    </div>
  );
}
