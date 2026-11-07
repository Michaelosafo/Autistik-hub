import Link from "next/link";
import MadnessPanel from "@/components/mood/MadnessPanel";
import FocusTik from "@/components/mood/FocusTik";
import LiveNow from "@/components/rooms/LiveNow";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "TIK · AUTISTIK Hub", description: "Post anything, see what your people are doing, follow each other and join live rooms." };

export default async function MadnessPage({ searchParams }: { searchParams: { tik?: string } }) {
  const user = await currentUser();
  return (
    <div className="stack mood-page">
      {!user && <header className="bd-top ln-top">
        <div>
          <h1>TIK</h1>
          <p className="muted">Post anything, share pictures, follow each other and see what your people are up to.</p>
        </div>
        <div className="ln-top-r"><Link href="/spaces?host=1" className="ln-watch">Host a live</Link><Link href="/board" className="ln-ghost">Open the Board</Link></div>
      </header>}
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
