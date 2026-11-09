/** Video players and thumbnails (browser and server). The host comes from NEXT_PUBLIC_CF_STREAM_HOST. */
export const STREAM_HOST = (process.env.NEXT_PUBLIC_CF_STREAM_HOST || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
export const videosOn = () => !!STREAM_HOST;
export const playerUrl = (uid: string, o: { autoplay?: boolean; muted?: boolean; loop?: boolean; controls?: boolean } = {}) => {
  const q = new URLSearchParams();
  if (o.autoplay) q.set("autoplay", "true");
  if (o.muted) q.set("muted", "true");
  if (o.loop) q.set("loop", "true");
  if (o.controls === false) q.set("controls", "false");
  q.set("preload", "metadata");
  return `https://${STREAM_HOST}/${uid}/iframe?${q}`;
};
export const thumbUrl = (uid: string, h = 360) => `https://${STREAM_HOST}/${uid}/thumbnails/thumbnail.jpg?time=2s&height=${h}`;
export type Video = {
  id: string; author_id: string; kind: "video" | "fun" | "stream"; title: string; about: string | null; cf_uid: string | null; rec_uid: string | null;
  status: string; duration: number | null; views: number; likes: number; comments: number; created_at: string; started_at: string | null; ended_at: string | null;
};
/** What plays for a video: the upload itself, a live stream's live input, or a finished stream's recording. */
export const playUid = (v: Pick<Video, "kind" | "status" | "cf_uid" | "rec_uid">) => (v.kind === "stream" && v.status !== "live" ? v.rec_uid : v.cf_uid);
export const fmtDur = (s: number | null) => (s == null || s < 0 ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
export const fmtCount = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
