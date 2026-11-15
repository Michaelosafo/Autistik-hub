import Link from "next/link";
import MadnessPanel from "@/components/mood/MadnessPanel";
import FocusTik from "@/components/mood/FocusTik";
import MyTikPanel from "@/components/mood/MyTikPanel";
import { MoodSticker } from "@/components/mood/MoodStickers";
import LiveNow from "@/components/rooms/LiveNow";
import { currentUser } from "@/lib/supabase/server";
import { FunTab, StreamsTab, VideosTab } from "@/components/watch/VideoTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "TIK · AUTISTIK Hub", description: "Post anything, see what your people are doing, follow each other and join live rooms." };

export default async function MadnessPage({ searchParams }: { searchParams: { tik?: string; tab?: string } }) {
  const tab = ["live", "streams", "videos", "fun"].includes(searchParams.tab || "") ? searchParams.tab! : "";
  const user = await currentUser();
  return (
    <div className="stack mood-page">
      <section className="tik-hello" aria-label="Welcome to TIK">
        <h1>Welcome to <b>TIK</b></h1>
        <nav className="tik-hello-go" aria-label="TIK">
          <Link href="/mood" className={!tab ? "on" : ""} scroll={false}><span>Tik</span><MoodSticker k="mainchar" size={26} /></Link>
          <Link href="/mood?tab=live" className={tab === "live" ? "on" : ""} scroll={false}><span>Live</span><MoodSticker k="dnd" size={26} /></Link>
          <Link href="/mood?tab=streams" className={tab === "streams" ? "on" : ""} scroll={false}><span>Livestream</span><MoodSticker k="stimmy" size={26} /></Link>
          <Link href="/mood?tab=videos" className={tab === "videos" ? "on" : ""} scroll={false}><span>Videos</span><MoodSticker k="goblin" size={26} /></Link>
        </nav>
      </section>
      {user && !tab && !searchParams.tik && <a href="#tik-post" className="tik-fab" aria-label="Post a Tik"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></a>}
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
        <div className="tik-layout">
          <MyTikPanel />
          <div className="tik-layout-feed"><MadnessPanel full focus={/^[0-9a-f-]{36}$/i.test(searchParams.tik || "") ? <FocusTik id={searchParams.tik!} /> : null} /></div>
        </div>
      )}
    </div>
  );
}
