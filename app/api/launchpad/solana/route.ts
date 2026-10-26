import { rateLimit } from "@/lib/ratelimit";
import { namesTaken, saveLogo, takenError } from "@/lib/launch-names";
import { parseUnits } from "viem";
import { json } from "@/lib/ai";
import { launchAccess } from "@/lib/admin";
import { currentUser, supabaseService } from "@/lib/supabase/server";
import { CHAINS, SOL_DECIMALS, checkPlan } from "@/lib/launchpad";
import { PublicKey } from "@solana/web3.js";
import { SOL_ADDR, connection, buildAddLiquidity, buildBurnLp, buildMint, buildPool, findPool } from "@/lib/solana-launch";
import { buildClaimLp, buildLockLp } from "@/lib/solana-locker";
import { LOCK_SECONDS, isLock } from "@/lib/launchpad";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Solana Launch Pad: builds each transaction for the member's own wallet to sign (see lib/solana-launch.ts).
 *   mint → pool → burn | lock: a new token, its Raydium pool, and the LP tokens burned or locked (6 months / 1 year).
 *   claim: after a lock ends, the creator takes their LP tokens back.
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
        const me = await currentUser();
        if (!me) return json({ error: "Please sign in first." }, 401);
        const r = checkPlan({ ...b.plan, chain: "solana" }, {});
        if ("error" in r) return json({ error: r.error }, 400);
        const taken = takenError(await namesTaken(r.plan.name, r.plan.symbol));
        if (taken) return json({ error: taken }, 409);
        const built = await buildMint(owner, r.plan);
        await saveLogo("solana", built.mint, r.plan.logo, me.id).catch(() => {});
        // Holder rewards: what the rewards wallet does with this coin's fee, fixed now (the mint's key is thrown away).
        if (r.plan.reward && built.creatorFeeBps > 0) {
          const { error } = await supabaseService().from("sol_reward_coins").insert({
            mint: built.mint, creator: owner, reward: r.plan.reward, fee_bps: built.creatorFeeBps, platform_bps: built.platformBps,
            holder_bps: Math.round((r.plan.holderPercent ?? 0) * 100), tax_wallet: r.plan.taxWallet, user_id: me.id,
          });
          if (error) return json({ error: "Couldn't set up holder rewards. Try again." }, 500);
        }
        return json(built);
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
      case "lock": {
        if (!SOL_ADDR.test(String(b.lpMint || ""))) return json({ error: "Missing the pool's LP token." }, 400);
        if (!isLock(b.lock) || b.lock === "burn") return json({ error: "Choose 6 months or 1 year." }, 400);
        const unlockAt = Math.floor(Date.now() / 1000) + LOCK_SECONDS[b.lock as "6m" | "1y"];
        return json(await buildLockLp(owner, b.lpMint, unlockAt));
      }
      case "claim": {
        if (!SOL_ADDR.test(String(b.lpMint || ""))) return json({ error: "Missing the pool's LP token." }, 400);
        return json(await buildClaimLp(owner, b.lpMint));
      }
      case "create-pool": {
        // A Raydium pool for a token that has none yet: the creator sets both amounts (that sets the starting price).
        if (!SOL_ADDR.test(String(b.mint || ""))) return json({ error: "That isn't a Solana token address." }, 400);
        const info = await connection().getParsedAccountInfo(new PublicKey(b.mint)).catch(() => null);
        const dec = Number((info?.value?.data as any)?.parsed?.info?.decimals);
        if (!Number.isInteger(dec)) return json({ error: "No token found at that address on Solana." }, 404);
        let tokens = 0n, lamports = 0n;
        try { tokens = parseUnits(String(b.tokens || ""), dec); lamports = parseUnits(String(b.sol || ""), 9); } catch {}
        if (tokens <= 0n || lamports <= 0n) return json({ error: "Type how many tokens and how much SOL to put in." }, 400);
        if (lamports < 10_000_000n) return json({ error: "Put in at least 0.01 SOL." }, 400);
        if (await findPool(b.mint).catch(() => null)) return json({ error: "That token already has a pool. Add liquidity to it instead." }, 400);
        return json(await buildPool(owner, b.mint, tokens, lamports));
      }
      case "balance": {
        // How many of this token the wallet holds (to fill in "all my tokens").
        if (!SOL_ADDR.test(String(b.mint || ""))) return json({ error: "That isn't a Solana token address." }, 400);
        const r = await connection().getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(b.mint) }).catch(() => null);
        const accs = r?.value || [];
        const amount = accs.reduce((t, a) => t + BigInt((a.account.data as any).parsed.info.tokenAmount.amount), 0n);
        const decimals = accs[0] ? Number((accs[0].account.data as any).parsed.info.tokenAmount.decimals) : null;
        const sol = await connection().getBalance(new PublicKey(owner)).catch(() => 0);
        return json({ amount: amount.toString(), decimals, sol: String(sol) });
      }
      case "resume": {
        // A token made here earlier whose launch stopped after step 1: its creation transaction, so the launch can
        // carry on with this token (the pool, then the burn or lock) instead of making a new one.
        if (!SOL_ADDR.test(String(b.mint || ""))) return json({ error: "That isn't a Solana token address." }, 400);
        const conn = connection();
        const sigs = await conn.getSignaturesForAddress(new PublicKey(b.mint), { limit: 1000 });
        const first = sigs[sigs.length - 1];
        if (!first) return json({ error: "No token found at that address on Solana." }, 404);
        const tx = await conn.getParsedTransaction(first.signature, { maxSupportedTransactionVersion: 0 });
        const payer = tx?.transaction.message.accountKeys[0]?.pubkey.toBase58();
        if (payer !== owner) return json({ error: "That token was made by another wallet. Connect the wallet that made it." }, 400);
        return json({ mint: b.mint, sig: first.signature });
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
    if ((action === "lock" || action === "claim") && /AUTISTIK Solana Locker|LP tokens|no lock|Still locked/.test(String(e?.message))) return json({ error: String(e.message) }, 400);
    return json({ error: `Couldn't prepare the ${CHAINS.solana.name} transaction. Try again in a moment.` }, 502);
  }
}
