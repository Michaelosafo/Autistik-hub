import { json } from "@/lib/ai";
import { runChecks } from "@/lib/analytics";
import { runSignals } from "@/lib/analytics-alerts";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every 10 minutes by the database's scheduler (supabase/analytics.sql). Anyone can call it, but it only
// runs once every 4 minutes however often it's called, and it only reads public blockchain data.
export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "not set up" }, 503);
  const { data: go } = await supabaseService().rpc("analytics_lease", { p_seconds: 240 });
  if (go !== true) return json({ skipped: true });
  const result = await runChecks(Date.now() + 35_000);
  // Then buy / take-profit / sell alerts for pinned tokens, using the fresh balances and trades.
  const signals = await runSignals(Date.now() + 15_000).catch((e) => ({ error: (e as Error).message }));
  return json({ ...result, signals });
}
