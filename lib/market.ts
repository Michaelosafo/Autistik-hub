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
  buysH1: number; sellsH1: number; buysH24: number | null; sellsH24: number | null; volumeH24: number | null; liquidityUsd: number | null; marketCap: number | null; imageUrl: string | null;
};

/** Adds one 24-hour figure up across pools; null when no pool reports it. */
const sum24 = (pairs: any[], f: (p: any) => unknown) => {
  const v = pairs.map((x) => num(f(x))).filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
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
      buysH1: num(t.buys) ?? 0, sellsH1: num(t.sells) ?? 0,
      // All buys and sells over the last 24 hours across the token's pools, as chart sites count them.
      buysH24: sum24(pairs, (x) => x?.txns?.h24?.buys), sellsH24: sum24(pairs, (x) => x?.txns?.h24?.sells), volumeH24: sum24(pairs, (x) => x?.volume?.h24),
      liquidityUsd: num(p.liquidity?.usd), marketCap: num(p.marketCap) ?? num(p.fdv),
      // The token's logo, when the project added one on DexScreener.
      imageUrl: (pairs as any[]).map((x) => x?.info?.imageUrl).find((u) => typeof u === "string" && u.startsWith("https://") && u.length < 600) ?? null,
    };
  } catch { return null; }
}

// GeckoTerminal's names for our chains (free price history, no key).
export const GT: Record<string, string> = {
  bsc: "bsc", ethereum: "eth", base: "base", robinhood: "robinhood", solana: "solana", arbitrum: "arbitrum", polygon: "polygon_pos",
  avalanche: "avax", optimism: "optimism", sonic: "sonic", berachain: "berachain", monad: "monad", unichain: "unichain",
  abstract: "abstract", linea: "linea", blast: "blast",
};

// Candle sizes: 15 minutes (last day), 1 hour (last 3 days), 4 hours (last 10 days).
const FRAMES = { "15m": "minute?aggregate=15&limit=96", "1h": "hour?limit=72", "4h": "hour?aggregate=4&limit=60" } as const;
export type Frame = keyof typeof FRAMES;

/** Candles for a pool, oldest first (hourly by default). Cached for 5 minutes; empty when unavailable. */
export async function getCandles(chain: string, pool: string | null | undefined, frame: Frame = "1h") {
  const net = GT[chain];
  if (!net || !pool) return [];
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pool}/ohlcv/${FRAMES[frame]}`, {
      next: { revalidate: 300 }, signal: AbortSignal.timeout(5000), headers: { accept: "application/json" },
    });
    const list: any[] = r.ok ? (await r.json())?.data?.attributes?.ohlcv_list || [] : [];
    return list
      .map((x) => ({ t: Number(x[0]), o: Number(x[1]), h: Number(x[2]), l: Number(x[3]), c: Number(x[4]), v: Number(x[5]) }))
      .filter((c) => [c.o, c.h, c.l, c.c].every((v) => isFinite(v) && v > 0))
      .sort((a, b) => a.t - b.t);
  } catch { return []; }
}

/** What DexScreener shows about a token: its picture, banner, links and deepest pool. Null when DexScreener doesn't list it. */
export type DexProfile = {
  pair: string | null;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  /** The wide banner the project uploaded to DexScreener. */
  header: string | null;
  websites: { label: string; url: string }[];
  socials: { label: string; url: string }[];
  url: string | null;
  dex: string | null;
  pairCreatedAt: number | null;
};

const safeUrl = (u: unknown) => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length < 600 ? u : null);
const SOCIAL_BASE: Record<string, string> = { twitter: "https://x.com/", x: "https://x.com/", telegram: "https://t.me/", discord: "https://discord.gg/", tiktok: "https://www.tiktok.com/@", instagram: "https://www.instagram.com/", youtube: "https://www.youtube.com/@" };
const titleCase = (s: string) => (s === "twitter" ? "X" : s.charAt(0).toUpperCase() + s.slice(1));

/** Cached for 5 minutes. Takes the picture, banner and links from whichever of the token's pools has them. */
export async function getDexProfile(chain: ChainKey, token: string): Promise<DexProfile | null> {
  const slug = CHAINS[chain]?.dexscreener;
  if (!slug) return null;
  try {
    const r = await fetch(`${API}/tokens/v1/${slug}/${token}`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(6000) });
    const all: any[] = r.ok ? await r.json() : [];
    const pairs = (Array.isArray(all) ? all : [])
      .filter((p) => String(p?.baseToken?.address || "").toLowerCase() === token.toLowerCase())
      .sort((a, b) => (num(b?.liquidity?.usd) ?? 0) - (num(a?.liquidity?.usd) ?? 0));
    if (!pairs.length) return null;
    const top = pairs[0];
    const info = pairs.map((p) => p?.info).find((i) => i && (i.imageUrl || i.header || i.websites?.length || i.socials?.length)) || {};
    const websites = (Array.isArray(info.websites) ? info.websites : [])
      .map((w: any) => ({ label: String(w?.label || "Website").slice(0, 24), url: safeUrl(w?.url) }))
      .filter((w: any) => w.url).slice(0, 4) as { label: string; url: string }[];
    const socials = (Array.isArray(info.socials) ? info.socials : [])
      .map((s: any) => {
        const kind = String(s?.type || s?.platform || "").toLowerCase();
        const url = safeUrl(s?.url) || (s?.handle && SOCIAL_BASE[kind] ? safeUrl(SOCIAL_BASE[kind] + String(s.handle).replace(/^@/, "")) : null);
        return { label: titleCase(kind || "Link").slice(0, 16), url };
      })
      .filter((s: any) => s.url).slice(0, 6) as { label: string; url: string }[];
    return {
      pair: top?.pairAddress ? String(top.pairAddress) : null,
      name: top?.baseToken?.name ? String(top.baseToken.name).slice(0, 64) : null,
      symbol: top?.baseToken?.symbol ? String(top.baseToken.symbol).slice(0, 24) : null,
      imageUrl: safeUrl(info.imageUrl),
      header: safeUrl(info.header),
      websites, socials,
      url: typeof top?.url === "string" && top.url.startsWith("https://dexscreener.com/") ? top.url : null,
      dex: top?.dexId ? String(top.dexId) : null,
      pairCreatedAt: num(top?.pairCreatedAt),
    };
  } catch { return null; }
}

/**
 * The project's own write-up on DexScreener (what its token page shows under "Info"). Comes from DexScreener's
 * website feed (pair-details), which isn't part of their documented API, so it's best-effort: null whenever it's
 * missing or the feed changes. `pair` is the pool address. Cached for an hour.
 */
export async function getDexAbout(chain: ChainKey, pair: string | null | undefined): Promise<string | null> {
  const slug = CHAINS[chain]?.dexscreener;
  if (!slug || !pair || !/^[0-9A-Za-z]{20,90}$/.test(pair)) return null;
  try {
    const r = await fetch(`https://io.dexscreener.com/dex/pair-details/v4/${slug}/${pair}`, {
      next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; AUTISTIK Hub)", origin: "https://dexscreener.com" },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const text = typeof d?.cms?.description === "string" ? d.cms.description : "";
    // Plain text only, tidy line breaks, kept short.
    const clean = text.replace(/[<>]/g, "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    return clean ? clean.slice(0, 1200) : null;
  } catch { return null; }
}

/** The pool address in a DexScreener pair link (https://dexscreener.com/bsc/0x…). */
export const pairFromUrl = (u: string | null | undefined) => (u ? u.split("/").pop() || null : null);
