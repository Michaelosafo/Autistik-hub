import { erc20Abi, getAddress, isAddress } from "viem";
import { TOKEN_ADDRESS } from "@/lib/groups";
import { getMarkets } from "@/lib/market";
import { STAKING_ABI } from "@/lib/staking-build";
import { TIERS } from "@/lib/staking-tiers";
import { NATIVE, WCHAINS, type WChainKey } from "@/lib/wallet-chains";
import { walletChainClient } from "@/lib/wallet-server";
import { supabaseService } from "@/lib/supabase/server";

/** Staking runs on these networks (AUTISTIK lives on BNB Chain). */
export const STAKE_CHAINS: WChainKey[] = ["bsc"];
export const isStakeChain = (c: unknown): c is WChainKey => typeof c === "string" && (STAKE_CHAINS as string[]).includes(c);

const PRECISION = 10n ** 30n;
const MAX_POOLS = 300;

export type StakeToken = { address: string; symbol: string; name: string; decimals: number; logo: string | null; priceUsd: number | null };

export type Position = { tier: number; amount: string; amountNum: number; unlockAt: number };
export type PoolView = {
  id: number; stake: StakeToken; reward: StakeToken; creator: string; durationDays: number;
  periodFinish: number; totalStaked: string; totalStakedNum: number; tvlUsd: number | null;
  /** apr: yearly return at 1x (flexible). Each lock level earns apr x its boost. */
  rewardsLeft: number; rewardPerDay: number; apr: number | null; featured: boolean; live: boolean; hidden: boolean;
  mine?: { stakedNum: number; earned: string; earnedNum: number; positions: Position[]; balance: string; balanceNum: number; allowance: string };
};

export async function stakingContracts(): Promise<Record<string, `0x${string}`>> {
  const { data } = await supabaseService().from("staking_contracts").select("chain,address");
  const out: Record<string, `0x${string}`> = {};
  for (const r of data || []) if (isStakeChain(r.chain) && isAddress(r.address)) out[r.chain] = getAddress(r.address);
  return out;
}

async function hiddenPools(chain: string): Promise<Set<number>> {
  const { data } = await supabaseService().from("staking_hidden").select("pool_id").eq("chain", chain);
  return new Set((data || []).map((r) => r.pool_id as number));
}

const num = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;

/** Every pool on a chain with live numbers, plus the member's own position when `user` is given. */
export async function listPools(chain: WChainKey, user?: string | null, opts: { includeHidden?: boolean } = {}): Promise<{ contract: string | null; owner: string | null; createFee: string; pools: PoolView[] }> {
  const c = WCHAINS[chain];
  const at = (await stakingContracts())[chain];
  if (!at) return { contract: null, owner: null, createFee: "0", pools: [] };
  const pc = walletChainClient(c);
  const [count, owner, createFee] = await Promise.all([
    pc.readContract({ address: at, abi: STAKING_ABI, functionName: "poolCount" }) as Promise<bigint>,
    pc.readContract({ address: at, abi: STAKING_ABI, functionName: "owner" }) as Promise<string>,
    pc.readContract({ address: at, abi: STAKING_ABI, functionName: "createFee" }) as Promise<bigint>,
  ]);
  const n = Math.min(Number(count), MAX_POOLS);
  const hidden = await hiddenPools(chain);
  const ids = Array.from({ length: n }, (_, i) => n - 1 - i); // newest first
  if (!ids.length) return { contract: at, owner, createFee: createFee.toString(), pools: [] };

  const me = user && isAddress(user) ? getAddress(user) : null;
  const call = (functionName: string, args: unknown[]) => ({ address: at, abi: STAKING_ABI, functionName, args });
  const base = await pc.multicall({ allowFailure: true, contracts: ids.flatMap((i) => [call("pools", [BigInt(i)]), call("rewardsLeft", [BigInt(i)])]) });
  const raw = ids.map((id, k) => ({ id, p: base[2 * k].result as any[] | undefined, left: (base[2 * k + 1].result as bigint | undefined) ?? 0n })).filter((x) => x.p);

  // Token names and decimals, read on-chain once per token.
  const addrs = [...new Set(raw.flatMap((x) => [x.p![0], x.p![1]]).map((a: string) => getAddress(a)))].filter((a) => a !== getAddress(NATIVE));
  const meta = await pc.multicall({ allowFailure: true, contracts: addrs.flatMap((a) => [
    { address: a, abi: erc20Abi, functionName: "symbol" }, { address: a, abi: erc20Abi, functionName: "name" }, { address: a, abi: erc20Abi, functionName: "decimals" },
  ]) });
  const markets = await getMarkets([...addrs, c.wrapped!].map((t) => ({ chain: chain as any, token: t })));
  const tokens: Record<string, StakeToken> = {};
  addrs.forEach((a, k) => {
    const m = markets[a.toLowerCase()];
    tokens[a] = {
      address: a, symbol: String(meta[3 * k].result ?? "?").slice(0, 16), name: String(meta[3 * k + 1].result ?? "").slice(0, 40),
      decimals: Number(meta[3 * k + 2].result ?? 18), logo: m?.imageUrl ?? null, priceUsd: m?.priceUsd ?? null,
    };
  });
  tokens[getAddress(NATIVE)] = { address: NATIVE, symbol: c.native.symbol, name: c.native.name, decimals: 18, logo: null, priceUsd: markets[c.wrapped!.toLowerCase()]?.priceUsd ?? null };

  // The member's position in each pool.
  let mine: any[] = [];
  if (me) mine = await pc.multicall({ allowFailure: true, contracts: raw.flatMap((x) => [
    call("positionsOf", [BigInt(x.id), me]), call("earned", [BigInt(x.id), me]),
    { address: getAddress(x.p![0]), abi: erc20Abi, functionName: "balanceOf", args: [me] },
    { address: getAddress(x.p![0]), abi: erc20Abi, functionName: "allowance", args: [me, at] },
  ]) });

  const featuredToken = getAddress(TOKEN_ADDRESS);
  const pools: PoolView[] = raw.map((x, k) => {
    const [stakeT, rewardT, creator, duration, periodFinish, , rewardRate, , totalStaked, totalWeight] = x.p! as [string, string, string, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
    const stake = tokens[getAddress(stakeT)], reward = tokens[getAddress(rewardT)];
    const totalNum = num(totalStaked, stake.decimals);
    const left = num(x.left, reward.decimals);
    const running = left > 0;
    const perDay = running ? Number((rewardRate * 86400n) / PRECISION) / 10 ** reward.decimals : 0;
    const tvl = stake.priceUsd != null ? totalNum * stake.priceUsd : null;
    // Rewards are split by weight (amount x boost), so the 1x rate is rewards / total weight.
    const weightUsd = stake.priceUsd != null ? num(totalWeight, stake.decimals) * stake.priceUsd : null;
    const apr = running && weightUsd && weightUsd > 0 && reward.priceUsd != null ? (perDay * 365 * reward.priceUsd * 100) / weightUsd : null;
    const v: PoolView = {
      id: x.id, stake, reward, creator: getAddress(creator), durationDays: Number(duration) / 86400,
      periodFinish: Number(periodFinish), totalStaked: totalStaked.toString(), totalStakedNum: totalNum, tvlUsd: tvl,
      rewardsLeft: left, rewardPerDay: perDay, apr, live: running,
      featured: getAddress(stakeT) === featuredToken && getAddress(creator) === getAddress(owner), hidden: hidden.has(x.id),
    };
    if (me) {
      const pos = mine[4 * k]?.result as [readonly bigint[], readonly bigint[]] | undefined, e = (mine[4 * k + 1]?.result as bigint | undefined) ?? 0n;
      const b = (mine[4 * k + 2]?.result as bigint | undefined) ?? 0n, al = (mine[4 * k + 3]?.result as bigint | undefined) ?? 0n;
      const positions: Position[] = TIERS.map((_, t) => ({ tier: t, amount: (pos?.[0][t] ?? 0n).toString(), amountNum: num(pos?.[0][t] ?? 0n, stake.decimals), unlockAt: Number(pos?.[1][t] ?? 0n) })).filter((x) => x.amount !== "0");
      v.mine = { stakedNum: positions.reduce((a, x) => a + x.amountNum, 0), earned: e.toString(), earnedNum: num(e, reward.decimals), positions, balance: b.toString(), balanceNum: num(b, stake.decimals), allowance: al.toString() };
    }
    return v;
  });
  // Hidden pools (spam) stay out of the list, except for members who still have tokens or rewards in them.
  const shown = pools.filter((p) => !p.hidden || opts.includeHidden || (p.mine && (p.mine.positions.length > 0 || p.mine.earned !== "0")));
  shown.sort((a, b) => Number(b.featured) - Number(a.featured) || (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0) || b.id - a.id);
  return { contract: at, owner, createFee: createFee.toString(), pools: shown };
}
