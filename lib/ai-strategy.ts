/**
 * The AI trader's two setups for small coins (server only):
 *  - HYPE: a young coin worth $5K–$60K (by default) that people are piling into right now: more buys than sells,
 *    more buyers every few minutes, volume speeding up, price above its short averages and not yet a vertical candle.
 *  - DIP: a coin that ran hard (big 6h/24h move), has pulled back 30–70% from its high (people selling in fear), and
 *    is now turning: buyers coming back, a higher low, price back above its 9-candle average, RSI rising from oversold.
 * Each candidate's 5-minute chart is read (RSI, EMA 9/21, drawdown from the high, higher lows, volume trend), then
 * Claude weighs the chart, the buying pressure and the buzz (X / Telegram / DexScreener boosts) and picks one, with
 * its own stop-loss and target. Nothing here can promise profit: coins this small are often rugs, so every buy still
 * goes through the honeypot / tax checks and small position sizes.
 */
import { anthropic, FAST_MODEL } from "@/lib/ai";
import { MOMENTUM_CHAINS } from "@/lib/momentum";

const GT = "https://api.geckoterminal.com/api/v2";
const num = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };

export type Setup = "hype" | "dip";
export type SCand = {
  chain: string; token: string; pool: string; symbol: string; name: string; image: string | null;
  price: number; mcap: number; liquidity: number; ageHours: number;
  ch: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  tx: { m5: [number, number, number, number]; m15: [number, number, number, number]; h1: [number, number, number, number] }; // buys, sells, buyers, sellers
  vol: { m5: number; m15: number; h1: number; h6: number };
  setup: Setup; score: number; reasons: string[];
  chart?: Chart; x?: boolean; tg?: boolean; boosted?: boolean; buyTax?: number; sellTax?: number;
};
export type Chart = {
  rsi: number; rsiMin12: number; ema9: number; ema21: number; close: number; high: number; low: number;
  drawdown: number; fromLow: number; higherLow: boolean; volTrend: number; greens3: number; closes: number[];
};

/** GeckoTerminal allows about 30 calls a minute: wait and try again when it says "slow down". */
async function gt(path: string, tries = 3): Promise<any> {
  for (let i = 0; ; i++) {
    const r = await fetch(`${GT}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (r.ok) return r.json();
    if (r.status !== 429 || i >= tries - 1) throw new Error(`GeckoTerminal ${r.status}`);
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
}

function parse(chain: string, j: any): Omit<SCand, "setup" | "score" | "reasons">[] {
  const toks = new Map<string, any>((j?.included || []).filter((x: any) => x.type === "token").map((x: any) => [x.id, x.attributes]));
  const out: Omit<SCand, "setup" | "score" | "reasons">[] = [];
  for (const p of j?.data || []) {
    const a = p.attributes || {};
    const baseId: string = p.relationships?.base_token?.data?.id || "";
    const token = baseId.slice(baseId.indexOf("_") + 1);
    const t = toks.get(baseId) || {};
    const pc = a.price_change_percentage || {}, tr = a.transactions || {}, v = a.volume_usd || {};
    const tx = (k: string): [number, number, number, number] => [num(tr[k]?.buys), num(tr[k]?.sells), num(tr[k]?.buyers), num(tr[k]?.sellers)];
    const mcap = num(a.market_cap_usd) || num(a.fdv_usd);
    if (!token || !mcap) continue;
    out.push({
      chain, token, pool: String(a.address || ""), symbol: String(t.symbol || String(a.name || "").split(" / ")[0] || "?"), name: String(t.name || a.name || ""),
      image: t.image_url && t.image_url !== "missing.png" ? t.image_url : null, price: num(a.base_token_price_usd), mcap, liquidity: num(a.reserve_in_usd),
      ageHours: a.pool_created_at ? (Date.now() - Date.parse(a.pool_created_at)) / 36e5 : 999,
      ch: { m5: num(pc.m5), m15: num(pc.m15), m30: num(pc.m30), h1: num(pc.h1), h6: num(pc.h6), h24: num(pc.h24) },
      tx: { m5: tx("m5"), m15: tx("m15"), h1: tx("h1") }, vol: { m5: num(v.m5), m15: num(v.m15), h1: num(v.h1), h6: num(v.h6) },
    });
  }
  return out;
}

/** Coins in the market-cap window on one chain, from trending (5m and 1h) and brand-new pools. */
async function pools(chain: string, deep: boolean) {
  const net = MOMENTUM_CHAINS.find((c) => c.key === chain)?.gt;
  if (!net) return [];
  // Trending (5m, 1h, 6h) plus the newest pools going back a few hours (BNB Chain makes ~100 an hour), so coins that
  // survived their first 20 minutes and are now moving get seen too.
  const pages = deep ? 6 : 2;
  const paths = [`/networks/${net}/trending_pools?include=base_token&duration=5m&page=1`, `/networks/${net}/trending_pools?include=base_token&duration=5m&page=2`, `/networks/${net}/trending_pools?include=base_token&duration=5m&page=3`, `/networks/${net}/trending_pools?include=base_token&duration=1h&page=1`, `/networks/${net}/trending_pools?include=base_token&duration=6h&page=1`,
    ...Array.from({ length: pages }, (_, i) => `/networks/${net}/new_pools?include=base_token&page=${i + 1}`)];
  const lists = await Promise.all(paths.map((p) => gt(p).then((j) => parse(chain, j)).catch(() => [])));
  const seen = new Set<string>();
  return lists.flat().filter((c) => { const k = c.token.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Sorts a coin into HYPE or DIP (or neither) and scores it. */
export function classify(c: Omit<SCand, "setup" | "score" | "reasons">, s: { hype_on: boolean; dip_on: boolean }): SCand | null {
  const [b15, s15, by15, sl15] = c.tx.m15, [b5, s5, by5, sl5] = c.tx.m5;
  const pressure15 = (b15 + 1) / (s15 + 1), buyers15 = (by15 + 1) / (sl15 + 1), pressure5 = (b5 + 1) / (s5 + 1);
  const accel = c.vol.h1 > 0 ? (c.vol.m15 * 4) / c.vol.h1 : 0; // >1: the last 15 min trade faster than the hour's average
  const reasons: string[] = [];
  // HYPE: crowd piling in, rising but not vertical.
  if (s.hype_on && c.ch.m15 > 0 && c.ch.m5 > -3 && c.ch.h1 > 5 && c.ch.h1 < 250 && c.ch.m5 < 45 && pressure15 >= 1.25 && buyers15 >= 1.05 && by15 >= 7) {
    reasons.push(`${b15} buys vs ${s15} sells in 15m`, `${by15} buyers vs ${sl15} sellers`, `volume ${accel.toFixed(1)}× its hourly pace`);
    const score = Math.min(pressure15, 4) * 12 + Math.min(buyers15, 4) * 10 + Math.min(accel, 4) * 8 + Math.min(c.ch.h1, 120) * 0.15 + Math.log10(Math.max(1, c.liquidity)) * 4 - (c.ch.m5 > 25 ? 10 : 0);
    return { ...c, setup: "hype", score: Math.round(score), reasons };
  }
  // DIP: ran hard, gave a lot back, buyers returning now.
  const ran = Math.max(c.ch.h6, c.ch.h24);
  if (s.dip_on && ran >= 60 && c.ch.h1 <= -15 && c.ch.h1 >= -75 && c.ch.m5 >= 0 && pressure5 >= 1.2 && by5 >= 4 && c.vol.h1 >= 1500) {
    reasons.push(`ran ${ran.toFixed(0)}% then fell ${c.ch.h1.toFixed(0)}% in 1h`, `buying back: ${b5} buys vs ${s5} sells in 5m`, `${by5} buyers vs ${sl5} sellers`);
    const score = Math.min(ran, 400) * 0.06 + Math.min(-c.ch.h1, 60) * 0.4 + Math.min(pressure5, 4) * 12 + Math.min(by5, 30) * 0.8 + Math.log10(Math.max(1, c.liquidity)) * 4;
    return { ...c, setup: "dip", score: Math.round(score), reasons };
  }
  return null;
}

// ---------------------------------------------------------------- Chart reading

const ema = (xs: number[], n: number) => { const k = 2 / (n + 1); let e = xs[0]; for (const x of xs.slice(1)) e = x * k + e * (1 - k); return e; };
function rsiSeries(cl: number[], n = 14): number[] {
  const out: number[] = [];
  let g = 0, l = 0;
  for (let i = 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i < n) continue; }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  }
  return out;
}

/**
 * The chart, boiled down to what a trader looks at: 5-minute candles (last ~6 hours) for coins older than 2 hours,
 * 1-minute candles for younger ones (a 30-minute-old coin has no 5-minute history worth reading yet).
 */
export async function readChart(chain: string, pool: string, ageHours = 99): Promise<Chart | null> {
  const net = MOMENTUM_CHAINS.find((c) => c.key === chain)?.gt;
  if (!net || !pool) return null;
  const agg = ageHours < 2 ? 1 : 5;
  const j = await gt(`/networks/${net}/pools/${pool}/ohlcv/minute?aggregate=${agg}&limit=${agg === 1 ? 120 : 72}&currency=usd`).catch((e) => { chartErr = (e as Error).message; return null; });
  const rows: number[][] = (j?.data?.attributes?.ohlcv_list || []).slice().reverse(); // oldest first: [t, o, h, l, c, v]
  if (rows.length < 12) { if (j) chartErr = `only ${rows.length} candles`; return null; }
  const cl = rows.map((r) => num(r[4])), hi = rows.map((r) => num(r[2])), lo = rows.map((r) => num(r[3])), vo = rows.map((r) => num(r[5]));
  const close = cl[cl.length - 1], high = Math.max(...hi), low = Math.min(...lo);
  const r = rsiSeries(cl);
  const lows = lo.slice(-12);
  const firstHalf = Math.min(...lows.slice(0, 6)), secondHalf = Math.min(...lows.slice(6));
  const v3 = vo.slice(-3).reduce((a, b) => a + b, 0) / 3, vAvg = vo.slice(-24).reduce((a, b) => a + b, 0) / Math.min(24, vo.length);
  return {
    rsi: r[r.length - 1] ?? 50, rsiMin12: Math.min(...r.slice(-12)), ema9: ema(cl, 9), ema21: ema(cl, 21), close, high, low,
    drawdown: high ? (1 - close / high) * 100 : 0, fromLow: low ? (close / low - 1) * 100 : 0, higherLow: secondHalf > firstHalf,
    volTrend: vAvg ? v3 / vAvg : 1, greens3: rows.slice(-3).filter((x) => num(x[4]) >= num(x[1])).length,
    closes: cl.slice(-24).map((x) => +(x / close).toFixed(3)),
  };
}

/** Why the last chart read failed (for the activity log). */
export let chartErr = "";

/** Chart rules each setup must pass (on top of the buying pressure). */
export function chartOk(c: SCand): string | null {
  const k = c.chart;
  if (!k) {
    // No candles to read (too new, or the chart service is busy): a hype entry can still be judged on the price path
    // (rising over 5, 15 and 30 minutes, not a vertical spike) plus the buying pressure it already passed. Dips need the chart.
    if (c.setup === "hype" && c.ch.m5 >= 0 && c.ch.m15 > 0 && c.ch.m30 >= 0 && c.ch.m5 < 25 && c.ch.h1 < 150) return null;
    return `no chart yet${chartErr ? ` (${chartErr})` : ""}`;
  }
  if (c.setup === "hype") {
    if (k.close < k.ema9 || k.ema9 < k.ema21) return "price under its short averages";
    if (k.rsi > 82) return `RSI ${k.rsi.toFixed(0)}: overheated`;
    if (k.drawdown > 25) return "already dumping from the high";
    return null;
  }
  if (k.drawdown < 30 || k.drawdown > 75) return `${k.drawdown.toFixed(0)}% off the high (want 30–75%)`;
  if (k.rsiMin12 > 38) return "never got oversold";
  if (k.close < k.ema9) return "hasn't reclaimed its 9-candle average";
  if (!k.higherLow) return "no higher low yet";
  return null;
}

/** Claude reads every candidate (pressure, chart, buzz) and picks one with its own stop and target. */
export async function aiPick(list: SCand[], target: number, stop: number): Promise<{ c: SCand; why: string; sl: number; tp: number } | null> {
  if (!list.length) return null;
  const fb = list[0];
  const fallback = { c: fb, why: `${fb.setup === "hype" ? "🔥 Hype" : "📉 Dip buy"}: ${fb.reasons.join(", ")}.`, sl: stop, tp: target };
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const rows = list.map((c, i) => ({
      i, setup: c.setup, chain: c.chain, symbol: c.symbol, mcapUsd: Math.round(c.mcap), liquidityUsd: Math.round(c.liquidity), ageHours: +c.ageHours.toFixed(1),
      change: c.ch, buysSellsBuyersSellers: c.tx, volumeUsd: c.vol, onX: !!c.x, onTelegram: !!c.tg, pushedNow: !!c.boosted, tax: [c.buyTax, c.sellTax],
      chart5m: c.chart && { rsi: +c.chart.rsi.toFixed(0), rsiLow1h: +c.chart.rsiMin12.toFixed(0), aboveEma9: c.chart.close > c.chart.ema9, ema9AboveEma21: c.chart.ema9 > c.chart.ema21,
        offHighPct: +c.chart.drawdown.toFixed(0), aboveLowPct: +c.chart.fromLow.toFixed(0), higherLow: c.chart.higherLow, volumeVsAvg: +c.chart.volTrend.toFixed(2), greenOfLast3: c.chart.greens3, last24ClosesVsNow: c.chart.closes },
      notes: c.reasons,
    }));
    const msg = await anthropic().messages.create({
      model: FAST_MODEL, max_tokens: 400,
      system: `You are a disciplined short-term trader of very small crypto coins (market cap $5K-$60K), reading 5-minute charts and order flow. Goal: trades that can make about +${target}% while cutting losers fast. Two setups: HYPE (crowd piling in, early in the move, not yet vertical) and DIP (a coin that ran, sold off in fear, and is now showing buyers coming back with a higher low). Prefer: rising buyer counts, buys clearly outnumbering sells, volume accelerating, price above EMA9>EMA21 for hype, RSI recovering from oversold with a reclaimed EMA9 for dips, real X/Telegram presence, deeper liquidity. Avoid: one giant green candle, falling buyer counts, sells overtaking buys, very thin pools, dead volume. If nothing is a clean setup, pick none: skipping is a good trade. Reply with JSON only: {"pick": <index or null>, "why": "<one or two short sentences: the setup, the chart, the flow>", "stop": <stop-loss % between 15 and 45>, "target": <take-profit % between 50 and 300>}.`,
      messages: [{ role: "user", content: JSON.stringify(rows) }],
    } as any);
    const text = (msg as any).content?.map((b: any) => b.text || "").join("") || "";
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (j.pick === null) return null;
    const c = list[Number(j.pick)];
    if (!c) return fallback;
    const sl = Math.min(45, Math.max(15, Number(j.stop) || stop)), tp = Math.min(300, Math.max(50, Number(j.target) || target));
    return { c, why: `AI ${c.setup === "hype" ? "🔥 Hype" : "📉 Dip buy"}: ${String(j.why || "").slice(0, 280)}`, sl, tp };
  } catch { return fallback; }
}

/** Scan the chains for HYPE and DIP setups in the market-cap window, best first (before the chart and safety checks). */
export async function scanSetups(chains: string[], s: { hype_on: boolean; dip_on: boolean; mcap_min: number; mcap_max: number; micro_min_liq: number }, skip: Set<string>) {
  const all = (await Promise.all(chains.map((c) => pools(c, chains.length <= 2).catch(() => [])))).flat();
  const out: SCand[] = [];
  for (const c of all) {
    if (skip.has(c.token.toLowerCase()) || c.price <= 0) continue;
    if (c.mcap < s.mcap_min || c.mcap > s.mcap_max) continue;
    if (c.liquidity < s.micro_min_liq) continue;
    if (c.ageHours < 0.15) continue; // the first 9 minutes are the worst rug zone
    const k = classify(c, s);
    if (k) out.push(k);
  }
  return out.sort((a, b) => b.score - a.score);
}
