"use client";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Video } from "@/lib/stream-shared";

export type Author = { id: string; alias: string; color: string; avatar_url: string | null };
export type VideoRow = Video & { author?: Author | null };
const COLS = "id,author_id,kind,title,about,cf_uid,rec_uid,status,duration,views,likes,comments,created_at,started_at,ended_at";

/** Adds each video's author (profiles are readable by signed-in members; signed-out visitors see "Member"). */
export async function withAuthors(list: Video[]): Promise<VideoRow[]> {
  const ids = [...new Set(list.map((v) => v.author_id))];
  if (!ids.length) return list;
  const { data } = await supabaseBrowser().from("profiles").select("id,alias,color,avatar_url").in("id", ids);
  const by = new Map(((data || []) as Author[]).map((a) => [a.id, a]));
  return list.map((v) => ({ ...v, author: by.get(v.author_id) ?? null }));
}
export async function listVideos(kind: "video" | "fun" | "stream", opts: { status?: string[]; limit?: number; author?: string } = {}): Promise<VideoRow[]> {
  let q = supabaseBrowser().from("videos").select(COLS).eq("kind", kind).in("status", opts.status ?? ["ready"]).order("created_at", { ascending: false }).limit(opts.limit ?? 30);
  if (opts.author) q = q.eq("author_id", opts.author);
  const { data } = await q;
  return withAuthors((data || []) as Video[]);
}
export const ago = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : m < 43200 ? `${Math.round(m / 1440)}d ago` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
export async function videoApi<T = any>(action: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/videos/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong. Try again.");
  return j as T;
}
