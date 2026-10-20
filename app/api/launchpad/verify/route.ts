import { rateLimit } from "@/lib/ratelimit";
import { getAddress, isAddress } from "viem";
import { json } from "@/lib/ai";
import { CHAINS, isSolana, type ChainKey } from "@/lib/launchpad";
import { isVerified, submitVerify, waitVerify } from "@/lib/launch-verify";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Is this token's source already public on its explorer? ok is null when the explorer can't be asked. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const chain = CHAINS[q.get("chain") as ChainKey];
  const token = String(q.get("token") || "");
  if (!chain || isSolana(chain) || !isAddress(token)) return json({ error: "Unknown token." }, 400);
  return json({ ok: await isVerified(chain.key, getAddress(token)).catch(() => null) });
}

/**
 * Publishes a Launch Pad token's source on its explorer, so it shows as open source. Anyone can ask: it only ever
 * publishes the Launch Pad's own token code for a token that's on the list.
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "launch-verify", 6, 600);
  if (slow) return slow;
  const b = await req.json().catch(() => null);
  const chain = CHAINS[b?.chain as ChainKey];
  if (!chain || isSolana(chain) || !isAddress(String(b?.token || ""))) return json({ error: "Unknown token." }, 400);
  const token = getAddress(b.token);
  const { data: launch } = await supabaseService().from("launches").select("tx_hash,source").eq("chain", chain.key).eq("token", token).maybeSingle();
  if (!launch || launch.source !== "launchpad") return json({ error: "Only tokens launched on the AUTISTIK Launch Pad can be verified here." }, 404);
  try {
    if (await isVerified(chain.key, token)) return json({ message: `✓ Already open source on the ${chain.name} explorer.`, ok: true });
    const sub = await submitVerify(chain.key, token, launch.tx_hash as `0x${string}`);
    return json("guid" in sub ? await waitVerify(chain.key, sub.guid) : sub);
  } catch (e: any) {
    console.error("launch verify:", String(e?.message || e).slice(0, 300));
    return json({ message: `Couldn't reach the ${chain.name} explorer. Try again in a minute.` });
  }
}
