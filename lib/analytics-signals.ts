/**
 * "Buy or sell?" and "Who might sell next?", worked out from a token's live trades, top wallets and links.
 * Pure functions, safe anywhere. A rough guide from public blockchain data, never financial advice.
 */
import { clusters, sellRisk, type EventRow, type HolderRow, type LinkRow, type Risk, type Signal } from "./analytics-insights";

export type Trade = {
  wallet: string; side: "buy" | "sell"; amount: number | string; at: string;
  balance_after?: number | string | null; pct_after?: number | string | null; block?: number | null;
};
export type Suspect = { wallet: string; pct: number; risk: Risk; isDev: boolean; soldRecently: boolean };
export type Group = { wallets: string[]; pct: number; how: string[]; withDev: boolean; soldRecently: boolean; risk: Risk };
export type Verdict = { kind: "buy" | "wait" | "careful" | "sell" | "avoid"; emoji: string; title: string; summary: string; score: number; reasons: Signal[] };

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const p = (v: number) => (v >= 10 ? v.toFixed(0) : v >= 0.1 ? v.toFixed(1) : v.toFixed(2)) + "%";
const DAY = 86_400_000, HOUR = 3_600_000;
const within = (at: string, ms: number, now: number) => now - Date.parse(at) < ms;
const KIND: Record<string, string> = { transfer: "sent tokens to each other", moved: "moved tokens to each other", funded: "one paid for the other's first tokens", "same-block": "bought in the same block (often one person or bot)" };

/** Wallets that bought in the same block, a few at a time (a big crowd in one block is just a busy moment). */
export function sameBlockLinks(trades: Trade[]): LinkRow[] {
  const byBlock = new Map<number, Set<string>>();
  for (const t of trades) if (t.side === "buy" && t.block) byBlock.set(t.block, (byBlock.get(t.block) || new Set()).add(t.wallet));
  const out: LinkRow[] = [];
  for (const set of byBlock.values()) {
    const w = [...set];
    if (w.length >= 2 && w.length <= 4) for (const b of w.slice(1)) out.push({ a: w[0], b, kind: "same-block" });
  }
  return out;
}

type Input = { holders: HolderRow[]; events: EventRow[]; trades: Trade[]; links: LinkRow[]; dev?: string | null; security?: any; now?: number };

/** Everyone who holds tokens now (tracked top wallets plus anyone seen trading), and their sales, in one shape. */
function people({ holders, events, trades, dev }: Input) {
  const rows = new Map<string, HolderRow>();
  const contracts = new Set(holders.filter((h) => h.is_contract).map((h) => h.wallet));
  for (const h of holders) if (!h.is_contract && n(h.balance) > 0) rows.set(h.wallet, h);
  const latest = new Map<string, Trade>();
  for (const t of trades) { const l = latest.get(t.wallet); if (!l || Date.parse(t.at) > Date.parse(l.at)) latest.set(t.wallet, t); }
  for (const [w, t] of latest) {
    if (rows.has(w) || contracts.has(w) || n(t.balance_after) <= 0) continue;
    const first = trades.filter((x) => x.wallet === w).reduce((a, x) => (Date.parse(x.at) < Date.parse(a) ? x.at : a), t.at);
    rows.set(w, {
      wallet: w, rank: null, pct: t.pct_after ?? null, balance: t.balance_after ?? 0, peak_balance: t.balance_after ?? 0,
      is_dev: w === dev, is_contract: false, label: null, in_top: false, acquired_at: first, first_seen_at: first,
    });
  }
  const all: EventRow[] = [
    ...events,
    ...trades.map((t) => ({ wallet: t.wallet, kind: t.side, pct_of_holding: null, created_at: t.at, is_dev: t.wallet === dev, amount: t.amount })),
  ];
  return { rows, all };
}

/** Links between people only, without "hub" wallets that touch lots of others (exchanges, routers, airdrops). */
function cleanLinks(links: LinkRow[], keep: Set<string>) {
  const degree = new Map<string, number>();
  for (const l of links) for (const w of [l.a, l.b]) degree.set(w, (degree.get(w) || 0) + 1);
  return links.filter((l) => l.a !== l.b && keep.has(l.a) && keep.has(l.b) && (degree.get(l.a) || 0) <= 6 && (degree.get(l.b) || 0) <= 6);
}

/** Connected groups of wallets and the single wallets most likely to sell next, riskiest first. */
export function whoMightSell(input: Input): { groups: Group[]; suspects: Suspect[] } {
  const now = input.now ?? Date.now();
  const { rows, all } = people(input);
  const links = cleanLinks([...input.links, ...sameBlockLinks(input.trades)], new Set(rows.keys()));
  const soldRecently = (w: string) => all.some((e) => e.wallet === w && e.kind !== "buy" && within(e.created_at, DAY, now));

  const suspects: Suspect[] = [...rows.values()].map((h) => {
    const risk = sellRisk(h, all, links, input.dev);
    const recent = soldRecently(h.wallet);
    if (recent && !risk.reasons.some((r) => r.includes("sold"))) risk.reasons.unshift("sold in the last 24 h");
    return { wallet: h.wallet, pct: n(h.pct), risk, isDev: h.is_dev, soldRecently: recent };
  }).sort((a, b) => b.risk.score - a.risk.score || b.pct - a.pct);

  const groups: Group[] = clusters([...rows.keys()], links).map((ws) => {
    const members = suspects.filter((s) => ws.includes(s.wallet));
    const inside = links.filter((l) => ws.includes(l.a) && ws.includes(l.b));
    const how = [...new Set(inside.map((l) => KIND[l.kind] || "are linked"))];
    const pct = members.reduce((a, s) => a + s.pct, 0);
    const withDev = ws.includes(input.dev || "") || inside.some((l) => l.a === input.dev || l.b === input.dev);
    const sold = members.filter((s) => s.soldRecently).length;
    const reasons: string[] = [];
    let score = Math.max(...members.map((s) => s.risk.score), 0);
    if (sold) { score += 15; reasons.push(`${sold} of them sold in the last 24 h. When one sells, the others often follow`); }
    if (withDev) { score += 15; reasons.push("the group includes or is tied to the dev"); }
    if (pct >= 5) { score += 10; reasons.push(`together they hold ${p(pct)}, enough to move the price`); }
    if (inside.some((l) => l.kind === "same-block")) reasons.push("they bought at the exact same moment, which bots and bundlers do");
    score = Math.min(95, score);
    return { wallets: ws, pct, how, withDev, soldRecently: !!sold, risk: { score, level: (score >= 55 ? "high" : score >= 30 ? "medium" : "low") as Risk["level"], reasons } };
  }).sort((a, b) => b.risk.score - a.risk.score || b.pct - a.pct);

  return { groups, suspects: suspects.filter((s) => s.risk.level !== "low") };
}

/**
 * One plain answer: does it look like a good time to buy, to wait, or to take profit? Weighs live buying against
 * selling (last hour and last day), what the dev is doing, connected wallets selling, big bags likely to sell,
 * and the token's safety checks.
 */
export function tradeCall(input: Input & { supply?: number }): Verdict {
  const now = input.now ?? Date.now();
  const s = input.security || {};
  const reasons: Signal[] = [];
  if (s.honeypot === true || n(s.sellTax) >= 25) {
    if (s.honeypot === true) reasons.push({ level: "bad", text: "Honeypot warning: buyers may not be able to sell." });
    if (n(s.sellTax) >= 25) reasons.push({ level: "bad", text: `Sell tax is ${Math.round(n(s.sellTax))}%: you lose that much every time you sell.` });
    return { kind: "avoid", emoji: "🚫", title: "Stay away", summary: "The token itself looks unsafe, whatever the trading looks like.", score: 0, reasons };
  }
  let score = 50;
  const vol = (ms: number) => {
    const w = input.trades.filter((t) => within(t.at, ms, now));
    const buy = w.filter((t) => t.side === "buy"), sell = w.filter((t) => t.side === "sell");
    const bv = buy.reduce((a, t) => a + n(t.amount), 0), sv = sell.reduce((a, t) => a + n(t.amount), 0);
    return { count: w.length, power: bv + sv ? bv / (bv + sv) : 0.5, buyers: new Set(buy.map((t) => t.wallet)).size, sellers: new Set(sell.map((t) => t.wallet)).size };
  };
  const d = vol(DAY), h = vol(HOUR);

  // Buying vs selling.
  if (!d.count) { score -= 5; reasons.push({ level: "warn", text: "Very quiet: no buys or sells in the last 24 h." }); }
  else {
    score += Math.round((d.power - 0.5) * 40);
    const bp = Math.round(d.power * 100);
    reasons.push(d.power >= 0.55 ? { level: "good", text: `More buying than selling in the last 24 h (${bp}% of the volume was buys).` }
      : d.power <= 0.45 ? { level: "bad", text: `More selling than buying in the last 24 h (${100 - bp}% of the volume was sells).` }
      : { level: "warn", text: "Buying and selling are about even in the last 24 h." });
    if (d.buyers >= Math.max(3, d.sellers * 1.5)) { score += 5; reasons.push({ level: "good", text: `${d.buyers} different wallets bought and only ${d.sellers} sold: new people are coming in.` }); }
    else if (d.sellers >= Math.max(3, d.buyers * 1.5)) { score -= 5; reasons.push({ level: "bad", text: `${d.sellers} different wallets sold and only ${d.buyers} bought: people are leaving.` }); }
  }
  if (h.count >= 2) {
    score += Math.round((h.power - 0.5) * 20);
    if (h.power >= 0.65) reasons.push({ level: "good", text: "Buyers are stepping in right now (last hour)." });
    else if (h.power <= 0.35) reasons.push({ level: "bad", text: "Selling picked up in the last hour." });
  }

  // The dev.
  const devSold = !!input.dev && (input.trades.some((t) => t.wallet === input.dev && t.side === "sell" && within(t.at, DAY, now))
    || input.events.some((e) => e.is_dev && e.kind !== "buy" && within(e.created_at, DAY, now)));
  const devRow = input.holders.find((x) => x.is_dev && n(x.balance) > 0);
  if (devSold) { score -= 25; reasons.push({ level: "bad", text: "The dev sold in the last 24 h." }); }
  else if (devRow && n(devRow.pct) > 10) { score -= 5; reasons.push({ level: "warn", text: `The dev still holds ${p(n(devRow.pct))}, and could sell at any time.` }); }

  // Who might sell next.
  const { groups, suspects } = whoMightSell(input);
  const risky = suspects.filter((x) => x.risk.level === "high").reduce((a, x) => a + x.pct, 0);
  if (risky >= 5) { score -= 10; reasons.push({ level: "bad", text: `Wallets that look likely to sell hold ${p(risky)} of the supply.` }); }
  else if (risky >= 1) reasons.push({ level: "warn", text: `Wallets that look likely to sell hold ${p(risky)} of the supply.` });
  const selling = groups.filter((g) => g.soldRecently);
  if (selling.length) { score -= 10; reasons.push({ level: "bad", text: `A group of ${selling[0].wallets.length} connected wallets is selling.` }); }

  // Concentration and tax.
  const top10 = input.holders.filter((x) => x.in_top && !x.is_contract).sort((a, b) => n(b.pct) - n(a.pct)).slice(0, 10).reduce((a, x) => a + n(x.pct), 0);
  if (top10 > 50) { score -= 10; reasons.push({ level: "bad", text: `The 10 biggest wallets hold ${p(top10)}: a few people can crash the price.` }); }
  if (n(s.sellTax) > 10) { score -= 10; reasons.push({ level: "bad", text: `Sell tax is ${Math.round(n(s.sellTax))}%.` }); }
  if (s.freezable === true) { score -= 15; reasons.push({ level: "bad", text: "The owner can freeze wallets, so you might not be able to sell." }); }

  score = Math.max(0, Math.min(100, score));
  const base = { score, reasons: reasons.sort((a, b) => ({ bad: 0, warn: 1, good: 2 }[a.level] - { bad: 0, warn: 1, good: 2 }[b.level])) };
  if (score >= 65) return { ...base, kind: "buy", emoji: "🟢", title: "Looks good to buy", summary: "Buyers are in control and nothing big is worrying." };
  if (score >= 45) return { ...base, kind: "wait", emoji: "🟡", title: "Wait and watch", summary: "Mixed signals. Wait for buyers to take over before going in." };
  if (score >= 30) return { ...base, kind: "careful", emoji: "🟠", title: "Careful: sellers are active", summary: "Not a good moment to buy. If you hold, think about taking some profit." };
  return { ...base, kind: "sell", emoji: "🔴", title: "Good time to take profit", summary: "Heavy selling or warning signs. If you hold, consider selling some." };
}

export type Outlook = { level: "good" | "ok" | "weak"; title: string; reasons: Signal[] };

/**
 * Is it a good hold, and for how long? Long term leans on loyalty: how long the top wallets have held, how many
 * never sold, locked supply and a dev who stays. Short term leans on the live buying and selling.
 * Holding times only count when the first purchase is known; otherwise a wallet counts from when tracking started.
 */
export function holdOutlook(input: Input, call: Verdict): { long: Outlook; short: Outlook } {
  const now = input.now ?? Date.now();
  const s = input.security || {};
  const { rows, all } = people(input);
  const sold = (w: string) => all.some((e) => e.wallet === w && e.kind !== "buy");
  const top = [...rows.values()].filter((h) => h.in_top);
  const daysOf = (at: string | null) => (at ? (now - Date.parse(at)) / DAY : NaN);
  const r: Signal[] = [];
  let score = 50;

  // Loyalty: who hasn't sold, and for how long they've held.
  if (top.length >= 3) {
    const loyal = top.filter((h) => !sold(h.wallet));
    const share = loyal.length / top.length;
    if (share >= 0.8) { score += 15; r.push({ level: "good", text: `${loyal.length} of the ${top.length} top wallets have never sold. People here are holding, not flipping.` }); }
    else if (share <= 0.5) { score -= 15; r.push({ level: "bad", text: `Only ${loyal.length} of the ${top.length} top wallets have never sold. Lots of flipping.` }); }
    else r.push({ level: "warn", text: `${loyal.length} of the ${top.length} top wallets have never sold.` });
  }
  const known = top.map((h) => ({ h, d: daysOf(h.acquired_at) })).filter((x) => isFinite(x.d));
  if (known.length >= 5) {
    const mid = known.map((x) => x.d).sort((a, b) => a - b)[Math.floor(known.length / 2)];
    const longPct = known.filter((x) => x.d >= 30 && !sold(x.h.wallet)).reduce((a, x) => a + n(x.h.pct), 0);
    if (mid >= 30) { score += 20; r.push({ level: "good", text: `Most top wallets have held for over ${Math.floor(mid)} days. Lots of people are in it for the long run, which gives it a chance to outperform over time.` }); }
    else if (mid >= 7) { score += 10; r.push({ level: "good", text: `Most top wallets have held for about ${Math.round(mid)} days.` }); }
    else if (mid < 1) { score -= 10; r.push({ level: "warn", text: "Most top wallets bought less than a day ago, so nobody has proven they'll hold yet." }); }
    if (longPct >= 5) r.push({ level: "good", text: `Wallets that have held for over a month without selling own ${p(longPct)} of the supply.` });
  } else {
    const tracked = Math.max(0, ...top.map((h) => daysOf(h.first_seen_at)).filter(isFinite));
    if (tracked >= 1) r.push({ level: "warn", text: `We've followed the top wallets for ${Math.floor(tracked)} day${Math.floor(tracked) === 1 ? "" : "s"}. Holding times get clearer the longer we watch.` });
  }

  // Locked supply and the dev.
  const locked = input.holders.filter((h) => h.is_contract && /lock|vest/i.test(h.label || "")).reduce((a, h) => a + n(h.pct), 0);
  if (locked >= 5) { score += 10; r.push({ level: "good", text: `${p(locked)} of the supply is locked, so it can't be dumped right now.` }); }
  const devSold = !!input.dev && all.some((e) => e.wallet === input.dev && e.kind !== "buy");
  if (devSold) { score -= 20; r.push({ level: "bad", text: "The dev has sold. Long-term holders usually want a dev who stays." }); }
  else if (input.dev) { score += 10; r.push({ level: "good", text: "The dev hasn't sold since we started watching." }); }

  // Things that hurt any hold.
  const top10 = input.holders.filter((x) => x.in_top && !x.is_contract).sort((a, b) => n(b.pct) - n(a.pct)).slice(0, 10).reduce((a, x) => a + n(x.pct), 0);
  if (top10 > 50) { score -= 10; r.push({ level: "bad", text: `The 10 biggest wallets hold ${p(top10)}. If they leave, the price falls hard.` }); }
  if (s.honeypot === true) { score -= 40; r.push({ level: "bad", text: "Honeypot warning: you may never be able to sell." }); }
  if (s.freezable === true) { score -= 15; r.push({ level: "bad", text: "The owner can freeze wallets. A long hold could get stuck." }); }
  if (s.mintable === true) { score -= 10; r.push({ level: "warn", text: "The owner can make new tokens, which can water down your bag over time." }); }
  const week = input.trades.filter((t) => within(t.at, 7 * DAY, now));
  const wb = new Set(week.filter((t) => t.side === "buy").map((t) => t.wallet)).size, ws = new Set(week.filter((t) => t.side === "sell").map((t) => t.wallet)).size;
  if (wb >= 5 && wb > ws) { score += 5; r.push({ level: "good", text: `${wb} wallets bought this week and ${ws} sold, so new holders keep arriving.` }); }

  score = Math.max(0, Math.min(100, score));
  const order = { good: 0, warn: 1, bad: 2 };
  const long: Outlook = score >= 65 ? { level: "good", title: "Looks strong to hold long term", reasons: r }
    : score >= 45 ? { level: "ok", title: "Okay to hold, keep an eye on it", reasons: r } : { level: "weak", title: "Risky to hold long term", reasons: r };
  long.reasons.sort((a, b) => order[a.level] - order[b.level]);

  // Short term: the live buying and selling.
  const shortReasons = call.reasons.filter((x) => /hour|24 h|wallets bought|wallets sold|likely to sell|connected wallets is selling|quiet/i.test(x.text)).slice(0, 4);
  const short: Outlook = call.kind === "avoid" ? { level: "weak", title: "Not safe to trade", reasons: call.reasons }
    : call.score >= 65 ? { level: "good", title: "Good momentum for a short-term trade", reasons: shortReasons }
    : call.score >= 45 ? { level: "ok", title: "Choppy: no clear direction right now", reasons: shortReasons }
    : { level: "weak", title: "Sellers in control for now", reasons: shortReasons };
  return { long, short };
}

export type Move = { priceUsd: number | null; m5: number | null; h1: number | null; h6: number | null; h24: number | null; buysH1: number; sellsH1: number; liquidityUsd: number | null };
export type Target = { label: string; pct: number; price: number | null; note: string };
export type Plan = {
  key: "long" | "short"; outlook: Outlook;
  entry: { level: "good" | "ok" | "weak"; title: string; reasons: Signal[] };
  exit: { now: boolean; title: string; reasons: Signal[] };
  targets: Target[]; price: number | null;
};

const at = (price: number | null, pct: number) => (price ? price * (1 + pct / 100) : null);
const rate = (score: number, good: string, ok: string, weak: string) =>
  score >= 65 ? { level: "good" as const, title: good } : score >= 45 ? { level: "ok" as const, title: ok } : { level: "weak" as const, title: weak };

/**
 * Two trading plans: long term (hold for weeks or months) and short term (a day trade). Each says whether now is a good
 * entry, whether it's time to take profit, and gives simple price targets from the current price. `move` is the live
 * price action from DexScreener and can be missing.
 */
export function tradingPlans(call: Verdict, hold: { long: Outlook; short: Outlook }, move: Move | null): { long: Plan; short: Plan } {
  const m = move, price = m?.priceUsd ?? null;
  const pc = (v: number | null | undefined) => `${v! > 0 ? "+" : ""}${Math.round(v!)}%`;
  const drop = (v: number | null | undefined) => `${Math.abs(Math.round(v!))}%`;
  const thinPool = m?.liquidityUsd != null && m.liquidityUsd < 10_000;
  const unsafe = call.kind === "avoid";

  // ---------- Short term: momentum and timing ----------
  const se: Signal[] = [];
  let ss = call.score;
  if (m) {
    if (m.h1 != null && m.h1 <= -8 && (m.m5 ?? 0) > 0 && m.buysH1 >= m.sellsH1) { ss += 15; se.push({ level: "good", text: `It dipped ${drop(m.h1)} in the last hour and buyers are stepping back in: a classic dip entry.` }); }
    else if (m.h1 != null && m.h1 <= -15) { ss -= 10; se.push({ level: "bad", text: `Down ${drop(m.h1)} in the last hour and still falling. Wait for it to stop dropping.` }); }
    if ((m.h1 ?? 0) >= 30 || (m.h6 ?? 0) >= 60) { ss -= 20; se.push({ level: "bad", text: `Already up ${pc(Math.max(m.h1 ?? 0, m.h6 ?? 0))} in a few hours. Chasing a pump is risky, so wait for a pullback.` }); }
    else if ((m.h1 ?? 0) > 3 && m.buysH1 > m.sellsH1) { ss += 5; se.push({ level: "good", text: `Climbing (${pc(m.h1)} this hour) with more buys than sells.` }); }
    if (m.buysH1 + m.sellsH1 >= 5) se.push({ level: m.buysH1 >= m.sellsH1 ? "good" : "warn", text: `Last hour: ${m.buysH1} buys and ${m.sellsH1} sells.` });
    else { ss -= 5; se.push({ level: "warn", text: "Very few trades in the last hour. Day trading needs action." }); }
  } else se.push({ level: "warn", text: "Live price data isn't available right now, so this is based on wallet activity only." });
  if (thinPool) { ss -= 15; se.push({ level: "bad", text: `Small pool ($${Math.round(m!.liquidityUsd!).toLocaleString("en-US")}): prices jump a lot and big sells hurt.` }); }
  for (const r of call.reasons.filter((x) => /dev sold|connected wallets is selling/i.test(x.text))) se.push(r);
  ss = unsafe ? 0 : Math.max(0, Math.min(100, ss));

  const sx: Signal[] = [];
  let sNow = false;
  if (m && ((m.h1 ?? 0) >= 20 || (m.h6 ?? 0) >= 40)) { sNow = true; sx.push({ level: "good", text: `Up ${pc(Math.max(m.h1 ?? 0, m.h6 ?? 0))} in a few hours. Good moment to lock in profit.` }); }
  if (call.kind === "sell" || call.kind === "careful") { sNow = true; sx.push({ level: "bad", text: "Sellers are taking over. Don't let a winning trade turn into a loss." }); }
  if (m && m.sellsH1 > m.buysH1 * 1.5 && m.sellsH1 >= 5) { sNow = true; sx.push({ level: "bad", text: `Sells are piling up (${m.sellsH1} sells vs ${m.buysH1} buys this hour).` }); }
  if (!sNow) sx.push({ level: "good", text: "No sign to sell yet. Follow your targets below and keep your stop-loss." });

  // ---------- Long term: loyalty and value ----------
  const le: Signal[] = [];
  let ls = hold.long.level === "good" ? 70 : hold.long.level === "ok" ? 52 : 30;
  le.push({ level: hold.long.level === "good" ? "good" : hold.long.level === "ok" ? "warn" : "bad", text: `What holders say: ${hold.long.title.toLowerCase()}.` });
  if (m?.h24 != null) {
    if (m.h24 <= -20 && hold.long.level !== "weak") { ls += 10; le.push({ level: "good", text: `Down ${drop(m.h24)} today while holders stay loyal: a discount for long-term buyers.` }); }
    else if (m.h24 >= 80) { ls -= 15; le.push({ level: "warn", text: `Up ${pc(m.h24)} in 24 h. Even long-term buyers get a better price after it cools down.` }); }
  }
  if (thinPool) { ls -= 10; le.push({ level: "warn", text: "The pool is small, so it's a very early, very risky coin. Only put in a little." }); }
  for (const r of hold.long.reasons.filter((x) => x.level !== "warn").slice(0, 3)) le.push(r);
  ls = unsafe ? 0 : Math.max(0, Math.min(100, ls));

  const lx: Signal[] = [];
  let lNow = false;
  if (m && (m.h24 ?? 0) >= 100) { lNow = true; lx.push({ level: "good", text: `Up ${pc(m.h24)} today. Taking back your starting money now is smart, then let the rest ride.` }); }
  if (hold.long.reasons.some((x) => /dev has sold/i.test(x.text))) { lNow = true; lx.push({ level: "bad", text: "The dev has sold. Long holds depend on a dev who stays, so think about leaving." }); }
  if (hold.long.level === "weak") { lNow = true; lx.push({ level: "bad", text: "Holders are leaving. The long-term case is getting weaker." }); }
  if (!lNow) lx.push({ level: "good", text: "Holders are steady. Keep holding and take profit in steps at the targets below." });

  const avoid = { level: "weak" as const, title: "Not safe to buy" };
  return {
    short: {
      key: "short", outlook: hold.short, price,
      entry: { ...(unsafe ? avoid : rate(ss, "Good entry for a day trade", "Wait for a better entry", "Not a good entry now")), reasons: unsafe ? call.reasons : se },
      exit: { now: sNow, title: sNow ? "Take profit now" : "Hold the trade for now", reasons: sx },
      targets: [
        { label: "Take profit 1", pct: 15, price: at(price, 15), note: "sell half" },
        { label: "Take profit 2", pct: 30, price: at(price, 30), note: "sell the rest" },
        { label: "Stop-loss", pct: -10, price: at(price, -10), note: "sell everything, no regrets" },
      ],
    },
    long: {
      key: "long", outlook: hold.long, price,
      entry: { ...(unsafe ? avoid : rate(ls, "Good entry for a long hold", "Okay entry: buy in small parts", "Not a good entry now")), reasons: unsafe ? call.reasons : le },
      exit: { now: lNow, title: lNow ? "Take some profit now" : "Keep holding", reasons: lx },
      targets: [
        { label: "2x", pct: 100, price: at(price, 100), note: "take back what you put in" },
        { label: "3x", pct: 200, price: at(price, 200), note: "sell another quarter" },
        { label: "5x+", pct: 400, price: at(price, 400), note: "sell some, keep a small bag for the long run" },
        { label: "Exit if", pct: -50, price: at(price, -50), note: "it halves and holders are leaving" },
      ],
    },
  };
}
