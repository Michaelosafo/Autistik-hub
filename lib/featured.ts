import type { ChainKey } from "@/lib/launchpad";

/**
 * The token AUTISTIK features as the face of the App: a big banner at the top of the App home and on the main page.
 * Change it in Vercel with NEXT_PUBLIC_FEATURED_CHAIN / NEXT_PUBLIC_FEATURED_TOKEN (and the name, ticker and line
 * below) without a code change, or set NEXT_PUBLIC_FEATURED_TOKEN=off to hide the banner.
 */
export type Featured = { chain: ChainKey; token: string; name: string; symbol: string; line: string };

const env = (k: string) => (process.env[k] || "").trim();

export const FEATURED: Featured | null = env("NEXT_PUBLIC_FEATURED_TOKEN") === "off" ? null : {
  chain: (env("NEXT_PUBLIC_FEATURED_CHAIN") || "bsc") as ChainKey,
  token: env("NEXT_PUBLIC_FEATURED_TOKEN") || "0x968cF888Bd0CA650fd3fE91C087bf8F8ce27795d",
  name: env("NEXT_PUBLIC_FEATURED_NAME") || "Goodie",
  symbol: env("NEXT_PUBLIC_FEATURED_SYMBOL") || "GG",
  line: env("NEXT_PUBLIC_FEATURED_LINE") || "The first coin launched on the AUTISTIK Launch Pad. Fixed supply, liquidity locked, anti-sniper launch.",
};
