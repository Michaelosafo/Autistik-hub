/** Reads a swap request typed in chat ("convert 1 SOL to USDT on Base"). No server code: safe in the browser too. */
/** Every network's key in bridge-chains.ts (kept here so this file has no imports). */
const KEYS = new Set("bsc ethereum solana base arbitrum optimism polygon avalanche sonic hyperevm linea zksync scroll blast mantle unichain berachain monad plasma worldchain gnosis celo sei ink mode soneium katana apechain cronos fraxtal lisk moonbeam metis kaia ronin flare bob hemi plume flow rootstock xlayer".split(" "));

export type SwapAsk = {
  amount: number | null;           // how much (in `unit`)
  unit: "coin" | "usd" | "pct" | "all";
  from: string; fromChain: string | null;
  to: string; toChain: string | null; // "cheapest" = any network, whichever costs least
  /** Buying a coin by its contract address (its network is found from the address). */
  toAddress?: string | null;
};
/** Words people use for networks. */
const CHAIN_WORDS: Record<string, string> = {
  sol: "solana", solana: "solana", bsc: "bsc", bnb: "bsc", "bnb chain": "bsc", "bnbchain": "bsc", binance: "bsc", bep20: "bsc", "binance smart chain": "bsc",
  eth: "ethereum", ethereum: "ethereum", mainnet: "ethereum", erc20: "ethereum", base: "base", arb: "arbitrum", arbitrum: "arbitrum",
  op: "optimism", optimism: "optimism", polygon: "polygon", matic: "polygon", avax: "avalanche", avalanche: "avalanche",
};
export const clean = (s: unknown) => {
  const v = String(s ?? "").trim().replace(/^\$/, "").toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 12);
  // The site's own coin, however it's typed (utistik, autistic, autism…).
  return /^A?U+T+I*S+T*I*[CK]+K?$|^AUTIS[MT]?$/.test(v) ? "AUTISTIK" : v;
};
export function chainKey(s: unknown): string | null {
  const v = String(s ?? "").trim().toLowerCase();
  if (!v || v === "null") return null;
  if (/cheap|any|best|wherever|lowest/.test(v)) return "cheapest";
  return CHAIN_WORDS[v] || (KEYS.has(v) ? v : null);
}

/** "approved", "confirm", "go ahead": the member wants it done straight away, no extra tap. */
export const APPROVED_RE = /\b(approved?|confirm(?:ed)?|go ahead|execute|do it( now)?|auto(?:matically)?|no need to (?:ask|confirm))\b/i;
export const isApproved = (text: string) => APPROVED_RE.test(text);

/** Quick reading for the common ways of asking; Claude reads anything else. */
export function readSwap(text: string): SwapAsk | null {
  const t = text.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").trim()
    .replace(new RegExp(APPROVED_RE.source, "gi"), " ")
    .replace(/\b(please|pls|plz|now|for me|from my wallet|in my wallet|my wallet)\b/g, " ")
    // "1 usd", "1 dollar", "1$" → "$1"; "worth" is just a filler word.
    .replace(/(\d[\d.]*)\s*(?:usd|dollars?|bucks|\$)(?![a-z])/g, "$$$1").replace(/\bworth\b/g, " ")
    .replace(/\s+/g, " ").trim()
    // "to sol usdt" / "to base usdc": the coin on that network.
    .replace(/\b(to|for|into)\s+(sol|solana|bsc|bnb|base|eth|ethereum|arb|arbitrum|polygon|optimism|avax)\s+([a-z][a-z0-9.]{1,11})\s*$/, (_, w, c, coin) => `${w} ${coin} on ${c}`)
    .replace(/[.!?]+$/, "").trim();
  const on = "(?:\\s+(?:on|in|via|over|at)\\s+(?:the\\s+)?([a-z ]+?)(?:\\s+(?:chain|network))?)?";
  const qty = "(all|max|half|everything|\\$?[\\d.]+\\s*%?|\\$[\\d.]+)?\\s*(?:(?:of|from)\\s+)?(?:my\\s+)?(?:the\\s+)?\\$?([a-z][a-z0-9.]{0,11})";
  const re = new RegExp(`(?:convert|swap|exchange|change|turn|trade|bridge|move|sell)\\s+(?:my\\s+)?${qty}${on}\\s+(?:to|for|into|2)\\s+\\$?([a-z][a-z0-9.]{0,11})${on}\\s*$`);
  // "sell $1 of autistik": no coin to receive named, so the network's own coin (BNB, SOL, ETH).
  const sell = new RegExp(`\\bsell\\s+(?:my\\s+)?${qty}${on}\\s*$`);
  let m = t.match(re);
  let q: string | undefined, from: string, fc: string | undefined, to = "", tc: string | undefined;
  if (m) [, q, from, fc, to, tc] = m;
  else if ((m = t.match(sell))) [, q, from, fc] = m;
  else return null;
  if (!q) return null; // no amount: Claude asks
  let amount: number | null = null, unit: SwapAsk["unit"] = "coin";
  if (/all|max|everything/.test(q)) unit = "all";
  else if (q === "half") { unit = "pct"; amount = 50; }
  else if (q.startsWith("$")) { unit = "usd"; amount = parseFloat(q.slice(1)); }
  else if (q.endsWith("%")) { unit = "pct"; amount = parseFloat(q); }
  else amount = parseFloat(q);
  const fromChain = chainKey(fc), toChain = chainKey(tc);
  if ((fc && !fromChain) || (tc && !toChain)) return null;
  // "move 1 SOL to base": a network named as the destination coin means "the same coin's equivalent on that network".
  const toIsChain = !!to && !tc && chainKey(to) && !["SOL", "BNB", "ETH", "AVAX", "MATIC"].includes(clean(to));
  return { amount, unit, from: clean(from), fromChain, to: toIsChain || !to ? "" : clean(to), toChain: toIsChain ? chainKey(to) : toChain };
}

/** Does this message look like a request to swap or convert coins (and not a question about swapping)? */
export function looksLikeSwap(text: string): boolean {
  const t = text.toLowerCase();
  if (t.length > 200 || /\?\s*$/.test(t) && !/^(can you|could you|pls|please)/.test(t)) return false;
  if (/\b(how|what|why|explain|difference|should i|when)\b/.test(t)) return false;
  if (/\b(convert|swap|exchange|bridge|change|turn|move)\b/.test(t) && /\b(to|for|into)\b/.test(t)) return true;
  // "sell $1 of autistik", "approved sell half my sol to usdt"
  return /\bsell\b/.test(t) && /(\d|\b(all|half|everything|max)\b)/.test(t);
}

const CA_RE = /\b0x[a-fA-F0-9]{40}\b|(?:^|\s)([1-9A-HJ-NP-Za-km-z]{32,44})(?=\s|$)/;
export type BuyAsk = { ca: string; amount: number; unit: "usd" | "coin"; pay: string | null; payChain: string | null };
/**
 * "buy 1 usd worth of 0x…", "approved buy $5 of <address> with my eth on base", "buy 0.1 bnb of 0x…".
 * Only a buy with a dollar amount or a named coin to pay with: "buy 0.1 0x…" (the chain's own coin) stays with the
 * trading bot.
 */
export function readBuy(text: string): BuyAsk | null {
  const m = text.match(CA_RE);
  const ca = m ? (m[0].startsWith("0x") ? m[0] : m[1]) : null;
  if (!ca) return null;
  const t = text.replace(ca, " ").toLowerCase().replace(/,/g, "")
    .replace(new RegExp(APPROVED_RE.source, "gi"), " ")
    .replace(/(\d[\d.]*)\s*(?:usd|dollars?|bucks|\$)(?![a-z])/g, "$$$1").replace(/\s+/g, " ").trim();
  if (!/\bbuy\b/.test(t)) return null;
  const w = t.match(/\b(?:with|using|from|use|pay(?:ing)?(?: with)?)\s+(?:my\s+)?([a-z][a-z0-9]{1,9})(?:\s+(?:on|in)\s+(?:the\s+)?([a-z]+))?/);
  let pay = w ? clean(w[1]) : null;
  let payChain = w?.[2] ? chainKey(w[2]) : null;
  if (pay && chainKey(pay) && !["BNB", "ETH", "SOL", "AVAX", "MATIC", "POL"].includes(pay)) { payChain = chainKey(pay); pay = null; } // "with base"
  const usd = t.match(/\$([\d.]+)/);
  if (usd && Number(usd[1]) > 0) return { ca, amount: Number(usd[1]), unit: "usd", pay, payChain };
  // "buy 0.1 bnb of 0x…": the amount in the coin named
  const coin = t.match(/\bbuy\s+([\d.]+)\s*([a-z][a-z0-9]{1,9})\b/);
  if (coin && Number(coin[1]) > 0 && !["of", "worth", "tokens", "token", "coins"].includes(coin[2])) return { ca, amount: Number(coin[1]), unit: "coin", pay: clean(coin[2]), payChain };
  return null;
}
