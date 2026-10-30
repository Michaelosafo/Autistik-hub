import type { ChainKey } from "@/lib/launchpad";
import { HIDDEN } from "@/lib/listings";

/**
 * The token AUTISTIK features as the face of the App: a big banner at the top of the App home and on the main page.
 * Change it in Vercel with NEXT_PUBLIC_FEATURED_CHAIN / NEXT_PUBLIC_FEATURED_TOKEN (and the name, ticker and line
 * below) without a code change, or set NEXT_PUBLIC_FEATURED_TOKEN=off to hide the banner.
 */
export type Featured = { chain: ChainKey; token: string; name: string; symbol: string; line: string };

const env = (k: string) => (process.env[k] || "").trim();

// No banner unless a token is set in Vercel (GG used to be the default; it has been taken off). A hidden coin never shows.
const tok = env("NEXT_PUBLIC_FEATURED_TOKEN");
export const FEATURED: Featured | null = !tok || tok === "off" || HIDDEN.has(tok.toLowerCase()) ? null : {
  chain: (env("NEXT_PUBLIC_FEATURED_CHAIN") || "bsc") as ChainKey,
  token: tok,
  name: env("NEXT_PUBLIC_FEATURED_NAME") || env("NEXT_PUBLIC_FEATURED_SYMBOL") || "Featured",
  symbol: env("NEXT_PUBLIC_FEATURED_SYMBOL") || "",
  line: env("NEXT_PUBLIC_FEATURED_LINE") || "",
};
