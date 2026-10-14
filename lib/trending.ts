import { getMarkets } from "@/lib/market";

/** Paid trending / listing: pay this many US dollars in BNB, on BNB Chain, to the treasury wallet. */
export const TRENDING_USD = Number(process.env.NEXT_PUBLIC_TRENDING_USD || 20);
/** How long one payment keeps a token in Trending and the ad slot. Paying again adds the time on top. */
export const TRENDING_HOURS = Number(process.env.NEXT_PUBLIC_TRENDING_HOURS || 24);

const addr = (v: string | undefined) => (v && /^0x[0-9a-fA-F]{40}$/.test(v.trim()) ? (v.trim() as `0x${string}`) : undefined);
/** The wallet trending payments go to. Shown on the site so people can check where their BNB goes. */
export const TREASURY = addr(process.env.NEXT_PUBLIC_TREASURY_WALLET);

/** Wrapped BNB on BNB Chain: its DexScreener price is the BNB price. */
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

export async function bnbPriceUsd(): Promise<number | null> {
  const m = await getMarkets([{ chain: "bsc", token: WBNB }]);
  const p = m[WBNB.toLowerCase()]?.priceUsd;
  return p && p > 0 ? p : null;
}

/** BNB (in wei) worth `usd` dollars at `price` dollars per BNB, rounded up. */
export function weiFor(usd: number, price: number): bigint {
  return BigInt(Math.ceil((usd / price) * 1e9)) * 10n ** 9n;
}
