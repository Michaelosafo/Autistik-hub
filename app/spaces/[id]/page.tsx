import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveSlot } from "@/components/rooms/LiveDock";
import EndedRoom from "@/components/rooms/EndedRoom";
import InviteLink from "@/components/rooms/InviteLink";
import { currentUser, supabaseServer, supabaseService } from "@/lib/supabase/server";
import { PRIVY_APP_ID, walletMember } from "@/lib/privy-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live room · AUTISTIK Hub" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RoomPage({ params, searchParams }: { params: { id: string }; searchParams: { key?: string } }) {
  if (!UUID.test(params.id)) notFound();
  const user = await currentUser();
  const sb = supabaseServer();
  const sel = "*,host:profiles!live_rooms_host_id_fkey(alias)";
  let { data: room } = await sb.from("live_rooms").select(sel).eq("id", params.id).maybeSingle();

  // A private live you can't see yet: the host's invite link (?key=…) lets you in while it's on.
  if (!room) {
    const svc = supabaseService();
    const { data: hidden } = await svc.from("live_rooms").select("id,title,ended_at,visibility").eq("id", params.id).maybeSingle();
    if (!hidden) notFound();
    const key = String(searchParams.key || "").slice(0, 64);
    const { data: ok } = key ? await svc.from("live_room_keys").select("room_id").eq("room_id", params.id).eq("code", key).maybeSingle() : { data: null };
    if (!user) {
      if (ok) return <SignInFirst title={hidden.title} next={`/spaces/${params.id}?key=${key}`} isPrivate />;
      return (
        <div className="card stack" style={{ maxWidth: 560, alignItems: "flex-start" }}>
          <b>🔒 A private live</b>
          <p className="muted" style={{ margin: 0 }}>Only people with the host&apos;s invite link can join.</p>
        </div>
      );
    }
    if (!ok || hidden.ended_at) {
      return (
        <div className="card stack" style={{ maxWidth: 560, alignItems: "flex-start" }}>
          <b>🔒 {hidden.ended_at ? "This private live has ended" : "This live is private"}</b>
          <p className="muted" style={{ margin: 0 }}>{hidden.ended_at ? "Only the people who were in it can see its summary, comments and recording." : "Only people with the host's invite link can join. Ask the host to send it to you."}</p>
          <Link className="btn" href="/spaces">See public lives</Link>
        </div>
      );
    }
    await svc.from("live_room_attendance").upsert({ room_id: params.id, user_id: user.id }, { onConflict: "room_id,user_id", ignoreDuplicates: true });
    ({ data: room } = await sb.from("live_rooms").select(sel).eq("id", params.id).maybeSingle());
    if (!room) notFound();
  }
  const r = room as any;

  // Ended: the recording and the comments, for everyone (signed in or not).
  if (r.ended_at) {
    const [{ data: recs }, me, { data: summary }] = await Promise.all([
      sb.from("live_recordings").select("id,url,duration_s,title").eq("room_id", params.id).order("created_at"),
      user ? sb.from("profiles").select("id,alias,color,avatar_url").eq("id", user.id).maybeSingle().then((x) => x.data) : Promise.resolve(null),
      sb.rpc("live_room_summary", { rid: params.id }),
    ]);
    const host = (Array.isArray(r.host) ? r.host[0] : r.host)?.alias || "a member";
    return (
      <div style={{ maxWidth: 820 }}>
        <EndedRoom room={{ id: r.id, title: r.title, created_at: r.created_at, ended_at: r.ended_at, visibility: r.visibility }} host={host} recs={(recs || []) as any} me={me as any} summary={(summary as any) || null} />
      </div>
    );
  }

  if (!user) return <SignInFirst title={r.title} next={`/spaces/${params.id}`} />;
  // You opened it while it's on: you count as having attended (for the summary, and to see a private live after).
  const isHost = r.host_id === user.id;
  const [{ data: me }, member, , key] = await Promise.all([
    sb.from("profiles").select("id,alias,color,avatar_url,is_verified,is_team,verified_badge").eq("id", user.id).maybeSingle(),
    PRIVY_APP_ID ? walletMember().catch(() => null) : Promise.resolve(null),
    supabaseService().from("live_room_attendance").upsert({ room_id: params.id, user_id: user.id }, { onConflict: "room_id,user_id", ignoreDuplicates: true }),
    isHost && r.visibility === "private" ? sb.from("live_room_keys").select("code").eq("room_id", params.id).maybeSingle().then((x) => x.data?.code ?? null) : Promise.resolve(null),
  ]);
  const info = { id: r.id, title: r.title, host_id: r.host_id, ended_at: r.ended_at, chain: r.chain ?? null, token: r.token ?? null, cohosts: r.cohosts ?? [], speakers: r.speakers ?? [] };
  return (
    <div style={{ maxWidth: 820 }}>
      {key && <InviteLink roomId={r.id} code={key} />}
      <LiveSlot room={info} me={{ id: user.id, alias: me?.alias || "Member", color: me?.color ?? null, avatar_url: me?.avatar_url ?? null, is_verified: !!(me as any)?.is_verified && !(me as any)?.is_team, verified_badge: (me as any)?.verified_badge ?? null, wallet: { appId: PRIVY_APP_ID || null, member } }} />
    </div>
  );
}

/** Opened a live's link while signed out: say plainly that you need to sign in first, then come straight back. */
function SignInFirst({ title, next, isPrivate }: { title: string; next: string; isPrivate?: boolean }) {
  const n = encodeURIComponent(next);
  return (
    <div className="card stack lv-gate" style={{ maxWidth: 560, alignItems: "flex-start" }}>
      <span className="room-live"><i />{isPrivate ? "Private live · you're invited" : "Live now"}</span>
      <b className="lv-gate-t">{title}</b>
      <p style={{ margin: 0 }}><b>Please sign in or log in before you can join this live.</b></p>
      <p className="muted" style={{ margin: 0 }}>You need an AUTISTIK account to listen, comment and speak. After you sign in, you come straight back to this live.</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Link className="btn primary" href={`/login?next=${n}`}>Log in to join</Link>
        <Link className="btn" href={`/login?mode=join&next=${n}`}>Create a free account</Link>
      </div>
    </div>
  );
}
