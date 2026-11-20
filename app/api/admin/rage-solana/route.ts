import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { SOL_ADDR as ADMIN_SOL, rageTaxBps } from "@/lib/admin-rage";
import { rateLimit } from "@/lib/ratelimit";
import { SOL_DECIMALS } from "@/lib/launchpad";
import { SOL_ADDR, buildAddLiquidity, buildPool } from "@/lib/solana-launch";
import { buildAdminCollect, buildAdminMint, buildAdminWithdraw, readAdminToken } from "@/lib/solana-launch-admin";
import { parseUnits } from "viem";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Rage on Solana, for an admin who has entered their 2-step code. Builds transactions the admin's own wallet signs:
 * create the token, open a Raydium pool, add liquidity, remove that wallet's LP, or collect a Token-2022 transfer fee.
 * Nothing here can move anyone else's money.
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "admin-rage-solana", 40, 600);
  if (slow) return slow;
  if (!(await adminState()).staff) return json({ error: "Admins only. Open the Admin page and enter your 2-step code first." }, 403);
  const b = await req.json().catch(() => null);
  const action = String(b?.action || "");
  const owner = String(b?.owner || "");
  const ownerOk = SOL_ADDR.test(owner) && ADMIN_SOL.test(owner);
  if (action !== "info" && !ownerOk) return json({ error: "Connect a Solana wallet first." }, 400);

  try {
    switch (action) {
      case "mint": {
        const buy = rageTaxBps(b?.buyTax);
        const sell = rageTaxBps(b?.sellTax);
        if (buy == null || sell == null) return json({ error: "Buy tax and sell tax must each be 0–50%." }, 400);
        const feeBps = Math.max(buy, sell);
        const supply = String(b?.supply || "").replace(/[,_\s]/g, "");
        const built = await buildAdminMint(owner, { name: String(b?.name || ""), symbol: String(b?.symbol || ""), supply, feeBps });
        return json({ ...built, buyBps: buy, sellBps: sell });
      }
      case "info": {
        if (!SOL_ADDR.test(String(b?.mint || ""))) return json({ error: "That isn't a Solana token address." }, 400);
        const poolId = SOL_ADDR.test(String(b?.pool || "")) ? String(b.pool) : undefined;
        return json(await readAdminToken(ownerOk ? owner : null, b.mint, poolId));
      }
      case "pool": {
        if (!SOL_ADDR.test(String(b?.mint || ""))) return json({ error: "That isn't a Solana token address." }, 400);
        const info = await readAdminToken(owner, b.mint);
        let tokens = 0n, lamports = 0n;
        try { tokens = parseUnits(String(b?.tokens || ""), info.decimals); lamports = parseUnits(String(b?.sol || ""), 9); } catch { /* bad number */ }
        if (tokens <= 0n || lamports <= 0n) return json({ error: "Type how many tokens and how much SOL to put in." }, 400);
        if (lamports < 10_000_000n) return json({ error: "Put in at least 0.01 SOL." }, 400);
        if (info.pool) return json({ error: "That token already has a pool. Add liquidity to it instead." }, 400);
        return json(await buildPool(owner, b.mint, tokens, lamports));
      }
      case "add": {
        if (!SOL_ADDR.test(String(b?.pool || ""))) return json({ error: "Missing the pool." }, 400);
        const side = b?.side === "sol" ? "sol" : "token";
        let amount = 0n;
        try { amount = parseUnits(String(b?.amount || ""), side === "sol" ? 9 : Number(b?.decimals ?? SOL_DECIMALS)); } catch { /* bad number */ }
        if (amount <= 0n) return json({ error: "Type an amount." }, 400);
        return json(await buildAddLiquidity(owner, b.pool, side, amount));
      }
      case "remove": {
        if (!SOL_ADDR.test(String(b?.pool || ""))) return json({ error: "Missing the pool." }, 400);
        const pct = Number(b?.pct);
        return json(await buildAdminWithdraw(owner, b.pool, pct));
      }
      case "collect": {
        if (!SOL_ADDR.test(String(b?.mint || ""))) return json({ error: "That isn't a Solana token address." }, 400);
        return json(await buildAdminCollect(owner, b.mint));
      }
    }
    return json({ error: "Not found." }, 404);
  } catch (e: any) {
    const m = String(e?.message || "");
    console.error(`admin-rage-solana ${action}:`, m.slice(0, 300));
    if (m && m.length < 220 && !/https?:|api[_-]?key|secret|private key/i.test(m)) return json({ error: m }, 400);
    return json({ error: "Couldn't prepare the Solana transaction. Try again in a moment." }, 502);
  }
}
