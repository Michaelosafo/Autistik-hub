/**
 * Works out which chain a pasted token address is on, so people don't have to pick a network.
 * Solana addresses look different from 0x addresses. For 0x addresses: DexScreener's pools first (the chain with the
 * most liquidity wins), then the chains' own nodes (the first one where that address is a contract). Server only.
 */
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { ACHAINS, isAChain, type AChain } from "@/lib/analytics";

const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Most-used chains first, for the contract check when DexScreener has no pool yet.
const ORDER: AChain[] = ["bsc", "base", "ethereum", "robinhood", "arbitrum", "polygon", "avalanche", "optimism", "sonic", "berachain", "unichain", "linea", "blast", "abstract"];
const API = process.env.DEXSCREENER_API || "https://api.dexscreener.com";

export async function detectChain(raw: string): Promise<AChain | null> {
  const a = raw.trim();
  if (SOL.test(a) && !a.startsWith("0x")) return "solana";
  if (!isAddress(a, { strict: false })) return null;
  const addr = getAddress(a);
  // 1. DexScreener: every chain that has a pool for this token.
  try {
    const r = await fetch(`${API}/latest/dex/tokens/${addr}`, { signal: AbortSignal.timeout(5000), next: { revalidate: 300 } });
    const pairs: any[] = r.ok ? ((await r.json())?.pairs ?? []) : [];
    const liq = new Map<AChain, number>();
    for (const p of pairs) {
      if (String(p?.baseToken?.address || "").toLowerCase() !== addr.toLowerCase()) continue;
      const key = (Object.keys(ACHAINS) as AChain[]).find((k) => ACHAINS[k].dex === p?.chainId);
      if (key) liq.set(key, (liq.get(key) || 0) + (Number(p?.liquidity?.usd) || 0));
    }
    const best = [...liq].sort((x, y) => y[1] - x[1])[0];
    if (best) return best[0];
  } catch { /* fall through to the contract check */ }
  // 2. No pool yet (brand-new token): find the chain where this address is a contract.
  const found = await Promise.all(ORDER.filter((k) => ACHAINS[k].kind === "evm").map(async (k) => {
    try {
      const c = createPublicClient({ chain: ACHAINS[k].viem, transport: http(ACHAINS[k].rpc, { timeout: 4000 }) });
      const code = await c.getCode({ address: addr });
      return code && code !== "0x" ? k : null;
    } catch { return null; }
  }));
  return found.find((k) => k && isAChain(k)) ?? null;
}
