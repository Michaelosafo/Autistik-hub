import { CHAINS, type ChainKey } from "@/lib/launchpad";
import { getMarkets, type Market } from "@/lib/market";
import { supabaseServer } from "@/lib/supabase/server";
import { HIDDEN, LISTINGS, TRENDING_ONLY } from "@/lib/listings";

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
  /** The picture chosen at launch (falls back to DexScreener's). */
  logo: string | null;
  /** Allowed on Trending (lib/listings.ts TRENDING_ONLY; every coin when that list is empty). */
  trend: boolean;
};

const key = (chain: string, token: string) => `${chain}:${token.toLowerCase()}`;

/**
 * Everything the Launch Pad pages show: launches with live prices, watcher counts and paid trending slots. Every token
 * launched or listed here is on it: the newest `limit`, plus any older one that is paying to trend right now.
 */
export async function getBoard(limit = 200, chain?: ChainKey): Promise<BoardToken[]> {
  const sb = supabaseServer();
  const now = new Date().toISOString();
  const onChain = (q: any) => (chain ? q.eq("chain", chain) : q);
  const [{ data: launches }, { data: promos }, { data: counts }] = await Promise.all([
    onChain(sb.from("launches").select("*")).order("created_at", { ascending: false }).limit(limit),
    onChain(sb.from("launch_promotions").select("chain,token,ends_at")).gt("ends_at", now),
    onChain(sb.from("launch_watch_counts").select("chain,token,watchers")),
  ]);
  const until = new Map<string, string>();
  for (const p of promos || []) {
    const k = key(p.chain, p.token);
    if (!until.has(k) || until.get(k)! < p.ends_at) until.set(k, p.ends_at);
  }
  // Paid tokens older than the newest `limit` still trend and still show as ads.
  const seen = new Set((launches || []).map((l: any) => key(l.chain, l.token)));
  const missing = (promos || []).filter((p: any) => !seen.has(key(p.chain, p.token)));
  const { data: older } = missing.length
    ? await onChain(sb.from("launches").select("*")).in("token", [...new Set(missing.map((p: any) => p.token))])
    : { data: [] };
  const rows = [...(launches || []), ...(older || []).filter((l: any) => !seen.has(key(l.chain, l.token)) && until.has(key(l.chain, l.token)))];
  // The whitelist (lib/listings.ts): listed coins that were never launched or paid for here still show, as Listed.
  for (const l of LISTINGS) {
    if ((chain && l.chain !== chain) || rows.some((r: any) => key(r.chain, r.token) === key(l.chain, l.token))) continue;
    rows.push({ chain: l.chain, token: l.token, pair: "", name: l.name, symbol: l.symbol, created_at: l.since, source: "listed" });
  }
  const visible = rows.filter((l: any) => CHAINS[l.chain as ChainKey] && !HIDDEN.has(String(l.token).toLowerCase()));
  rows.length = 0; rows.push(...visible);
  const watchers = new Map<string, number>((counts || []).map((c: any) => [key(c.chain, c.token), c.watchers as number]));
  const [markets, { data: logos }] = await Promise.all([
    getMarkets(rows.map((r: any) => ({ chain: r.chain, token: r.token }))),
    rows.length ? sb.from("token_logos").select("chain,token,url").in("token", rows.map((r: any) => r.token)) : Promise.resolve({ data: [] as any[] }),
  ]);
  const logoOf = new Map<string, string>((logos || []).map((l: any) => [key(l.chain, l.token), l.url]));
  return rows.map((r: any) => ({
    // Only the public fields: rows are read with * so the board keeps working before new columns exist.
    chain: r.chain, token: r.token, pair: r.pair, name: r.name, symbol: r.symbol, created_at: r.created_at,
    source: r.source === "listed" ? "listed" : "launchpad",
    watchers: watchers.get(key(r.chain, r.token)) ?? 0,
    promotedUntil: until.get(key(r.chain, r.token)) ?? null,
    market: markets[r.token.toLowerCase()] ?? null,
    logo: logoOf.get(key(r.chain, r.token)) ?? markets[r.token.toLowerCase()]?.imageUrl ?? null,
    trend: !TRENDING_ONLY.size || TRENDING_ONLY.has(String(r.token).toLowerCase()),
  }));
}

/** Paid slots first (newest purchase ending last first), then the busiest tokens by 24h volume and trades. */
export function trending(list: BoardToken[]) {
  return byHeat(list.filter((t) => t.trend));
}

function byHeat(list: BoardToken[]) {
  const organic = (t: BoardToken) => (t.market?.volume24h ?? 0) + (t.market?.txns24h ?? 0) * 10;
  return [...list].sort((a, b) => {
    if (!!a.promotedUntil !== !!b.promotedUntil) return a.promotedUntil ? -1 : 1;
    if (a.promotedUntil && b.promotedUntil) return b.promotedUntil.localeCompare(a.promotedUntil);
    return organic(b) - organic(a);
  });
}

export const mostWatched = (list: BoardToken[]) => [...list].filter((t) => t.watchers > 0).sort((a, b) => b.watchers - a.watchers);

/** Tokens currently paying to trend; shown as ads around the Launch Pad. */
export const ads = (list: BoardToken[]) => byHeat(list).filter((t) => t.promotedUntil);
