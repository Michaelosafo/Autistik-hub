/**
 * Trade page: big exchanges with the AUTISTIK referral links, plus live prices of top meme coins.
 * Put each referral link in Vercel as the env var named below. Exchanges without a link show a plain link
 * (no earnings) so the page still works.
 */
export type Exchange = { id: string; name: string; blurb: string; site: string; ref?: string };

const link = (v: string | undefined) => {
  const s = (v || "").trim();
  return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : undefined;
};

// NEXT_PUBLIC_ values are written out in full so Next.js puts them in the page.
export const EXCHANGES: Exchange[] = [
  { id: "binance", name: "Binance", blurb: "The biggest exchange. Easy deposits with mobile money and cards in many countries.", site: "https://www.binance.com", ref: link(process.env.NEXT_PUBLIC_REF_BINANCE) },
  { id: "bybit", name: "Bybit", blurb: "Popular for meme coins, with a simple app.", site: "https://www.bybit.com", ref: link(process.env.NEXT_PUBLIC_REF_BYBIT) },
  { id: "okx", name: "OKX", blurb: "Large exchange with a built-in Web3 wallet.", site: "https://www.okx.com", ref: link(process.env.NEXT_PUBLIC_REF_OKX) },
  { id: "bitget", name: "Bitget", blurb: "Lists new meme coins quickly.", site: "https://www.bitget.com", ref: link(process.env.NEXT_PUBLIC_REF_BITGET) },
  { id: "mexc", name: "MEXC", blurb: "Very wide choice of small and new tokens.", site: "https://www.mexc.com", ref: link(process.env.NEXT_PUBLIC_REF_MEXC) },
  { id: "kucoin", name: "KuCoin", blurb: "Long-running exchange with many altcoins.", site: "https://www.kucoin.com", ref: link(process.env.NEXT_PUBLIC_REF_KUCOIN) },
];

export const MEMES = [
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "shiba-inu", symbol: "SHIB", name: "Shiba Inu" },
  { id: "pepe", symbol: "PEPE", name: "Pepe" },
  { id: "dogwifcoin", symbol: "WIF", name: "dogwifhat" },
  { id: "bonk", symbol: "BONK", name: "Bonk" },
  { id: "floki", symbol: "FLOKI", name: "FLOKI" },
] as const;

export type MemePrice = { price: number | null; change24h: number | null; marketCap: number | null };

/** Live prices from CoinGecko's free API, cached for a minute. Missing data never breaks the page. */
export async function memePrices(): Promise<Record<string, MemePrice>> {
  const ids = MEMES.map((m) => m.id).join(",");
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`, {
      next: { revalidate: 60 }, signal: AbortSignal.timeout(6000),
    });
    const j = r.ok ? await r.json() : {};
    const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
    return Object.fromEntries(MEMES.map((m) => [m.id, { price: num(j?.[m.id]?.usd), change24h: num(j?.[m.id]?.usd_24h_change), marketCap: num(j?.[m.id]?.usd_market_cap) }]));
  } catch {
    return {};
  }
}
