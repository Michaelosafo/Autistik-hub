import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { rateLimit } from "@/lib/ratelimit";
import { currentUser, supabaseService } from "@/lib/supabase/server";
import { deleteLiveInput, deleteVideo, liveInputInfo, liveRecording, newLiveInput, streamReady, uploadUrl, videoInfo } from "@/lib/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * TIK videos (Cloudflare Stream). The server is the only one that creates or changes a video row; members read
 * public videos, like and comment straight from the database (RLS).
 * POST upload | sync | live-start | live-whip | live-on | live-end | view | delete | hide.  GET live (live streams now).
 */
const MAX_SECONDS = { video: 30 * 60, fun: 90 } as const;
const UUID = /^[0-9a-f-]{36}$/i;
const clean = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

type Row = { id: string; author_id: string; kind: string; cf_uid: string | null; rec_uid: string | null; status: string; created_at: string; started_at: string | null; updated_at: string; hidden: boolean };

/** Brings a row up to date with Cloudflare: upload finished, stream live or over, recording ready. */
async function sync(v: Row): Promise<Partial<Row> & { whep?: string | null }> {
  const up: Record<string, unknown> = {};
  let whep: string | null = null;
  if (!v.cf_uid) return up;
  if (v.kind !== "stream") {
    if (v.status === "ready" || v.status === "failed") return up;
    const i = await videoInfo(v.cf_uid).catch(() => null);
    if (!i) return up;
    const st = i.status?.state;
    if (i.readyToStream) Object.assign(up, { status: "ready", duration: i.duration ?? null, width: i.input?.width ?? null, height: i.input?.height ?? null });
    else if (st === "error") up.status = "failed";
    else if (st && st !== "pendingupload") up.status = "processing";
    else if (Date.now() - Date.parse(v.created_at) > 3 * 3600_000) up.status = "failed"; // never uploaded
  } else {
    if (v.status === "waiting" || v.status === "live") {
      const i = await liveInputInfo(v.cf_uid).catch(() => null);
      whep = i?.whep ?? null;
      if (i?.connected && v.status === "waiting") Object.assign(up, { status: "live", started_at: new Date().toISOString() });
      // Off air for over a minute (or never started within 2 hours): the stream is over.
      const quiet = Date.now() - Date.parse(v.updated_at) > 90_000;
      if (i && !i.connected && v.status === "live" && quiet) Object.assign(up, { status: "ended", ended_at: new Date().toISOString() });
      if (v.status === "waiting" && Date.now() - Date.parse(v.created_at) > 2 * 3600_000) up.status = "failed";
    }
    if ((v.status === "ended" || up.status === "ended") && !v.rec_uid) {
      const rec = await liveRecording(v.cf_uid);
      if (rec) up.rec_uid = rec;
    }
  }
  if (Object.keys(up).length) {
    up.updated_at = new Date().toISOString();
    await supabaseService().from("videos").update(up).eq("id", v.id);
  }
  return { ...(up as Partial<Row>), whep };
}

async function loadRow(id: unknown): Promise<Row | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const { data } = await supabaseService().from("videos").select("id,author_id,kind,cf_uid,rec_uid,status,created_at,started_at,updated_at,hidden").eq("id", id).maybeSingle();
  return (data as Row) || null;
}

export async function GET(req: Request, { params }: { params: { action: string } }) {
  if (params.action !== "live") return json({ error: "Not found." }, 404);
  const slow = await rateLimit(req, "videos-live", 60, 60);
  if (slow) return slow;
  if (!streamReady()) return json({ ready: false, live: [] });
  const sb = supabaseService();
  const { data } = await sb.from("videos").select("id,author_id,kind,cf_uid,rec_uid,status,created_at,started_at,updated_at,hidden").eq("kind", "stream").in("status", ["live", "waiting"]).eq("hidden", false).limit(30);
  // Check streams that may have stopped without the host pressing End.
  await Promise.all(((data || []) as Row[]).filter((v) => Date.now() - Date.parse(v.updated_at) > 60_000).map((v) => sync(v).catch(() => null)));
  const { data: live } = await sb.from("videos").select("id,author_id,title,cf_uid,status,views,likes,comments,started_at,created_at").eq("kind", "stream").eq("status", "live").eq("hidden", false).order("started_at", { ascending: false }).limit(30);
  return json({ ready: true, live: live || [] });
}

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const a = params.action;
  const b = await req.json().catch(() => ({}));
  const sb = supabaseService();

  if (a === "view") {
    const v = await loadRow(b.id);
    if (!v) return json({ ok: true });
    // One view per visitor per video every 30 minutes.
    const again = await rateLimit(req, `video-view-${v.id}`, 1, 1800);
    if (!again) await sb.rpc("video_view", { p_id: v.id });
    return json({ ok: true });
  }
  if (a === "sync") {
    const v = await loadRow(b.id);
    if (!v) return json({ error: "Video not found." }, 404);
    if (!streamReady()) return json({ status: v.status });
    const slow = await rateLimit(req, "video-sync", 120, 60);
    if (slow) return slow;
    const up: Partial<Row> & { whep?: string | null } = await sync(v).catch(() => ({}));
    const status = up.status ?? v.status;
    // A live stream is watched over WebRTC (WHEP): its public playback address.
    return json({ status, rec_uid: up.rec_uid ?? v.rec_uid, whep: status === "live" || status === "waiting" ? up.whep ?? null : null });
  }

  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!streamReady()) return json({ error: "Videos aren't switched on yet." }, 503);

  switch (a) {
    case "upload": {
      const slow = await rateLimit(req, "video-upload", 12, 3600, user.id);
      if (slow) return slow;
      const kind = b.kind === "fun" ? "fun" : "video";
      const title = clean(b.title, 120);
      if (!title) return json({ error: "Give your video a title." }, 400);
      const { uploadURL, uid } = await uploadUrl({ name: title, maxSeconds: MAX_SECONDS[kind], author: user.id });
      const { data, error } = await sb.from("videos").insert({ author_id: user.id, kind, title, about: clean(b.about, 2000) || null, cf_uid: uid, status: "uploading" }).select("id").single();
      if (error) { await deleteVideo(uid); return json({ error: "Couldn't start the upload." }, 500); }
      return json({ id: data.id, uploadURL, maxSeconds: MAX_SECONDS[kind] });
    }
    case "live-start": {
      const slow = await rateLimit(req, "video-live", 6, 3600, user.id);
      if (slow) return slow;
      const title = clean(b.title, 120);
      if (!title) return json({ error: "Give your stream a title." }, 400);
      // One stream at a time per member.
      await sb.from("videos").update({ status: "ended", ended_at: new Date().toISOString() }).eq("author_id", user.id).eq("kind", "stream").in("status", ["waiting", "live"]);
      const { uid, whip } = await newLiveInput(title, user.id);
      const { data, error } = await sb.from("videos").insert({ author_id: user.id, kind: "stream", title, about: clean(b.about, 2000) || null, cf_uid: uid, status: "waiting" }).select("id").single();
      if (error) { await deleteLiveInput(uid); return json({ error: "Couldn't start the stream." }, 500); }
      return json({ id: data.id, whip });
    }
  }

  const v = await loadRow(b.id);
  if (!v) return json({ error: "Video not found." }, 404);
  const mine = v.author_id === user.id;
  const admin = !mine && (await adminState()).staff;
  if (!mine && !admin) return json({ error: "That's not your video." }, 403);

  switch (a) {
    case "live-whip": {
      if (!mine || v.kind !== "stream" || !v.cf_uid || !["waiting", "live"].includes(v.status)) return json({ error: "That stream is over." }, 400);
      const i = await liveInputInfo(v.cf_uid);
      return json({ whip: i.whip });
    }
    case "live-on": {
      if (!mine || v.kind !== "stream" || !["waiting", "live"].includes(v.status)) return json({ error: "That stream is over." }, 400);
      await sb.from("videos").update({ status: "live", started_at: v.started_at ?? new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", v.id);
      return json({ ok: true });
    }
    case "live-end": {
      if (v.kind !== "stream") return json({ error: "Not a stream." }, 400);
      await sb.from("videos").update({ status: v.started_at ? "ended" : "failed", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", v.id);
      return json({ ok: true });
    }
    case "delete": {
      if (v.kind === "stream") { if (v.cf_uid) await deleteLiveInput(v.cf_uid); if (v.rec_uid) await deleteVideo(v.rec_uid); }
      else if (v.cf_uid) await deleteVideo(v.cf_uid);
      await sb.from("videos").delete().eq("id", v.id);
      return json({ ok: true });
    }
    case "hide": {
      if (!admin && !(await adminState()).staff) return json({ error: "Admins only." }, 403);
      await sb.from("videos").update({ hidden: b.hidden !== false, updated_at: new Date().toISOString() }).eq("id", v.id);
      return json({ ok: true });
    }
  }
  return json({ error: "Not found." }, 404);
}
