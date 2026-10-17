/**
 * Momentum: tokens with unusual volume and buying right now, scored for how likely a quick move up (like 2x) is,
 * with a suggested buy range, take-profit steps and a stop. Pure scoring here; fetching is in momentum-server.ts.
 * Suggestions only: fast movers are the riskiest tokens there are. Never financial advice.
 */

export const MOMENTUM_CHAINS = [
  { key: "bsc", name: "BNB Chain", gt: "bsc", goplus: "56" },
  { key: "base", name: "Base", gt: "base", goplus: "8453" },
  { key: "solana", name: "Solana", gt: "solana", goplus: "solana" },
  { key: "ethereum", name: "Ethereum", gt: "eth", goplus: "1" },
  { key: "arbitrum", name: "Arbitrum", gt: "arbitrum", goplus: "42161" },
  { key: "robinhood", name: "Robinhood Chain", gt: "robinhood", goplus: "4663" },
] as const;
export type MomentumChain = (typeof MOMENTUM_CHAINS)[number]["key"];
export const isMomentumChain = (c: unknown): c is MomentumChain => MOMENTUM_CHAINS.some((x) => x.key === c);
export const chainName = (c: string) => MOMENTUM_CHAINS.find((x) => x.key === c)?.name ?? c;

type Frame = "m5" | "m15" | "h1" | "h6" | "h24";
type Tx = { buys: number; sells: number; buyers: number; sellers: number };
export type Pool = {
  chain: MomentumChain; pool: string; token: string; symbol: string; name: string; image: string | null;
  price: number; change: Partial<Record<Frame, number>>; volume: Partial<Record<Frame, number>>; tx: Partial<Record<Frame, Tx>>;
  liquidity: number; mcap: number | null; ageHours: number | null;
  /** From GoPlus when available. */
  safety?: { honeypot: boolean | null; buyTax: number | null; sellTax: number | null; mintable: boolean | null } | null;
};

export type Sign = { lean: 1 | 0 | -1; text: string };
export type Pick = Pool & {
  score: number; level: "hot" | "building" | "watch" | "avoid"; label: string;
  action: "buy" | "dip" | "wait" | "avoid"; actionText: string;
  buy: [number, number] | null; tp1: number | null; tp2: number | null; stop: number | null;
  volX: number; buyerShare: number; signs: Sign[]; risks: string[];
};

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const usd = (v: number | null | undefined) => {
  if (v == null || !isFinite(v)) return "–";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  // Small prices: keep 4 significant digits.
  return `$${v.toPrecision(4).replace(/\.?0+$/, "")}`;
};
const pctTxt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}%`;

/** Minimum pool money to be listed at all: smaller pools are too easy to manipulate and hard to sell. */
export const MIN_LIQUIDITY = 15_000;

/**
 * Scores a pool 0–100. Points for: volume far above its normal pace, lots of trading for the pool's size, more buyers
 * than sellers, price rising without being overheated, room to grow (small market cap), and passing safety checks.
 */
export function scorePool(p: Pool): Pick {
  const signs: Sign[] = [], risks: string[] = [];
  const v1 = n(p.volume.h1), v24 = n(p.volume.h24), liq = n(p.liquidity);
  const volX = v24 > 0 ? v1 / Math.max(v24 / 24, 1) : 0;
  const h1 = p.tx.h1, m15 = p.tx.m15;
  const buyers = n(h1?.buyers), sellers = n(h1?.sellers);
  const buyerShare = buyers + sellers > 0 ? buyers / (buyers + sellers) : 0.5;
  const m15Share = n(m15?.buyers) + n(m15?.sellers) > 0 ? n(m15?.buyers) / (n(m15?.buyers) + n(m15?.sellers)) : buyerShare;
  const c5 = n(p.change.m5), c15 = n(p.change.m15), c1 = n(p.change.h1), c24 = n(p.change.h24);
  const cap = p.mcap ?? 0;

  // 1. Volume acceleration (0–25)
  let s = 0;
  const accel = clamp((volX - 1) * 8, 0, 25);
  s += accel;
  if (volX >= 4) signs.push({ lean: 1, text: `Volume is ${volX.toFixed(1)}x its normal pace this hour: a crowd is arriving.` });
  else if (volX >= 2) signs.push({ lean: 1, text: `Volume is ${volX.toFixed(1)}x normal this hour.` });
  else signs.push({ lean: 0, text: "Volume is around its normal pace." });

  // 2. Trading for the pool's size (0–15)
  const turnover = liq > 0 ? v1 / liq : 0;
  s += clamp(turnover * 20, 0, 15);
  if (turnover >= 0.5) signs.push({ lean: 1, text: `Busy: ${usd(v1)} traded in the last hour on a ${usd(liq)} pool.` });

  // 3. Buyers vs sellers (0–20)
  s += clamp((buyerShare - 0.45) * 80, 0, 14) + clamp((m15Share - 0.5) * 40, 0, 6);
  if (buyerShare >= 0.58) signs.push({ lean: 1, text: `${Math.round(buyerShare * 100)}% of traders this hour are buyers (${buyers} buyers vs ${sellers} sellers).` });
  else if (buyerShare <= 0.42) signs.push({ lean: -1, text: `More sellers than buyers this hour (${sellers} vs ${buyers}).` });

  // 4. Price trend (0–15), but overheated moves lose points: late buyers often get dumped on.
  const overheated = c1 >= 80 || c24 >= 400;
  const dumping = c15 <= -12 || (m15Share < 0.4 && c15 < -5);
  // Real momentum means the price is actually going up, not just lots of trading.
  const rising = c1 > 2 && c15 >= 0;
  if (!overheated && !dumping) s += clamp(c1 / 3, 0, 10) + (c5 > 0 && c15 > 0 ? 5 : 0);
  if (c1 < -3 && !dumping) { s -= 6; signs.push({ lean: -1, text: `Price is falling this hour (${pctTxt(c1)}) despite the trading.` }); }
  if (overheated) { s -= 8; signs.push({ lean: -1, text: `Already up ${pctTxt(c1 >= 80 ? c1 : c24)} ${c1 >= 80 ? "this hour" : "today"}: overheated, early buyers may sell into new buyers.` }); }
  else if (c1 > 5) signs.push({ lean: 1, text: `Price is rising (${pctTxt(c1)} this hour) without being overheated.` });
  if (dumping) { s -= 10; signs.push({ lean: -1, text: `Dropping right now (${pctTxt(c15)} in 15 minutes).` }); }

  // 5. Room to grow (0–15): a 2x is far easier from $500K than from $500M.
  if (cap > 0) {
    s += cap < 1e6 ? 15 : cap < 5e6 ? 12 : cap < 20e6 ? 8 : cap < 100e6 ? 3 : 0;
    if (cap < 5e6) signs.push({ lean: 1, text: `Small market cap (${usd(cap)}): it takes less new money to double.` });
    else if (cap >= 100e6) signs.push({ lean: -1, text: `Big market cap (${usd(cap)}): doubling needs a lot of new money.` });
  }

  // 6. Safety and age (0–10)
  const sf = p.safety;
  if (sf?.honeypot) risks.push("Honeypot warning: you may not be able to sell.");
  if (sf && (n(sf.sellTax) >= 10 || n(sf.buyTax) >= 10)) risks.push(`High tax: ${n(sf.buyTax).toFixed(0)}% buy / ${n(sf.sellTax).toFixed(0)}% sell.`);
  if (sf?.mintable) risks.push("The owner can print more tokens.");
  if (sf && !sf.honeypot && !sf.mintable && n(sf.sellTax) < 10) s += 6;
  if (!sf) risks.push("Safety check not available: check it on the token page before buying.");
  if (p.ageHours != null && p.ageHours < 6) {
    s -= p.ageHours < 1 ? 12 : 8;
    risks.push(`Brand new pool (${p.ageHours < 1 ? "under 1 hour" : Math.floor(p.ageHours) + " hours"} old): the riskiest stage, rugs happen here.`);
  } else if (p.ageHours != null && p.ageHours >= 24) s += 4;
  if (liq < 40_000) { s -= 5; risks.push(`Small pool (${usd(liq)}): big sells move the price a lot.`); }

  const unsafe = !!sf?.honeypot || n(sf?.sellTax) >= 25;
  // Hot needs everything at once: a strong score, the price rising and more buyers than sellers.
  const score = unsafe ? 0 : Math.round(clamp(s, 0, 100));
  const hot = score >= 70 && rising && buyerShare >= 0.55 && !overheated;
  const level: Pick["level"] = unsafe ? "avoid" : hot ? "hot" : score >= 50 ? "building" : "watch";
  const LABEL = { hot: "🔥 Hot: higher quick-2x chance", building: "⚡ Building momentum", watch: "👀 Watch", avoid: "🚫 Avoid" } as const;

  // The suggestion.
  const price = n(p.price);
  let action: Pick["action"], actionText: string, buy: [number, number] | null = null;
  if (unsafe) { action = "avoid"; actionText = "Don't buy: it failed the safety checks."; }
  else if (dumping) { action = "wait"; actionText = "Wait: it's dropping right now. Let it settle before thinking about buying."; }
  else if (overheated) { action = "dip"; buy = [price * 0.7, price * 0.8]; actionText = `Too hot to chase. Suggested: wait for a pullback to ${usd(buy[0])}–${usd(buy[1])}.`; }
  else if (level === "watch") { action = "wait"; buy = [price * 0.88, price * 0.97]; actionText = "Not enough momentum yet. Watch it, or pin it for an alert."; }
  else if (!rising) { action = "wait"; buy = [price * 0.92, price * 1.0]; actionText = "Lots of trading, but the price isn't rising yet. Wait for it to turn up before buying."; }
  else { action = "buy"; buy = [price * 0.92, price * 1.0]; actionText = `Suggested buy range: ${usd(buy[0])}–${usd(buy[1])} (now or on a small dip).`; }
  const entry = buy ? (buy[0] + buy[1]) / 2 : null;
  return {
    ...p, score, level, label: LABEL[level], action, actionText, buy,
    tp1: entry ? entry * 1.5 : null, tp2: entry ? entry * 2 : null, stop: entry ? entry * 0.8 : null,
    volX, buyerShare, signs, risks,
  };
}

/** Ranks pools: safe ones with enough liquidity, best score first. */
export function rank(pools: Pool[]): Pick[] {
  const seen = new Set<string>();
  return pools
    .filter((p) => p.liquidity >= MIN_LIQUIDITY && p.price > 0 && !/^(W?BNB|W?ETH|W?SOL|USDT|USDC|DAI|BUSD|FDUSD|USD1|WBTC|BTCB|CBBTC)$/i.test(p.symbol))
    .map(scorePool)
    .filter((p) => { const k = `${p.chain}:${p.token.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.score - a.score);
}

export type AlertPrefs = { enabled: boolean; chains: string[]; min_score: number; min_liquidity: number; max_mcap: number | null; follow_ups: boolean };
export const DEFAULT_PREFS: AlertPrefs = { enabled: false, chains: ["bsc", "base", "solana"], min_score: 70, min_liquidity: 30_000, max_mcap: 20_000_000, follow_ups: true };
/** Momentum alerts per day: free members get a taste, Pro gets plenty. */
export const FREE_ALERTS_PER_DAY = 3;
export const PRO_ALERTS_PER_DAY = 40;

export const matches = (p: Pick, f: AlertPrefs) =>
  p.action === "buy" && f.chains.includes(p.chain) && p.score >= f.min_score && p.liquidity >= f.min_liquidity && (f.max_mcap == null || (p.mcap ?? Infinity) <= f.max_mcap);
