/**
 * Background jobs (orders, payouts, rewards, the AI trader…) are started by the database's scheduler (pg_cron), which
 * sends the CRON_SECRET in an "x-cron-key" header. Anyone else calling the job links gets "Not allowed".
 * Until CRON_SECRET is set in Vercel the links stay open as before, so turning this on never stops the jobs.
 */
import { timingSafeEqual } from "crypto";

export function cronDenied(req: Request): Response | null {
  const want = (process.env.CRON_SECRET || "").trim();
  if (!want) return null;
  const got = (req.headers.get("x-cron-key") || "").trim();
  const a = Buffer.from(got), b = Buffer.from(want);
  if (a.length === b.length && timingSafeEqual(a, b)) return null;
  return new Response(JSON.stringify({ error: "Not allowed." }), { status: 401, headers: { "content-type": "application/json" } });
}
