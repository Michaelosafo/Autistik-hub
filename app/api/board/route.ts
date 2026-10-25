import { getBoard } from "@/lib/board";
import { CHAINS, type ChainKey } from "@/lib/launchpad";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Board's live data: every token launched or listed here, with live prices (refreshed by the page every few seconds). */
export async function GET(req: Request) {
  const c = new URL(req.url).searchParams.get("chain") as ChainKey | null;
  const tokens = await getBoard(200, c && CHAINS[c] ? c : undefined);
  return new Response(JSON.stringify({ tokens, at: Date.now() }), {
    headers: { "content-type": "application/json", "cache-control": "public, s-maxage=5, stale-while-revalidate=10" },
  });
}
