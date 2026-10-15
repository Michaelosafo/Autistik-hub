import { rateLimit } from "@/lib/ratelimit";
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { json } from "@/lib/ai";
import { CHAINS, type ChainKey } from "@/lib/launchpad";
import { lookupToken } from "@/lib/market";
import { supabaseService } from "@/lib/supabase/server";
import { TREASURY, TRENDING_HOURS, TRENDING_USD, bnbPriceUsd, weiFor } from "@/lib/trending";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Payments older than this can't be claimed, so old transfers to the treasury can't be reused. */
const MAX_AGE_SECONDS = 48 * 3600;
/** BNB moves while a payment confirms; accept payments within 5% of today's price. */
const SLACK = 95n;

// Turns a confirmed BNB payment to the treasury wallet into a trending slot, and lists the token on the
// Launch Pad if it isn't there yet. Everything is checked on BNB Chain; nothing is taken from the request
// except which token the payment is for.
export async function POST(req: Request) {
  const slow = await rateLimit(req, "trending-pay", 10, 600);
  if (slow) return slow;
  if (!TREASURY) return json({ error: "Trending payments aren't open yet." }, 503);
  const body = await req.json().catch(() => null);
  const chain = CHAINS[body?.chain as ChainKey];
  const tokenIn = String(body?.token || "");
  const txHash = String(body?.txHash || "").toLowerCase();
  if (!chain) return json({ error: "Pick the chain your token is on." }, 400);
  if (!isAddress(tokenIn)) return json({ error: "That isn't a token address." }, 400);
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return json({ error: "That isn't a transaction hash." }, 400);
  const token = getAddress(tokenIn);

  const sb = supabaseService();
  const { data: seen } = await sb.from("launch_promotions").select("token,ends_at").eq("tx_hash", txHash).maybeSingle();
  if (seen) return seen.token === token ? json({ endsAt: seen.ends_at }) : json({ error: "That payment was already used for another token." }, 409);

  const bsc = createPublicClient({ transport: http(CHAINS.bsc.rpc) });
  let tx, receipt, block;
  try {
    receipt = await bsc.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 45_000 });
    [tx, block] = await Promise.all([bsc.getTransaction({ hash: txHash as `0x${string}` }), bsc.getBlock({ blockNumber: receipt.blockNumber })]);
  } catch {
    return json({ error: "Couldn't find that payment on BNB Chain yet. Try again in a minute." }, 404);
  }
  if (receipt.status !== "success") return json({ error: "That payment failed on-chain." }, 400);
  if (!tx.to || getAddress(tx.to) !== getAddress(TREASURY)) return json({ error: "That payment didn't go to the AUTISTIK trending wallet." }, 400);
  if (Date.now() / 1000 - Number(block.timestamp) > MAX_AGE_SECONDS) return json({ error: "That payment is more than 2 days old. Send a new one." }, 400);
  // Payments made from this site carry the token address, so they can only be claimed for that token.
  if (tx.input && tx.input !== "0x" && tx.input.toLowerCase() !== token.toLowerCase()) return json({ error: "That payment was made for a different token." }, 400);

  const price = await bnbPriceUsd();
  if (!price) return json({ error: "Couldn't get the BNB price right now. Try again in a minute." }, 502);
  const need = weiFor(TRENDING_USD, price);
  if (tx.value * 100n < need * SLACK) return json({ error: `That payment is less than $${TRENDING_USD} of BNB. Send the amount shown on the page.` }, 400);

  // Make sure the token is on the board: launched here, or listed now from its DexScreener pool.
  const { data: known } = await sb.from("launches").select("token").eq("chain", chain.key).eq("token", token).maybeSingle();
  let listing: { pair: string; name: string; symbol: string } | null = null;
  if (!known) {
    listing = await lookupToken(chain.key, token);
    if (!listing) return json({ error: `We couldn't find a trading pool for this token on ${chain.name} on DexScreener. It needs liquidity before it can be listed. Your payment hasn't been used, so you can claim it again once the pool shows up.` }, 400);
  }

  // Paying again while trending adds the time on top of the current slot.
  const now = Date.now();
  const { data: current } = await sb.from("launch_promotions").select("ends_at")
    .eq("chain", chain.key).eq("token", token).gt("ends_at", new Date(now).toISOString())
    .order("ends_at", { ascending: false }).limit(1).maybeSingle();
  const start = current ? Math.max(now, Date.parse(current.ends_at)) : now;
  const endsAt = new Date(start + TRENDING_HOURS * 3600 * 1000).toISOString();

  const { error } = await sb.from("launch_promotions").insert({
    chain: chain.key, token, plan: 100, price: tx.value.toString(), payer: getAddress(tx.from),
    tx_hash: txHash, starts_at: new Date(start).toISOString(), ends_at: endsAt,
  });
  if (error) {
    if (error.code === "23505") return json({ error: "That payment was already used." }, 409);
    return json({ error: "Your payment went through, but trending didn't start. Contact an admin with your transaction link." }, 500);
  }

  if (listing) {
    await sb.from("launches").upsert({
      chain: chain.key, token, pair: listing.pair, creator: getAddress(tx.from), name: listing.name || "Unknown",
      symbol: listing.symbol || "?", supply: "0", tx_hash: txHash, source: "listed",
    }, { onConflict: "tx_hash", ignoreDuplicates: true });
  }
  return json({ endsAt, listed: !!listing });
}
