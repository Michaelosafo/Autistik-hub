import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/ratelimit";
import { currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const KINDS = new Set(["swap", "liquidity", "lp-burn"]);
const TX = /^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$/;

// A swap or liquidity change finished in someone's wallet: saved for the admin's activity view. The browser reports
// it, so it's a record of what people did, not proof (the transaction link lets the admin check it on-chain).
export async function POST(req: Request) {
  const slow = await rateLimit(req, "activity", 40, 600);
  if (slow) return new Response(null, { status: 204 });
  const b = await req.json().catch(() => null);
  const kind = String(b?.kind || ""), chain = String(b?.chain || ""), tx = String(b?.tx || "");
  if (!KINDS.has(kind) || !/^[a-z]{2,12}$/.test(chain) || !TX.test(tx)) return new Response(null, { status: 204 });
  // Plain words only: no links or markup can reach the admin page.
  const label = String(b?.label || "").replace(/[^\p{L}\p{N} .,:+()$%→_-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 140);
  const user = await currentUser().catch(() => null);
  logActivity(user?.id ?? null, kind, label || kind, undefined, { chain, tx });
  return new Response(null, { status: 204 });
}
