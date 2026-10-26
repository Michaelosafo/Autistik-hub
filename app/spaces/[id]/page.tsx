import Link from "next/link";
import { notFound } from "next/navigation";
import LiveRoom from "@/components/rooms/LiveRoom";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live room · AUTISTIK Hub" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RoomPage({ params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) notFound();
  const user = await currentUser();
  if (!user) {
    return (
      <div className="card stack" style={{ maxWidth: 560, alignItems: "flex-start" }}>
        <b>Join the live</b>
        <p className="muted" style={{ margin: 0 }}>Sign in with your AUTISTIK account to listen and speak.</p>
        <Link className="btn primary" href={`/login?next=/spaces/${params.id}`}>Sign in / Join</Link>
      </div>
    );
  }
  const sb = supabaseServer();
  const [{ data: room }, { data: me }] = await Promise.all([
    sb.from("live_rooms").select("id,title,host_id,ended_at").eq("id", params.id).maybeSingle(),
    sb.from("profiles").select("id,alias,color,avatar_url").eq("id", user.id).maybeSingle(),
  ]);
  if (!room) notFound();
  return (
    <div style={{ maxWidth: 820 }}>
      <LiveRoom room={room as any} me={{ id: user.id, alias: me?.alias || "Member", color: me?.color ?? null, avatar_url: me?.avatar_url ?? null }} />
    </div>
  );
}
