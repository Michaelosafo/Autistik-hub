import { rateLimit } from "@/lib/ratelimit";
import { json } from "@/lib/ai";
import { currentUser } from "@/lib/supabase/server";
import { linkBuiltinWallet } from "@/lib/privy-server";

export const runtime = "nodejs";

/** Links the signed-in member's free AUTISTIK wallet to their account, so they can receive tokens by name. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return json({ error: "Please sign in first." }, 401);
  if (!user.email || !user.email_confirmed_at) return json({ error: "Confirm your email first." }, 403);
  const slow = await rateLimit(req, "wallet-auto", 6, 600, user.id);
  if (slow) return slow;
  const address = await linkBuiltinWallet(user.id, user.email);
  if (!address) return json({ error: "Your AUTISTIK wallet isn't ready yet. Connect your own wallet instead." }, 503);
  return json({ address });
}
