import { isAddress } from "viem";
import { currentUser } from "@/lib/supabase/server";
import { isLockerChain } from "@/lib/locker";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Notes a new lock in the admin's Site activity panel (the lock itself lives on-chain). */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "lock-log", 20, 3600);
  if (slow) return slow;
  const { chain, token, name, lp } = await req.json().catch(() => ({}));
  if (!isLockerChain(chain) || typeof token !== "string" || !isAddress(token)) return new Response(null, { status: 400 });
  logActivity((await currentUser())?.id, "lock", `Locked ${lp ? "liquidity" : "tokens"}: ${String(name || "token").slice(0, 40)}`, `/lockers`);
  return new Response(null, { status: 204 });
}
