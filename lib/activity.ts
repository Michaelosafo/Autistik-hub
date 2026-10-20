/** What members do on the site, for the admin's Site activity panel. Server only; never blocks or throws. */
import { supabaseService } from "@/lib/supabase/server";

export function logActivity(userId: string | null | undefined, kind: string, label?: string, link?: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const safeLink = link && /^\/[A-Za-z0-9/_-]*$/.test(link) ? link : null;
  supabaseService().from("activity_log").insert({ user_id: userId ?? null, kind: kind.slice(0, 30), label: label?.slice(0, 200) ?? null, link: safeLink })
    .then(({ error }) => { if (error) console.error("activity log failed:", error.message); });
}
