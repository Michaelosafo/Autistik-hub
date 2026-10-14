import { CHAINS, type ChainKey } from "@/lib/launchpad";
import { getMarkets, type Market } from "@/lib/market";
import { supabaseServer } from "@/lib/supabase/server";

export type BoardToken = {
  chain: ChainKey;
  token: string;
  pair: string;
  name: string;
  symbol: string;
  created_at: string;
  /** "launchpad" = launched here, "listed" = launched elsewhere and paid to be listed. */
  source: "launchpad" | "listed";
  watchers: number;
  /** When the paid trending slot ends, if one is running. */
  promotedUntil: string | null;
  market: Market | null;
};

const key = (chain: string, token: string) => `${chain}:${token.toLowerCase()}`;

/** Everything the Launch Pad pages show: launches with live prices, watcher counts and paid trending slots. */
export async function getBoard(limit = 200): Promise<BoardToken[]> {
  const sb = supabaseServer();
  const now = new Date().toISOString();
  const [{ data: launches }, { data: promos }, { data: counts }] = await Promise.all([
    sb.from("launches").select("*").order("created_at", { ascending: false }).limit(limit),
    sb.from("launch_promotions").select("chain,token,ends_at").gt("ends_at", now),
    sb.from("launch_watch_counts").select("chain,token,watchers"),
  ]);
  const rows = (launches || []).filter((l: any) => CHAINS[l.chain as ChainKey]);
  const until = new Map<string, string>();
  for (const p of promos || []) {
    const k = key(p.chain, p.token);
    if (!until.has(k) || until.get(k)! < p.ends_at) until.set(k, p.ends_at);
  }
  const watchers = new Map((counts || []).map((c: any) => [key(c.chain, c.token), c.watchers as number]));
  const markets = await getMarkets(rows.map((r: any) => ({ chain: r.chain, token: r.token })));
  return rows.map((r: any) => ({
    // Only the public fields: rows are read with * so the board keeps working before new columns exist.
    chain: r.chain, token: r.token, pair: r.pair, name: r.name, symbol: r.symbol, created_at: r.created_at,
    source: r.source === "listed" ? "listed" : "launchpad",
    watchers: watchers.get(key(r.chain, r.token)) ?? 0,
    promotedUntil: until.get(key(r.chain, r.token)) ?? null,
    market: markets[r.token.toLowerCase()] ?? null,
  }));
}

/** Paid slots first (newest purchase ending last first), then the busiest tokens by 24h volume and trades. */
export function trending(list: BoardToken[]) {
  const organic = (t: BoardToken) => (t.market?.volume24h ?? 0) + (t.market?.txns24h ?? 0) * 10;
  return [...list].sort((a, b) => {
    if (!!a.promotedUntil !== !!b.promotedUntil) return a.promotedUntil ? -1 : 1;
    if (a.promotedUntil && b.promotedUntil) return b.promotedUntil.localeCompare(a.promotedUntil);
    return organic(b) - organic(a);
  });
}

export const mostWatched = (list: BoardToken[]) => [...list].filter((t) => t.watchers > 0).sort((a, b) => b.watchers - a.watchers);

/** Tokens currently paying to trend; shown as ads around the Launch Pad. */
export const ads = (list: BoardToken[]) => trending(list).filter((t) => t.promotedUntil);
