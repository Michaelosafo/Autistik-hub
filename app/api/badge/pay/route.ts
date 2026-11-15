import { rateLimit } from "@/lib/ratelimit";
import { createPublicClient, getAddress, http } from "viem";
import { json } from "@/lib/ai";
import { CHAINS } from "@/lib/launchpad";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { TREASURY, bnbPriceUsd, weiFor } from "@/lib/trending";
import { BADGE_DAYS, BADGE_USD, badgeMemo } from "@/lib/badge-pay";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Payments older than this can't be claimed, so old transfers to the treasury can't be reused. */
const MAX_AGE_SECONDS = 48 * 3600;
/** BNB moves while a payment confirms: accept within 5% of today's price. */
const SLACK = 95n;

// Turns a confirmed BNB payment to the treasury into the AUTISTIK sticker badge for a year. Everything is checked on
// BNB Chain: it went to the treasury, it succeeded, it's recent, it's enough, it carries this member's id, and it
// hasn't been used before. Paying again adds a year on top.
export async function POST(req: Request) {
  const slow = await rateLimit(req, "badge-pay", 10, 600);
  if (slow) return slow;
  if (!TREASURY) return json({ error: "Badge payments aren't open yet." }, 503);
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  const body = await req.json().catch(() => null);
  const txHash = String(body?.txHash || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return json({ error: "That isn't a transaction hash." }, 400);

  const sb = supabaseService();
  const { data: seen } = await sb.from("badge_payments").select("user_id,until").eq("tx_hash", txHash).maybeSingle();
  if (seen) return seen.user_id === user.id ? json({ until: seen.until }) : json({ error: "That payment was already used." }, 409);

  const bsc = createPublicClient({ transport: http(CHAINS.bsc.rpc) });
  let tx, receipt, block;
  try {
    receipt = await bsc.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 45_000 });
    [tx, block] = await Promise.all([bsc.getTransaction({ hash: txHash as `0x${string}` }), bsc.getBlock({ blockNumber: receipt.blockNumber })]);
  } catch {
    return json({ error: "Couldn't find that payment on BNB Chain yet. Try again in a minute." }, 404);
  }
  if (receipt.status !== "success") return json({ error: "That payment failed on-chain." }, 400);
  if (!tx.to || getAddress(tx.to) !== getAddress(TREASURY)) return json({ error: "That payment didn't go to the AUTISTIK wallet." }, 400);
  if (Date.now() / 1000 - Number(block.timestamp) > MAX_AGE_SECONDS) return json({ error: "That payment is more than 2 days old. Send a new one." }, 400);
  if ((tx.input || "0x").toLowerCase() !== badgeMemo(user.id)) return json({ error: "That payment wasn't made for your account. Please pay with the button in your panel." }, 400);

  const price = await bnbPriceUsd();
  if (!price) return json({ error: "Couldn't get the BNB price right now. Try again in a minute." }, 502);
  if (tx.value * 100n < weiFor(BADGE_USD, price) * SLACK) return json({ error: `That payment is less than $${BADGE_USD} of BNB.` }, 400);

  const { data: prof } = await sb.from("profiles").select("verified_until,is_verified,is_team").eq("id", user.id).maybeSingle();
  const from = Math.max(Date.now(), prof?.verified_until ? Date.parse(prof.verified_until) : 0);
  const until = new Date(from + BADGE_DAYS * 864e5).toISOString();
  const { error: payErr } = await sb.from("badge_payments").insert({ tx_hash: txHash, user_id: user.id, paid_wei: tx.value.toString(), usd: BADGE_USD, until });
  if (payErr) return json({ error: "That payment was already used." }, 409);
  await sb.from("profiles").update({ is_verified: true, verified_until: until }).eq("id", user.id);
  return json({ until });
}
