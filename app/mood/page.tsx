import Link from "next/link";
import MadnessPanel from "@/components/mood/MadnessPanel";
import FocusTik from "@/components/mood/FocusTik";
import LiveNow from "@/components/rooms/LiveNow";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import LogoMark from "@/components/LogoMark";
import WatchTabs from "@/components/watch/WatchTabs";
import { FunTab, StreamsTab, VideosTab } from "@/components/watch/VideoTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "TIK · AUTISTIK Hub", description: "Post anything, see what your people are doing, follow each other and join live rooms." };

export default async function MadnessPage({ searchParams }: { searchParams: { tik?: string; tab?: string } }) {
  const tab = ["live", "streams", "videos", "fun"].includes(searchParams.tab || "") ? searchParams.tab! : "";
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
          <Link href="/mood?tab=streams">Livestreams</Link>
          <Link href="/mood?tab=videos">Videos</Link>
          <Link href="/members?tab=find">Find people</Link>
        </nav>
      </section>
      <WatchTabs tab={tab} />
      {tab === "live" ? (
        <section className="stack" aria-label="Live rooms">
          <div className="wv-head"><b><i className="wv-dot" aria-hidden="true" />Live rooms</b><Link className="btn primary small" href="/spaces?host=1">🎙️ Start a room</Link></div>
          <LiveNow max={12} />
          <Link href="/spaces" className="btn small" style={{ alignSelf: "flex-start" }}>All live rooms and past sessions →</Link>
        </section>
      ) : tab === "streams" ? <StreamsTab signedIn={!!user} />
        : tab === "videos" ? <VideosTab signedIn={!!user} />
        : tab === "fun" ? <FunTab signedIn={!!user} />
        : !user ? (
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
