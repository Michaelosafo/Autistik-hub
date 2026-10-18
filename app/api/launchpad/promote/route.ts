import { rateLimit } from "@/lib/ratelimit";
import { createPublicClient, getAddress, http, parseEventLogs } from "viem";
import { json } from "@/lib/ai";
import { CHAINS, LAUNCHPAD_ABI, type ChainKey } from "@/lib/launchpad";
import { padOn } from "@/lib/launchpad-server";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Turns a confirmed on-chain trending payment into a trending slot. The token, plan, price and length all come
// from the contract's Promoted event, so a payment can't be claimed for a different token or reused.
export async function POST(req: Request) {
  const slow = await rateLimit(req, "promote", 10, 600);
  if (slow) return slow;
  const body = await req.json().catch(() => null);
  const chain = CHAINS[body?.chain as ChainKey];
  const txHash = String(body?.txHash || "");
  if (!chain) return json({ error: "Unknown chain." }, 400);
  const pad = await padOn(chain.key);
  if (!pad) return json({ error: `${chain.name} isn't open yet.` }, 400);
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return json({ error: "That isn't a transaction hash." }, 400);

  const client = createPublicClient({ transport: http(chain.rpc) });
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 45_000 });
  } catch {
    return json({ error: "Couldn't find that payment yet. Try again in a minute." }, 404);
  }
  if (receipt.status !== "success") return json({ error: "That payment failed on-chain." }, 400);
  const event = parseEventLogs({ abi: LAUNCHPAD_ABI, logs: receipt.logs, eventName: "Promoted" }).find(
    (l) => getAddress(l.address) === pad
  );
  if (!event) return json({ error: "That transaction isn't a trending payment." }, 400);
  const { token, payer, planId, price, duration } = event.args;

  const sb = supabaseService();
  const tx = txHash.toLowerCase();
  const { data: seen } = await sb.from("launch_promotions").select("ends_at").eq("tx_hash", tx).maybeSingle();
  if (seen) return json({ endsAt: seen.ends_at });

  // Buying again while trending adds the time on top of the current slot.
  const now = Date.now();
  const { data: current } = await sb.from("launch_promotions").select("ends_at")
    .eq("chain", chain.key).eq("token", getAddress(token)).gt("ends_at", new Date(now).toISOString())
    .order("ends_at", { ascending: false }).limit(1).maybeSingle();
  const start = current ? Math.max(now, Date.parse(current.ends_at)) : now;
  const endsAt = new Date(start + Number(duration) * 1000).toISOString();

  const { error } = await sb.from("launch_promotions").insert({
    chain: chain.key,
    token: getAddress(token),
    plan: Number(planId),
    price: price.toString(),
    payer: getAddress(payer),
    tx_hash: tx,
    starts_at: new Date(start).toISOString(),
    ends_at: endsAt,
  });
  if (error) {
    if (error.code === "23505") return json({ error: "That payment was already used." }, 409);
    return json({ error: "Your payment went through, but we couldn't start trending. Contact an admin with your transaction link." }, 500);
  }
  return json({ endsAt });
}
