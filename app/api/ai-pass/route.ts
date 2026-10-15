import { createPublicClient, getAddress, http } from "viem";
import { json } from "@/lib/ai";
import { AI_FREE_TRIES, AI_PASS_DAYS, AI_PASS_USD, passTag } from "@/lib/aipass";
import { CHAINS } from "@/lib/launchpad";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { TREASURY, bnbPriceUsd, weiFor } from "@/lib/trending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Payments older than this can't be claimed. */
const MAX_AGE_SECONDS = 48 * 3600;
/** BNB moves while a payment confirms; accept payments within 5% of the price. */
const SLACK = 95n;

async function signedInUser() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  return user;
}

async function passUntil(uid: string): Promise<string | null> {
  const { data } = await supabaseService().from("ai_passes").select("ends_at")
    .eq("user_id", uid).gt("ends_at", new Date().toISOString()).order("ends_at", { ascending: false }).limit(1).maybeSingle();
  return data?.ends_at ?? null;
}

// Your AI Pass: free tries left, when your pass ends, and the price in BNB right now.
export async function GET() {
  const user = await signedInUser();
  if (!user) return json({ error: "Please sign in." }, 401);
  const sb = supabaseService();
  const [{ data: trial }, { data: prof }, until, price] = await Promise.all([
    sb.from("ai_trials").select("used").eq("user_id", user.id).maybeSingle(),
    sb.from("profiles").select("is_admin").eq("id", user.id).maybeSingle(),
    passUntil(user.id),
    TREASURY ? bnbPriceUsd() : Promise.resolve(null),
  ]);
  return json({
    usd: AI_PASS_USD, days: AI_PASS_DAYS, freeTries: AI_FREE_TRIES,
    freeLeft: Math.max(AI_FREE_TRIES - (trial?.used ?? 0), 0),
    dailyLimit: Number(process.env.AI_DAILY_LIMIT || 60),
    passUntil: until, admin: !!prof?.is_admin,
    onSale: !!TREASURY && !!price,
    treasury: TREASURY ?? null,
    wei: price ? weiFor(AI_PASS_USD, price).toString() : null,
    tag: passTag(user.id),
  });
}

// Turns a confirmed BNB payment to the treasury into an AI Pass for the signed-in account.
// Everything is checked on BNB Chain; only the transaction hash comes from the request.
export async function POST(req: Request) {
  if (!TREASURY) return json({ error: "AI Passes aren't on sale yet." }, 503);
  const user = await signedInUser();
  if (!user) return json({ error: "Please sign in." }, 401);
  const body = await req.json().catch(() => null);
  const txHash = String(body?.txHash || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return json({ error: "That isn't a transaction hash." }, 400);

  const sb = supabaseService();
  const { data: seen } = await sb.from("ai_passes").select("user_id,ends_at").eq("tx_hash", txHash).maybeSingle();
  if (seen) return seen.user_id === user.id ? json({ passUntil: seen.ends_at }) : json({ error: "That payment was already used." }, 409);

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
  if (Date.now() / 1000 - Number(block.timestamp) > MAX_AGE_SECONDS) return json({ error: "That payment is more than 2 days old." }, 400);
  // The payment carries this account's id, so a payment can't be claimed by someone else.
  if ((tx.input || "0x").toLowerCase() !== passTag(user.id)) return json({ error: "That payment wasn't made from this account's AI Pass button. Use the Pay button while signed in." }, 400);

  const price = await bnbPriceUsd();
  if (!price) return json({ error: "Couldn't get the BNB price right now. Try again in a minute." }, 502);
  if (tx.value * 100n < weiFor(AI_PASS_USD, price) * SLACK) return json({ error: `That payment is less than $${AI_PASS_USD} of BNB.` }, 400);

  // Paying while a pass is active adds the days on top.
  const now = Date.now();
  const current = await passUntil(user.id);
  const start = current ? Math.max(now, Date.parse(current)) : now;
  const endsAt = new Date(start + AI_PASS_DAYS * 86400 * 1000).toISOString();
  const { error } = await sb.from("ai_passes").insert({
    user_id: user.id, tx_hash: txHash, payer: getAddress(tx.from), amount_wei: tx.value.toString(),
    starts_at: new Date(start).toISOString(), ends_at: endsAt,
  });
  if (error) {
    if (error.code === "23505") return json({ error: "That payment was already used." }, 409);
    console.error("ai_passes insert failed (has supabase/ai-pass.sql been run?):", error.message);
    return json({ error: "Your payment went through, but the pass didn't start. Contact an admin with your transaction link." }, 500);
  }
  return json({ passUntil: endsAt });
}
