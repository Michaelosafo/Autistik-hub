import { TOKEN_ADDRESS } from "@/lib/groups";

/** Coins listed on AUTISTIK: shown first in the wallet and on the home page, each with a one-tap Buy. Newest first. */
export type Listing = { chain: "bsc"; token: string; symbol: string; name: string; note: string };

export const LISTINGS: Listing[] = [
  { chain: "bsc", token: TOKEN_ADDRESS, symbol: "AUTISTIK", name: "AUTISTIK", note: "The community token of AUTISTIK Hub" },
  { chain: "bsc", token: "0xa6e3eaCdF8e6A1Ea02052693838F3653FA3BFfFF", symbol: "GRIOT", name: "Griot", note: "Trading on PancakeSwap" },
];

/** The wallet link that opens the easy Buy screen for a listed coin. */
export const buyLink = (l: Pick<Listing, "chain" | "token">) => `/wallet?chain=${l.chain}&buy=${l.token}&quick=1`;
