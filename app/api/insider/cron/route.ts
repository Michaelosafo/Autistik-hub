import { json } from "@/lib/ai";
import { cronDenied } from "@/lib/cron-auth";
import { ingestPushed, runInsider } from "@/lib/insider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every minute from the database scheduler, or from a Railway worker that holds the X stream. */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  return json(await runInsider(Date.now() + 48_000).catch((e) => ({ error: (e as Error).message })));
}

/** Posts already read by a long-lived worker (X filtered stream or a held Telegram session). */
export async function POST(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  const b = await req.json().catch(() => null);
  const posts = Array.isArray(b?.posts) ? b.posts : [];
  return json(await ingestPushed(posts).catch((e) => ({ error: (e as Error).message })));
}
