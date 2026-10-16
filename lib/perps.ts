/**
 * Perps page: live perpetual-futures prices plus the big futures exchanges, using the AUTISTIK referral links.
 * The Hub never holds anyone's money or places trades: members trade on the exchange itself.
 * Referral links: the same NEXT_PUBLIC_REF_* settings as the Trade page (an exchange's referral link counts its
 * futures fees too), plus NEXT_PUBLIC_REF_ASTER for Aster on BNB Chain.
 */
import { EXCHANGES } from "@/lib/trade";

export type PerpVenue = { id: string; name: string; blurb: string; url: string; ref?: string; dex?: boolean };

const link = (v: string | undefined) => {
  const s = (v || "").trim();
  return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : undefined;
};
const ref = (id: string) => EXCHANGES.find((e) => e.id === id)?.ref;

export const PERP_VENUES: PerpVenue[] = [
  { id: "binance", name: "Binance Futures", blurb: "The biggest futures market, with the most coins.", url: "https://www.binance.com/en/futures/BTCUSDT", ref: ref("binance") },
  { id: "bybit", name: "Bybit", blurb: "Simple futures app, popular for meme coins.", url: "https://www.bybit.com/trade/usdt/BTCUSDT", ref: ref("bybit") },
  { id: "okx", name: "OKX", blurb: "Large exchange with clear futures tools.", url: "https://www.okx.com/trade-swap/btc-usdt-swap", ref: ref("okx") },
  { id: "bitget", name: "Bitget", blurb: "Lists new coin futures quickly, with copy trading.", url: "https://www.bitget.com/futures/usdt/BTCUSDT", ref: ref("bitget") },
  { id: "mexc", name: "MEXC", blurb: "A very wide choice of small-coin futures.", url: "https://futures.mexc.com/exchange/BTC_USDT", ref: ref("mexc") },
  { id: "aster", name: "Aster", blurb: "Futures on BNB Chain, traded straight from your own wallet. No sign-up.", url: "https://www.asterdex.com/en/futures/BTCUSDT", ref: link(process.env.NEXT_PUBLIC_REF_ASTER), dex: true },
];

// Hyperliquid name, CoinGecko id (backup price), what members see.
export const PERP_COINS = [
  { hl: "BTC", cg: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { hl: "ETH", cg: "ethereum", symbol: "ETH", name: "Ethereum" },
  { hl: "BNB", cg: "binancecoin", symbol: "BNB", name: "BNB" },
  { hl: "SOL", cg: "solana", symbol: "SOL", name: "Solana" },
  { hl: "DOGE", cg: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { hl: "WIF", cg: "dogwifcoin", symbol: "WIF", name: "dogwifhat" },
] as const;

export type PerpPrice = { price: number | null; change24h: number | null; fundingPct: number | null; volume24h: number | null };

const num = (v: unknown) => { const n = typeof v === "string" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };

/**
 * Live futures prices from Hyperliquid's free public market data (works worldwide, no key). If it can't be
 * reached, falls back to normal (spot) prices from CoinGecko, so the page always shows something.
 * `source` says which one was used.
 */
export async function perpPrices(): Promise<{ source: "futures" | "spot" | "none"; prices: Record<string, PerpPrice> }> {
  try {
    const r = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      next: { revalidate: 60 }, signal: AbortSignal.timeout(6000),
    });
    const j = r.ok ? await r.json() : null;
    const names: string[] = Array.isArray(j?.[0]?.universe) ? j[0].universe.map((u: any) => u?.name) : [];
    const ctxs: any[] = Array.isArray(j?.[1]) ? j[1] : [];
    const prices: Record<string, PerpPrice> = {};
    for (const c of PERP_COINS) {
      const x = ctxs[names.indexOf(c.hl)];
      if (!x) continue;
      const price = num(x.markPx), prev = num(x.prevDayPx), funding = num(x.funding);
      prices[c.symbol] = {
        price,
        change24h: price != null && prev ? ((price - prev) / prev) * 100 : null,
        fundingPct: funding != null ? funding * 100 : null, // hourly funding rate, in %
        volume24h: num(x.dayNtlVlm),
      };
    }
    if (Object.keys(prices).length) return { source: "futures", prices };
  } catch {}
  try {
    const ids = PERP_COINS.map((c) => c.cg).join(",");
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`, {
      next: { revalidate: 60 }, signal: AbortSignal.timeout(6000),
    });
    const j = r.ok ? await r.json() : {};
    const prices: Record<string, PerpPrice> = {};
    for (const c of PERP_COINS) {
      const x = j?.[c.cg];
      if (x) prices[c.symbol] = { price: num(x.usd), change24h: num(x.usd_24h_change), fundingPct: null, volume24h: num(x.usd_24h_vol) };
    }
    if (Object.keys(prices).length) return { source: "spot", prices };
  } catch {}
  return { source: "none", prices: {} };
}
