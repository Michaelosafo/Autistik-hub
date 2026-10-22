import Link from "next/link";
import { notFound } from "next/navigation";
import ProfileEdit from "@/components/ProfileEdit";
import { badgesFor } from "@/lib/badges";
import { CHANNELS, GROUPS } from "@/lib/groups";
import { supabaseServer, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Member · AUTISTIK Hub" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MemberPage({ params }: { params: { id: string } }) {
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

  const [{ data: prof }, { data: pts }, { data: pro }, { data: groups }, { data: posts }, { data: st }] = await Promise.all([
    sb.from("profiles").select("id,alias,color,is_admin,created_at").eq("id", params.id).maybeSingle(),
    sb.from("member_points").select("posts,sessions,support,points").eq("user_id", params.id).maybeSingle(),
    sb.from("practitioners").select("role").eq("user_id", params.id).maybeSingle(),
    sb.from("group_members").select("group_id").eq("user_id", params.id),
    sb.from("posts").select("id,channel,body,created_at,hidden").eq("author_id", params.id).eq("hidden", false).order("created_at", { ascending: false }).limit(10),
    sb.from("app_settings").select("qualify_points,round_name").eq("id", 1).maybeSingle(),
  ]);
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
      <div className="card profile-head">
        <div className="avatar big" aria-hidden="true" style={{ background: prof.color }}>{prof.alias.charAt(0)}</div>
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <div className="label">{mine ? "Your profile" : "Member profile"}</div>
          <h1 style={{ overflowWrap: "anywhere" }}>{prof.alias}</h1>
          <span className="muted" style={{ fontSize: ".9em" }}>Joined {new Date(prof.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}{pro ? ` · ${pro.role}` : ""}</span>
        </div>
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
          <ProfileEdit alias={prof.alias} color={prof.color} />
          <div className="card stack">
            <h2>Private to you</h2>
            <table><tbody>
              <tr><th>Email</th><td style={{ overflowWrap: "anywhere" }}>{user.email}</td></tr>
              <tr><th>Wallet</th><td className="mono" style={{ overflowWrap: "anywhere" }}>{wallet || <Link href="/rewards">Link a wallet</Link>}</td></tr>
            </tbody></table>
            <p className="muted" style={{ fontSize: ".85em" }}>Only you can see this box. Other members see your Hub name, colour, badges, groups and posts, never your email or wallet.</p>
          </div>
        </div>
      )}

      <div className="card stack">
        <h2>Recent posts</h2>
        {!posts?.length && <div className="empty">No posts yet.</div>}
        {(posts || []).map((x: any) => (
          <div key={x.id} className="stack" style={{ gap: 2, borderTop: "1px solid var(--line)", paddingTop: 10 }} data-g={CHANNELS[x.channel]?.group.id}>
            <span className="where" style={{ fontSize: ".82em" }}>{CHANNELS[x.channel]?.group.name} › #{CHANNELS[x.channel]?.name} · {new Date(x.created_at).toLocaleDateString()}</span>
            <p style={{ overflowWrap: "anywhere" }}>{x.body.length > 280 ? x.body.slice(0, 280) + "…" : x.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
