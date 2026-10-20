import { rateLimit } from "@/lib/ratelimit";
import { logActivity } from "@/lib/activity";
import { createPublicClient, getAddress, http, parseEventLogs } from "viem";
import { json } from "@/lib/ai";
import { CHAINS, ERC20_META_ABI, LAUNCHPAD_ABI, LAUNCH_TOKEN_ABI, type ChainKey } from "@/lib/launchpad";
import { padOn } from "@/lib/launchpad-server";
import { LOCKER_ABI } from "@/lib/locker";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { launchAccess } from "@/lib/admin";
import { isAChain, scanToken } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 60;

// Saves a launch to the public list. Everything stored is read from the chain, never taken from the request.
export async function POST(req: Request) {
  const slow = await rateLimit(req, "launch-record", 20, 600);
  if (slow) return slow;
  if (!(await launchAccess()).allowed) return json({ error: "The Launch Pad is coming soon." }, 403);
  const body = await req.json().catch(() => null);
  const chain = CHAINS[body?.chain as ChainKey];
  const txHash = String(body?.txHash || "");
  if (!chain) return json({ error: "Unknown chain." }, 400);
  const pad = await padOn(chain.key);
  if (!pad) return json({ error: `${chain.name} launches aren't open yet.` }, 400);
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return json({ error: "That isn't a transaction hash." }, 400);

  const client = createPublicClient({ transport: http(chain.rpc) });
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 45_000 });
  } catch {
    return json({ error: "Couldn't find that transaction yet. Try again in a minute." }, 404);
  }
  if (receipt.status !== "success") return json({ error: "That transaction failed on-chain." }, 400);

  const event = parseEventLogs({ abi: LAUNCHPAD_ABI, logs: receipt.logs, eventName: "Launched" }).find((l) => getAddress(l.address) === pad);
  if (!event) return json({ error: "That transaction isn't an AUTISTIK Launch Pad launch." }, 400);
  const { token, pair, creator, lockOption, lockId } = event.args;
  const supply = (await client.readContract({ address: token, abi: LAUNCH_TOKEN_ABI, functionName: "totalSupply" } as any)) as bigint;
  // Locked liquidity sits in the AUTISTIK Locker: its unlock date comes from the lock itself.
  let unlockAt = 0;
  if (lockOption !== 0) {
    const locker = (await client.readContract({ address: pad, abi: LAUNCHPAD_ABI, functionName: "locker" } as any)) as `0x${string}`;
    const l = (await client.readContract({ address: locker, abi: LOCKER_ABI, functionName: "getLockById", args: [lockId] } as any)) as any;
    unlockAt = Number(l.tgeDate);
  }

  // Cast: viem's types misread optional fields when the project has `strict: false`.
  const read = (functionName: "name" | "symbol") => client.readContract({ address: token, abi: ERC20_META_ABI, functionName } as any) as Promise<string>;
  const [name, symbol] = await Promise.all([read("name"), read("symbol")]).catch(() => ["", ""]);

  // The launch is only tied to this account if the account's linked wallet is the one that launched it.
  const { data: { user } } = await supabaseServer().auth.getUser();
  let owner: string | null = null;
  if (user) {
    const { data: w } = await supabaseService().from("wallets").select("address").eq("user_id", user.id);
    if ((w || []).some((x: any) => String(x.address).toLowerCase() === String(creator).toLowerCase())) owner = user.id;
  }
  const row = {
    chain: chain.key,
    token: getAddress(token),
    pair: getAddress(pair),
    creator: getAddress(creator),
    name: String(name).slice(0, 64),
    symbol: String(symbol).slice(0, 24),
    supply: (supply / 10n ** 18n).toString(),
    tx_hash: txHash.toLowerCase(),
    lp_lock: lockOption === 0 ? "burn" : lockOption === 2 ? "1y" : "6m",
    lp_unlock_at: lockOption !== 0 ? new Date(unlockAt * 1000).toISOString() : null,
    user_id: owner,
  };
  const { error } = await supabaseService().from("launches").upsert(row, { onConflict: "tx_hash", ignoreDuplicates: true });
  if (error) return json({ error: "Your token launched, but we couldn't add it to the list. It's still live on-chain." }, 500);
  // Analytics follows every token launched here: its top wallets and the creator as the dev.
  if (isAChain(chain.key)) await scanToken(chain.key, row.token, { dev: row.creator, userId: owner }).catch(() => null);
  logActivity(owner, "launch", `Launched ${row.symbol || row.token} on ${chain.name}`, `/launchpad/${chain.key}/${row.token}`);
  return json({ launch: row });
}
