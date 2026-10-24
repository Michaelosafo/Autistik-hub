import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberLite } from "@/components/members/MemberName";

// Team columns arrive with supabase/members-live.sql. Until it's run, profiles load without them.
const PHOTO = "id,alias,color,is_admin,created_at,is_team,team_title,handle,holdings_share,is_verified,avatar_url";
const FULL = "id,alias,color,is_admin,created_at,is_team,team_title,handle,holdings_share,is_verified";
const MID = "id,alias,color,is_admin,created_at,is_team,team_title";
const BASIC = "id,alias,color,is_admin,created_at";

export async function loadProfiles(sb: SupabaseClient, ids?: string[], extra?: (q: any) => any): Promise<(MemberLite & { is_admin: boolean; created_at: string; holdings_share?: string })[]> {
  const run = (cols: string) => {
    let q: any = sb.from("profiles").select(cols);
    if (ids) q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    return extra ? extra(q) : q;
  };
  let { data, error } = await run(PHOTO);
  if (error && /column/i.test(error.message)) ({ data, error } = await run(FULL));
  if (error && /column/i.test(error.message)) ({ data, error } = await run(MID));
  if (error && /column/i.test(error.message)) ({ data } = await run(BASIC));
  return (data || []) as any;
}

export type MemberCard = { followers: number; following: number; i_follow: boolean; follows_me: boolean; wallet: boolean; lives: number };
export async function memberCard(sb: SupabaseClient, id: string): Promise<MemberCard | null> {
  const { data, error } = await sb.rpc("member_card", { p_id: id });
  return error || !data ? null : (data as MemberCard);
}

export type Activity = { at: string; kind: string; label: string | null; link: string | null };
export async function memberActivity(sb: SupabaseClient, id: string, limit = 30): Promise<Activity[] | null> {
  const { data, error } = await sb.rpc("member_activity", { p_id: id, p_limit: limit });
  return error ? null : ((data || []) as Activity[]);
}

/** What each kind of activity says on a profile. Swaps, trades and wallet money are never in the list. */
export const ACTIVITY: Record<string, { icon: string; verb: string }> = {
  scan: { icon: "🔎", verb: "Scanned" },
  launch: { icon: "🚀", verb: "" },
  launchpad: { icon: "🚀", verb: "" },
  lock: { icon: "🔒", verb: "" },
  locker: { icon: "🔒", verb: "" },
  pin: { icon: "⭐", verb: "Added to watchlist:" },
  post: { icon: "💬", verb: "Posted:" },
  live: { icon: "🎙️", verb: "Joined live:" },
  follow: { icon: "➕", verb: "Followed" },
};

export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
