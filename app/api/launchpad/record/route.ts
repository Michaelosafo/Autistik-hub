import { createPublicClient, getAddress, http, parseEventLogs } from "viem";
import { json } from "@/lib/ai";
import { CHAINS, ERC20_META_ABI, LAUNCHPAD_ABI, isLive, type ChainKey } from "@/lib/launchpad";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Saves a launch to the public list. Everything stored is read from the chain, never taken from the request.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const chain = CHAINS[body?.chain as ChainKey];
  const txHash = String(body?.txHash || "");
  if (!chain) return json({ error: "Unknown chain." }, 400);
  if (!isLive(chain)) return json({ error: `${chain.name} launches aren't open yet.` }, 400);
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return json({ error: "That isn't a transaction hash." }, 400);

  const client = createPublicClient({ transport: http(chain.rpc) });
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 45_000 });
  } catch {
    return json({ error: "Couldn't find that transaction yet. Try again in a minute." }, 404);
  }
  if (receipt.status !== "success") return json({ error: "That transaction failed on-chain." }, 400);

  const event = parseEventLogs({ abi: LAUNCHPAD_ABI, logs: receipt.logs, eventName: "Launched" }).find(
    (l) => getAddress(l.address) === getAddress(chain.launchpad!)
  );
  if (!event) return json({ error: "That transaction isn't an AUTISTIK Launch Pad launch." }, 400);
  const { token, pair, creator, supply } = event.args;
  const locked = parseEventLogs({ abi: LAUNCHPAD_ABI, logs: receipt.logs, eventName: "LiquidityLocked" }).find(
    (l) => getAddress(l.address) === getAddress(chain.launchpad!) && getAddress(l.args.token) === getAddress(token)
  );
  const unlockAt = locked ? Number(locked.args.unlockAt) : 0;
  // The contract only allows 182 or 365 days, so the length tells us which option was picked.
  const lockDays = locked ? Math.round((unlockAt - Number((await client.getBlock({ blockNumber: receipt.blockNumber })).timestamp)) / 86400) : 0;

  // Cast: viem's types misread optional fields when the project has `strict: false`.
  const read = (functionName: "name" | "symbol") => client.readContract({ address: token, abi: ERC20_META_ABI, functionName } as any) as Promise<string>;
  const [name, symbol] = await Promise.all([read("name"), read("symbol")]).catch(() => ["", ""]);

  const { data: { user } } = await supabaseServer().auth.getUser();
  const row = {
    chain: chain.key,
    token: getAddress(token),
    pair: getAddress(pair),
    creator: getAddress(creator),
    name: String(name).slice(0, 64),
    symbol: String(symbol).slice(0, 24),
    supply: (supply / 10n ** 18n).toString(),
    tx_hash: txHash.toLowerCase(),
    lp_lock: !locked ? "burn" : lockDays > 200 ? "1y" : "6m",
    lp_unlock_at: locked ? new Date(unlockAt * 1000).toISOString() : null,
    user_id: user?.id ?? null,
  };
  const { error } = await supabaseService().from("launches").upsert(row, { onConflict: "tx_hash", ignoreDuplicates: true });
  if (error) return json({ error: "Your token launched, but we couldn't add it to the list. It's still live on-chain." }, 500);
  return json({ launch: row });
}
