/** Reads a swap request typed in chat ("convert 1 SOL to USDT on Base"). No server code: safe in the browser too. */
/** Every network's key in bridge-chains.ts (kept here so this file has no imports). */
const KEYS = new Set("bsc ethereum solana base arbitrum optimism polygon avalanche sonic hyperevm linea zksync scroll blast mantle unichain berachain monad plasma worldchain gnosis celo sei ink mode soneium katana apechain cronos fraxtal lisk moonbeam metis kaia ronin flare bob hemi plume flow rootstock xlayer".split(" "));

export type SwapAsk = {
  amount: number | null;           // how much (in `unit`)
  unit: "coin" | "usd" | "pct" | "all";
  from: string; fromChain: string | null;
  to: string; toChain: string | null; // "cheapest" = any network, whichever costs least
};
/** Words people use for networks. */
const CHAIN_WORDS: Record<string, string> = {
  sol: "solana", solana: "solana", bsc: "bsc", bnb: "bsc", "bnb chain": "bsc", "bnbchain": "bsc", binance: "bsc", bep20: "bsc", "binance smart chain": "bsc",
  eth: "ethereum", ethereum: "ethereum", mainnet: "ethereum", erc20: "ethereum", base: "base", arb: "arbitrum", arbitrum: "arbitrum",
  op: "optimism", optimism: "optimism", polygon: "polygon", matic: "polygon", avax: "avalanche", avalanche: "avalanche",
};
export const clean = (s: unknown) => String(s ?? "").trim().replace(/^\$/, "").toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 12);
export function chainKey(s: unknown): string | null {
  const v = String(s ?? "").trim().toLowerCase();
  if (!v || v === "null") return null;
  if (/cheap|any|best|wherever|lowest/.test(v)) return "cheapest";
  return CHAIN_WORDS[v] || (KEYS.has(v) ? v : null);
}

/** Quick reading for the common ways of asking; Claude reads anything else. */
export function readSwap(text: string): SwapAsk | null {
  const t = text.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").trim()
    // "to sol usdt" / "to base usdc": the coin on that network.
    .replace(/\b(to|for|into)\s+(sol|solana|bsc|bnb|base|eth|ethereum|arb|arbitrum|polygon|optimism|avax)\s+([a-z][a-z0-9.]{1,11})\s*$/, (_, w, c, coin) => `${w} ${coin} on ${c}`)
    .replace(/[.!?]+$/, "");
  const on = "(?:\\s+(?:on|in|via|over|at)\\s+(?:the\\s+)?([a-z ]+?)(?:\\s+(?:chain|network))?)?";
  const re = new RegExp(`(?:convert|swap|exchange|change|turn|trade|bridge|move|sell)\\s+(?:my\\s+)?(all|max|half|everything|\\$?[\\d.]+\\s*%?|\\$[\\d.]+)?\\s*(?:of\\s+)?(?:my\\s+)?\\$?([a-z][a-z0-9.]{0,11})${on}\\s+(?:to|for|into|2)\\s+\\$?([a-z][a-z0-9.]{0,11})${on}\\s*$`);
  const m = t.match(re);
  if (!m) return null;
  const [, q, from, fc, to, tc] = m;
  let amount: number | null = null, unit: SwapAsk["unit"] = "coin";
  if (!q || /all|max|everything/.test(q)) { unit = "all"; if (!q) return null; }
  else if (q === "half") { unit = "pct"; amount = 50; }
  else if (q.startsWith("$")) { unit = "usd"; amount = parseFloat(q.slice(1)); }
  else if (q.endsWith("%")) { unit = "pct"; amount = parseFloat(q); }
  else amount = parseFloat(q);
  const fromChain = chainKey(fc), toChain = chainKey(tc);
  if ((fc && !fromChain) || (tc && !toChain)) return null;
  // "move 1 SOL to base": a network named as the destination coin means "the same coin's equivalent on that network".
  const toIsChain = !tc && chainKey(to) && !["SOL", "BNB", "ETH", "AVAX", "MATIC"].includes(clean(to));
  return { amount, unit, from: clean(from), fromChain, to: toIsChain ? "" : clean(to), toChain: toIsChain ? chainKey(to) : toChain };
}


/** Does this message look like a request to swap or convert coins (and not a question about swapping)? */
export function looksLikeSwap(text: string): boolean {
  const t = text.toLowerCase();
  if (t.length > 200 || /\?\s*$/.test(t) && !/^(can you|could you|pls|please)/.test(t)) return false;
  return /\b(convert|swap|exchange|bridge|change|turn|move)\b/.test(t) && /\b(to|for|into)\b/.test(t) && !/\b(how|what|why|explain|difference)\b/.test(t);
}
