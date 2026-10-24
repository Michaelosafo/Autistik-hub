import { json } from "@/lib/ai";
import { VANITY_SUFFIX, grind } from "@/lib/solana-vanity";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How many ready "tik" addresses to keep for Solana launches. */
const POOL = 20;

// Called every 5 minutes by the database's scheduler (supabase/sol-vanity.sql). Anyone can call it, but it runs at
// most once every 4 minutes however often it's called, and stops once the pool is full.
export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "not set up" }, 503);
  const sb = supabaseService();
  const { count } = await sb.from("sol_vanity_mints").select("pubkey", { count: "exact", head: true });
  if ((count ?? 0) >= POOL) return json({ ready: count, skipped: true });
  const { data: go } = await sb.rpc("vanity_lease", { p_seconds: 240 });
  if (go !== true) return json({ skipped: true });

  const end = Date.now() + 45_000;
  let found = 0;
  for (let have = count ?? 0; have < POOL && Date.now() < end; ) {
    const kp = grind(end - Date.now());
    if (!kp) break;
    const { error } = await sb.from("sol_vanity_mints").insert({ pubkey: kp.publicKey.toBase58(), seed: Buffer.from(kp.secretKey.subarray(0, 32)).toString("base64") });
    if (!error) { found++; have++; }
  }
  return json({ suffix: VANITY_SUFFIX, found, ready: (count ?? 0) + found });
}
