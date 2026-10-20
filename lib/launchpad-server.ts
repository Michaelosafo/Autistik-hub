/**
 * Where the AUTISTIK Launch Pad v2 lives on each chain. Saved by the team's one-click deploy (checked on-chain)
 * and read here by pages and API routes. Server only.
 */
import { getAddress, isAddress } from "viem";
import { supabaseService } from "@/lib/supabase/server";
import { CHAINS, type ChainKey, type Pads } from "@/lib/launchpad";

let cache: { at: number; pads: Pads; burners: Partial<Record<ChainKey, string>> } | null = null;

export async function padInfo(fresh = false) {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache;
  const { data } = await supabaseService().from("launchpad_contracts").select("chain,address,burner");
  const pads: Pads = {}, burners: Partial<Record<ChainKey, string>> = {};
  for (const r of data || []) {
    if (!(r.chain in CHAINS) || !isAddress(r.address)) continue;
    // A row can hold just the burner (deployed first on BNB Chain) before the launchpad exists.
    if (!/^0x0{40}$/i.test(r.address)) pads[r.chain as ChainKey] = getAddress(r.address);
    if (r.burner && isAddress(r.burner)) burners[r.chain as ChainKey] = getAddress(r.burner);
  }
  cache = { at: Date.now(), pads, burners };
  return cache;
}

export async function padSites(): Promise<Pads> {
  return (await padInfo()).pads;
}

export async function padOn(chain: ChainKey) {
  return (await padSites())[chain] ?? null;
}
