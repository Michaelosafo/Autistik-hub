import { json } from "@/lib/ai";
import { runInstantKeeper } from "@/lib/instant-keeper";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every 30 minutes by the database's scheduler (supabase/instant-fees.sql). Anyone can call it, but it runs at
// most once every 25 minutes, and all it can do is pay Instant coins' fees to their creators, holders and AUTISTIK.
export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "not set up" }, 503);
  const { data: go } = await supabaseService().rpc("instant_keeper_lease", { p_seconds: 1500 });
  if (go !== true) return json({ skipped: true });
  return json(await runInstantKeeper(Date.now() + 50_000).catch((e) => ({ error: (e as Error).message })));
}
