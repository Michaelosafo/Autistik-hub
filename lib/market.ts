import { CHAINS, type ChainKey } from "@/lib/launchpad";

/** Live market numbers for one token, from DexScreener's public API. */
export type Market = {
  priceUsd: number | null;
  change24h: number | null;
  volume24h: number;
  txns24h: number;
  marketCap: number | null;
  liquidityUsd: number | null;
  imageUrl: string | null;
  url: string | null;
};

const API = process.env.DEXSCREENER_API || "https://api.dexscreener.com";
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v !== "" && isFinite(+v) ? +v : null);

/** Looks up up to 30 tokens per request per chain. Cached for a minute; missing data never breaks the page. */
export async function getMarkets(tokens: { chain: ChainKey; token: string }[]): Promise<Record<string, Market>> {
  const out: Record<string, Market> = {};
  const byChain = new Map<string, string[]>();
  for (const t of tokens) {
    const slug = CHAINS[t.chain]?.dexscreener;
    if (!slug) continue;
    byChain.set(slug, [...(byChain.get(slug) || []), t.token]);
  }
  const jobs: Promise<void>[] = [];
  for (const [slug, list] of byChain) {
    for (let i = 0; i < list.length; i += 30) {
      const batch = list.slice(i, i + 30);
      jobs.push(
        fetch(`${API}/tokens/v1/${slug}/${batch.join(",")}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(6000) })
          .then((r) => (r.ok ? r.json() : []))
          .then((pairs: any[]) => {
            for (const p of Array.isArray(pairs) ? pairs : []) {
              const key = String(p?.baseToken?.address || "").toLowerCase();
              if (!key) continue;
              const liq = num(p?.liquidity?.usd);
              const prev = out[key];
              if (prev && (prev.liquidityUsd ?? 0) >= (liq ?? 0)) continue; // keep the deepest pool
              const t = p?.txns?.h24 || {};
              out[key] = {
                priceUsd: num(p?.priceUsd),
                change24h: num(p?.priceChange?.h24),
                volume24h: num(p?.volume?.h24) ?? 0,
                txns24h: (num(t.buys) ?? 0) + (num(t.sells) ?? 0),
                marketCap: num(p?.marketCap) ?? num(p?.fdv),
                liquidityUsd: liq,
                imageUrl: typeof p?.info?.imageUrl === "string" && p.info.imageUrl.startsWith("https://") ? p.info.imageUrl : null,
                url: typeof p?.url === "string" && p.url.startsWith("https://dexscreener.com/") ? p.url : null,
              };
            }
          })
          .catch(() => {})
      );
    }
  }
  await Promise.all(jobs);
  return out;
}

export function usd(n: number | null | undefined) {
  if (n === null || n === undefined) return "–";
  if (n === 0) return "$0";
  if (n < 0.01) return "$" + n.toPrecision(3);
  if (n < 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Finds a token's deepest DexScreener pool, to list a token that wasn't launched on the Launch Pad. */
export async function lookupToken(chain: ChainKey, token: string): Promise<{ pair: string; name: string; symbol: string } | null> {
  const slug = CHAINS[chain]?.dexscreener;
  if (!slug) return null;
  try {
    const r = await fetch(`${API}/tokens/v1/${slug}/${token}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const pairs: any[] = r.ok ? await r.json() : [];
    const mine = (Array.isArray(pairs) ? pairs : []).filter((p) => String(p?.baseToken?.address || "").toLowerCase() === token.toLowerCase());
    mine.sort((a, b) => (num(b?.liquidity?.usd) ?? 0) - (num(a?.liquidity?.usd) ?? 0));
    const p = mine[0];
    if (!p?.pairAddress) return null;
    return { pair: String(p.pairAddress), name: String(p.baseToken.name || "").slice(0, 64), symbol: String(p.baseToken.symbol || "").slice(0, 24) };
  } catch {
    return null;
  }
}

/** Short-term price moves for one token's deepest pool: what a trading plan needs. */
export type PairStats = {
  priceUsd: number | null; m5: number | null; h1: number | null; h6: number | null; h24: number | null;
  buysH1: number; sellsH1: number; liquidityUsd: number | null; marketCap: number | null;
};

/** `slug` is DexScreener's chain id (bsc, ethereum…). Cached for 30 seconds; returns null when unavailable. */
export async function getPairStats(slug: string, token: string): Promise<PairStats | null> {
  try {
    const r = await fetch(`${API}/tokens/v1/${slug}/${token}`, { next: { revalidate: 30 }, signal: AbortSignal.timeout(5000) });
    const pairs: any[] = r.ok ? await r.json() : [];
    const p = (Array.isArray(pairs) ? pairs : []).sort((a, b) => (num(b?.liquidity?.usd) ?? 0) - (num(a?.liquidity?.usd) ?? 0))[0];
    if (!p) return null;
    const c = p.priceChange || {}, t = p.txns?.h1 || {};
    return {
      priceUsd: num(p.priceUsd), m5: num(c.m5), h1: num(c.h1), h6: num(c.h6), h24: num(c.h24),
      buysH1: num(t.buys) ?? 0, sellsH1: num(t.sells) ?? 0, liquidityUsd: num(p.liquidity?.usd), marketCap: num(p.marketCap) ?? num(p.fdv),
    };
  } catch { return null; }
}
