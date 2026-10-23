import { json } from "@/lib/ai";
import { runReleaseKeeper } from "@/lib/release-keeper";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every 5 minutes by the database's scheduler (supabase/auto-release.sql). Anyone can call it, but it only
// runs once every 4 minutes, and all it can do is send due locks and liquidity to their owners.
export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "not set up" }, 503);
  const { data: go } = await supabaseService().rpc("release_keeper_lease", { p_seconds: 240 });
  if (go !== true) return json({ skipped: true });
  return json(await runReleaseKeeper(Date.now() + 50_000).catch((e) => ({ error: (e as Error).message })));
}
