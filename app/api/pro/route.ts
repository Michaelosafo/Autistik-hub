import { createPublicClient, decodeFunctionData, erc20Abi, getAddress, http, parseEventLogs } from "viem";
import { logActivity } from "@/lib/activity";
import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { passTag } from "@/lib/aipass";
import { CHAINS } from "@/lib/launchpad";
import { TREASURY } from "@/lib/trending";
import { PRO_DAYS, PRO_TOKEN, PRO_USD } from "@/lib/pro";
import { autistikPriceUsd, proUntil, unitsFor } from "@/lib/pro-server";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_AGE_SECONDS = 48 * 3600;
/** The price moves while a payment confirms and $AUTISTIK has a small transfer tax: accept 88% or more. */
const SLACK = 88n;

const bsc = () => createPublicClient({ transport: http(CHAINS.bsc.rpc) });
async function decimals() {
  try { return Number(await bsc().readContract({ address: PRO_TOKEN, abi: erc20Abi, functionName: "decimals" } as any)); } catch { return 9; }
}
async function signedIn() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  return user;
}

// Pro status and today's price in $AUTISTIK.
export async function GET() {
  const user = await signedIn();
  const [until, price, dec] = await Promise.all([proUntil(user?.id), TREASURY ? autistikPriceUsd() : Promise.resolve(null), decimals()]);
  return json({
    usd: PRO_USD, days: PRO_DAYS, proUntil: until, signedIn: !!user,
    onSale: !!TREASURY && !!price, treasury: TREASURY ?? null, token: PRO_TOKEN, decimals: dec,
    units: price ? unitsFor(PRO_USD, price, dec).toString() : null,
    tag: user ? passTag(user.id) : null,
  });
}

// Turns a confirmed $AUTISTIK payment to the treasury into Pro for the signed-in account. Everything is checked
// on BNB Chain; only the transaction hash comes from the request.
export async function POST(req: Request) {
  if (!TREASURY) return json({ error: "Pro isn't on sale yet." }, 503);
  const user = await signedIn();
  if (!user) return json({ error: "Please sign in." }, 401);
  const slow = await rateLimit(req, "pro-pay", 10, 600, user.id);
  if (slow) return slow;
  const body = await req.json().catch(() => null);
  const txHash = String(body?.txHash || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return json({ error: "That isn't a transaction hash." }, 400);

  const sb = supabaseService();
  const { data: seen } = await sb.from("pro_passes").select("user_id,ends_at").eq("tx_hash", txHash).maybeSingle();
  if (seen) return seen.user_id === user.id ? json({ proUntil: seen.ends_at }) : json({ error: "That payment was already used." }, 409);

  const pub = bsc();
  let tx, receipt, block;
  try {
    receipt = await pub.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 45_000 });
    [tx, block] = await Promise.all([pub.getTransaction({ hash: txHash as `0x${string}` }), pub.getBlock({ blockNumber: receipt.blockNumber })]);
  } catch {
    return json({ error: "Couldn't find that payment on BNB Chain yet. Try again in a minute." }, 404);
  }
  if (receipt.status !== "success") return json({ error: "That payment failed on-chain." }, 400);
  if (!tx.to || getAddress(tx.to) !== getAddress(PRO_TOKEN)) return json({ error: "That isn't an $AUTISTIK payment." }, 400);
  if (Date.now() / 1000 - Number(block.timestamp) > MAX_AGE_SECONDS) return json({ error: "That payment is more than 2 days old." }, 400);

  // The payment is a normal $AUTISTIK transfer to the treasury with this account's id added at the end,
  // so nobody can claim someone else's payment from BscScan.
  const input = (tx.input || "0x").toLowerCase();
  const tag = passTag(user.id).slice(2);
  if (input.length !== 2 + 8 + 128 + tag.length || !input.endsWith(tag)) {
    return json({ error: "That payment wasn't made from this account's Pro button. Use the Pay button while signed in." }, 400);
  }
  let call;
  try { call = decodeFunctionData({ abi: erc20Abi, data: input.slice(0, 2 + 8 + 128) as `0x${string}` }); } catch { call = null; }
  if (!call || call.functionName !== "transfer" || getAddress(call.args[0] as string) !== getAddress(TREASURY)) {
    return json({ error: "That payment didn't go to the AUTISTIK wallet." }, 400);
  }
  // What actually arrived (after the token's transfer tax).
  const received = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
    .filter((l) => getAddress(l.address) === getAddress(PRO_TOKEN) && getAddress(l.args.to) === getAddress(TREASURY))
    .reduce((a, l) => a + l.args.value, 0n);

  const [price, dec] = await Promise.all([autistikPriceUsd(), decimals()]);
  if (!price) return json({ error: "Couldn't get the $AUTISTIK price right now. Try again in a minute." }, 502);
  if (received * 100n < unitsFor(PRO_USD, price, dec) * SLACK) return json({ error: `That payment is less than $${PRO_USD} of $AUTISTIK.` }, 400);

  // Paying while Pro is active adds the days on top.
  const now = Date.now();
  const current = await proUntil(user.id);
  const start = current && Date.parse(current) < Date.parse("2099-01-01") ? Math.max(now, Date.parse(current)) : now;
  const endsAt = new Date(start + PRO_DAYS * 86400 * 1000).toISOString();
  const { error } = await sb.from("pro_passes").insert({
    user_id: user.id, tx_hash: txHash, payer: getAddress(tx.from), amount: received.toString(), starts_at: new Date(start).toISOString(), ends_at: endsAt,
  });
  if (error) {
    if (error.code === "23505") return json({ error: "That payment was already used." }, 409);
    console.error("pro_passes insert failed:", error.message);
    return json({ error: "Your payment went through, but Pro didn't start. Contact an admin with your transaction link." }, 500);
  }
  logActivity(user.id, "pro", `Paid for Pro until ${endsAt.slice(0, 10)}`, "/pro");
  return json({ proUntil: endsAt });
}
