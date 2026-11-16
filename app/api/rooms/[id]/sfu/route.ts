import { json } from "@/lib/ai";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Voice relay for big lives (Cloudflare Realtime SFU). Each phone makes ONE connection to Cloudflare: speakers send
 * their voice up once, and Cloudflare copies it to every listener. That is what lets a room hold 1,000+ people without
 * a speaker's phone choking (before, every speaker sent a separate copy of their voice to every listener).
 *
 * Set in Vercel: CLOUDFLARE_SFU_APP_ID + CLOUDFLARE_SFU_APP_TOKEN (Cloudflare dashboard → Realtime → SFU → Create app).
 * Not set: GET says { on: false } and rooms keep the phone-to-phone voice (fine for small rooms).
 *
 * The app token never leaves the server. Only members who can see the room (public, or invited to a private one) can
 * use it, so a private live's voices stay private.
 */
const APP = () => (process.env.CLOUDFLARE_SFU_APP_ID || "").trim();
const TOKEN = () => (process.env.CLOUDFLARE_SFU_APP_TOKEN || "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SID = /^[A-Za-z0-9_-]{8,128}$/;
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const MID = /^[A-Za-z0-9_-]{1,16}$/;

async function allowed(roomId: string, userId: string) {
  const sb = supabaseService();
  const { data: r } = await sb.from("live_rooms").select("id,host_id,visibility,cohosts,speakers,ended_at").eq("id", roomId).maybeSingle();
  if (!r || r.ended_at) return false;
  if (r.visibility !== "private" || r.host_id === userId || (r.cohosts || []).includes(userId) || (r.speakers || []).includes(userId)) return true;
  const [a, m] = await Promise.all([
    sb.from("live_room_attendance").select("user_id").eq("room_id", roomId).eq("user_id", userId).maybeSingle(),
    sb.from("live_room_members").select("user_id").eq("room_id", roomId).eq("user_id", userId).maybeSingle(),
  ]);
  return !!(a.data || m.data);
}

async function cf(method: "POST" | "PUT", path: string, body?: unknown) {
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(APP())}${path}`, {
    method, headers: { authorization: `Bearer ${TOKEN()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(12_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j?.errorCode) {
    console.warn(`[rooms/sfu] Cloudflare ${path.split("/").slice(-1)[0]} refused (${r.status}): ${j?.errorDescription || j?.errorCode || ""}`);
    return { error: "The voice relay didn't answer. Try again.", status: r.ok ? 502 : r.status >= 500 ? 502 : 400 };
  }
  return { data: j };
}

const desc = (d: any) => (d && (d.type === "offer" || d.type === "answer") && typeof d.sdp === "string" && d.sdp.length < 200_000 ? { type: d.type, sdp: d.sdp } : undefined);

export async function GET() {
  return json({ on: !!(APP() && TOKEN()) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!APP() || !TOKEN()) return json({ error: "Voice relay not set up." }, 503);
  if (!UUID.test(params.id)) return json({ error: "Unknown room." }, 404);
  const user = await currentUser().catch(() => null);
  if (!user) return json({ error: "Sign in first." }, 401);
  const b: any = await req.json().catch(() => ({}));
  if (!(await allowed(params.id, user.id))) return json({ error: "You can't join this live." }, 403);

  const op = String(b.op || "");
  if (op === "new") {
    const r = await cf("POST", "/sessions/new");
    return r.error ? json({ error: r.error }, r.status) : json({ sessionId: r.data.sessionId });
  }
  const sid = String(b.sessionId || "");
  if (!SID.test(sid)) return json({ error: "Bad session." }, 400);

  if (op === "tracks") {
    const tracks = (Array.isArray(b.tracks) ? b.tracks : []).slice(0, 24).map((t: any) =>
      t?.location === "local" && MID.test(String(t.mid)) && NAME.test(String(t.trackName)) ? { location: "local", mid: String(t.mid), trackName: String(t.trackName) }
      : t?.location === "remote" && SID.test(String(t.sessionId)) && NAME.test(String(t.trackName)) ? { location: "remote", sessionId: String(t.sessionId), trackName: String(t.trackName) }
      : null).filter(Boolean);
    if (!tracks.length) return json({ error: "No tracks." }, 400);
    const sessionDescription = desc(b.sessionDescription);
    const r = await cf("POST", `/sessions/${sid}/tracks/new`, sessionDescription ? { sessionDescription, tracks } : { tracks });
    return r.error ? json({ error: r.error }, r.status) : json(r.data);
  }
  if (op === "renegotiate") {
    const sessionDescription = desc(b.sessionDescription);
    if (!sessionDescription) return json({ error: "Bad answer." }, 400);
    const r = await cf("PUT", `/sessions/${sid}/renegotiate`, { sessionDescription });
    return r.error ? json({ error: r.error }, r.status) : json(r.data);
  }
  if (op === "close") {
    const tracks = (Array.isArray(b.tracks) ? b.tracks : []).slice(0, 24).filter((t: any) => MID.test(String(t?.mid))).map((t: any) => ({ mid: String(t.mid) }));
    if (!tracks.length) return json({ ok: true });
    const sessionDescription = desc(b.sessionDescription);
    const r = await cf("PUT", `/sessions/${sid}/tracks/close`, sessionDescription ? { tracks, sessionDescription, force: false } : { tracks, force: true });
    return r.error ? json({ error: r.error }, r.status) : json(r.data);
  }
  return json({ error: "Unknown step." }, 400);
}
