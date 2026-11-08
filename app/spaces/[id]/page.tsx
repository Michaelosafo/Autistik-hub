import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveSlot } from "@/components/rooms/LiveDock";
import EndedRoom from "@/components/rooms/EndedRoom";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live room · AUTISTIK Hub" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RoomPage({ params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) notFound();
  const user = await currentUser();
  const sb = supabaseServer();
  const { data: room } = await sb.from("live_rooms").select("*,host:profiles!live_rooms_host_id_fkey(alias)").eq("id", params.id).maybeSingle();
  if (!room) notFound();
  const r = room as any;

  // Ended: the recording and the comments, for everyone (signed in or not).
  if (r.ended_at) {
    const [{ data: recs }, me] = await Promise.all([
      sb.from("live_recordings").select("id,url,duration_s,title").eq("room_id", params.id).order("created_at"),
      user ? sb.from("profiles").select("id,alias,color,avatar_url").eq("id", user.id).maybeSingle().then((x) => x.data) : Promise.resolve(null),
    ]);
    const host = (Array.isArray(r.host) ? r.host[0] : r.host)?.alias || "a member";
    return (
      <div style={{ maxWidth: 820 }}>
        <EndedRoom room={{ id: r.id, title: r.title, created_at: r.created_at, ended_at: r.ended_at }} host={host} recs={(recs || []) as any} me={me as any} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="card stack" style={{ maxWidth: 560, alignItems: "flex-start" }}>
        <b>Join the live: {r.title}</b>
        <p className="muted" style={{ margin: 0 }}>Sign in with your AUTISTIK account to listen, comment and speak.</p>
        <Link className="btn primary" href={`/login?next=/spaces/${params.id}`}>Sign in / Join</Link>
      </div>
    );
  }
  const { data: me } = await sb.from("profiles").select("id,alias,color,avatar_url,is_verified,is_team,verified_badge").eq("id", user.id).maybeSingle();
  const info = { id: r.id, title: r.title, host_id: r.host_id, ended_at: r.ended_at, chain: r.chain ?? null, token: r.token ?? null, cohosts: r.cohosts ?? [], speakers: r.speakers ?? [] };
  return (
    <div style={{ maxWidth: 820 }}>
      <LiveSlot room={info} me={{ id: user.id, alias: me?.alias || "Member", color: me?.color ?? null, avatar_url: me?.avatar_url ?? null, is_verified: !!(me as any)?.is_verified && !(me as any)?.is_team, verified_badge: (me as any)?.verified_badge ?? null }} />
    </div>
  );
}
