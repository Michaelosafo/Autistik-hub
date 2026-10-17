/**
 * Buy and sell zones in plain words. Reads three things people actually react to:
 *  - 🧠 crowd psychology: FOMO, panic, greed, fear, "I just want my money back", holders who won't sell;
 *  - 📈 the chart: the floor (support) and ceiling (resistance) of the last 3 days, overbought/oversold (RSI),
 *    the trend (price vs its 20- and 50-hour averages) and whether volume is rising;
 *  - 🏗️ the project: liquidity, holders, the dev, safety.
 * Every sign leans toward buying (+1), selling (-1) or neither (0). The zone comes from where the price sits between
 * the floor and the ceiling; the strength is how many signs agree. Pure functions. A guide, never a promise.
 */
import type { Verdict, Outlook } from "./analytics-signals";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number }; // oldest first
export type Lean = 1 | 0 | -1;
export type Sign = { lean: Lean; text: string };
export type ZoneKind = "buy" | "middle" | "sell" | "falling" | "breakout" | "avoid";
export type Zones = {
  kind: ZoneKind; title: string; summary: string;
  price: number | null; floor: number | null; ceiling: number | null;
  buy: [number, number] | null; sell: [number, number] | null;
  position: number | null; // 0 = at the floor, 1 = at the ceiling
  rsi: number | null;
  strength: { agree: number; total: number; label: "Strong" | "Medium" | "Weak" };
  people: Sign[]; chart: Sign[]; project: Sign[];
};
type Move = { priceUsd: number | null; m5: number | null; h1: number | null; h6: number | null; h24: number | null; buysH1: number; sellsH1: number; liquidityUsd: number | null; marketCap?: number | null };

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}%`;
export const usd = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? "–" : "$" + (v >= 1 ? v.toLocaleString("en-US", { maximumFractionDigits: 4 }) : v.toLocaleString("en-US", { maximumSignificantDigits: 4 }));

function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
function ema(xs: number[], len: number) {
  if (xs.length < len) return NaN;
  const k = 2 / (len + 1);
  let e = xs.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (const x of xs.slice(len)) e = x * k + e * (1 - k);
  return e;
}
/** Wilder's RSI: above 70 = bought too fast (overbought), below 30 = sold too fast (oversold). */
export function rsi(closes: number[], len = 14) {
  if (closes.length <= len) return NaN;
  let up = 0, down = 0;
  for (let i = 1; i <= len; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) up += d; else down -= d; }
  up /= len; down /= len;
  for (let i = len + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    up = (up * (len - 1) + Math.max(d, 0)) / len;
    down = (down * (len - 1) + Math.max(-d, 0)) / len;
  }
  return down === 0 ? 100 : 100 - 100 / (1 + up / down);
}

export type ZoneInput = {
  candles: Candle[]; move: Move | null; call: Verdict; long: Outlook;
  security?: any; holders?: { is_contract: boolean; in_top: boolean; pct: any; is_dev: boolean; balance: any }[];
  devSold?: boolean;
};

export function zones({ candles, move, call, long, security: s = {}, holders = [], devSold }: ZoneInput): Zones {
  const people: Sign[] = [], chart: Sign[] = [], project: Sign[] = [];
  const price = move?.priceUsd ?? candles.at(-1)?.c ?? null;

  // ---------- The chart ----------
  let floor: number | null = null, ceiling: number | null = null, r: number | null = null;
  const closes = candles.map((c) => c.c);
  if (candles.length >= 12) {
    // Floor and ceiling of the last 3 days, ignoring the odd spike (15th / 85th percentile of the lows / highs).
    floor = quantile(candles.map((c) => c.l), 0.15);
    ceiling = quantile(candles.map((c) => c.h), 0.85);
    // After a big move the older range is stale: use the last 24 hours instead.
    const p = price ?? candles.at(-1)!.c;
    if (p > ceiling * 1.1 || p < floor * 0.9) {
      const day = candles.slice(-24);
      floor = quantile(day.map((c) => c.l), 0.15);
      ceiling = quantile(day.map((c) => c.h), 0.85);
    }
    const rv = rsi(closes);
    r = isFinite(rv) ? Math.round(rv) : null;
    if (r != null) {
      if (r >= 70) chart.push({ lean: -1, text: `Overbought (RSI ${r}): it went up too fast. Prices usually cool down after this.` });
      else if (r <= 30) chart.push({ lean: 1, text: `Oversold (RSI ${r}): it fell too fast. A bounce often follows.` });
      else chart.push({ lean: 0, text: `Neither overbought nor oversold (RSI ${r}).` });
    }
    const e20 = ema(closes, 20), e50 = ema(closes, 50), last = closes.at(-1)!;
    if (isFinite(e20) && isFinite(e50)) {
      if (last > e20 && e20 > e50) chart.push({ lean: 1, text: "Uptrend: the price is above its 20-hour and 50-hour averages." });
      else if (last < e20 && e20 < e50) chart.push({ lean: -1, text: "Downtrend: the price is below its 20-hour and 50-hour averages." });
      else chart.push({ lean: 0, text: "No clear trend: the price is moving sideways." });
    }
    const vol = candles.map((c) => c.v), recent = vol.slice(-6).reduce((a, b) => a + b, 0) / 6, before = vol.slice(-30, -6).reduce((a, b) => a + b, 0) / Math.max(1, vol.slice(-30, -6).length);
    if (before > 0 && recent > before * 1.5) chart.push({ lean: (closes.at(-1)! >= closes.at(-7)! ? 1 : -1) as Lean, text: `Volume is ${Math.round(recent / before)}x higher than usual: lots of attention right now.` });
    else if (before > 0 && recent < before * 0.5) chart.push({ lean: 0, text: "Volume is low: few people are trading it right now." });
  } else if (price && move) {
    // Not enough history: rebuild the last day from the price changes.
    const pts = [price, ...[move.h1, move.h6, move.h24].filter((x): x is number => x != null).map((ch) => price / (1 + ch / 100))];
    floor = Math.min(...pts); ceiling = Math.max(...pts);
    chart.push({ lean: 0, text: "Not much price history yet, so the floor and ceiling are rough." });
  }
  const span = floor != null && ceiling != null && ceiling > floor ? ceiling - floor : null;
  const position = price != null && span ? (price - floor!) / span : null;
  if (floor != null && ceiling != null && span) {
    chart.push({ lean: 0, text: `Floor (support) around ${usd(floor)}, ceiling (resistance) around ${usd(ceiling)}.` });
  }

  // ---------- People ----------
  const h1 = move?.h1 ?? 0, h6 = move?.h6 ?? 0, h24 = move?.h24 ?? 0, m5 = move?.m5 ?? 0;
  const buys = move?.buysH1 ?? 0, sells = move?.sellsH1 ?? 0;
  if (h1 >= 15 || h6 >= 35) people.push({ lean: -1, text: `FOMO: people are rushing in after a ${pct(Math.max(h1, h6))} jump. Late buyers are usually the first to panic-sell on a dip.` });
  if (h24 <= -25 && m5 >= 0 && buys >= sells) people.push({ lean: 1, text: `Panic looks tired: after a ${Math.round(-h24)}% drop, the selling slowed and buyers are back. Patient buyers often step in here.` });
  else if (h24 <= -25) people.push({ lean: -1, text: `Fear: it dropped ${Math.round(-h24)}% today and people are still selling. Wait until the panic calms down.` });
  if (r != null && r >= 75) people.push({ lean: -1, text: "Greed: everyone is excited. That's usually when experienced traders take profit." });
  if (r != null && r <= 25) people.push({ lean: 1, text: "Extreme fear: everyone is scared. That's often when patient buyers get the best price." });
  if (position != null && position >= 0.8 && position <= 1.05) people.push({ lean: -1, text: `"I just want my money back": many people bought near ${usd(ceiling)}. When the price gets back there, lots of them sell.` });
  if (position != null && position <= 0.25 && position >= -0.05) people.push({ lean: 1, text: `Buyers remember this price: last time it was near ${usd(floor)}, people bought the dip.` });
  if (devSold) people.push({ lean: -1, text: "The dev sold. People copy the dev, so fear spreads fast." });
  else if (long.reasons.some((x) => /never sold|held for over/i.test(x.text) && x.level === "good")) people.push({ lean: 1, text: "Big holders are calm and not selling. That gives smaller holders confidence too." });
  if (buys + sells >= 6) people.push(buys > sells * 1.5 ? { lean: 1, text: `More buyers than sellers this hour (${buys} buys, ${sells} sells).` }
    : sells > buys * 1.5 ? { lean: -1, text: `More sellers than buyers this hour (${sells} sells, ${buys} buys).` } : { lean: 0, text: "Buyers and sellers are balanced this hour." });

  // ---------- The project ----------
  const liq = move?.liquidityUsd ?? null, mcap = move?.marketCap ?? null;
  if (liq != null) {
    if (liq < 10_000) project.push({ lean: -1, text: `Tiny pool (${usd(liq)}): big sells crash the price and it can be hard to get out.` });
    else if (mcap && liq / mcap >= 0.1) project.push({ lean: 1, text: `Healthy pool (${usd(Math.round(liq))}): easy to buy and sell without moving the price much.` });
    else project.push({ lean: 0, text: `Pool size ${usd(Math.round(liq))}.` });
  }
  if (s.holderCount) project.push(s.holderCount >= 1000 ? { lean: 1, text: `${Number(s.holderCount).toLocaleString("en-US")} holders: a real community.` } : { lean: 0, text: `${Number(s.holderCount).toLocaleString("en-US")} holders so far: still early.` });
  const top10 = holders.filter((x) => x.in_top && !x.is_contract).sort((a, b) => n(b.pct) - n(a.pct)).slice(0, 10).reduce((a, x) => a + n(x.pct), 0);
  if (top10 > 50) project.push({ lean: -1, text: `The 10 biggest wallets own ${Math.round(top10)}%. A few people can crash it.` });
  else if (top10 > 0 && top10 < 25) project.push({ lean: 1, text: `Well spread: the 10 biggest wallets own only ${Math.round(top10)}%.` });
  const unsafe = s.honeypot === true || n(s.sellTax) >= 25;
  if (s.honeypot === true) project.push({ lean: -1, text: "Honeypot warning: you may not be able to sell." });
  if (s.freezable === true) project.push({ lean: -1, text: "The owner can freeze wallets." });
  if (s.mintable === true) project.push({ lean: -1, text: "The owner can print more tokens." });
  if (s.honeypot === false && s.mintable === false) project.push({ lean: 1, text: "Safety checks passed: no honeypot, no extra tokens can be made." });

  // ---------- The zone ----------
  const all = [...people, ...chart, ...project];
  const net = all.reduce((a, x) => a + x.lean, 0);
  let kind: ZoneKind;
  if (unsafe) kind = "avoid";
  else if (position == null) kind = net >= 2 ? "buy" : net <= -2 ? "sell" : "middle";
  else if (position < -0.02) kind = net > 0 ? "buy" : "falling";
  else if (position > 1.02) kind = r != null && r >= 75 ? "sell" : "breakout";
  else if (position <= 0.35) kind = net >= 0 ? "buy" : "falling";
  else if (position >= 0.72) kind = "sell";
  else kind = net >= 3 ? "buy" : net <= -3 ? "sell" : "middle";

  const buy: [number, number] | null = floor != null && span ? [floor * 0.97, floor + span * 0.3] : null;
  const sell: [number, number] | null = !(ceiling != null && span) ? null
    : price != null && price > ceiling ? [Math.max(ceiling, price * 0.97), price * 1.15]
    : [ceiling - span * 0.2, ceiling * 1.05];

  const want: Lean = kind === "buy" || kind === "breakout" ? 1 : kind === "sell" || kind === "falling" || kind === "avoid" ? -1 : 0;
  const voting = all.filter((x) => x.lean !== 0);
  const agree = want === 0 ? voting.length - Math.abs(net) : voting.filter((x) => x.lean === want).length;
  const ratio = voting.length ? agree / voting.length : 0;
  const strength = { agree, total: voting.length, label: (ratio >= 0.7 && voting.length >= 3 ? "Strong" : ratio >= 0.5 ? "Medium" : "Weak") as Zones["strength"]["label"] };

  const TEXT: Record<ZoneKind, [string, string]> = {
    buy: ["🟢 In the BUY range", "The price is near its floor and most signs say buyers are in control. A good area to buy in small parts."],
    middle: ["🟡 In the middle", "Not cheap, not expensive. Patient people wait for the buy range or the sell range."],
    sell: ["🔴 In the SELL range", "The price is near its ceiling, where people usually take profit. Good time to sell some if you hold."],
    falling: ["⚠️ Falling below the floor", "Buyers aren't defending the floor yet. Wait for it to stop falling before buying."],
    breakout: ["🚀 Breaking out above the ceiling", "New highs with buyers in control. Ride it with a stop, and take profit in steps."],
    avoid: ["🚫 Avoid", "The token itself looks unsafe, so no price is a good price."],
  };
  return { kind, title: TEXT[kind][0], summary: TEXT[kind][1], price, floor, ceiling, buy, sell, position, rsi: r, strength, people, chart, project };
}
