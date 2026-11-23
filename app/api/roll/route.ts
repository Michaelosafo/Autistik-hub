import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { currentUser, supabaseService } from "@/lib/supabase/server";
import { checkHolder, join, rollState } from "@/lib/roll-dice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Roll the Dice (real AUTISTIK). GET: the round, players, pot and recent results (and settles a round that's due).
 * POST { action: "check", address } → can this wallet play (holds $10+ of AUTISTIK)?
 * POST { action: "join", tx } → verify the $0.50 entry payment on chain and join the round.
 * See lib/roll-dice.ts.
 */
export async function GET() {
  const user = await currentUser();
  try { return json(await rollState(user?.id ?? null)); }
  catch (e) { return json({ error: (e as Error).message }, 500); }
}

export async function POST(req: Request) {
  const slow = await rateLimit(req, "roll", 20, 60);
  if (slow) return slow;
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to play." }, 401);
  const b = await req.json().catch(() => ({}));
  try {
    if (b?.action === "check") {
      const a = String(b.address || "");
      if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return json({ error: "Connect a BNB Chain wallet." }, 400);
      return json(await checkHolder(a));
    }
    if (b?.action === "join") {
      if (b.adult !== true) return json({ error: "Confirm you're 18 or older to play." }, 400);
      const { data } = await supabaseService().from("profiles").select("alias").eq("id", user.id).maybeSingle();
      return json(await join(user.id, String(data?.alias || "Player"), String(b.tx || "")));
    }
    return json({ error: "Unknown." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message.slice(0, 300) }, 400);
  }
}
