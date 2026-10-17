import { json } from "@/lib/ai";
import { runMomentum } from "@/lib/momentum-server";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every 5 minutes by the database's scheduler (supabase/analytics.sql). Anyone can call it, but it only runs
// once every 4 minutes however often it's called, and it only reads public market data.
export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "not set up" }, 503);
  const { data: go } = await supabaseService().rpc("momentum_lease", { p_seconds: 240 });
  if (go !== true) return json({ skipped: true });
  return json(await runMomentum(Date.now() + 40_000).catch((e) => ({ error: (e as Error).message })));
}
