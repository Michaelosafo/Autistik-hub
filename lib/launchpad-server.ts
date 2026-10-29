/**
 * Where the AUTISTIK Launch Pad lives on each chain, and which version it is (3 = token addresses ending in "aaaaa"). Saved by the team's one-click deploy (checked on-chain)
 * and read here by pages and API routes. Server only.
 */
import { getAddress, isAddress } from "viem";
import { supabaseService } from "@/lib/supabase/server";
import { CHAINS, type ChainKey, type Pads } from "@/lib/launchpad";

let cache: { at: number; pads: Pads; burners: Partial<Record<ChainKey, string>>; versions: Partial<Record<ChainKey, number>>; instants: Partial<Record<ChainKey, `0x${string}`>> } | null = null;

export async function padInfo(fresh = false) {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache;
  // "*" so this keeps working before the version column exists (supabase/evm-vanity.sql).
  const { data } = await supabaseService().from("launchpad_contracts").select("*");
  const pads: Pads = {}, burners: Partial<Record<ChainKey, string>> = {}, versions: Partial<Record<ChainKey, number>> = {}, instants: Partial<Record<ChainKey, `0x${string}`>> = {};
  for (const r of data || []) {
    if (!(r.chain in CHAINS) || !isAddress(r.address)) continue;
    // A row can hold just the burner (deployed first on BNB Chain) before the launchpad exists.
    if (!/^0x0{40}$/i.test(r.address)) {
      pads[r.chain as ChainKey] = getAddress(r.address);
      versions[r.chain as ChainKey] = Number(r.version) || 2;
    }
    if (r.burner && isAddress(r.burner)) burners[r.chain as ChainKey] = getAddress(r.burner);
    if (r.instant && isAddress(r.instant)) instants[r.chain as ChainKey] = getAddress(r.instant);
  }
  cache = { at: Date.now(), pads, burners, versions, instants };
  return cache;
}

export async function padSites(): Promise<Pads> {
  return (await padInfo()).pads;
}

export async function padOn(chain: ChainKey) {
  return (await padSites())[chain] ?? null;
}

/** The version of a chain's Launch Pad: 3 gives token addresses ending in "aaaaa", 2 is the one before. */
export async function padVersion(chain: ChainKey) {
  return (await padInfo()).versions[chain] ?? 2;
}

/** A chain's Instant Launch contract (no liquidity, no bonding curve), if deployed. */
export async function instantOn(chain: ChainKey) {
  return (await padInfo()).instants[chain] ?? null;
}
