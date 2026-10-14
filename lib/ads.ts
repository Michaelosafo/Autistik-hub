import type { Ad } from "@/components/AdBar";
import type { BoardToken } from "@/lib/board";

/** Only what the ad slot needs, so pages don't send the whole board to the browser. */
export const toAds = (list: BoardToken[]): Ad[] =>
  list.filter((t) => t.promotedUntil).map((t) => ({
    chain: t.chain, token: t.token, name: t.name, symbol: t.symbol,
    imageUrl: t.market?.imageUrl ?? null, change24h: t.market?.change24h ?? null, promotedUntil: t.promotedUntil!,
  }));
