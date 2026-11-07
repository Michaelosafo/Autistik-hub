/**
 * Automatic payout of Instant coins' trading fees. Server only.
 *
 * Pool fees sit in the PancakeSwap / Uniswap position until someone calls collectFees on the Instant contract, which
 * always pays the coin's creator their share (straight to the wallet that launched it), its holders' rewards (if
 * chosen) and the AUTISTIK team wallet. Anyone may call it, so the keeper (the same hot wallet that fills limit orders
 * and releases locks, ORDERS_KEEPER_KEY) does it on a schedule. It never receives any of the fees; it only pays gas, and
 * only when a coin has built up enough fees that the gas is a small part of them.
 */
import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseAbi, parseEther } from "viem";
import { supabaseService } from "@/lib/supabase/server";
import { keeperAccount } from "@/lib/orders-server";
import { CHAINS, viemChain } from "@/lib/launchpad";
import { INSTANT_DEX, isInstantChain, type InstantChain } from "@/lib/instant";

const PAD_ABI = parseAbi([
  // v1 and v2 both start coinOf with (creator, pool, positionId); the rest is read only as far as needed.
  "function coinOf(address) view returns (address creator, address pool, uint256 positionId)",
  "function collectFees(address token)",
]);
const NPM_ABI = parseAbi([
  "struct C { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }",
  "function collect(C params) payable returns (uint256 amount0, uint256 amount1)",
  "function WETH9() view returns (address)",
]);
const MAX = 2n ** 128n - 1n;

/** Collect once a coin has at least this much of the chain's coin in fees (gas must also be under 15% of it). */
const MIN_FEES: Record<InstantChain, bigint> = {
  bsc: parseEther(process.env.INSTANT_AUTO_MIN_BNB || "0.004"),
  ethereum: parseEther(process.env.INSTANT_AUTO_MIN_ETH || "0.03"),
  robinhood: parseEther(process.env.INSTANT_AUTO_MIN_RH || "0.0005"),
};

type Stats = { checked: number; collected: number; skipped: number; failed: number; notes: string[] };

export async function runInstantKeeper(deadline: number) {
  const stats: Stats = { checked: 0, collected: 0, skipped: 0, failed: 0, notes: [] };
  const account = keeperAccount();
  if (!account) return { ...stats, notes: ["ORDERS_KEEPER_KEY isn't set"] };
  const { data } = await supabaseService().from("launches").select("chain,token,pad").eq("style", "instant").not("pad", "is", null).order("created_at", { ascending: false }).limit(400);
  const clients = new Map<string, { pub: any; wallet: any; weth: `0x${string}` }>();
  for (const r of data || []) {
    if (Date.now() > deadline) break;
    if (!isInstantChain(r.chain) || !isAddress(r.pad) || !isAddress(r.token)) continue;
    const key = r.chain as InstantChain;
    const c = CHAINS[key];
    try {
      if (!clients.has(key)) {
        const chain = viemChain(c);
        const pub = createPublicClient({ chain, transport: http(c.rpc, { timeout: 10_000 }) }) as any;
        const weth = getAddress(await pub.readContract({ address: INSTANT_DEX[key].positions, abi: NPM_ABI, functionName: "WETH9" }));
        clients.set(key, { pub, weth, wallet: createWalletClient({ account, chain, transport: http(c.rpc, { timeout: 15_000 }) }) });
      }
      const { pub, wallet, weth } = clients.get(key)!;
      const pad = getAddress(r.pad), token = getAddress(r.token);
      stats.checked++;
      const [, , positionId] = (await pub.readContract({ address: pad, abi: PAD_ABI, functionName: "coinOf", args: [token] })) as [string, string, bigint];
      // What the position would pay out right now: the same call, as the Instant contract (it owns the position).
      const { result } = await pub.simulateContract({ account: pad, address: INSTANT_DEX[key].positions, abi: NPM_ABI, functionName: "collect", args: [{ tokenId: positionId, recipient: pad, amount0Max: MAX, amount1Max: MAX }] });
      const fees: bigint = token.toLowerCase() < weth.toLowerCase() ? result[1] : result[0];
      if (fees < MIN_FEES[key]) { stats.skipped++; continue; }
      const { request } = await pub.simulateContract({ account, address: pad, abi: PAD_ABI, functionName: "collectFees", args: [token] });
      const [gas, price] = await Promise.all([pub.estimateContractGas({ account, address: pad, abi: PAD_ABI, functionName: "collectFees", args: [token] }), pub.getGasPrice()]);
      if (BigInt(gas) * BigInt(price) * 100n > fees * 15n) { stats.skipped++; continue; }
      const hash = await wallet.writeContract(request);
      await pub.waitForTransactionReceipt({ hash, timeout: 40_000 });
      stats.collected++;
    } catch (e: any) {
      stats.failed++;
      if (stats.notes.length < 10) stats.notes.push(`${r.chain} ${String(r.token).slice(0, 10)}: ${String(e?.shortMessage || e?.message).slice(0, 120)}`);
    }
  }
  return stats;
}
