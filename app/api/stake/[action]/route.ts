import { getAddress, isAddress } from "viem";
import { adminState } from "@/lib/admin";
import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { STAKING_ABI } from "@/lib/staking-build";
import { isStakeChain, listPools, stakingContracts } from "@/lib/staking-server";
import { WCHAINS } from "@/lib/wallet-chains";
import { walletChainClient } from "@/lib/wallet-server";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TREASURY = process.env.NEXT_PUBLIC_TREASURY_WALLET || "0x531A5ccB712B2bB997Ce0dF018707948c49Da5ba";

/** Staking: list pools (with the member's own position), and admin setup. Staking itself happens in the member's wallet. */
export async function GET(req: Request, { params }: { params: { action: string } }) {
  if (params.action === "admin") {
    if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
    return json({ treasury: TREASURY, contracts: await stakingContracts() });
  }
  return json({ error: "Not found." }, 404);
}

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const b = await req.json().catch(() => ({}));
  switch (params.action) {
    case "pools": {
      const limited = await rateLimit(req, "stake-pools", 60, 60);
      if (limited) return limited;
      const chain = isStakeChain(b.chain) ? b.chain : "bsc";
      const admin = b.all === true && (await adminState()).admin;
      try { return json(await listPools(chain, typeof b.user === "string" ? b.user : null, { includeHidden: admin })); }
      catch { return json({ error: "Couldn't read the pools right now. Try again in a moment." }, 502); }
    }
    case "contracts": {
      // Admin: save the Staking contract the team wallet just deployed, after checking it on-chain.
      if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
      if (!isStakeChain(b.chain) || !isAddress(b.address)) return json({ error: "Bad request." }, 400);
      const c = WCHAINS[b.chain];
      const at = getAddress(b.address);
      try {
        const pc = walletChainClient(c);
        const [owner, fee] = await Promise.all([
          pc.readContract({ address: at, abi: STAKING_ABI, functionName: "owner" }),
          pc.readContract({ address: at, abi: STAKING_ABI, functionName: "feeReceiver" }),
          pc.readContract({ address: at, abi: STAKING_ABI, functionName: "poolCount" }),
        ]);
        if (getAddress(owner) !== getAddress(TREASURY) || getAddress(fee) !== getAddress(TREASURY)) return json({ error: "That contract isn't owned by the team wallet." }, 400);
      } catch { return json({ error: `No AUTISTIK Staking contract at ${at} on ${c.name} yet. Wait a few seconds and try again.` }, 400); }
      await supabaseService().from("staking_contracts").upsert({ chain: c.key, address: at, deployed_at: new Date().toISOString() });
      return json({ ok: true });
    }
    case "hide": {
      // Admin: hide a spam or scam pool from the list (it keeps working on-chain, members can still withdraw).
      if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
      if (!isStakeChain(b.chain) || !Number.isInteger(b.id) || b.id < 0) return json({ error: "Bad request." }, 400);
      const sb = supabaseService();
      if (b.hidden === false) await sb.from("staking_hidden").delete().eq("chain", b.chain).eq("pool_id", b.id);
      else await sb.from("staking_hidden").upsert({ chain: b.chain, pool_id: b.id });
      return json({ ok: true });
    }
  }
  return json({ error: "Not found." }, 404);
}
