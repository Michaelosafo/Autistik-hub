/**
 * Reading the AUTISTIK Locker on each chain, for pages and token scans. Server only.
 */
import { createPublicClient, formatUnits, getAddress, isAddress } from "viem";
import { supabaseService } from "@/lib/supabase/server";
import { LOCKER_ABI, LOCKER_CHAINS, TOKEN_ABI, isLockerChain, lockerTransport, type LockerChain, type LockerSite } from "@/lib/locker";

let cache: { at: number; rows: LockerSite[] } | null = null;

/** Every chain the locker is deployed on (cached for a minute). */
export async function lockerSites(fresh = false): Promise<LockerSite[]> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.rows;
  const { data } = await supabaseService().from("locker_contracts").select("chain,address,verified").order("deployed_at");
  const rows = (data || []).filter((r: any) => isLockerChain(r.chain) && isAddress(r.address)).map((r: any) => ({ chain: r.chain, address: getAddress(r.address), verified: !!r.verified }));
  cache = { at: Date.now(), rows };
  return rows;
}

export async function lockerOn(chain: string) {
  return (await lockerSites()).find((s) => s.chain === chain) || null;
}

// Cast: viem's types misread optional fields when the project has `strict: false`.
export const lockerClient = (chain: LockerChain): any =>
  createPublicClient({ chain: LOCKER_CHAINS[chain].viem as any, transport: lockerTransport(chain) });

export type LockView = {
  chain: LockerChain; id: number; token: string; name: string; owner: string; amount: string; left: string; pctOfSupply: number | null;
  lockDate: number; unlockDate: number; vesting: boolean; isLp: boolean; description: string; done: boolean;
};

/** Turns raw locks into rows people can read: token names (LP shows as "A/B LP"), amounts and dates. */
async function describe(chain: LockerChain, locks: any[]): Promise<LockView[]> {
  if (!locks.length) return [];
  const c = lockerClient(chain);
  const tokens = [...new Set(locks.map((l) => l.token as string))];
  const calls = tokens.flatMap((t) => (["symbol", "decimals", "totalSupply", "token0", "token1"] as const).map((functionName) => ({ address: t as `0x${string}`, abi: TOKEN_ABI, functionName })));
  const res = await c.multicall({ contracts: calls as any, allowFailure: true });
  const info = new Map<string, { symbol: string; decimals: number; supply: bigint; t0?: string; t1?: string }>();
  tokens.forEach((t, i) => {
    const r = (k: number) => (res[i * 5 + k]?.status === "success" ? res[i * 5 + k].result : undefined) as any;
    info.set(t, { symbol: String(r(0) ?? "?").slice(0, 16), decimals: Number(r(1) ?? 18), supply: (r(2) as bigint) ?? 0n, t0: r(3), t1: r(4) });
  });
  // LP tokens: name them after the two tokens in the pool.
  const parts = [...new Set(locks.filter((l) => l.isLpToken).flatMap((l) => [info.get(l.token)?.t0, info.get(l.token)?.t1]).filter(Boolean) as string[])];
  const syms = parts.length ? await c.multicall({ contracts: parts.map((address) => ({ address: address as `0x${string}`, abi: TOKEN_ABI, functionName: "symbol" })) as any, allowFailure: true }) : [];
  const sym = new Map(parts.map((p, i) => [p, syms[i]?.status === "success" ? String(syms[i].result).slice(0, 12) : "?"]));
  return locks.map((l) => {
    const m = info.get(l.token)!;
    const left = (l.amount as bigint) - (l.unlockedAmount as bigint);
    return {
      chain, id: Number(l.id), token: l.token, owner: l.owner,
      name: l.isLpToken && m.t0 && m.t1 ? `${sym.get(m.t0)}/${sym.get(m.t1)} LP` : m.symbol,
      amount: formatUnits(l.amount, m.decimals), left: formatUnits(left, m.decimals),
      pctOfSupply: m.supply > 0n ? Number((left * 1_000_000n) / m.supply) / 10_000 : null,
      lockDate: Number(l.lockDate), unlockDate: Number(l.tgeDate), vesting: (l.cycle as bigint) > 0n, isLp: !!l.isLpToken,
      description: String(l.description || "").slice(0, 200), done: left === 0n,
    };
  });
}

/** The newest locks on every chain, newest first. */
export async function recentLocks(perChain = 12): Promise<LockView[]> {
  const sites = await lockerSites();
  const lists = await Promise.all(sites.map(async (s) => {
    try {
      const c = lockerClient(s.chain);
      const count = (await c.readContract({ address: s.address, abi: LOCKER_ABI, functionName: "getTotalLockCount" })) as bigint;
      const start = count > BigInt(perChain) ? count - BigInt(perChain) : 0n;
      const locks = (await c.readContract({ address: s.address, abi: LOCKER_ABI, functionName: "getLocks", args: [start, count] })) as any[];
      return describe(s.chain, [...locks].reverse());
    } catch (e) { console.error("locker read failed", s.chain, (e as Error).message); return []; }
  }));
  return lists.flat().sort((a, b) => b.lockDate - a.lockDate);
}

/** Locks for a token and (optionally) its pool's LP token, still-locked first. */
export async function locksFor(chain: string, token: string, pair?: string | null): Promise<LockView[]> {
  const s = await lockerOn(chain);
  if (!s || !isAddress(token)) return [];
  try {
    const c = lockerClient(s.chain);
    const addrs = [token, ...(pair && isAddress(pair) ? [pair] : [])] as `0x${string}`[];
    const ids = (await Promise.all(addrs.map((a) => c.readContract({ address: s.address, abi: LOCKER_ABI, functionName: "lockIdsForToken", args: [a] }) as Promise<bigint[]>))).flat().slice(-60);
    if (!ids.length) return [];
    const res = await c.multicall({ contracts: ids.map((id) => ({ address: s.address, abi: LOCKER_ABI, functionName: "getLockById", args: [id] })) as any, allowFailure: true });
    const rows = await describe(s.chain, res.filter((r) => r.status === "success").map((r) => r.result));
    return rows.sort((a, b) => Number(a.done) - Number(b.done) || a.unlockDate - b.unlockDate);
  } catch (e) { console.error("locker read failed", chain, (e as Error).message); return []; }
}

export type LpLock = { locked: number; burned: number; lockers: { name: string; pct: number; until: number | null }[] };
const DEAD = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);

/** How much of a pool's liquidity is locked or burned, from GoPlus's LP holder list. Our locker always counts as a lock. */
export function lpLockOf(lpHolders: unknown, ourLocker?: string | null): LpLock | null {
  if (!Array.isArray(lpHolders) || !lpHolders.length) return null;
  const ours = ourLocker?.toLowerCase();
  const out: LpLock = { locked: 0, burned: 0, lockers: [] };
  for (const h of lpHolders as any[]) {
    const a = String(h?.address || "").toLowerCase();
    const pct = Number(h?.percent) * 100;
    if (!isFinite(pct) || pct <= 0) continue;
    if (DEAD.has(a)) { out.burned += pct; continue; }
    if (h?.is_locked === 1 || h?.is_locked === "1" || (ours && a === ours)) {
      out.locked += pct;
      const ends = (Array.isArray(h?.locked_detail) ? h.locked_detail : []).map((d: any) => Date.parse(d?.end_time) / 1000).filter((x: number) => isFinite(x));
      out.lockers.push({ name: ours && a === ours ? "AUTISTIK Locker" : String(h?.tag || "Locker").slice(0, 30), pct, until: ends.length ? Math.max(...ends) : null });
    }
  }
  out.lockers.sort((a, b) => b.pct - a.pct).splice(5);
  return out;
}

/** Live liquidity-lock check for any token (for the Lockers page search). */
export async function lpLockLive(chain: LockerChain, token: string): Promise<LpLock | null> {
  try {
    const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${LOCKER_CHAINS[chain].viem.id}?contract_addresses=${token}`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000) });
    const x = r.ok ? (await r.json())?.result?.[token.toLowerCase()] : null;
    return x ? lpLockOf(x.lp_holders, (await lockerOn(chain))?.address) : null;
  } catch { return null; }
}

/** One lock, read live from the chain, for its shareable certificate page. Null if there's no such lock. */
export async function lockById(chain: LockerChain, id: number) {
  const s = await lockerOn(chain);
  if (!s || !Number.isInteger(id) || id < 0) return null;
  const c = lockerClient(chain);
  try {
    const raw = await c.readContract({ address: s.address, abi: LOCKER_ABI, functionName: "getLockById", args: [BigInt(id)] });
    const [view] = await describe(chain, [raw]);
    return { ...view, locker: s.address, verified: s.verified, cycleDays: Number((raw as any).cycle) / 86400, cycleBps: Number((raw as any).cycleBps), tgeBps: Number((raw as any).tgeBps) };
  } catch { return null; }
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"; // EIP-1967: where an upgradeable proxy keeps its code
const PROBE_ABI = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "admin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export type TrustCheck = {
  chain: LockerChain; address: `0x${string}`; explorer: string; verified: boolean;
  locks: number | null; noOwner: boolean | null; noAdmin: boolean | null; notUpgradeable: boolean | null; error?: string;
};

/**
 * Live checks anyone can repeat on a block explorer: the locker has no owner and no admin to call, isn't an upgradeable
 * proxy (its code can never be swapped), and how many locks it holds. Read straight from each chain, not our database.
 */
export async function lockerTrust(): Promise<TrustCheck[]> {
  const sites = await lockerSites();
  return Promise.all(sites.map(async (s): Promise<TrustCheck> => {
    const base = { chain: s.chain, address: s.address, explorer: LOCKER_CHAINS[s.chain].explorer, verified: s.verified };
    try {
      const c = lockerClient(s.chain);
      const reads = <T,>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), () => ({ ok: false as const, v: undefined }));
      const [count, owner, admin, slot] = await Promise.all([
        reads(c.readContract({ address: s.address, abi: LOCKER_ABI, functionName: "getTotalLockCount" })),
        reads(c.readContract({ address: s.address, abi: PROBE_ABI, functionName: "owner" })),
        reads(c.readContract({ address: s.address, abi: PROBE_ABI, functionName: "admin" })),
        reads(c.getStorageAt({ address: s.address, slot: IMPL_SLOT })),
      ]);
      return {
        ...base,
        locks: count.ok ? Number(count.v) : null,
        // The call fails because there is no such function. Only trusted when the chain answered the lock count, so a
        // network problem never shows as a pass.
        noOwner: count.ok ? !owner.ok : null,
        noAdmin: count.ok ? !admin.ok : null,
        notUpgradeable: slot.ok ? !slot.v || /^0x0*$/.test(String(slot.v)) : null,
      };
    } catch (e) { return { ...base, locks: null, noOwner: null, noAdmin: null, notUpgradeable: null, error: (e as Error).message.slice(0, 80) }; }
  }));
}
