import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { isAChain, isChainAddress } from "@/lib/analytics";
import { devReport } from "@/lib/dev-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?chain=&wallet=  A dev wallet's earlier tokens and score (lib/dev-history.ts). Cached for 30 minutes. */
export async function GET(req: Request) {
  const slow = await rateLimit(req, "dev-scan", 12, 600);
  if (slow) return slow;
  const u = new URL(req.url);
  const chain = u.searchParams.get("chain") || "", wallet = u.searchParams.get("wallet") || "";
  if (!isAChain(chain) || !isChainAddress(chain, wallet)) return json({ error: "Pick a network and paste a wallet address." }, 400);
  try { return json({ report: await devReport(chain, wallet) }); }
  catch (e) { console.error("dev api", (e as Error).message); return json({ error: "Couldn't read that wallet right now." }, 502); }
}
