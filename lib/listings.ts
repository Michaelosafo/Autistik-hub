import { TOKEN_ADDRESS } from "@/lib/groups";

/** Coins listed on AUTISTIK: shown first in the wallet and on the home page, each with a one-tap Buy. Newest first. */
export type Listing = { chain: "bsc"; token: string; symbol: string; name: string; note: string };

export const LISTINGS: Listing[] = [
  { chain: "bsc", token: "0x968cF888Bd0CA650fd3fE91C087bf8F8ce27795d", symbol: "GG", name: "Goodie", note: "Launched on the AUTISTIK Launch Pad" },
  { chain: "bsc", token: TOKEN_ADDRESS, symbol: "AUTISTIK", name: "AUTISTIK", note: "The community token of AUTISTIK Hub" },
  { chain: "bsc", token: "0xa6e3eaCdF8e6A1Ea02052693838F3653FA3BFfFF", symbol: "GRIOT", name: "Griot", note: "Trading on PancakeSwap" },
];

/** The wallet link that opens the easy Buy screen for a listed coin. */
export const buyLink = (l: { chain: string; token: string }) => `/wallet?chain=${l.chain}&buy=${l.token}&quick=1`;
