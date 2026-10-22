import { rateLimit } from "@/lib/ratelimit";
import { parseUnits } from "viem";
import { json } from "@/lib/ai";
import { launchAccess } from "@/lib/admin";
import { currentUser } from "@/lib/supabase/server";
import { CHAINS, SOL_DECIMALS, checkPlan } from "@/lib/launchpad";
import { SOL_ADDR, buildAddLiquidity, buildBurnLp, buildMint, buildPool, findPool } from "@/lib/solana-launch";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Solana Launch Pad: builds each transaction for the member's own wallet to sign (see lib/solana-launch.ts).
 *   mint → pool → burn: a new token, its Raydium pool, and the LP tokens burned.
 *   find → add (→ burn): add liquidity to any Raydium CPMM pool paired with SOL.
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "launch-solana", 40, 600);
  if (slow) return slow;
  if (!(await launchAccess()).allowed) return json({ error: "The Launch Pad is coming soon." }, 403);
  const b = await req.json().catch(() => null);
  const owner = String(b?.owner || "");
  const action = String(b?.action || "");
  if (action !== "find" && !SOL_ADDR.test(owner)) return json({ error: "Connect a Solana wallet first." }, 400);

  try {
    switch (action) {
      case "mint": {
        if (!(await currentUser())) return json({ error: "Please sign in first." }, 401);
        const r = checkPlan({ ...b.plan, chain: "solana" }, {});
        if ("error" in r) return json({ error: r.error }, 400);
        return json(await buildMint(owner, r.plan));
      }
      case "pool": {
        const r = checkPlan({ ...b.plan, chain: "solana" }, {});
        if ("error" in r) return json({ error: r.error }, 400);
        if (!SOL_ADDR.test(String(b.mint || ""))) return json({ error: "Missing the token address." }, 400);
        // Same split as the EVM Launch Pad: the creator keeps their share, the rest goes into the pool.
        const supply = BigInt(r.plan.supply) * 10n ** BigInt(SOL_DECIMALS);
        const tokens = supply - (supply * BigInt(Math.round(r.plan.creatorPercent * 100))) / 10_000n;
        return json(await buildPool(owner, b.mint, tokens, parseUnits(r.plan.liquidity, 9)));
      }
      case "burn": {
        if (!SOL_ADDR.test(String(b.lpMint || ""))) return json({ error: "Missing the pool's LP token." }, 400);
        return json(await buildBurnLp(owner, b.lpMint));
      }
      case "find": {
        if (!SOL_ADDR.test(String(b.mint || ""))) return json({ error: "That isn't a Solana token address." }, 400);
        const p = await findPool(b.mint, SOL_ADDR.test(String(b.pool || "")) ? b.pool : undefined);
        return p ? json(p) : json({ error: `No Raydium pool with SOL found for that token. Liquidity can be added to Raydium CPMM pools.` }, 404);
      }
      case "add": {
        if (!SOL_ADDR.test(String(b.pool || ""))) return json({ error: "Missing the pool." }, 400);
        const side = b.side === "token" ? "token" : "sol";
        let amount = 0n;
        try { amount = parseUnits(String(b.amount || ""), side === "sol" ? 9 : Number(b.decimals ?? SOL_DECIMALS)); } catch {}
        if (amount <= 0n) return json({ error: "Type an amount." }, 400);
        return json(await buildAddLiquidity(owner, b.pool, side, amount));
      }
    }
    return json({ error: "Not found." }, 404);
  } catch (e: any) {
    console.error(`launch-solana ${action}:`, String(e?.message || e).slice(0, 300));
    return json({ error: `Couldn't prepare the ${CHAINS.solana.name} transaction. Try again in a moment.` }, 502);
  }
}
