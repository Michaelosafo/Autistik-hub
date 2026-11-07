import Link from "next/link";
import MadnessPanel from "@/components/mood/MadnessPanel";
import FocusTik from "@/components/mood/FocusTik";
import LiveNow from "@/components/rooms/LiveNow";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import LogoMark from "@/components/LogoMark";

export const dynamic = "force-dynamic";
export const metadata = { title: "TIK · AUTISTIK Hub", description: "Post anything, see what your people are doing, follow each other and join live rooms." };

export default async function MadnessPage({ searchParams }: { searchParams: { tik?: string } }) {
  const user = await currentUser();
  const { data: me } = user ? await supabaseServer().from("profiles").select("alias").eq("id", user.id).maybeSingle() : { data: null };
  // A friendly welcome at the top of TIK. The hour is UTC (AUTISTIK is run from Accra, which is UTC); it is only a greeting.
  const hour = new Date().getUTCHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="stack mood-page">
      <section className="tik-welcome" aria-label="Welcome to TIK">
        <span className="tik-welcome-logo" aria-hidden="true"><LogoMark size={52} /></span>
        <div className="tik-welcome-t">
          <small>{user ? `${hello}${me?.alias ? `, ${me.alias}` : ""} 👋` : "Different wavelength. Same channel."}</small>
          <h1>Welcome to the <b>TIK</b> Board</h1>
          <p>Say what&apos;s on your mind, cheer each other on, and find your people. No pressure, no noise: just your corner of AUTISTIK.</p>
        </div>
        <nav className="tik-welcome-go" aria-label="Get started on TIK">
          <a href="#tik-post">Post a Tik</a>
          <Link href="/spaces?host=1">Go live</Link>
          <Link href="/members?tab=find">Find people</Link>
        </nav>
      </section>
      {!user ? (
        <div className="card stack" style={{ alignItems: "flex-start" }}>
          <p style={{ margin: 0 }}>TIK is for members. Sign in or join free to post and see everyone&apos;s Tiks.</p>
          <Link className="btn primary" href="/login?next=/mood">Sign in / Join</Link>
        </div>
      ) : (
        <MadnessPanel full side={<LiveNow max={6} />} focus={/^[0-9a-f-]{36}$/i.test(searchParams.tik || "") ? <FocusTik id={searchParams.tik!} /> : null} />
      )}
    </div>
  );
}
