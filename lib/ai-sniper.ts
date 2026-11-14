/**
 * 🎯 Sniper (server only): a high-risk trader of brand-new Solana launch coins (pump.fun, letsbonk, …).
 *
 * Its own desk (SNIPE_DESK + the admin's trader id) on the AI Futures tables: own Solana wallet, settings, money,
 * trades and log. The money stays in that Solana wallet (USDT / USDC / SOL); nothing goes to Hyperliquid.
 *
 * Every minute it reads Jupiter's trending and newest coins and buys at most a couple that are:
 *   - under an hour old, $8K–$150K market cap, on a launchpad (still on its curve or just graduated),
 *   - pumping right now: +15% or more in 5 minutes, at least 25 buys and clearly more buys than sells,
 *   - spread out: 40+ holders, top holders under 35%, and not bought by this sniper before.
 * Each buy is a fixed $ amount. It sells at the take profit, the stop-loss, a trailing stop once it's up 50%
 * (gives back at most 20% from the high and always keeps +10%), a liquidity collapse (rug) or the time limit.
 *
 * Practice: pretend dollars at real prices (2% slippage and 1% fees counted). Live: real swaps through Jupiter.
 * Most brand-new coins go to zero. This is the riskiest of the traders on purpose.
 */
import { supabaseService } from "@/lib/supabase/server";
import { T } from "@/lib/ai-trader-ctx";
import { resolve, type Flow } from "@/lib/ai-signals";
import { flog, futSolAccount, type FPos, type FSettings } from "@/lib/ai-futures";

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const sb = () => supabaseService();
const pos = () => sb().from("ai_futures_positions");
const JUP = process.env.JUPITER_API || "https://lite-api.jup.ag";
const LAUNCHPAD = /pump|bonk|launchlab|moonshot|believe|bags|meteora|dbc/i;

export type SnipeCfg = { usd: number; tp: number; sl: number };
export const snipeCfg = (s: FSettings): SnipeCfg => {
  const a = s as any;
  return { usd: Math.max(1, n(a.snipe_usd) || 10), tp: Math.max(10, n(a.snipe_tp) || 100), sl: Math.min(90, Math.max(5, n(a.snipe_sl) || 25)) };
};

async function get(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

type Pick = { mint: string; symbol: string; mcap: number; price: number; why: string; score: number };

/** Coins pumping right now that pass every filter, best first. */
async function candidates(skip: Set<string>): Promise<Pick[]> {
  const lists = await Promise.all([
    get(`${JUP}/tokens/v2/toptrending/5m?limit=100`).catch(() => []),
    get(`${JUP}/tokens/v2/recent?limit=100`).catch(() => []),
  ]);
  const seen = new Set<string>(), out: Pick[] = [];
  for (const t of lists.flat() as any[]) {
    const mint = String(t?.id || "");
    if (!mint || seen.has(mint) || skip.has(mint)) continue;
    seen.add(mint);
    const st = t.stats5m || {};
    const created = Date.parse(t.firstPool?.createdAt || t.createdAt || "") || 0;
    const ageMin = created ? (Date.now() - created) / 60_000 : 9e9;
    const mcap = n(t.mcap) || n(t.fdv), buys = n(st.numBuys), sells = n(st.numSells), ch5 = n(st.priceChange);
    const top = n(t.audit?.topHoldersPercentage);
    const onPad = LAUNCHPAD.test(String(t.launchpad || "")) || /pump$|bonk$/i.test(mint);
    if (!onPad || ageMin > 60 || mcap < 8_000 || mcap > 150_000 || !(n(t.usdPrice) > 0)) continue;
    if (ch5 < 15 || buys < 25 || buys < sells * 1.5 || n(st.buyVolume) < n(st.sellVolume) * 1.3) continue;
    if (n(t.holderCount) < 40 || top > 35) continue;
    if (t.audit?.mintAuthorityDisabled === false || t.audit?.freezeAuthorityDisabled === false) continue;
    out.push({
      mint, symbol: String(t.symbol || "?"), mcap, price: n(t.usdPrice),
      why: `${t.symbol || "?"}: +${ch5.toFixed(0)}% in 5 min, ${buys} buys vs ${sells} sells, ${n(t.holderCount)} holders, $${Math.round(mcap).toLocaleString("en-US")} cap, ${Math.round(ageMin)} min old${t.launchpad ? ` (${t.launchpad})` : ""}`,
      score: ch5 * Math.min(4, buys / Math.max(1, sells)),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

async function wallets() {
  const kp = await futSolAccount();
  if (!kp) throw new Error("Create or import the Sniper's Solana wallet first.");
  return { sol: kp, evm: null };
}

/** Live: what the Solana wallet holds (stablecoins, SOL) in dollars. */
export async function snipeWallet() {
  const kp = await futSolAccount();
  if (!kp) return null;
  const { solWalletBalances, nativeUsd } = await import("@/lib/ai-trader-chains");
  const [b, solUsd] = await Promise.all([solWalletBalances(kp.publicKey.toBase58()), nativeUsd("solana").catch(() => 0)]);
  const sol = n(b.sol);
  return { address: kp.publicKey.toBase58(), usdt: b.usdt, usdc: b.usdc, sol, solUsd, total: b.usdt + b.usdc + sol * solUsd };
}

/** Account value: free money plus open trades at their last price. */
export async function snipeEquity(s: FSettings): Promise<{ total: number; free: number }> {
  const { data } = await pos().select("*").eq("fut_id", T()).eq("mode", s.mode).in("status", ["open", "closing"]);
  const open = (data || []) as FPos[];
  const inTrades = open.reduce((a, p) => a + n(p.notional_usd) * (n(p.last) || n(p.entry)) / n(p.entry), 0);
  if (s.mode === "live") {
    const w = await snipeWallet().catch(() => null);
    const free = w ? w.usdt + w.usdc + Math.max(0, w.sol - 0.02) * w.solUsd : 0;
    return { total: (w?.total ?? 0) + inTrades, free };
  }
  return { total: s.paper_usd + inTrades, free: s.paper_usd };
}

async function buy(s: FSettings, c: Pick, cfg: SnipeCfg): Promise<string> {
  const eq = await snipeEquity(s);
  if (eq.free < cfg.usd) return `not enough free money ($${eq.free.toFixed(2)}, each buy is $${cfg.usd})`;
  let entry = c.price * 1.02, qty = cfg.usd / entry, tx: string | null = null, spent = cfg.usd;
  if (s.mode === "live") {
    const { liveBuyOn, bestStable, nativeUsd } = await import("@/lib/ai-trader-chains");
    const w = await wallets();
    const st = await bestStable("solana", w);
    let r: { hash: string; raw: bigint; decimals: number };
    if (st && st.balance >= cfg.usd) r = await liveBuyOn("solana", w, c.mint, cfg.usd, 5, st);
    else {
      const solUsd = await nativeUsd("solana");
      if (!(solUsd > 0)) return "couldn't price SOL";
      r = await liveBuyOn("solana", w, c.mint, cfg.usd / solUsd, 5, null);
    }
    if (!(r.raw > 0n)) return "the swap went through but no coins arrived";
    qty = Number(r.raw) / 10 ** r.decimals;
    entry = cfg.usd / qty; tx = r.hash;
  } else {
    await sb().from("ai_futures_settings").update({ paper_usd: s.paper_usd - cfg.usd }).eq("id", T());
    s.paper_usd -= cfg.usd;
  }
  await pos().insert({
    fut_id: T(), mode: s.mode, venue: "pumpfun", coin: c.mint, side: "long", lev: 1, margin_usd: spent, notional_usd: spent,
    entry, stop: entry * (1 - cfg.sl / 100), target: entry * (1 + cfg.tp / 100), liq: null, best: entry, last: entry, size: qty,
    fees_usd: s.mode === "paper" ? spent * 0.01 : 0, why: c.why, open_tx: tx, risk_usd: spent * cfg.sl / 100, equity_at_open: eq.total,
  });
  await flog("open", `🎯 Bought ${c.symbol} for $${cfg.usd}${s.mode === "paper" ? " (practice)" : ""}: ${c.why}. Sells at +${cfg.tp}% or -${cfg.sl}%. https://dexscreener.com/solana/${c.mint}`);
  return `bought ${c.symbol}`;
}

/** Sell a sniper trade (all of it) and record the result. */
export async function closeSnipe(s: FSettings, p: FPos, reason: string, price?: number) {
  const { data: claimed } = await pos().update({ status: "closing" }).eq("id", p.id).eq("status", "open").select("id");
  if (!claimed?.length) return;
  try {
    let px = price || n(p.last) || n(p.entry), got = 0, tx: string | null = null;
    if (p.mode === "live") {
      const { liveSellOn, tokenBalanceOn, STABLES, nativeUsd } = await import("@/lib/ai-trader-chains");
      const w = await wallets();
      const bal = await tokenBalanceOn("solana", w, p.coin);
      if (bal.raw > 0n) {
        const usdt = STABLES.solana![0];
        const panic = /stop|rug|liquidity/i.test(reason) ? 2000 : 0;
        const r = await liveSellOn("solana", w, p.coin, bal.raw, 5, panic, usdt).catch(async () => {
          // Straight to USDT failed: sell for SOL instead.
          const r2 = await liveSellOn("solana", w, p.coin, bal.raw, 5, panic, null);
          return { ...r2, receivedNative: r2.receivedNative * (await nativeUsd("solana")) };
        });
        got = r.receivedNative; tx = r.hash;
        if (n(p.size) > 0) px = got / n(p.size);
      } else reason = `${reason} (the wallet held none of it any more)`;
    } else {
      got = n(p.notional_usd) * (px / n(p.entry)) * 0.98; // 1% fee + 1% slippage on the way out
      await sb().from("ai_futures_settings").update({ paper_usd: s.paper_usd + got }).eq("id", T());
      s.paper_usd += got;
    }
    const pnl = got - n(p.notional_usd) - (p.mode === "paper" ? n(p.fees_usd) : 0);
    await pos().update({ status: "closed", exit: px, pnl_usd: pnl, reason, closed_at: new Date().toISOString(), close_tx: tx }).eq("id", p.id);
    await flog(pnl >= 0 ? "win" : "loss", `${pnl >= 0 ? "✅" : "🔻"} Sold ${p.why?.split(":")[0] || p.coin.slice(0, 6)}: ${reason}. ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${((got / n(p.notional_usd) - 1) * 100).toFixed(0)}%)${p.mode === "paper" ? " (practice)" : ""}.`);
  } catch (e) {
    await pos().update({ status: "open" }).eq("id", p.id);
    await flog("error", `Couldn't sell ${p.coin.slice(0, 6)}…: ${(e as Error).message}`);
  }
}

/** Take profit, stop-loss, trailing stop, rug and time limit for every open sniper trade. */
async function manage(s: FSettings) {
  const { data } = await pos().select("*").eq("fut_id", T()).eq("status", "open");
  for (const p of (data || []) as FPos[]) {
    const f: Flow | null = await resolve({ chain: "solana", token: p.coin }, ["solana"]).catch(() => null);
    if (!f?.price) continue;
    const price = f.price, entry = n(p.entry), best = Math.max(n(p.best) || entry, price);
    await pos().update({ last: price, best }).eq("id", p.id);
    const up = (price / entry - 1) * 100, peak = (best / entry - 1) * 100;
    // Trailing stop once it's been up 50%: gives back at most 20% from the high, and keeps at least +10%.
    const trail = peak >= 50 ? Math.max(best * 0.8, entry * 1.1) : null;
    const old = Date.now() - Date.parse(p.opened_at) > s.max_hold_hours * 3600e3;
    const why = f.liquidity > 0 && f.liquidity < 1500 ? "Liquidity collapsed (possible rug)"
      : price <= n(p.stop) ? `Stop-loss (${up.toFixed(0)}%)`
      : price >= n(p.target) ? `Take profit (+${up.toFixed(0)}%)`
      : trail && price <= trail ? `Trailing stop (+${up.toFixed(0)}%, high was +${peak.toFixed(0)}%)`
      : old ? `Time limit (${s.max_hold_hours}h, ${up >= 0 ? "+" : ""}${up.toFixed(0)}%)` : null;
    if (why) await closeSnipe(s, { ...p, best, last: price }, why, price);
  }
}

/** One minute of the Sniper: manage open trades, then buy the best fresh pumps (at most 2 a minute). */
export async function runSniper(s: FSettings): Promise<string> {
  await manage(s);
  if (!s.enabled) return "Off. Open trades are still watched.";
  const cfg = snipeCfg(s);
  const { data: openP } = await pos().select("coin").eq("fut_id", T()).in("status", ["open", "closing"]);
  const room = s.max_positions - (openP?.length || 0);
  if (room <= 0) return `Holding ${openP?.length} of ${s.max_positions}.`;
  // Daily loss limit, from the day's starting value.
  const eq = await snipeEquity(s);
  const today = new Date().toISOString().slice(0, 10);
  if (s.day !== today || s.day_start_usd == null) { await sb().from("ai_futures_settings").update({ day: today, day_start_usd: eq.total }).eq("id", T()); s.day_start_usd = eq.total; }
  if (eq.total < n(s.day_start_usd) * (1 - s.daily_loss_pct / 100)) return `Paused for today: down ${(100 - (eq.total / n(s.day_start_usd)) * 100).toFixed(1)}% (limit ${s.daily_loss_pct}%).`;
  const { data: ever } = await pos().select("coin").eq("fut_id", T()).eq("venue", "pumpfun").limit(2000);
  const picks = await candidates(new Set(((ever || []) as any[]).map((r) => String(r.coin))));
  const notes: string[] = [];
  for (const c of picks.slice(0, Math.min(2, room))) {
    const r = await buy(s, c, cfg).catch((e) => `failed: ${(e as Error).message}`);
    notes.push(`${c.symbol}: ${r}`);
    if (/^failed/.test(r)) await flog("error", `Buy ${c.symbol}: ${r}`);
  }
  return notes.length ? notes.join(" · ") : `Scanning new launches; nothing pumping hard enough right now. Account $${eq.total.toFixed(2)}.`;
}
