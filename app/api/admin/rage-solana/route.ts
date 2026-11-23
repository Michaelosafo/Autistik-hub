import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { SOL_ADDR as ADMIN_SOL, rageTaxBps } from "@/lib/admin-rage";
import { rateLimit } from "@/lib/ratelimit";
import { SOL_DECIMALS } from "@/lib/launchpad";
import { SOL_ADDR, buildAddLiquidity, buildPool } from "@/lib/solana-launch";
import { buildAdminCollect, buildAdminMint, buildAdminWithdraw, readAdminToken } from "@/lib/solana-launch-admin";
import { buildMeteoraAdd, buildMeteoraPool, buildMeteoraRemove, isMeteoraPool, meteoraOk } from "@/lib/solana-meteora";
import { parseUnits } from "viem";

// LobbySol pays in USDT: USDT is swapped to SOL (Jupiter) right before liquidity goes in, and SOL back to USDT after
// it comes out. SOL only pays fees.
const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const JUP_KEY = process.env.JUPITER_API_KEY || "";
const JUP = process.env.JUPITER_API || (JUP_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag");
const JUP_H: Record<string, string> = JUP_KEY ? { "x-api-key": JUP_KEY } : {};
async function jupSwap(owner: string, inputMint: string, outputMint: string, amount: bigint, slippageBps = 100) {
  const q = await fetch(`${JUP}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`, { cache: "no-store", headers: JUP_H, signal: AbortSignal.timeout(10_000) }).then((r) => r.json());
  if (!q?.outAmount) throw new Error(q?.error || "Jupiter has no route for that swap right now.");
  const built = await fetch(`${JUP}/swap/v1/swap`, { method: "POST", headers: { "content-type": "application/json", ...JUP_H }, signal: AbortSignal.timeout(12_000), body: JSON.stringify({
    quoteResponse: q, userPublicKey: owner, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" } },
  }) }).then((r) => r.json());
  if (!built?.swapTransaction) throw new Error(built?.error || "Jupiter couldn't build the swap.");
  return { tx: String(built.swapTransaction), out: String(q.outAmount), min: String(q.otherAmountThreshold || q.outAmount) };
}

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Rage on Solana, for an admin who has entered their 2-step code. Builds transactions the admin's own wallet signs:
 * create the token, open a Raydium pool, add liquidity, the first buy (USDT → token), remove that wallet's LP, or
 * collect a Token-2022 transfer fee.
 * Nothing here can move anyone else's money.
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "admin-rage-solana", 40, 600);
  if (slow) return slow;
  // LobbySol is the owner's only.
  const who = await adminState();
  if (!who.staff) return json({ error: "Admins only. Open the Admin page and enter your 2-step code first." }, 403);
  if (!who.owner) return json({ error: "Only the owner can use LobbySol." }, 403);
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
        // Standard tokens: a Meteora DAMM v2 pool (~0.03 SOL). Taxed Token-2022 tokens: Raydium (~0.2 SOL).
        if (await meteoraOk(b.mint)) return json({ ...(await buildMeteoraPool(owner, b.mint, tokens, lamports)), venue: "meteora" });
        return json({ ...(await buildPool(owner, b.mint, tokens, lamports)), venue: "raydium" });
      }
      case "add": {
        if (!SOL_ADDR.test(String(b?.pool || ""))) return json({ error: "Missing the pool." }, 400);
        const side = b?.side === "sol" ? "sol" : "token";
        let amount = 0n;
        try { amount = parseUnits(String(b?.amount || ""), side === "sol" ? 9 : Number(b?.decimals ?? SOL_DECIMALS)); } catch { /* bad number */ }
        if (amount <= 0n) return json({ error: "Type an amount." }, 400);
        if (await isMeteoraPool(b.pool)) {
          if (side !== "sol") return json({ error: "Add to a Meteora pool by its SOL amount." }, 400);
          return json(await buildMeteoraAdd(owner, b.pool, amount));
        }
        return json(await buildAddLiquidity(owner, b.pool, side, amount));
      }
      case "remove": {
        if (!SOL_ADDR.test(String(b?.pool || ""))) return json({ error: "Missing the pool." }, 400);
        const pct = Number(b?.pct);
        if (await isMeteoraPool(b.pool)) return json(await buildMeteoraRemove(owner, b.pool, pct));
        return json(await buildAdminWithdraw(owner, b.pool, pct));
      }
      case "balances": {
        // The wallet's USDT and SOL, and USDT for 1 SOL right now.
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const conn = new Connection(process.env.WALLET_SOLANA_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC || "https://solana-rpc.publicnode.com", "confirmed");
        const pk = new PublicKey(owner);
        const [lamports, accs, px] = await Promise.all([
          conn.getBalance(pk),
          // USDT: every USDT account this wallet owns (the usual one and any extra), read on two nodes so a busy node
          // doesn't show 0, then the wallet's standard USDT account directly as a last check.
          (async () => {
            const nodes = [conn, new Connection("https://solana-rpc.publicnode.com", "confirmed"), new Connection("https://api.mainnet-beta.solana.com", "confirmed")];
            for (const c of nodes) {
              try {
                const r = await c.getParsedTokenAccountsByOwner(pk, { mint: new PublicKey(SOL_USDT) });
                if (r.value.length) return r.value;
              } catch { /* next node */ }
            }
            try {
              const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
              const ata = getAssociatedTokenAddressSync(new PublicKey(SOL_USDT), pk, true);
              const v = await conn.getTokenAccountBalance(ata);
              return [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: v.value.uiAmount } } } } } }];
            } catch { return []; }
          })(),
          fetch(`${JUP}/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${SOL_USDT}&amount=1000000000&slippageBps=100`, { cache: "no-store", headers: JUP_H, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null),
        ]);
        const usdt = (accs as any[]).reduce((a, x) => a + Number(x?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0);
        // SOL's dollar price: Jupiter first, then two public price feeds, so paying with SOL still works when Jupiter is busy.
        let solUsd = px?.outAmount ? Number(px.outAmount) / 1e6 : 0;
        if (!(solUsd > 0)) solUsd = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT", { cache: "no-store", signal: AbortSignal.timeout(5000) }).then((r) => r.json()).then((d) => Number(d?.price) || 0).catch(() => 0);
        if (!(solUsd > 0)) solUsd = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { cache: "no-store", signal: AbortSignal.timeout(5000) }).then((r) => r.json()).then((d) => Number(d?.solana?.usd) || 0).catch(() => 0);
        return json({ sol: lamports / 1e9, usdt, solUsd });
      }
      case "swap-in": {
        // USDT → SOL for the pool side.
        let raw = 0n;
        try { raw = parseUnits(String(b?.usdt || ""), 6); } catch { /* bad number */ }
        if (raw < 500_000n) return json({ error: "Type at least 0.5 USDT." }, 400);
        const r = await jupSwap(owner, SOL_USDT, SOL_MINT, raw);
        return json({ tx: r.tx, sol: Number(r.min) / 1e9, solOut: Number(r.out) / 1e9 });
      }
      case "first-buy": {
        // LobbySol's first buy: USDT → the token, straight after the liquidity goes in (5% slippage for a new pool).
        if (!SOL_ADDR.test(String(b?.mint || ""))) return json({ error: "That isn't a Solana token address." }, 400);
        // Paid with USDT, or with SOL when the wallet holds SOL instead (pay: "sol", sol: amount).
        const paySol = b?.pay === "sol";
        let raw = 0n;
        try { raw = paySol ? parseUnits(String(b?.sol || ""), 9) : parseUnits(String(b?.usdt || ""), 6); } catch { /* bad number */ }
        if (paySol ? raw < 500_000n : raw < 100_000n) return json({ error: paySol ? "The first buy is too small." : "Type at least 0.1 USDT for the first buy." }, 400);
        try {
          const r = await jupSwap(owner, paySol ? SOL_MINT : SOL_USDT, String(b.mint), raw, 500);
          return json({ tx: r.tx, out: r.out });
        } catch (e: any) {
          // A brand-new pool takes a few seconds to show up in Jupiter's routes: the page asks again.
          if (/route|not tradable|TOKEN_NOT_TRADABLE|COULD_NOT_FIND/i.test(String(e?.message || ""))) return json({ wait: true });
          throw e;
        }
      }
      case "swap-out": {
        // SOL → USDT after removing liquidity.
        let raw = 0n;
        try { raw = parseUnits(String(b?.sol || ""), 9); } catch { /* bad number */ }
        if (raw < 1_000_000n) return json({ error: "Too little SOL to swap back." }, 400);
        const r = await jupSwap(owner, SOL_MINT, SOL_USDT, raw);
        return json({ tx: r.tx, usdt: Number(r.out) / 1e6 });
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
