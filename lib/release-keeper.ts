/**
 * Automatic release of locked tokens and locked liquidity. Server only.
 *
 * A smart contract can't wake itself up, so a keeper (the same hot wallet that fills limit orders, ORDERS_KEEPER_KEY)
 * sends the release the moment a lock is due. The AUTISTIK Locker (contracts/AutistikLocker.sol) lets anyone trigger a
 * due release but always pays the lock's owner, and the Launch Pad lets anyone release due liquidity but always pays the
 * token's creator. So the keeper can only ever deliver funds to their owners. It never receives or holds them; it only
 * pays the network fee. Locks made on an older locker or launch pad (before this update) still need a manual unlock.
 */
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, toFunctionSelector } from "viem";
import { supabaseService } from "@/lib/supabase/server";
import { keeperAccount } from "@/lib/orders-server";
import { LOCKER_ABI, LOCKER_CHAINS, lockerTransport, type LockerChain } from "@/lib/locker";
import { lockerClient, lockerSites } from "@/lib/locker-server";
import { CHAINS, LAUNCHPAD_ABI, type ChainKey } from "@/lib/launchpad";
import { padSites } from "@/lib/launchpad-server";

type Stats = { checked: number; released: number; failed: number; oldContract: number; notes: string[] };
const PAGE = 100n;

function wallet(chain: LockerChain, account: any) {
  return createWalletClient({ account, chain: LOCKER_CHAINS[chain].viem as any, transport: lockerTransport(chain) });
}

/** Releases every due lock on every chain where the locker is the new version. */
async function releaseLocks(account: any, deadline: number, stats: Stats) {
  for (const site of await lockerSites()) {
    if (Date.now() > deadline) return;
    const c = lockerClient(site.chain);
    const w = wallet(site.chain, account);
    try {
      // Only lockers deployed after this update have unlockMany; older ones are left for their owners to unlock.
      const code = String((await c.getCode({ address: site.address })) || "0x").toLowerCase();
      if (!code.includes(toFunctionSelector("unlockMany(uint256[])").slice(2))) { stats.oldContract++; stats.notes.push(`${site.chain}: locker is the older version (unlock by hand)`); continue; }
      const count = (await c.readContract({ address: site.address, abi: LOCKER_ABI, functionName: "getTotalLockCount" })) as bigint;
      const nowS = BigInt(Math.floor(Date.now() / 1000));
      const due: bigint[] = [];
      const ownerIsContract = new Map<string, boolean>();
      for (let start = 0n; start < count; start += PAGE) {
        const locks = (await c.readContract({ address: site.address, abi: LOCKER_ABI, functionName: "getLocks", args: [start, start + PAGE > count ? count : start + PAGE] })) as any[];
        for (const l of locks) {
          if (l.amount <= l.unlockedAmount || l.tgeDate > nowS || /^0x0{40}$/i.test(l.owner)) continue;
          if (!ownerIsContract.has(l.owner)) ownerIsContract.set(l.owner, ((await c.getCode({ address: l.owner }).catch(() => "0x")) || "0x") !== "0x");
          if (ownerIsContract.get(l.owner)) continue; // contract-owned locks are released by that contract (see releaseLiquidity)
          due.push(l.id as bigint);
        }
      }
      stats.checked += due.length;
      for (let i = 0; i < due.length && Date.now() < deadline; i += 15) {
        const ids = due.slice(i, i + 15);
        try {
          const { request, result } = await c.simulateContract({ account, address: site.address, abi: LOCKER_ABI, functionName: "unlockMany", args: [ids] });
          if (!result) continue;
          const hash = await w.writeContract(request as any);
          await c.waitForTransactionReceipt({ hash, timeout: 40_000 });
          stats.released += Number(result);
        } catch (e: any) {
          stats.failed += ids.length;
          stats.notes.push(`${site.chain}: ${String(e?.shortMessage || e?.message).slice(0, 120)}`);
        }
      }
    } catch (e: any) { stats.notes.push(`${site.chain}: ${String(e?.shortMessage || e?.message).slice(0, 120)}`); }
  }
}

/** Releases locked launch-pad liquidity to the creator once its lock has ended. */
async function releaseLiquidity(account: any, deadline: number, stats: Stats) {
  const pads = await padSites();
  const { data } = await supabaseService().from("launches").select("chain,token,lp_unlock_at,pad").neq("lp_lock", "burn").eq("source", "launchpad").lte("lp_unlock_at", new Date().toISOString()).order("lp_unlock_at").limit(200);
  for (const r of data || []) {
    if (Date.now() > deadline) return;
    const chain = r.chain as ChainKey;
    // The Launch Pad the token came from (older tokens stay on the older one after a chain moves to a newer one).
    const pad = r.pad && isAddress(r.pad) ? getAddress(r.pad) : pads[chain];
    const info = CHAINS[chain];
    if (!pad || !info || info.kind === "solana") continue;
    const viemChain = defineChain({ id: info.chainId, name: info.name, nativeCurrency: { name: info.coin, symbol: info.coin, decimals: 18 }, rpcUrls: { default: { http: [info.rpc] } } });
    try {
      const pc: any = createPublicClient({ chain: viemChain, transport: http(info.rpc) });
      const l = (await pc.readContract({ address: pad, abi: LAUNCHPAD_ABI, functionName: "launchOf", args: [getAddress(r.token)] })) as any;
      if (l[4] || l[3] === 0) continue; // already released, or burned
      stats.checked++;
      const { request } = await pc.simulateContract({ account, address: pad, abi: LAUNCHPAD_ABI, functionName: "releaseLiquidity", args: [getAddress(r.token)] });
      const hash = await createWalletClient({ account, chain: viemChain, transport: http(info.rpc) }).writeContract(request as any);
      await pc.waitForTransactionReceipt({ hash, timeout: 40_000 });
      stats.released++;
    } catch (e: any) {
      // The older launch pad only lets the team release, so the simulation says so: leave those for the team.
      if (/NotOwner/i.test(String(e?.message))) { stats.oldContract++; continue; }
      stats.failed++; stats.notes.push(`${chain} ${String(r.token).slice(0, 8)}: ${String(e?.shortMessage || e?.message).slice(0, 100)}`);
    }
  }
}

export async function runReleaseKeeper(deadline: number) {
  const account = keeperAccount();
  if (!account) return { skipped: "ORDERS_KEEPER_KEY isn't set" };
  const stats: Stats = { checked: 0, released: 0, failed: 0, oldContract: 0, notes: [] };
  await releaseLocks(account, deadline, stats);
  await releaseLiquidity(account, deadline, stats);
  stats.notes = stats.notes.slice(0, 10);
  return stats;
}
