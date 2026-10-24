import { json } from "@/lib/ai";
import { getBoard, trending, type BoardToken } from "@/lib/board";
import { CHAINS } from "@/lib/launchpad";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The side column of the three-column layout (components/RailShell.tsx): three tabs of Launch Pad tokens.
 *  - trending: paid trending slots first, then by trading activity (the same order as the Trending page)
 *  - gainers: biggest 24h price rise among tokens that trade
 *  - newest: the latest launches and listings
 * Public data, cached for a minute.
 */
const toTok = (t: BoardToken) => ({
  chain: t.chain, chainName: CHAINS[t.chain]?.name ?? t.chain, token: t.token, name: t.name, symbol: t.symbol, created_at: t.created_at,
  priceUsd: t.market?.priceUsd ?? null, change24h: t.market?.change24h ?? null, imageUrl: t.market?.imageUrl ?? null, promoted: !!t.promotedUntil,
});
type Side = { trending: ReturnType<typeof toTok>[]; gainers: ReturnType<typeof toTok>[]; newest: ReturnType<typeof toTok>[] };
let cache: { at: number; data: Side } | null = null;

export async function GET() {
  if (!cache || Date.now() - cache.at > 60_000) {
    const board = await getBoard(80).catch(() => [] as BoardToken[]);
    cache = {
      at: Date.now(),
      data: {
        trending: trending(board).slice(0, 5).map(toTok),
        gainers: board.filter((t) => t.market?.change24h != null && (t.market?.volume24h ?? 0) > 0)
          .sort((a, b) => (b.market!.change24h! - a.market!.change24h!)).slice(0, 5).map(toTok),
        newest: [...board].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5).map(toTok),
      },
    };
  }
  return json(cache.data);
}
