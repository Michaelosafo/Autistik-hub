import { getAddress, isAddress } from "viem";
import { adminState } from "@/lib/admin";
import { currentUser, supabaseService } from "@/lib/supabase/server";
import { isLockerChain, LOCKER_CHAINS } from "@/lib/locker";
import { LOCKER_RUNTIME } from "@/lib/locker-build";
import { lockerClient, lockerSites } from "@/lib/locker-server";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, status = 200) => Response.json(body, { status });
// The build fingerprint at the end of the code (its length is in the last 2 bytes) changes with file names, e.g. when
// deployed from the single-file version in Remix. Everything before it must match exactly.
const body = (hex: string) => { const h = hex.toLowerCase().replace(/^0x/, ""); const n = parseInt(h.slice(-4), 16); return isFinite(n) && (n + 2) * 2 < h.length ? h.slice(0, h.length - (n + 2) * 2) : h; };

/** Admin only: saves a locker the admin just deployed, after checking on-chain that it is exactly our contract. */
export async function POST(req: Request) {
  if (!(await adminState()).admin) return json({ error: "Admins only. Open the Admin page and enter your 2-step code first." }, 403);
  const { chain, txHash } = await req.json().catch(() => ({}));
  if (!isLockerChain(chain)) return json({ error: "Unknown chain." }, 400);
  const input = typeof txHash === "string" ? txHash.trim() : "";
  const isHash = /^0x[0-9a-fA-F]{64}$/.test(input);
  if (!isHash && !isAddress(input)) return json({ error: "Paste the deploy transaction hash (0x + 64 characters) or the locker's address (0x + 40 characters)." }, 400);
  const name = LOCKER_CHAINS[chain].name;
  const c = lockerClient(chain);
  let address: `0x${string}`;
  if (isHash) {
    // The network can take a few seconds to show a new transaction everywhere.
    let r: any = null;
    for (let i = 0; i < 3 && !r; i++) {
      r = await c.getTransactionReceipt({ hash: input as `0x${string}` }).catch((e: any) => { console.error("locker receipt", chain, e?.shortMessage || e?.message); return null; });
      if (!r && i < 2) await new Promise((ok) => setTimeout(ok, 3000));
    }
    if (!r) return json({ error: `Couldn't find that transaction on ${name}. Check it's the right chain, or paste the locker's address instead.` }, 404);
    if (r.status !== "success") return json({ error: "That transaction failed on-chain, so no locker was created. Deploy again." }, 400);
    if (!r.contractAddress) return json({ error: "That transaction didn't create a contract. Paste the deploy transaction, or the locker's address." }, 400);
    address = getAddress(r.contractAddress);
  } else address = getAddress(input);
  // getCode gives nothing for an address without a contract, and FAILED when the chain couldn't be reached.
  const code: string | undefined = await c.getCode({ address }).catch((e: any) => { console.error("locker code", chain, e?.shortMessage || e?.message); return "FAILED"; });
  if (code === "FAILED") return json({ error: `Couldn't reach ${name} right now. Try again in a minute.` }, 503);
  if (!code || code === "0x") return json({ error: `There's no contract at ${address} on ${name}. Check the chain and the address.` }, 400);
  if (body(code) !== body(LOCKER_RUNTIME)) return json({ error: `The contract at ${address} isn't the AUTISTIK Locker (its code doesn't match), so it wasn't saved. Use the Deploy button, or compile the single file with 0.8.24, optimizer 200 runs, EVM paris.` }, 400);
  const { error } = await supabaseService().from("locker_contracts").upsert({ chain, address, tx_hash: isHash ? input : null, verified: false, deployed_at: new Date().toISOString() }, { onConflict: "chain" });
  if (error) { console.error("locker save", error.message); return json({ error: "Couldn't save it. Try again." }, 500); }
  await lockerSites(true);
  logActivity((await currentUser())?.id, "locker", `Locker deployed on ${LOCKER_CHAINS[chain].name}`, "/lockers");
  return json({ ok: true, address });
}
