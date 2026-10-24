import { rateLimit } from "@/lib/ratelimit";
import { json } from "@/lib/ai";
import { SOL_ADDR } from "@/lib/solana-launch";
import { buildJupClaim, buildJupLock, listJupLocks, tokenInfo } from "@/lib/solana-jup-lock";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Solana locks on the Lockers page (lib/solana-jup-lock.ts, through Jupiter Lock). Builds transactions for the
 * member's own wallet to sign; nothing here can move anyone's tokens by itself.
 *   info  → a token's ticker, decimals and the wallet's balance
 *   lock  → lock an amount until a date
 *   claim → take a finished lock back
 *   list  → locks for a wallet or for a token
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "lock-solana", 40, 600);
  if (slow) return slow;
  const b = await req.json().catch(() => null);
  const action = String(b?.action || "");
  const owner = String(b?.owner || "");
  const mint = String(b?.mint || "");
  try {
    switch (action) {
      case "info": {
        if (!SOL_ADDR.test(owner) || !SOL_ADDR.test(mint)) return json({ error: "Connect a wallet and paste a token address." }, 400);
        const r = await tokenInfo(owner, mint);
        return "error" in r ? json(r, 400) : json(r);
      }
      case "lock": {
        if (!SOL_ADDR.test(owner) || !SOL_ADDR.test(mint)) return json({ error: "Connect a wallet and paste a token address." }, 400);
        if (!/^\d{1,20}$/.test(String(b?.amount || ""))) return json({ error: "Type an amount." }, 400);
        const unlockAt = Math.floor(Number(b?.unlockAt));
        if (!Number.isFinite(unlockAt)) return json({ error: "Pick an unlock date." }, 400);
        return json(await buildJupLock(owner, mint, BigInt(b.amount), unlockAt));
      }
      case "claim": {
        const escrow = String(b?.escrow || "");
        if (!SOL_ADDR.test(owner) || !SOL_ADDR.test(escrow)) return json({ error: "Missing the lock." }, 400);
        return json(await buildJupClaim(owner, escrow));
      }
      case "list": {
        if (SOL_ADDR.test(owner)) return json({ locks: await listJupLocks({ recipient: owner }) });
        if (SOL_ADDR.test(mint)) return json({ locks: await listJupLocks({ mint }) });
        return json({ error: "Paste a token address." }, 400);
      }
    }
    return json({ error: "Not found." }, 404);
  } catch (e: any) {
    const m = String(e?.message || e);
    console.error(`lock-solana ${action}:`, m.slice(0, 300));
    // Our own messages are written for people; anything else is a network problem.
    if (/^(Type|Pick|Locks|This wallet|Only|That |Still|This lock)/.test(m)) return json({ error: m }, 400);
    return json({ error: "Couldn't reach Solana. Try again in a moment." }, 502);
  }
}
