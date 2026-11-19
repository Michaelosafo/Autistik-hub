import type { ChainKey } from "@/lib/launchpad";

/** Networks the Rage admin deploy can target. BNB Chain stays the default. */
export const RAGE_CHAINS = ["bsc", "ethereum", "base", "arbitrum", "polygon", "avalanche", "optimism", "robinhood", "solana"] as const;
export type RageChain = (typeof RAGE_CHAINS)[number];
export type EvmRageChain = Exclude<RageChain, "solana">;

/** Buy tax and sell tax each cap at this percent. */
export const MAX_RAGE_TAX = 50;

export const isEvmRage = (k: ChainKey | RageChain): k is EvmRageChain => (RAGE_CHAINS as readonly string[]).includes(k) && k !== "solana";

/** Solana base58 address (a mint or a wallet). */
export const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Percent string (0–50, up to 2 decimals) as basis points. A blank field is 0.
 * Returns null when the value is not allowed.
 */
export function rageTaxBps(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (s === "") return 0;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > MAX_RAGE_TAX) return null;
  const bps = Math.round(n * 100);
  return bps <= 5_000 ? bps : null;
}

/** Native coin kept back for gas on each Rage step (deploy, add, first buy). */
export const RAGE_GAS: Record<EvmRageChain, number> = {
  bsc: 0.0015,
  ethereum: 0.008,
  base: 0.0004,
  arbitrum: 0.0004,
  polygon: 0.05,
  avalanche: 0.015,
  optimism: 0.0004,
  robinhood: 0.0004,
};
