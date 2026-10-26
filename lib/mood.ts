/** Moods a Tik can carry (Autistik Mood). Words only, each with its own colour. */
export const MOODS = [
  { key: "happy", label: "Happy", color: "#F0B90B" },
  { key: "calm", label: "Calm", color: "#3FCABB" },
  { key: "excited", label: "Excited", color: "#FF6B9A" },
  { key: "proud", label: "Proud", color: "#B57CFF" },
  { key: "grateful", label: "Grateful", color: "#4FA3FF" },
  { key: "focused", label: "Focused", color: "#2EBD85" },
  { key: "tired", label: "Tired", color: "#8F84AA" },
  { key: "anxious", label: "Anxious", color: "#FF9A4D" },
  { key: "sad", label: "Sad", color: "#6C8EBF" },
  { key: "overwhelmed", label: "Overwhelmed", color: "#E5484D" },
] as const;
export type MoodKey = (typeof MOODS)[number]["key"];
export const moodOf = (k: string | null | undefined) => MOODS.find((m) => m.key === k) || null;

export type TikAuthor = { id: string; alias: string; color: string | null; avatar_url: string | null; is_team?: boolean; is_verified?: boolean; handle?: string | null };
export type Tik = {
  id: string; body: string; mood: string | null; image_url: string | null; created_at: string; author_id: string; reply_to: string | null;
  author: TikAuthor | null; likes: number; replies: number; liked: boolean;
};

export const TIK_COLS = "id,body,mood,image_url,created_at,author_id,reply_to,author:profiles!tiks_author_id_fkey(id,alias,color,avatar_url,is_team,is_verified,handle),tik_likes(count),replies:tiks!reply_to(count)";

export function ago(iso: string) {
  const s = Math.max(1, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

/** Turns rows from Supabase into Tiks, with this member's likes marked. */
export function shapeTiks(rows: any[], mine: Set<string>): Tik[] {
  return rows.map((r) => ({
    id: r.id, body: r.body, mood: r.mood, image_url: r.image_url, created_at: r.created_at, author_id: r.author_id, reply_to: r.reply_to,
    author: Array.isArray(r.author) ? r.author[0] ?? null : r.author ?? null,
    likes: r.tik_likes?.[0]?.count ?? 0, replies: r.replies?.[0]?.count ?? 0, liked: mine.has(r.id),
  }));
}
