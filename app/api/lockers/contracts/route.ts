import { getAddress } from "viem";
import { adminState } from "@/lib/admin";
import { currentUser, supabaseService } from "@/lib/supabase/server";
import { isLockerChain, LOCKER_CHAINS } from "@/lib/locker";
import { LOCKER_RUNTIME } from "@/lib/locker-build";
import { lockerClient, lockerSites } from "@/lib/locker-server";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status });
// The build fingerprint at the end of the code (its length is in the last 2 bytes) changes with file names, e.g. when
// deployed from the single-file version in Remix. Everything before it must match exactly.
const body = (hex: string) => { const h = hex.toLowerCase().replace(/^0x/, ""); const n = parseInt(h.slice(-4), 16); return isFinite(n) && (n + 2) * 2 < h.length ? h.slice(0, h.length - (n + 2) * 2) : h; };

/** Admin only: saves a locker the admin just deployed, after checking on-chain that it is exactly our contract. */
export async function POST(req: Request) {
  if (!(await adminState()).admin) return json({ error: "Admins only. Open the Admin page and enter your 2-step code first." }, 403);
  const { chain, txHash } = await req.json().catch(() => ({}));
  if (!isLockerChain(chain)) return json({ error: "Unknown chain." }, 400);
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return json({ error: "That isn't a transaction hash." }, 400);
  const c = lockerClient(chain);
  let address: `0x${string}` | null = null;
  try {
    const r = await c.getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (r.status !== "success" || !r.contractAddress) return json({ error: "That transaction didn't create a contract." }, 400);
    address = getAddress(r.contractAddress);
  } catch { return json({ error: `Couldn't find that transaction on ${LOCKER_CHAINS[chain].name} yet. Wait a minute and press "Try saving again".` }, 404); }
  const code = await c.getCode({ address }).catch(() => null);
  if (!code || body(code) !== body(LOCKER_RUNTIME)) return json({ error: "That contract isn't the AUTISTIK Locker (its code doesn't match), so it wasn't saved." }, 400);
  const { error } = await supabaseService().from("locker_contracts").upsert({ chain, address, tx_hash: txHash, verified: false, deployed_at: new Date().toISOString() }, { onConflict: "chain" });
  if (error) return json({ error: "Couldn't save it. Try again." }, 500);
  await lockerSites(true);
  logActivity((await currentUser())?.id, "locker", `Locker deployed on ${LOCKER_CHAINS[chain].name}`, "/lockers");
  return json({ ok: true, address });
}
