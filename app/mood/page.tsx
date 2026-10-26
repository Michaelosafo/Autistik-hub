import Link from "next/link";
import MoodFeed from "@/components/mood/MoodFeed";
import LiveNow from "@/components/rooms/LiveNow";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Autistik Mood · AUTISTIK Hub", description: "Share how you feel, post pictures and Tiks, and join live rooms." };

export default async function MoodPage() {
  const user = await currentUser();
  return (
    <div className="stack mood-page">
      <header className="bd-top ln-top">
        <div>
          <h1>Autistik Mood</h1>
          <p className="muted">Share how you feel with a Tik, add a picture, and cheer each other on.</p>
        </div>
        <div className="ln-top-r"><Link href="/spaces" className="ln-ghost">Live rooms</Link></div>
      </header>
      {!user ? (
        <div className="card stack" style={{ alignItems: "flex-start" }}>
          <p style={{ margin: 0 }}>Autistik Mood is for members. Sign in or join free to post and see everyone&apos;s Tiks.</p>
          <Link className="btn primary" href="/login?next=/mood">Sign in / Join</Link>
        </div>
      ) : (
        <div className="mood-grid">
          <MoodFeed limit={20} />
          <aside className="card stack mood-side" aria-label="Live now">
            <b>Live now</b>
            <LiveNow max={6} />
          </aside>
        </div>
      )}
    </div>
  );
}
