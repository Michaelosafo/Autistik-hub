import Link from "next/link";
import HostRoom from "@/components/rooms/HostRoom";
import LiveNow from "@/components/rooms/LiveNow";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live rooms · AUTISTIK Hub", description: "Host or join a live audio room, like an X Space." };

export default async function SpacesPage({ searchParams }: { searchParams: { host?: string } }) {
  const user = await currentUser();
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <header className="bd-top ln-top">
        <div>
          <h1>Live rooms</h1>
          <p className="muted">Talk live with the community, like an X Space. Host one, or join and raise your hand to speak.</p>
        </div>
        <div className="ln-top-r"><Link href="/mood" className="ln-ghost">Autistik Mood</Link></div>
      </header>
      {!user ? (
        <div className="card stack" style={{ alignItems: "flex-start" }}>
          <p style={{ margin: 0 }}>Sign in to host or join a live room.</p>
          <Link className="btn primary" href="/login?next=/spaces">Sign in / Join</Link>
        </div>
      ) : (
        <>
          <HostRoom open={searchParams.host === "1"} />
          <section className="card stack"><b>Live now</b><LiveNow max={20} /></section>
          <small className="muted">Be kind. Hosts can move anyone back to listening. Use headphones to avoid echo.</small>
        </>
      )}
    </div>
  );
}
