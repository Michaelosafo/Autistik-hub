import Link from "next/link";
import Guide from "@/components/Guide";
import Community from "@/components/Community";
import { currentUser } from "@/lib/supabase/server";
import ProHero from "@/components/ProHero";
import { GROUPS } from "@/lib/groups";

export const dynamic = "force-dynamic";
export const metadata = { title: "Community · AUTISTIK Hub" };

export default async function CommunityPage({ searchParams }: { searchParams: { g?: string; c?: string } }) {
  const user = await currentUser();
  return (
    <div className="stack">
      <ProHero tone="violet" kicker="AUTISTIK · COMMUNITY" title="Two groups. One community."
        text="Join the groups that fit you, then talk in their channels. You post under your Hub name, never your real name."
        stats={[[GROUPS.length, "groups"], [GROUPS.reduce((n, g) => n + g.channels.length, 0), "channels"], ["Hub names", "never real names"], ["18+", "adults only"]]} />
      <Guide id="groups" title="Join in, in 3 steps" steps={[
        <>Sign in with your email (it takes a minute).</>,
        <>Join a group: <b>Spectrum Lounge</b> to hang out, <b>Support &amp; Questions</b> for help.</>,
        <>Post in a channel. Others see your Hub name, never your real name.</>,
      ]} />
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
