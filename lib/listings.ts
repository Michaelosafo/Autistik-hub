import { TOKEN_ADDRESS } from "@/lib/groups";

/** Coins listed on AUTISTIK: shown first in the wallet and on the home page, each with a one-tap Buy. Newest first. */
export type Listing = { chain: "bsc"; token: string; symbol: string; name: string; note: string;
  /** When it went on the list (sorts it on the Board New tab). */
  since: string };

export const LISTINGS: Listing[] = [
  { chain: "bsc", token: "0x2371433a9229791f24F32405c596ffa732dF2A2A", symbol: "COUGAR", name: "Cougar", note: "Listed on AUTISTIK", since: "2026-10-30T08:46:00Z" },
  { chain: "bsc", token: TOKEN_ADDRESS, symbol: "AUTISTIK", name: "AUTISTIK", note: "The community token of AUTISTIK Hub", since: "2026-10-14T00:00:00Z" },
  { chain: "bsc", token: "0xa6e3eaCdF8e6A1Ea02052693838F3653FA3BFfFF", symbol: "GRIOT", name: "Griot", note: "Trading on PancakeSwap", since: "2026-10-14T00:00:00Z" },
];

/**
 * Coins taken off AUTISTIK: never shown on the Board, Trending, the side column, ads or the listings, even though
 * they are still in the launches table. Lower-case addresses.
 */
export const HIDDEN = new Set<string>([
  "0x968cf888bd0ca650fd3fe91c087bf8f8ce27795d", // GG (Goodie)
  "0x82ece2bb9e1f3e0b19afe141ef61c0745e28c75b", // DogAvenger (Dog Avenger)
]);

/**
 * When this has coins, Trending (the Board's Trending tab and strip, King of the Hill, the side column, the home and
 * App pages) shows only these. Empty = Trending ranks every coin by paid slots and trading. Lower-case addresses.
 */
export const TRENDING_ONLY = new Set<string>([
  "0x2371433a9229791f24f32405c596ffa732df2a2a", // Cougar
]);

/** "30 Oct 2026, 08:46 GMT": the same on the server and in the browser. */
export function listedAt(iso: string) {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} GMT`;
}

/** The wallet link that opens the easy Buy screen for a listed coin. */
export const buyLink = (l: { chain: string; token: string }) => `/wallet?chain=${l.chain}&buy=${l.token}&quick=1`;
