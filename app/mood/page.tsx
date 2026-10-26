import Link from "next/link";
import MadnessPanel from "@/components/mood/MadnessPanel";
import FocusTik from "@/components/mood/FocusTik";
import LiveNow from "@/components/rooms/LiveNow";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Autistik Madness · AUTISTIK Hub", description: "Post how you feel, see what your people are doing, follow each other and join live rooms." };

export default async function MadnessPage({ searchParams }: { searchParams: { tik?: string } }) {
  const user = await currentUser();
  return (
    <div className="stack mood-page">
      <header className="bd-top ln-top">
        <div>
          <h1>Autistik Madness</h1>
          <p className="muted">Post how you feel, share pictures, follow each other and see what your people are up to.</p>
        </div>
        <div className="ln-top-r"><Link href="/spaces?host=1" className="ln-watch">Host a live</Link><Link href="/board" className="ln-ghost">Open the Board</Link></div>
      </header>
      {!user ? (
        <div className="card stack" style={{ alignItems: "flex-start" }}>
          <p style={{ margin: 0 }}>Autistik Madness is for members. Sign in or join free to post and see everyone&apos;s Tiks.</p>
          <Link className="btn primary" href="/login?next=/mood">Sign in / Join</Link>
        </div>
      ) : (
        <div className="mood-grid">
          <div className="stack" style={{ gap: 10, minWidth: 0 }}>
            {/^[0-9a-f-]{36}$/i.test(searchParams.tik || "") && <FocusTik id={searchParams.tik!} />}
            <MadnessPanel full />
          </div>
          <aside className="card stack mood-side" aria-label="Live now">
            <b>Live now</b>
            <LiveNow max={6} />
          </aside>
        </div>
      )}
    </div>
  );
}
