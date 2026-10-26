import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { rateLimit } from "@/lib/ratelimit";
import { supabaseService } from "@/lib/supabase/server";
import { SOL_ADDR, buildCollectFees } from "@/lib/solana-launch";
import { solFeeWallet } from "@/lib/launchpad";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Owner only: transactions for the marketing wallet to collect the trade fee withheld on Solana coins launched here.
 * The connected wallet must be the marketing wallet itself (only it can sign them).
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "admin-sol-fees", 20, 600);
  if (slow) return slow;
  if (!(await adminState()).admin) return json({ error: "Not found." }, 404);
  const b = await req.json().catch(() => null);
  const owner = String(b?.owner || "");
  const feeWallet = solFeeWallet();
  if (!feeWallet) return json({ error: "No Solana marketing wallet is set." }, 400);
  if (!SOL_ADDR.test(owner) || owner !== feeWallet) return json({ error: `Connect the marketing wallet (${feeWallet.slice(0, 4)}…${feeWallet.slice(-4)}) to collect the fees.` }, 400);
  const { data } = await supabaseService().from("launches").select("token").eq("chain", "solana").limit(200);
  const mints = [...new Set((data || []).map((r: any) => String(r.token)).filter((t) => SOL_ADDR.test(t)))];
  try {
    return json(await buildCollectFees(owner, mints));
  } catch (e: any) {
    console.error("admin-sol-fees:", String(e?.message || e).slice(0, 300));
    return json({ error: "Couldn't read the fees from Solana right now. Try again in a minute." }, 502);
  }
}
