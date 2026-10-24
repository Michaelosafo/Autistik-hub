import { json } from "@/lib/ai";
import { deployerOf, grindSalt } from "@/lib/evm-vanity";
import { CHAINS, EVM_VANITY_SUFFIX, type ChainKey } from "@/lib/launchpad";
import { padInfo } from "@/lib/launchpad-server";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How many ready salts to keep for each v3 Launch Pad. */
const POOL = 10;

// Called every 5 minutes by the database's scheduler (supabase/evm-vanity.sql). Anyone can call it, but it runs at
// most once every 4 minutes however often it's called, and stops once every pool is full.
export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "not set up" }, 503);
  const sb = supabaseService();
  const { pads, versions } = await padInfo(true);
  const v3 = (Object.keys(pads) as ChainKey[]).filter((c) => versions[c] === 3 && CHAINS[c]?.kind !== "solana");
  if (!v3.length) return json({ skipped: "no v3 Launch Pad yet" });

  // Emptiest pool first, so every chain gets salts.
  const counts = await Promise.all(v3.map(async (chain) => {
    const { count } = await sb.from("evm_vanity_salts").select("salt", { count: "exact", head: true }).eq("chain", chain).eq("pad", pads[chain]!);
    return { chain, pad: pads[chain]!, have: count ?? 0 };
  }));
  const todo = counts.filter((c) => c.have < POOL).sort((a, b) => a.have - b.have);
  if (!todo.length) return json({ ready: counts, skipped: true });
  const { data: go } = await sb.rpc("evm_vanity_lease", { p_seconds: 240 });
  if (go !== true) return json({ skipped: true });

  const end = Date.now() + 45_000;
  const found: Record<string, number> = {};
  for (let k = 0; Date.now() < end && todo.some((c) => c.have < POOL); k++) {
    const c = todo.filter((x) => x.have < POOL)[k % todo.filter((x) => x.have < POOL).length];
    const deployer = await deployerOf(c.chain, c.pad).catch(() => null);
    if (!deployer) { c.have = POOL; continue; } // chain unreachable right now: try again next run
    // Only all-capitals "AAAAA" addresses go in the pool (about 30 seconds each).
    const s = await grindSalt(deployer, Math.min(40_000, end - Date.now()));
    if (!s?.caps) continue;
    const { error } = await sb.from("evm_vanity_salts").insert({ salt: s.salt, chain: c.chain, pad: c.pad, token: s.token });
    if (!error) { c.have++; found[c.chain] = (found[c.chain] ?? 0) + 1; }
  }
  return json({ suffix: EVM_VANITY_SUFFIX.toUpperCase(), found, ready: todo.map((c) => ({ chain: c.chain, have: Math.min(c.have, POOL) })) });
}
