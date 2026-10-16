import Link from "next/link";
import Community from "@/components/Community";
import SectionTabs, { COMMUNITY_TABS } from "@/components/SectionTabs";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Community · AUTISTIK Hub" };

export default async function CommunityPage({ searchParams }: { searchParams: { g?: string; c?: string } }) {
  const user = await currentUser();
  return (
    <div className="stack">
      <SectionTabs tabs={COMMUNITY_TABS} active="/community" label="Community" />
      <div className="page-head">
        <h1>Two groups. One community.</h1>
        <p className="muted">Pick a group, join, and say hi.</p>
      </div>
      {user ? (
        <Community uid={user.id} initialGroup={searchParams.g} initialChannel={searchParams.c} />
      ) : (
        <div className="joincta" data-g="lounge">
          <div><b>Sign in to join the groups</b><p className="muted" style={{ fontSize: ".9em" }}>Members only, to keep it safe.</p></div>
          <Link className="btn g" href="/login">Sign in / Join</Link>
        </div>
      )}
    </div>
  );
}
