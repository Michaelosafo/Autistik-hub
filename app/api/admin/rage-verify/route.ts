import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { isEvmRage } from "@/lib/admin-rage";
import { checkRageVerify, submitRageVerify } from "@/lib/rage-verify";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Submits a Rage token's source to the chain explorer after the deploy is confirmed,
 * then checks until the explorer says Pass or Fail. The API key stays on the server.
 * Admins only, after the 2-step code.
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "admin-rage-verify", 20, 60);
  if (slow) return slow;
  const who = await adminState();
  if (!who.staff) return json({ error: "Admins only. Open the Admin page and enter your 2-step code first." }, 403);
  const b = await req.json().catch(() => null);
  const chain = String(b?.chain || "");
  const address = String(b?.address || "");
  const guid = String(b?.guid || "");
  if (!isEvmRage(chain as "bsc")) return json({ status: "unsupported", message: "Rage works on BNB Chain, Ethereum and Robinhood Chain." });
  // EthRise / WanaRobinhood are the owner's only.
  if (chain !== "bsc" && !who.owner) return json({ status: "unsupported", message: "Only the owner can use this chain." });
  try {
    const result = guid
      ? await checkRageVerify(chain, address, guid)
      : await submitRageVerify(chain, address, b?.args);
    return json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Verification failed.";
    return json({ status: "failed", message });
  }
}
