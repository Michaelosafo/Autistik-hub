import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Avatar from "@/components/Avatar";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const clean = (h: string) => decodeURIComponent(h || "").replace(/^@/, "").toLowerCase();
const OK = /^[a-z0-9_]{3,20}$/;

async function load(handle: string) {
  if (!OK.test(handle)) return null;
  const sb = supabaseService();
  const { data: p } = await sb.from("profiles").select("id,alias,color,avatar_url,handle,is_team,team_title,is_verified,created_at").eq("handle", handle).maybeSingle();
  if (!p) return null;
  const [{ count: followers }, { count: following }] = await Promise.all([
    sb.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", p.id),
    sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", p.id),
  ]);
  return { ...p, followers: followers ?? 0, following: following ?? 0 };
}

export async function generateMetadata({ params }: { params: { handle: string } }): Promise<Metadata> {
  const p = await load(clean(params.handle));
  if (!p) return { title: "Member · AUTISTIK" };
  const title = `${p.alias} (@${p.handle}) · AUTISTIK`;
  const description = `Follow ${p.alias} on AUTISTIK: posts, lives and what they're up to.`;
  return { title, description, openGraph: { title, description, images: p.avatar_url ? [p.avatar_url] : undefined }, twitter: { card: "summary", title, description } };
}

/**
 * autistik.io/@name: a member's profile link to share. Members go straight to the full profile (activity, Follow).
 * Visitors see who it is and sign in (or join) to follow; they come back here and land on the profile.
 */
export default async function HandlePage({ params }: { params: { handle: string } }) {
  const handle = clean(params.handle);
  const p = await load(handle);
  if (!p) notFound();
  const user = await currentUser();
  if (user) redirect(`/members/${p.id}`);
  const back = `/@${p.handle}`;
  return (
    <div className="stack" style={{ maxWidth: 560, margin: "0 auto" }}>
      <div className="card profile-head share-card">
        <Avatar className="avatar big" alias={p.alias} color={p.color} url={p.avatar_url} />
        <div className="stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
          <div className="label">{p.is_team ? `AUTISTIK team${p.team_title ? ` · ${p.team_title}` : ""}` : "AUTISTIK member"}</div>
          <h1 style={{ overflowWrap: "anywhere", margin: 0 }}>{p.alias}{p.is_verified ? " ✓" : ""}</h1>
          <span className="mhandle big">@{p.handle}</span>
          <div className="follow-stats"><span><b>{p.followers}</b> follower{p.followers === 1 ? "" : "s"}</span><span><b>{p.following}</b> following</span></div>
        </div>
      </div>
      <div className="card stack" style={{ alignItems: "flex-start" }}>
        <b>Follow {p.alias} on AUTISTIK</b>
        <p className="muted" style={{ margin: 0 }}>Sign in or join free to follow @{p.handle} and see their Tiks, lives and what they&apos;re up to. Profiles are only shown in full to members, to keep everyone&apos;s privacy.</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Link className="btn primary" href={`/login?mode=join&next=${encodeURIComponent(back)}`}>Join free and follow</Link>
          <Link className="btn" href={`/login?next=${encodeURIComponent(back)}`}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}
