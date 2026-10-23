import { createPublicClient, decodeEventLog, erc20Abi, formatUnits, getAddress, http } from "viem";
import { rateLimit } from "@/lib/ratelimit";
import { json } from "@/lib/ai";
import { supabaseService, currentUser } from "@/lib/supabase/server";
import { WCHAINS } from "@/lib/wallet-chains";

export const runtime = "nodejs";
const c = WCHAINS.bsc;
const pub = createPublicClient({ chain: c.viem, transport: http(c.rpc) }) as any;

/**
 * Record a token transfer sent from a live session. The member signs the transfer in their own wallet; this route
 * only checks on-chain that the transaction really moved that token from their linked wallet to the recipient, then
 * keeps a record. The site never holds funds or keys.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return json({ error: "Please sign in first." }, 401);
  const slow = await rateLimit(req, "tip", 30, 600, user.id);
  if (slow) return slow;
  const b = await req.json().catch(() => null);
  const hash = String(b?.hash || "");
  const session = /^[0-9a-f-]{36}$/i.test(String(b?.session || "")) ? String(b.session) : null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return json({ error: "That isn't a transaction hash." }, 400);
  const sb = supabaseService();
  const { data: mine } = await sb.from("wallets").select("address").eq("user_id", user.id).maybeSingle();
  if (!mine) return json({ error: "Connect your wallet first." }, 403);

  let receipt: any;
  try { receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 }); }
  catch { return json({ error: "The transaction hasn't confirmed yet. It will still arrive; refresh in a minute." }, 202); }
  if (receipt.status !== "success") return json({ error: "That transaction failed on-chain." }, 400);

  for (const log of receipt.logs) {
    let ev: any;
    try { ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics }); } catch { continue; }
    if (ev.eventName !== "Transfer") continue;
    if (getAddress(ev.args.from) !== getAddress(mine.address)) continue;
    const to = getAddress(ev.args.to);
    const token = getAddress(log.address);
    let decimals = 18;
    try { decimals = Number(await pub.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })); } catch {}
    const { data: w } = await sb.from("wallets").select("user_id").eq("address_lower", to.toLowerCase()).maybeSingle();
    const { error } = await sb.from("tips").insert({
      session_id: session, from_user: user.id, to_user: w?.user_id ?? null,
      from_wallet: getAddress(mine.address), to_wallet: to, token, amount: formatUnits(ev.args.value, decimals), tx_hash: hash,
    });
    if (error && error.code !== "23505") return json({ error: "Sent, but the record couldn't be saved." }, 500);
    return json({ ok: true });
  }
  return json({ error: "That transaction wasn't a token transfer from your linked wallet." }, 400);
}
