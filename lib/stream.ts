/**
 * Cloudflare Stream: uploads (converted to play on any phone), short clips, and live video from the browser (WHIP),
 * recorded automatically. Set in Vercel: CF_ACCOUNT_ID, CF_STREAM_TOKEN (an API token with Stream: Edit) and
 * NEXT_PUBLIC_CF_STREAM_HOST (the "customer-xxxx.cloudflarestream.com" host shown in the Stream dashboard).
 * Server only: the token never reaches the browser.
 */
const ACCOUNT = (process.env.CF_ACCOUNT_ID || "").trim();
const TOKEN = (process.env.CF_STREAM_TOKEN || "").trim();
export const streamReady = () => !!ACCOUNT && !!TOKEN && !!process.env.NEXT_PUBLIC_CF_STREAM_HOST;
const API = () => `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream`;

async function cf<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  if (!streamReady()) throw new Error("Videos aren't switched on yet.");
  const r = await fetch(`${API()}${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers || {}) }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || j?.success === false) throw new Error(String(j?.errors?.[0]?.message || `Video service error (${r.status})`).slice(0, 160));
  return j?.result as T;
}

/** A one-time upload address for one file (basic upload, up to 200 MB). */
export async function uploadUrl(p: { name: string; maxSeconds: number; author: string }) {
  const r = await cf<{ uploadURL: string; uid: string }>("/direct_upload", {
    method: "POST",
    body: JSON.stringify({ maxDurationSeconds: p.maxSeconds, expiry: new Date(Date.now() + 60 * 60_000).toISOString(), requireSignedURLs: false, meta: { name: p.name.slice(0, 120), author: p.author } }),
  });
  return { uploadURL: r.uploadURL, uid: r.uid };
}

export type CfVideo = { uid: string; readyToStream: boolean; status?: { state?: string; errorReasonText?: string }; duration?: number; input?: { width?: number; height?: number } };
export const videoInfo = (uid: string) => cf<CfVideo>(`/${encodeURIComponent(uid)}`);
export const deleteVideo = (uid: string) => cf(`/${encodeURIComponent(uid)}`, { method: "DELETE" }).catch(() => null);

/** A live input: the host broadcasts from the browser to its WHIP address; it's recorded automatically. */
export async function newLiveInput(name: string, author: string) {
  const r = await cf<{ uid: string; webRTC?: { url?: string } }>("/live_inputs", {
    method: "POST",
    body: JSON.stringify({ meta: { name: name.slice(0, 120), author }, recording: { mode: "automatic", timeoutSeconds: 60, requireSignedURLs: false } }),
  });
  if (!r.webRTC?.url) throw new Error("Couldn't set up the stream.");
  return { uid: r.uid, whip: r.webRTC.url };
}
export async function liveInputInfo(uid: string) {
  const r = await cf<{ uid: string; webRTC?: { url?: string }; status?: { current?: { state?: string } } | null }>(`/live_inputs/${encodeURIComponent(uid)}`);
  return { whip: r.webRTC?.url ?? null, connected: r.status?.current?.state === "connected" };
}
/** The newest recording of a live input, once there is one. */
export async function liveRecording(uid: string): Promise<string | null> {
  const list = await cf<CfVideo[]>(`/live_inputs/${encodeURIComponent(uid)}/videos`).catch(() => [] as CfVideo[]);
  return list?.[0]?.uid ?? null;
}
export const deleteLiveInput = (uid: string) => cf(`/live_inputs/${encodeURIComponent(uid)}`, { method: "DELETE" }).catch(() => null);
