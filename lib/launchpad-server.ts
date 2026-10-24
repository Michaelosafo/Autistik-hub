/**
 * Where the AUTISTIK Launch Pad lives on each chain, and which version it is (3 = token addresses ending in "aaaaa"). Saved by the team's one-click deploy (checked on-chain)
 * and read here by pages and API routes. Server only.
 */
import { getAddress, isAddress } from "viem";
import { supabaseService } from "@/lib/supabase/server";
import { CHAINS, type ChainKey, type Pads } from "@/lib/launchpad";

let cache: { at: number; pads: Pads; burners: Partial<Record<ChainKey, string>>; versions: Partial<Record<ChainKey, number>> } | null = null;

export async function padInfo(fresh = false) {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache;
  // "*" so this keeps working before the version column exists (supabase/evm-vanity.sql).
  const { data } = await supabaseService().from("launchpad_contracts").select("*");
  const pads: Pads = {}, burners: Partial<Record<ChainKey, string>> = {}, versions: Partial<Record<ChainKey, number>> = {};
  for (const r of data || []) {
    if (!(r.chain in CHAINS) || !isAddress(r.address)) continue;
    // A row can hold just the burner (deployed first on BNB Chain) before the launchpad exists.
    if (!/^0x0{40}$/i.test(r.address)) {
      pads[r.chain as ChainKey] = getAddress(r.address);
      versions[r.chain as ChainKey] = Number(r.version) || 2;
    }
    if (r.burner && isAddress(r.burner)) burners[r.chain as ChainKey] = getAddress(r.burner);
  }
  cache = { at: Date.now(), pads, burners, versions };
  return cache;
}

export async function padSites(): Promise<Pads> {
  return (await padInfo()).pads;
}

export async function padOn(chain: ChainKey) {
  return (await padSites())[chain] ?? null;
}

/**
 * Where new tokens can be launched: only v3 Launch Pads (token addresses ending in "AAAAA"). A chain still on an older
 * Launch Pad takes no new launches until the team upgrades it on the admin page; its older tokens keep working there
 * (promotions, liquidity release), which is why padSites/padOn still list it.
 */
export async function launchSites(): Promise<Pads> {
  const { pads, versions } = await padInfo();
  const out: Pads = {};
  for (const chain of Object.keys(pads) as ChainKey[]) if ((versions[chain] ?? 2) >= 3) out[chain] = pads[chain];
  return out;
}

export async function launchPadOn(chain: ChainKey) {
  return (await launchSites())[chain] ?? null;
}

/** The version of a chain's Launch Pad: 3 gives token addresses ending in "aaaaa", 2 is the one before. */
export async function padVersion(chain: ChainKey) {
  return (await padInfo()).versions[chain] ?? 2;
}
