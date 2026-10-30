import { TOKEN_ADDRESS } from "@/lib/groups";

/** Coins listed on AUTISTIK: shown first in the wallet and on the home page, each with a one-tap Buy. Newest first. */
export type Listing = { chain: "bsc"; token: string; symbol: string; name: string; note: string;
  /** When it went on the list (sorts it on the Board New tab). */
  since: string };

export const LISTINGS: Listing[] = [
  { chain: "bsc", token: TOKEN_ADDRESS, symbol: "AUTISTIK", name: "AUTISTIK", note: "The community token of AUTISTIK Hub", since: "2026-10-14T00:00:00Z" },
  { chain: "bsc", token: "0xa6e3eaCdF8e6A1Ea02052693838F3653FA3BFfFF", symbol: "GRIOT", name: "Griot", note: "Trading on PancakeSwap", since: "2026-10-14T00:00:00Z" },
];

/**
 * Coins taken off AUTISTIK: never shown on the Board, Trending, the side column, ads or the listings, even though
 * they are still in the launches table. Lower-case addresses.
 */
export const HIDDEN = new Set<string>([
  "0x968cf888bd0ca650fd3fe91c087bf8f8ce27795d", // GG (Goodie)
]);

/** The wallet link that opens the easy Buy screen for a listed coin. */
export const buyLink = (l: { chain: string; token: string }) => `/wallet?chain=${l.chain}&buy=${l.token}&quick=1`;
