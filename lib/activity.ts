/** What members do on the site, for the admin's Site activity panel. Server only; never blocks or throws. */
import { supabaseService } from "@/lib/supabase/server";

/** `chain` and `tx` need supabase/admin-activity.sql; until it's run the row is saved without them. */
export function logActivity(userId: string | null | undefined, kind: string, label?: string, link?: string, extra?: { chain?: string; tx?: string }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const safeLink = link && /^\/[A-Za-z0-9/_-]*$/.test(link) ? link : null;
  const row = { user_id: userId ?? null, kind: kind.slice(0, 30), label: label?.slice(0, 200) ?? null, link: safeLink };
  const sb = supabaseService();
  const full = extra?.chain || extra?.tx ? { ...row, chain: extra.chain ?? null, tx: extra.tx ?? null } : row;
  sb.from("activity_log").insert(full)
    .then(({ error }) => (error && full !== row && /column/i.test(error.message) ? sb.from("activity_log").insert(row) : { error }))
    .then(({ error }) => { if (error) console.error("activity log failed:", error.message); });
}
