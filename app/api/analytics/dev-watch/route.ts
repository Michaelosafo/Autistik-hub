import { json } from "@/lib/ai";
import { cronDenied } from "@/lib/cron-auth";
import { runDevWatch } from "@/lib/dev-watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every 5 minutes (pg_cron job autistik-dev-watch): re-check followed devs and alert about their new tokens. */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "not set up" }, 503);
  return json(await runDevWatch(Date.now() + 45_000));
}
