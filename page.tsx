import Link from "next/link";
import Community from "@/components/Community";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Community · AUTISTIK Hub" };

export default async function CommunityPage({ searchParams }: { searchParams: { g?: string; c?: string } }) {
  const user = await currentUser();
  return (
    <div className="stack">
      <div className="page-head">
        <div className="label">Community</div>
        <h1>Four groups. One community.</h1>
        <p className="muted">Join the groups that fit you, then talk in their channels. You post under your Hub name, never your real name.</p>
      </div>
      {user ? (
        <Community uid={user.id} initialGroup={searchParams.g} initialChannel={searchParams.c} />
      ) : (
        <div className="joincta" data-g="lounge">
          <div><b>Sign in to join the groups</b><p className="muted" style={{ fontSize: ".9em" }}>The community is members-only to keep it safe. It takes one email.</p></div>
          <Link className="btn g" href="/login">Sign in / Join</Link>
        </div>
      )}
    </div>
  );
}
