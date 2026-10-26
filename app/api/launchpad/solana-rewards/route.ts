import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { supabaseService } from "@/lib/supabase/server";
import { SOL_ADDR } from "@/lib/solana-launch";
import { buildRewardAccount, claim, payoutCoin, rewardsInfo, rewardsReady, rewardsWallet, runCoin } from "@/lib/solana-rewards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Solana holder rewards (lib/solana-rewards.ts).
 *  GET            the job, every 10 minutes from the database's scheduler (supabase/sol-rewards.sql). Anyone can call it,
 *                 but it runs at most once every 8 minutes and does a few coins per run (oldest first).
 *  GET ?status=1  whether rewards are switched on (the rewards wallet key is set in Vercel) and its address.
 *  GET ?mint=…[&holder=…]  a coin's rewards and one holder's.
 *  POST {action:"claim", mint, holder}    sends the holder what they're owed now.
 *  POST {action:"account", mint, holder}  the holder's own transaction to open their account for BTC/ETH rewards.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("status")) return json({ ready: rewardsReady(), wallet: rewardsWallet()?.publicKey.toBase58() ?? null });
  const mint = u.searchParams.get("mint");
  if (mint) {
    if (!SOL_ADDR.test(mint)) return json({ error: "Bad address." }, 400);
    const holder = u.searchParams.get("holder");
    return json({ rewards: await rewardsInfo(mint, holder && SOL_ADDR.test(holder) ? holder : undefined) });
  }
  if (!rewardsReady() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ skipped: "not set up" });
  const sb = supabaseService();
  const { data: go } = await sb.rpc("sol_rewards_lease", { p_seconds: 480 });
  if (go !== true) return json({ skipped: true });
  const { data: coins } = await sb.from("sol_reward_coins").select("*").eq("active", true).order("last_run", { ascending: true, nullsFirst: true }).limit(4);
  const end = Date.now() + 45_000;
  const done: any[] = [];
  for (const c of coins || []) {
    if (Date.now() > end) break;
    try {
      const r = await runCoin(c as any);
      const paid = Date.now() < end ? await payoutCoin(c as any) : 0;
      done.push({ ...r, paid });
    } catch (e) {
      await sb.from("sol_reward_coins").update({ last_run: new Date().toISOString() }).eq("mint", (c as any).mint);
      done.push({ mint: (c as any).mint, error: (e as Error).message.slice(0, 160) });
    }
  }
  return json({ done });
}

export async function POST(req: Request) {
  const slow = await rateLimit(req, "sol-rewards", 20, 600);
  if (slow) return slow;
  const b = await req.json().catch(() => null);
  const mint = String(b?.mint || ""), holder = String(b?.holder || "");
  if (!SOL_ADDR.test(mint) || !SOL_ADDR.test(holder)) return json({ error: "Connect a Solana wallet first." }, 400);
  if (!rewardsReady()) return json({ error: "Rewards aren't switched on yet." }, 503);
  try {
    if (b.action === "account") return json(await buildRewardAccount(mint, holder));
    if (b.action === "claim") {
      const r = await claim(mint, holder);
      return json(r, "error" in r ? (r.error === "needs-account" ? 409 : 400) : 200);
    }
  } catch (e) {
    console.error("sol rewards", (e as Error).message);
    return json({ error: "Couldn't reach Solana. Try again in a minute." }, 502);
  }
  return json({ error: "Unknown action." }, 400);
}
