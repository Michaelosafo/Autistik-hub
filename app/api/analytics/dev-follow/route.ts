import { json } from "@/lib/ai";
import { getAddress } from "viem";
import { isAChain, isChainAddress } from "@/lib/analytics";
import { followDev, unfollowDev } from "@/lib/dev-watch";
import { rateLimit } from "@/lib/ratelimit";
import { currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Follow / unfollow a dev wallet: followers get an alert when it creates a new token. */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "dev-follow", 30, 600);
  if (slow) return slow;
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to follow a dev." }, 401);
  const b = await req.json().catch(() => null);
  const chain = String(b?.chain || ""), raw = String(b?.wallet || "").trim();
  if (!isAChain(chain) || !isChainAddress(chain, raw)) return json({ error: "That isn't a wallet address." }, 400);
  const wallet = chain === "solana" ? raw : getAddress(raw);
  if (b?.on === false) await unfollowDev(user.id, chain, wallet);
  else await followDev(user.id, chain, wallet, b?.from ? String(b.from).slice(0, 64) : null);
  return json({ ok: true, following: b?.on !== false });
}
