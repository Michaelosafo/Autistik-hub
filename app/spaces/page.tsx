import Link from "next/link";
import Avatar from "@/components/Avatar";
import HostRoom from "@/components/rooms/HostRoom";
import LiveNow from "@/components/rooms/LiveNow";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live rooms · AUTISTIK Hub", description: "Host or join a live audio room on AUTISTIK, talk with the community, and drop tokens to your listeners." };

const len = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.max(1, Math.round(s / 60))} min`);
const day = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function SpacesPage({ searchParams }: { searchParams: { host?: string } }) {
  const user = await currentUser();
  const sb = supabaseServer();
  // Past lives: the ones that went on for at least a minute, or were recorded.
  const { data } = await sb.from("live_rooms")
    .select("id,title,created_at,ended_at,host:profiles!live_rooms_host_id_fkey(alias,color,avatar_url),live_recordings(id,duration_s)")
    .not("ended_at", "is", null).order("ended_at", { ascending: false }).limit(60);
  const past = ((data || []) as any[])
    .map((r) => ({ ...r, host: Array.isArray(r.host) ? r.host[0] : r.host, secs: Math.round((Date.parse(r.ended_at) - Date.parse(r.created_at)) / 1000), rec: (r.live_recordings || [])[0] || null }))
    .filter((r) => r.secs >= 60 || r.rec)
    .slice(0, 20);

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <header className="bd-top ln-top">
        <div>
          <h1>Live rooms</h1>
          <p className="muted">Talk live with the community. Host one, or join, comment, and raise your hand to speak.</p>
        </div>
        <div className="ln-top-r"><Link href="/mood" className="ln-ghost">TIK</Link></div>
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
        </>
      )}
      <section className="card stack">
        <b>Past lives</b>
        {!past.length ? <small className="muted">No past lives yet.</small> : (
          <div className="lv-past">
            {past.map((r) => (
              <Link key={r.id} href={`/spaces/${r.id}`} className="lv-past-row">
                <Avatar className="avatar lv-av xs" alias={r.host?.alias || "Member"} color={r.host?.color ?? null} url={r.host?.avatar_url ?? null} />
                <span className="lv-past-t"><b>{r.title}</b><small className="muted">{r.host?.alias || "A member"} · {day(r.created_at)} · {len(r.secs)}</small></span>
                <span className={"lv-past-tag" + (r.rec ? " rec" : "")}>{r.rec ? "▶ Recording" : "Comments"}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
      {user && <small className="muted">Be kind. Hosts can mute anyone or move them back to listening. Use headphones to avoid echo. Your live keeps playing while you browse the site.</small>}
    </div>
  );
}
