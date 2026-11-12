/**
 * The AI trader (admin only, for testing). Every run (every 5 minutes):
 *  1. Checks each open position and sells on stop-loss, take-profit, trailing stop, max hold time, or if the
 *     liquidity is pulled (rug protection).
 *  2. If there's room and money, looks at coins trending and new on the chosen chains (BNB Chain always; Ethereum and
 *     Robinhood Chain by default; Solana optional), adds the coins being pushed on X and Telegram right now (DexScreener
 *     boosts, plus each coin's own X / Telegram links), keeps only ones that pass the safety gates (safety badge,
 *     honeypot and tax check, liquidity, age) and buys the best one. With "use AI" on, Claude picks among the safe
 *     candidates and says why; otherwise the highest score wins. Money is always counted in BNB.
 * Paper mode trades pretend BNB at real prices on every chain (nothing is sent). Live mode buys on BNB Chain only (the
 * wallet holds BNB; other chains would need bridging), and trades a dedicated wallet whose key is
 * only in Vercel (AI_TRADER_KEY); it never touches anyone else's funds. It pauses itself after the daily loss limit.
 * Server only.
 */
import { createWalletClient, erc20Abi, getAddress, http, isAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anthropic, FAST_MODEL } from "@/lib/ai";
import { discover } from "@/lib/momentum-server";
import { IMPOSTOR, aiPick, chartOk, readChart, scanSetups, type SCand } from "@/lib/ai-strategy";
import { dexSignals, postSignals, resolve, toFlow, xPosts, xReady, type Flow, type Signal } from "@/lib/ai-signals";
import { WCHAINS } from "@/lib/wallet-chains";
import { build, market, quote, riskOf, walletChainClient, type EvmTx } from "@/lib/wallet-server";
import { supabaseService } from "@/lib/supabase/server";
import { T, tq, withTrader } from "@/lib/ai-trader-ctx";
import { SAFETY, safetyGate, type Gate } from "@/lib/ai-safety";
import { simulateHoneypot } from "@/lib/honeypot-sim";
import { extract } from "@/lib/ai-signals";
import { tgNotify, xFollowedPosts } from "@/lib/ai-trader-copy";
import { tgaNewPosts } from "@/lib/tg-account";

export const TRADE_CHAINS = ["bsc", "ethereum", "robinhood", "solana"] as const;
export type TradeChain = (typeof TRADE_CHAINS)[number];
const CHAIN_NAME: Record<string, string> = { bsc: "BNB Chain", ethereum: "Ethereum", robinhood: "Robinhood Chain", solana: "Solana" };

export type Settings = {
  enabled: boolean; mode: "paper" | "live"; chains: TradeChain[]; need_socials: boolean; paper_cash: number; paper_start: number; per_trade: number; max_positions: number;
  min_liquidity: number; max_tax: number; min_age_hours: number; stop_loss: number; take_profit: number; trail: number;
  max_hold_hours: number; daily_loss_limit: number; use_ai: boolean; last_run: string; last_note: string | null;
  manual_active: boolean; away_take_profit: number; admin_seen_at: string | null;
  hype_on: boolean; dip_on: boolean; mcap_min: number; mcap_max: number; micro_min_liq: number; target_profit: number; strat_stop: number;
  signals_on: boolean; callers: string[]; caller_mcap_max: number; x_since: string | null; per_trade_usd: number;
  copy_on: boolean; copy_tp: number; copy_sl: number; tg_user_id: number | null; tg_username: string | null; x_username: string | null;
  trade_mode: "telegram" | "x" | "general"; rebuy_on: boolean; rebuy_dump: number; rebuy_tp: number;
};
export type Position = {
  id: string; mode: "paper" | "live"; chain: string; token: string; symbol: string | null; name: string | null; logo: string | null;
  status: "open" | "closing" | "closed"; spent: number; qty: number; amount_raw: string | null; decimals: number;
  entry_usd: number; high_usd: number; last_usd: number | null; stop_loss: number; take_profit: number; trail: number;
  why: string | null; buy_tx: string | null; sell_tx: string | null; received: number | null; pnl: number | null; pnl_pct: number | null;
  close_reason: string | null; opened_at: string; closed_at: string | null; strategy: string | null; pool: string | null;
  new_project?: boolean | null;
};

const C = WCHAINS.bsc;
const SLIP_BPS = 300; // live: 3% plus the coin's tax
const PAPER_SLIP = 0.01; // paper: assume 1% lost to price impact each way
const GAS_KEEP = 0.003; // BNB always left in the live wallet for gas
const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };

/**
 * The live trading wallet: AI_TRADER_KEY in Vercel if set, otherwise the wallet created from the Admin panel, whose
 * key is kept encrypted in the database Vault (only the server can read it; it's never shown or sent anywhere).
 */
// Each admin's trader has its own wallet. AI_TRADER_KEY in Vercel, if set, is the owner's (trader 1) only.
const wallets = new Map<number, ReturnType<typeof privateKeyToAccount>>();
const envKey = () => (T() === 1 ? process.env.AI_TRADER_KEY?.trim() || "" : "");
export async function traderAccount() {
  const have = wallets.get(T());
  if (have) return have;
  let k = envKey();
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) {
    const { data } = await supabaseService().rpc("ai_trader_key_get_for", { p_trader: T() });
    k = typeof data === "string" ? data : "";
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) return null;
  const a = privateKeyToAccount(k as `0x${string}`);
  wallets.set(T(), a);
  return a;
}

/** Owner: makes the live trading wallet (once). Returns its address to send BNB to. */
export async function createTraderWallet(): Promise<string> {
  if (await traderAccount()) throw new Error("The AI trader already has a wallet.");
  const key = generatePrivateKey();
  const { error } = await supabaseService().rpc("ai_trader_key_set_for", { p_trader: T(), p_key: key, p_replace: false });
  if (error) throw new Error(error.message);
  const a = privateKeyToAccount(key);
  wallets.set(T(), a);
  await log("settings", `Live trading wallet created: ${a.address}`);
  return a.address;
}

/** Owner: the wallet's private key, to import it into their own wallet app (MetaMask, Trust Wallet…). */
export async function revealTraderKey(): Promise<string> {
  const env = envKey();
  if (env && /^0x[0-9a-fA-F]{64}$/.test(env)) return env;
  const { data } = await supabaseService().rpc("ai_trader_key_get_for", { p_trader: T() });
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data)) throw new Error("There's no trading wallet yet.");
  await log("settings", "The owner viewed the trading wallet's private key.");
  return data;
}

/** Owner: use their own wallet for live trading instead (only while the current one is empty and nothing live is open). */
export async function importTraderKey(raw: string): Promise<string> {
  const key = (raw.trim().startsWith("0x") ? raw.trim() : `0x${raw.trim()}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("That isn't a private key (64 letters and numbers, from your wallet's Export private key).");
  if (envKey()) throw new Error("AI_TRADER_KEY is set in Vercel and wins over this. Remove it there first.");
  const sb = supabaseService();
  const { data: openLive } = await tq("ai_trader_positions").select("id").eq("mode", "live").in("status", ["open", "closing"]).limit(1);
  if (openLive?.length) throw new Error("Sell the open live coins first.");
  const cur = await traderAccount();
  if (cur) {
    const bnb = Number(await (walletChainClient(C) as any).getBalance({ address: cur.address })) / 1e18;
    if (bnb > 0.0005) throw new Error(`The current trading wallet still holds ${bnb.toFixed(4)} BNB. Withdraw it first so nothing is left behind.`);
  }
  const { error } = await sb.rpc("ai_trader_key_set_for", { p_trader: T(), p_key: key, p_replace: true });
  if (error) throw new Error(error.message);
  const a = privateKeyToAccount(key);
  wallets.set(T(), a);
  await log("settings", `Live trading now uses your own wallet: ${a.address}`);
  return a.address;
}

/** Owner: sends the wallet's BNB (all but the gas for this transfer) to an address the owner typed. */
export async function withdrawBnb(to: string): Promise<{ hash: string; bnb: number }> {
  const account = await traderAccount();
  if (!account) throw new Error("There's no trading wallet yet.");
  if (!isAddress(to)) throw new Error("That isn't a BNB Chain address.");
  const pc = walletChainClient(C) as any;
  const bal: bigint = await pc.getBalance({ address: account.address });
  const price: bigint = await pc.getGasPrice();
  const fee = price * 21000n * 2n;
  if (bal <= fee) throw new Error("Not enough BNB to cover the transfer fee.");
  const w = createWalletClient({ account, chain: C.viem, transport: http(C.rpc, { timeout: 20_000 }) }) as any;
  const value = bal - fee;
  const hash = await w.sendTransaction({ to: getAddress(to), value, gas: 21000n, gasPrice: price });
  await pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
  await log("settings", `Withdrew ${(Number(value) / 1e18).toFixed(5)} BNB to ${to}.`);
  return { hash, bnb: Number(value) / 1e18 };
}

export async function log(kind: string, text: string) {
  await tq("ai_trader_log").insert({ kind, text: text.slice(0, 600) });
}

export async function getSettings(): Promise<Settings> {
  const { data } = await supabaseService().from("ai_trader_settings").select("*").eq("id", T()).single();
  const s = data as any;
  for (const k of ["paper_cash", "paper_start", "per_trade", "min_liquidity", "max_tax", "min_age_hours", "stop_loss", "take_profit", "trail", "max_hold_hours", "daily_loss_limit", "away_take_profit", "mcap_min", "mcap_max", "micro_min_liq", "target_profit", "strat_stop", "caller_mcap_max", "per_trade_usd", "copy_tp", "copy_sl", "rebuy_dump", "rebuy_tp"]) s[k] = n(s[k]);
  if (!["telegram", "x", "general"].includes(s.trade_mode)) s.trade_mode = "telegram";
  s.rebuy_on = s.rebuy_on !== false;
  s.copy_on = s.copy_on !== false;
  s.callers = Array.isArray(s.callers) ? s.callers : [];
  s.chains = (Array.isArray(s.chains) ? s.chains : ["bsc"]).filter((c: string) => (TRADE_CHAINS as readonly string[]).includes(c));
  if (!s.chains.includes("bsc")) s.chains.unshift("bsc");
  s.need_socials = s.need_socials !== false;
  return s as Settings;
}

async function bnbUsd() {
  const m = await market(C, C.native.address);
  if (!m.priceUsd) throw new Error("No BNB price right now.");
  return m.priceUsd;
}

// ---------------------------------------------------------------- Any chain: price, socials, safety

type Info = { price: number | null; liquidity: number | null; x: boolean; tg: boolean; logo: string | null };
/** Price, pool depth and whether the coin has an X / Telegram, from DexScreener (up to 30 coins per call). */
async function dexInfo(chain: string, tokens: string[]): Promise<Map<string, Info>> {
  const out = new Map<string, Info>();
  for (let i = 0; i < tokens.length; i += 30) {
    const part = tokens.slice(i, i + 30);
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${part.join(",")}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const pairs: any[] = (await r?.json().catch(() => null)) || [];
    for (const t of part) {
      const mine = pairs.filter((p) => String(p?.baseToken?.address || "").toLowerCase() === t.toLowerCase()).sort((a, b) => n(b?.liquidity?.usd) - n(a?.liquidity?.usd));
      const p = mine[0];
      if (!p) continue;
      const soc = mine.flatMap((x) => x?.info?.socials || []);
      out.set(t.toLowerCase(), {
        price: n(p.priceUsd) || null, liquidity: n(p.liquidity?.usd) || null, logo: p.info?.imageUrl || null,
        x: soc.some((s: any) => /twitter|^x$/i.test(String(s?.type)) || /x\.com|twitter\.com/i.test(String(s?.url))),
        tg: soc.some((s: any) => /telegram/i.test(String(s?.type)) || /t\.me\//i.test(String(s?.url))),
      });
    }
  }
  return out;
}
async function priceOf(chain: string, token: string) {
  if (chain === "bsc") { const m = await market(C, token); return { price: m.priceUsd, liquidity: m.liquidity }; }
  const i = (await dexInfo(chain, [token])).get(token.toLowerCase());
  return { price: i?.price ?? null, liquidity: i?.liquidity ?? null };
}
/** Coins people are paying to push on X / Telegram right now (DexScreener boosts), as "chain:address". */
async function boosted(): Promise<Set<string>> {
  const urls = ["https://api.dexscreener.com/token-boosts/top/v1", "https://api.dexscreener.com/token-boosts/latest/v1"];
  const lists = await Promise.all(urls.map((u) => fetch(u, { cache: "no-store", signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => [])));
  return new Set(lists.flat().filter((b: any) => b?.chainId && b?.tokenAddress).map((b: any) => `${b.chainId}:${String(b.tokenAddress).toLowerCase()}`));
}
/** Honeypot / tax check on any of the chains (Robinhood Chain uses GoPlus chain 4663). */
function riskChain(chain: string) {
  if (chain === "robinhood") return { ...WCHAINS.arbitrum, key: "arbitrum", chainId: 4663, tokens: [] } as any;
  return WCHAINS[chain as "bsc" | "ethereum" | "solana"];
}
const riskFor = (chain: string, token: string) => riskOf(riskChain(chain), token);

/**
 * Rug guard for every buy (lib/ai-safety.ts): DexScreener market cap $1K–$60K, pool at least 90% locked or burned,
 * buy and sell tax 2% or less (GoPlus, Honeypot.is and the wallet check agree), not a honeypot, no dangerous owner
 * powers, creator under 15%. If any check can't be done the coin isn't bought. A honeypot goes on the watch list.
 */
async function gate(s: Settings, chain: string, token: string, symbol?: string | null): Promise<Gate> {
  const risk = await riskFor(chain, token).catch(() => null);
  const g: Gate = await safetyGate(chain, token, risk, s.max_tax)
    .catch((e) => ({ ok: false as const, reason: `safety check failed (${String((e as Error)?.message || e).slice(0, 60)})`, honeypot: false, mcap: null }));
  if (!g.ok && g.honeypot) await watch(chain, token, symbol ?? null, g).catch(() => {});
  return g;
}

const WATCH = "honeypot-watch";

/** Puts a honeypot / not-yet-sellable coin on the watch list (once per coin; kept in ai_trader_signals). */
async function watch(chain: string, token: string, symbol: string | null, g: Extract<Gate, { ok: false }>) {
  if (g.mcap != null && g.mcap > SAFETY.MCAP_MAX) return;
  const { data } = await tq("ai_trader_signals").upsert(
    { source: WATCH, who: "rug guard", body: g.reason, url: "watch", chain, token, symbol, mcap: g.mcap, result: `watching: ${g.reason}`.slice(0, 300) },
    { onConflict: "trader_id,source,chain,token,url", ignoreDuplicates: true },
  ).select("id");
  if (data?.length) await log("watch", `👀 Watching ${symbol || token} on ${CHAIN_NAME[chain] || chain}: ${g.reason}. It's bought only once it can be sold and passes every rug check while under $${SAFETY.MCAP_MAX / 1000}K.`);
}

/**
 * Every minute: re-checks the watched honeypots. One is bought only once it can be sold, passes the whole rug guard
 * and is still between $1K and $60K. It's dropped after 6 hours, or once its market cap goes above $60K.
 */
async function recheckWatch(s: Settings) {
  const sb = supabaseService();
  const { data } = await tq("ai_trader_signals").select("id,chain,token,symbol,at").eq("source", WATCH).like("result", "watching%").order("at", { ascending: true }).limit(8);
  const chains = s.mode === "live" ? ["bsc"] : s.chains;
  for (const w of (data || []) as { id: number; chain: string; token: string; symbol: string | null; at: string }[]) {
    const set = (result: string, mcap?: number | null) => tq("ai_trader_signals").update({ result: result.slice(0, 300), ...(mcap != null ? { mcap } : {}) }).eq("id", w.id);
    const name = w.symbol || w.token;
    if (Date.now() - Date.parse(w.at) > SAFETY.WATCH_HOURS * 36e5) { await set(`dropped: still not safe after ${SAFETY.WATCH_HOURS}h`); continue; }
    if (!(chains as string[]).includes(w.chain)) continue;
    const g = await gate(s, w.chain, w.token, w.symbol);
    if (!g.ok) {
      if (g.mcap != null && g.mcap > SAFETY.MCAP_MAX) { await set(`dropped: market cap went above $${SAFETY.MCAP_MAX / 1000}K`, g.mcap); await log("watch", `Stopped watching ${name}: market cap went above $${SAFETY.MCAP_MAX / 1000}K.`); }
      else await set(`watching: ${g.reason}`, g.mcap);
      continue;
    }
    const room = await buyRoom(s);
    if (typeof room === "string") { await set(`watching: safe now, but ${room}`, g.mcap); continue; }
    if (room.held.has(w.token.toLowerCase())) { await set("dropped: already holding", g.mcap); continue; }
    const f = await resolve({ chain: w.chain, token: w.token }, chains).catch(() => null);
    if (!f || !f.price) { await set("watching: safe now, waiting for a price", g.mcap); continue; }
    try {
      const why = `👀 Was a honeypot; now it sells fine and passed every rug check (buy tax ${g.buyTax}%, sell tax ${g.sellTax}%).`;
      const out = await executeBuy(s, room.cash, { ...f, mcap: g.mcap, buyTax: g.buyTax }, { sl: s.strat_stop, tp: s.target_profit, why, strategy: "signal" });
      await set(`bought: ${out}`, g.mcap);
    } catch (e) { await set(`watching: buy failed (${(e as Error).message.slice(0, 80)})`, g.mcap); }
  }
}

/** BNB to spend per trade: the dollar amount if one is set (so it stays e.g. $5 when BNB moves), else the BNB amount. */
export async function tradeSize(s: Settings): Promise<number> {
  if (s.per_trade_usd > 0) return +(s.per_trade_usd / (await bnbUsd())).toFixed(6);
  return s.per_trade;
}

/** Live wallet: BNB balance (in BNB). */
export async function liveBalance(): Promise<{ address: string; bnb: number } | null> {
  const a = await traderAccount();
  if (!a) return null;
  const wei = await walletChainClient(C).getBalance({ address: a.address });
  return { address: a.address, bnb: Number(wei) / 1e18 };
}

// ---------------------------------------------------------------- Live swaps

async function sendSwap(tx: EvmTx, amountIn: bigint, tokenIn: string) {
  const account = (await traderAccount())!;
  const pc = walletChainClient(C) as any;
  const w = createWalletClient({ account, chain: C.viem, transport: http(C.rpc, { timeout: 20_000 }) }) as any;
  if (tx.spender) {
    const have: bigint = await pc.readContract({ address: tokenIn, abi: erc20Abi, functionName: "allowance", args: [account.address, tx.spender] });
    if (have < amountIn) {
      const h = await w.writeContract({ address: tokenIn, abi: erc20Abi, functionName: "approve", args: [tx.spender, amountIn] });
      await pc.waitForTransactionReceipt({ hash: h, timeout: 60_000 });
    }
  }
  const hash = await w.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) });
  const r = await pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== "success") throw new Error("The swap transaction failed on-chain.");
  return { hash: hash as string, gas: BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice ?? 0n) };
}

async function liveBuy(token: string, bnb: number, tax: number) {
  const account = (await traderAccount())!;
  const pc = walletChainClient(C) as any;
  const wei = BigInt(Math.floor(bnb * 1e18));
  const before: bigint = await pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const q = await quote(C, C.native.address, token, wei, 0);
  const tx = (await build(C, q, account.address, Math.min(1500, SLIP_BPS + Math.ceil(tax * 100)), true)) as EvmTx;
  const { hash } = await sendSwap(tx, wei, C.native.address);
  const after: bigint = await pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  return { hash, raw: after - before };
}

async function liveSell(token: string, raw: bigint, tax: number) {
  const account = (await traderAccount())!;
  const pc = walletChainClient(C) as any;
  const have: bigint = await pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const amount = raw > have ? have : raw;
  if (amount <= 0n) throw new Error("The wallet holds none of this coin any more.");
  const before: bigint = await pc.getBalance({ address: account.address });
  const q = await quote(C, token, C.native.address, amount, 0);
  const tx = (await build(C, q, account.address, Math.min(1500, SLIP_BPS + Math.ceil(tax * 100)), true)) as EvmTx;
  const { hash, gas } = await sendSwap(tx, amount, token);
  const after: bigint = await pc.getBalance({ address: account.address });
  return { hash, received: Number(after - before + gas) / 1e18 };
}

// ---------------------------------------------------------------- Selling

/** Sells one position (paper or live) and records the result. */
export async function closePosition(p: Position, reason: string, priceUsd?: number | null) {
  const sb = supabaseService();
  const { data: claimed } = await tq("ai_trader_positions").update({ status: "closing", updated_at: new Date().toISOString() }).eq("id", p.id).in("status", ["open", "closing"]).select("id");
  if (!claimed?.length) return;
  try {
    const risk = await riskFor(p.chain, p.token).catch(() => null);
    const tax = risk?.sellTax ?? 0;
    let received: number, sellTx: string | null = null, price = priceUsd ?? null;
    if (price == null) price = (await priceOf(p.chain, p.token)).price;
    if (p.mode === "paper" || p.chain !== "bsc") {
      if (!price) throw new Error("No price to sell at.");
      received = (n(p.qty) * price * (1 - tax / 100 - (p.strategy ? 0.03 : PAPER_SLIP))) / (await bnbUsd());
      const s = await getSettings();
      await sb.from("ai_trader_settings").update({ paper_cash: s.paper_cash + Math.max(0, received) }).eq("id", T());
    } else {
      if (!(await traderAccount())) throw new Error("There's no trading wallet, so live positions can't be sold here.");
      const r = await liveSell(getAddress(p.token), BigInt(p.amount_raw || "0"), tax);
      received = r.received; sellTx = r.hash;
    }
    const pnl = received - n(p.spent);
    await tq("ai_trader_positions").update({
      status: "closed", received, pnl, pnl_pct: n(p.spent) ? (pnl / n(p.spent)) * 100 : null, close_reason: reason, sell_tx: sellTx,
      last_usd: price, closed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", p.id);
    if (p.strategy === "copy" && p.new_project && reason.startsWith("Take profit") && price) await startRebuyWatch(p, price).catch(() => {});
    if (p.strategy === "copy" || p.strategy === "rebuy") await tgNotify(`${pnl >= 0 ? "✅" : "🔻"} Sold ${p.symbol} (${reason}): ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} BNB (${n(p.spent) ? ((pnl / n(p.spent)) * 100).toFixed(1) : "0"}%)${p.mode === "paper" ? " · practice" : ""}.`);
    await log(pnl >= 0 ? "win" : "loss", `Sold ${p.symbol} on ${CHAIN_NAME[p.chain] || p.chain} (${reason}): ${received.toFixed(4)} BNB back for ${n(p.spent).toFixed(4)} in, ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} BNB (${n(p.spent) ? ((pnl / n(p.spent)) * 100).toFixed(1) : "0"}%).`);
  } catch (e) {
    await tq("ai_trader_positions").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", p.id);
    await log("error", `Couldn't sell ${p.symbol}: ${(e as Error).message}`);
  }
}

/** An admin had the AI trader page open in the last 10 minutes. */
export const ACTIVE_MS = 10 * 60_000;
export const adminActive = (s: Settings) => !!s.admin_seen_at && Date.now() - Date.parse(s.admin_seen_at) < ACTIVE_MS;

/** Price, pool and the last 5 minutes of buys / sells for every open coin, one DexScreener call per chain. */
async function flowsFor(ps: Position[]): Promise<Map<string, Flow>> {
  const out = new Map<string, Flow>();
  const byChain = new Map<string, string[]>();
  for (const p of ps) byChain.set(p.chain, [...(byChain.get(p.chain) || []), p.token]);
  await Promise.all([...byChain].map(async ([chain, toks]) => {
    for (let i = 0; i < toks.length; i += 30) {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${toks.slice(i, i + 30).join(",")}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
      const pairs: any[] = (await r?.json().catch(() => null)) || [];
      for (const t of toks.slice(i, i + 30)) {
        const best = pairs.filter((x) => String(x?.baseToken?.address || "").toLowerCase() === t.toLowerCase()).sort((a, b) => n(b?.liquidity?.usd) - n(a?.liquidity?.usd))[0];
        if (best) out.set(`${chain}:${t.toLowerCase()}`, toFlow(best));
      }
    }
  }));
  return out;
}

async function manage(s: Settings) {
  const sb = supabaseService();
  // Hands-on: while an admin is around, they close trades themselves (only a pulled pool still sells automatically).
  // When nobody is around, the AI takes over: target, stop-loss, trailing stop, sellers taking over near the top.
  const handsOn = s.manual_active && adminActive(s);
  const { data } = await tq("ai_trader_positions").select("*").in("status", ["open", "closing"]);
  const ps = (data || []) as Position[];
  if (!ps.length) return;
  const flows = await flowsFor(ps).catch(() => new Map<string, Flow>());
  for (const p of ps) {
    const f = flows.get(`${p.chain}:${p.token.toLowerCase()}`);
    const m = f ? { price: f.price, liquidity: f.liquidity } : await priceOf(p.chain, p.token).catch(() => null);
    const price = m?.price ?? null;
    if (p.status === "closing") { await closePosition(p, p.close_reason || "Closed by admin", price); continue; }
    if (!price) continue;
    const high = Math.max(n(p.high_usd), price);
    await tq("ai_trader_positions").update({ last_usd: price, high_usd: high, updated_at: new Date().toISOString() }).eq("id", p.id);
    const ch = (price / n(p.entry_usd) - 1) * 100;
    const ageH = (Date.now() - Date.parse(p.opened_at)) / 36e5;
    // Small-coin trades judge a pulled pool against their own size, not the big-coin minimum.
    const rugLine = p.strategy ? Math.max(500, s.micro_min_liq / 2) : s.min_liquidity / 3;
    const rug = m?.liquidity != null && m.liquidity < rugLine;
    // Copy trades (coins posted in the groups you follow) always sell at their own target or stop-loss, even when
    // you're in control: nothing else (trailing stop, sellers taking over, max hold) closes them.
    if (p.strategy === "copy" || p.strategy === "rebuy") {
      const cw = rug ? "Liquidity dropped sharply (possible rug)" : ch <= -n(p.stop_loss) ? `Stop-loss (${ch.toFixed(1)}%)` : ch >= n(p.take_profit) ? `Take profit (+${ch.toFixed(1)}%)` : null;
      if (cw) await closePosition({ ...p, high_usd: high }, cw, price);
      continue;
    }
    if (handsOn) { if (rug) await closePosition({ ...p, high_usd: high }, "Liquidity dropped sharply (possible rug)", price); continue; }
    let why: string | null = null;
    // Setup and signal trades keep their own target; older trades use the "away" take profit in hands-on mode.
    const tp = p.strategy ? n(p.take_profit) : s.manual_active ? n(s.away_take_profit) || n(p.take_profit) : n(p.take_profit);
    const trailFrom = p.strategy ? 1.5 : 1.1; // small-coin trades only start trailing once they're up 50%
    if (rug) why = "Liquidity dropped sharply (possible rug)";
    else if (ch <= -n(p.stop_loss)) why = `Stop-loss (${ch.toFixed(1)}%)`;
    else if (ch >= tp) why = `Take profit (+${ch.toFixed(1)}%)`;
    else if (p.strategy && f && ch >= 40 && f.sells5 >= 8 && f.sells5 > f.buys5 * 1.8) why = `Sellers taking over near the top (+${ch.toFixed(1)}%: ${f.sells5} sells vs ${f.buys5} buys in 5m)`;
    else if (n(p.trail) > 0 && high >= n(p.entry_usd) * trailFrom && price <= high * (1 - n(p.trail) / 100)) why = `Trailing stop (${((price / high - 1) * 100).toFixed(1)}% from the high)`;
    else if (ageH >= s.max_hold_hours) why = `Held ${Math.round(ageH)}h, the most allowed (${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%)`;
    if (why) await closePosition({ ...p, high_usd: high }, why, price);
  }
}

// ---------------------------------------------------------------- Buying

type Cand = { chain: TradeChain; x: boolean; tg: boolean; boosted: boolean; token: string; symbol: string; name: string; image: string | null; price: number; change1h: number; change24h: number; liquidity: number; mcap: number | null; ageHours: number | null; badge: string; reasons: string[]; score: number; buyTax?: number; sellTax?: number };

function momentum(c: Omit<Cand, "score">) {
  // Rising, but not already a vertical candle; deeper pools score higher; very new or very old coins score lower.
  const h1 = Math.max(-10, Math.min(c.change1h, 40)), d1 = Math.max(-30, Math.min(c.change24h, 150));
  const liq = Math.log10(Math.max(1, c.liquidity)) * 8;
  const hot = c.change1h > 60 || c.change24h > 300 ? -25 : 0;
  const age = c.ageHours == null ? 0 : c.ageHours < 3 ? -8 : c.ageHours > 24 * 30 ? -5 : 4;
  // Buzz on X and Telegram: has an X, has a Telegram, and is being pushed right now.
  const buzz = (c.x ? 6 : 0) + (c.tg ? 6 : 0) + (c.x && c.tg ? 4 : 0) + (c.boosted ? 10 : 0);
  return Math.round(h1 * 1.2 + d1 * 0.25 + liq + hot + age + buzz + (c.badge === "safer" ? 8 : 0));
}

async function candidates(s: Settings, held: Set<string>): Promise<Cand[]> {
  const sb = supabaseService();
  const { data: recent } = await tq("ai_trader_positions").select("token").eq("status", "closed").gte("closed_at", new Date(Date.now() - 12 * 36e5).toISOString());
  const skip = new Set([...held, ...(recent || []).map((r: any) => String(r.token).toLowerCase())]);
  // Live mode can only buy with the BNB in its wallet, so it shops on BNB Chain only.
  const chains = s.mode === "live" ? (["bsc"] as TradeChain[]) : s.chains;
  const boosts = await boosted();
  const perChain = await Promise.all(chains.map(async (chain) => {
    const d = await discover(chain).catch(() => null);
    if (!d) return [] as Cand[];
    const seen = new Set<string>();
    const raw = [...d.trending, ...d.fresh, ...d.listed].filter((c) => {
      const k = c.token.toLowerCase();
      if (seen.has(k) || skip.has(k)) return false;
      seen.add(k);
      return chain === "solana" ? c.token.length >= 32 : isAddress(c.token);
    });
    const info = await dexInfo(chain, raw.map((c) => c.token)).catch(() => new Map<string, Info>());
    const list: Cand[] = [];
    for (const c of raw) {
      const i = info.get(c.token.toLowerCase());
      const extra = { chain, x: !!i?.x, tg: !!i?.tg, boosted: boosts.has(`${chain}:${c.token.toLowerCase()}`) };
      if (c.badge !== "safer" && c.badge !== "caution") continue;
      if (c.liquidity < s.min_liquidity) continue;
      if (c.ageHours != null && c.ageHours < s.min_age_hours) continue;
      if (c.change1h < -5) continue;
      if (s.need_socials && !extra.x && !extra.tg) continue;
      const cand = { ...c, ...extra, image: c.image || i?.logo || null } as Omit<Cand, "score">;
      list.push({ ...cand, score: momentum(cand) });
    }
    return list;
  }));
  const list = perChain.flat().sort((a, b) => b.score - a.score);
  // The honeypot and tax check on the best few.
  const top = list.slice(0, 10);
  const checked = await Promise.all(top.map(async (c) => {
    const g = await gate(s, c.chain, c.token, c.symbol);
    if (!g.ok) return null;
    return { ...c, mcap: g.mcap, buyTax: g.buyTax, sellTax: g.sellTax };
  }));
  return checked.filter(Boolean) as Cand[];
}

/** Claude picks one candidate (or none) and says why. Falls back to the top momentum score. */
async function pick(s: Settings, list: Cand[]): Promise<{ c: Cand; why: string } | null> {
  if (!list.length) return null;
  const fallback = { c: list[0], why: `${CHAIN_NAME[list[0].chain]}${list[0].x ? " · on X" : ""}${list[0].tg ? " · on Telegram" : ""}${list[0].boosted ? " · trending push" : ""}. Top score ${list[0].score}: ${list[0].change1h.toFixed(1)}% in 1h, ${list[0].change24h.toFixed(1)}% in 24h, $${Math.round(list[0].liquidity).toLocaleString("en-US")} liquidity.` };
  if (!s.use_ai || !process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const rows = list.map((c, i) => ({ i, chain: CHAIN_NAME[c.chain], symbol: c.symbol, onX: c.x, onTelegram: c.tg, pushedNow: c.boosted, change1h: +c.change1h.toFixed(1), change24h: +c.change24h.toFixed(1), liquidityUsd: Math.round(c.liquidity), mcapUsd: c.mcap ? Math.round(c.mcap) : null, ageHours: c.ageHours != null ? Math.round(c.ageHours) : null, safety: c.badge, buyTax: c.buyTax, sellTax: c.sellTax, notes: c.reasons.slice(0, 3), score: c.score }));
    const msg = await anthropic().messages.create({
      model: FAST_MODEL, max_tokens: 300,
      system: "You are a cautious short-term crypto trading assistant choosing at most one coin to buy for a test portfolio (BNB Chain, Ethereum, Robinhood Chain or Solana). All candidates already passed honeypot, tax and liquidity checks. Prefer steady momentum with deep liquidity and reasonable market cap, and real community buzz (an active X and Telegram; being pushed right now helps but hype alone is not enough); avoid coins that already pumped vertically, very thin pools, or warning notes. If none look good, pick none. Reply with JSON only: {\"pick\": <index or null>, \"why\": \"<one short sentence>\"}.",
      messages: [{ role: "user", content: JSON.stringify(rows) }],
    } as any);
    const text = (msg as any).content?.map((b: any) => b.text || "").join("") || "";
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (j.pick === null) return null;
    const c = list[Number(j.pick)];
    return c ? { c, why: `AI: ${String(j.why || "").slice(0, 240)}` } : fallback;
  } catch { return fallback; }
}

/** HYPE / DIP setups on small coins: scan, read the charts, safety checks, then the AI picks (or skips). */
async function setupBuy(s: Settings, cash: number, held: Set<string>) {
  const sb = supabaseService();
  const { data: recent } = await tq("ai_trader_positions").select("token").eq("status", "closed").gte("closed_at", new Date(Date.now() - 12 * 36e5).toISOString());
  const skip = new Set([...held, ...(recent || []).map((r: any) => String(r.token).toLowerCase())]);
  const chains = s.mode === "live" ? ["bsc"] : s.chains;
  const found = await scanSetups(chains, s, skip);
  if (!found.length) return `Scanned ${chains.length} chain(s): no hype or dip setup between $${Math.round(s.mcap_min / 1000)}K and $${Math.round(s.mcap_max / 1000)}K market cap right now.`;
  const top = found.slice(0, 8);
  const boosts = await boosted();
  const byChain = new Map<string, SCand[]>();
  for (const c of top) byChain.set(c.chain, [...(byChain.get(c.chain) || []), c]);
  const infos = new Map<string, Info>();
  await Promise.all([...byChain].map(async ([chain, cs]) => { const m = await dexInfo(chain, cs.map((c) => c.token)).catch(() => new Map<string, Info>()); for (const [k, v] of m) infos.set(`${chain}:${k}`, v); }));
  const rejected: string[] = [];
  // Charts are read one after another (GeckoTerminal limits bursts).
  for (const c of top) { c.chart = (await readChart(c.chain, c.pool, c.ageHours).catch(() => null)) || undefined; }
  const checked = (await Promise.all(top.map(async (c) => {
    const i = infos.get(`${c.chain}:${c.token.toLowerCase()}`);
    c.x = !!i?.x; c.tg = !!i?.tg; c.boosted = boosts.has(`${c.chain}:${c.token.toLowerCase()}`);
    // Brand-new small coins rarely have their X / Telegram on DexScreener yet: for chart setups socials are a bonus
    // (the AI sees them), not a must. DexScreener signals still need them.
    const bad = chartOk(c);
    if (bad) { rejected.push(`${c.symbol}: ${bad}`); return null; }
    const g = await gate(s, c.chain, c.token, c.symbol);
    if (!g.ok) { rejected.push(`${c.symbol}: ${g.honeypot ? "watching (honeypot) — " : ""}${g.reason}`); return null; }
    c.buyTax = g.buyTax; c.sellTax = g.sellTax;
    return c;
  }))).filter(Boolean) as SCand[];
  if (!checked.length) return `Found ${found.length} setups; none passed the chart and safety checks (${rejected.slice(0, 3).join("; ")}).`;
  const p = await aiPick(checked.sort((a, b) => b.score - a.score), s.target_profit, s.strat_stop);
  if (!p) return `Read ${checked.length} clean setups; the AI skipped them all this round (no clean entry).`;
  const c = p.c;
  return executeBuy(s, cash, c, { sl: p.sl, tp: p.tp, why: p.why, strategy: c.setup });
}

/** Buys one coin (practice or live) and records it with its own stop and target. */
async function executeBuy(s: Settings, cash: number, c: { chain: string; token: string; symbol: string; name: string; image: string | null; price: number; liquidity: number; mcap: number; buyTax?: number; pool?: string },
  o: { sl: number; tp: number; why: string; strategy: string; trail?: number; usd?: number | null; newProject?: boolean }) {
  const sb = supabaseService();
  const bnb = await bnbUsd();
  // A caller with their own size buys that many dollars' worth; everyone else uses the normal trade size.
  const spend = Math.min(o.usd && o.usd > 0 ? +(o.usd / bnb).toFixed(6) : await tradeSize(s), cash);
  let qty: number, raw: string | null = null, tx: string | null = null, decimals = 18;
  if (s.mode === "paper" || c.chain !== "bsc") {
    const slip = Math.min(0.15, 0.01 + ((spend * bnb) / Math.max(1, c.liquidity)) * 2); // small pools move a lot
    qty = (spend * bnb * (1 - (c.buyTax ?? 0) / 100 - slip)) / c.price;
    const fresh = await getSettings();
    await sb.from("ai_trader_settings").update({ paper_cash: fresh.paper_cash - spend }).eq("id", T());
  } else {
    const r = await liveBuy(getAddress(c.token), spend, c.buyTax ?? 0);
    const dec = await (walletChainClient(C) as any).readContract({ address: c.token, abi: erc20Abi, functionName: "decimals" }).catch(() => 18);
    decimals = Number(dec); raw = r.raw.toString(); tx = r.hash;
    qty = Number(r.raw) / 10 ** decimals;
  }
  const { error } = await tq("ai_trader_positions").insert({
    mode: s.mode === "live" && c.chain !== "bsc" ? "paper" : s.mode, chain: c.chain, token: c.token, symbol: c.symbol, name: c.name, logo: c.image, spent: spend, qty, amount_raw: raw, decimals,
    entry_usd: c.price, high_usd: c.price, last_usd: c.price, stop_loss: o.sl, take_profit: o.tp, trail: o.trail ?? 25, why: `${o.why} (mcap $${Math.round(c.mcap).toLocaleString("en-US")})`, buy_tx: tx,
    strategy: o.strategy, pool: c.pool || null, new_project: !!o.newProject,
  });
  if (error) { await log("error", `Bought ${c.symbol} but couldn't save it: ${error.message}`); throw new Error("Save failed."); }
  const icon = o.strategy === "hype" ? "🔥" : o.strategy === "dip" ? "📉" : o.strategy === "caller" ? "📣" : o.strategy === "copy" ? "📡" : "⚡";
  await log("buy", `${icon} Bought ${c.symbol} on ${CHAIN_NAME[c.chain] || c.chain} at $${Math.round(c.mcap).toLocaleString("en-US")} market cap for ${spend} BNB${s.mode === "paper" ? " (practice)" : ""}. Target +${o.tp}%, stop -${o.sl}%. ${o.why}`);
  return `Bought ${c.symbol} on ${CHAIN_NAME[c.chain] || c.chain}.`;
}

async function buyOne(s: Settings, cash: number, held: Set<string>) {
  if (s.hype_on || s.dip_on) return setupBuy(s, cash, held);
  const sb = supabaseService();
  const list = await candidates(s, held);
  if (!list.length) return "No coin passed the safety checks this round.";
  const p = await pick(s, list);
  if (!p) return `Looked at ${list.length} safe coins; none looked good enough to buy.`;
  const c = p.c;
  const spend = Math.min(await tradeSize(s), cash);
  let qty: number, raw: string | null = null, tx: string | null = null, decimals = 18;
  const bnb = await bnbUsd();
  if (s.mode === "paper" || c.chain !== "bsc") {
    qty = (spend * bnb * (1 - (c.buyTax ?? 0) / 100 - PAPER_SLIP)) / c.price;
    await sb.from("ai_trader_settings").update({ paper_cash: s.paper_cash - spend }).eq("id", T());
  } else {
    const r = await liveBuy(getAddress(c.token), spend, c.buyTax ?? 0);
    const dec = await (walletChainClient(C) as any).readContract({ address: c.token, abi: erc20Abi, functionName: "decimals" }).catch(() => 18);
    decimals = Number(dec); raw = r.raw.toString(); tx = r.hash;
    qty = Number(r.raw) / 10 ** decimals;
  }
  const { error } = await tq("ai_trader_positions").insert({
    mode: s.mode === "live" && c.chain !== "bsc" ? "paper" : s.mode, chain: c.chain, token: c.token, symbol: c.symbol, name: c.name, logo: c.image, spent: spend, qty, amount_raw: raw, decimals,
    entry_usd: c.price, high_usd: c.price, last_usd: c.price, stop_loss: s.stop_loss, take_profit: s.take_profit, trail: s.trail, why: p.why, buy_tx: tx,
  });
  if (error) { await log("error", `Bought ${c.symbol} but couldn't save it: ${error.message}`); return "Save failed."; }
  await log("buy", `Bought ${c.symbol} on ${CHAIN_NAME[c.chain]} for ${spend} BNB${s.mode === "paper" ? " (practice)" : ""} at $${c.price}. ${p.why}`);
  return `Bought ${c.symbol} on ${CHAIN_NAME[c.chain]}.`;
}

// ---------------------------------------------------------------- One run

export async function runTrader({ force = false } = {}) {
  const sb = supabaseService();
  if (!force) {
    const { data: go } = await sb.rpc("ai_trader_lease_for", { p_trader: T(), p_seconds: 240 });
    if (go !== true) return { skipped: "ran recently" };
  }
  const s = await getSettings();
  if (!s.enabled && !force) return { skipped: "paused" };
  const note = async (t: string) => { await sb.from("ai_trader_settings").update({ last_note: t.slice(0, 300) }).eq("id", T()); return { note: t }; };
  if (s.mode === "live" && !(await traderAccount())) return note("Live mode needs a trading wallet (create one on the AI trader page). Nothing was traded.");

  // Exits are checked every minute by the fast loop (runFast), so this run only looks for new buys.

  // Daily loss limit: pause itself.
  const { data: day } = await tq("ai_trader_positions").select("pnl").eq("status", "closed").eq("mode", s.mode).gte("closed_at", new Date(Date.now() - 864e5).toISOString());
  const lost = -(day || []).reduce((a: number, r: any) => a + Math.min(0, n(r.pnl)), 0);
  if (lost >= s.daily_loss_limit) {
    if (s.enabled) { await sb.from("ai_trader_settings").update({ enabled: false }).eq("id", T()); await log("pause", `Paused itself: lost ${lost.toFixed(4)} BNB in 24h (limit ${s.daily_loss_limit}).`); }
    return note(`Paused: daily loss limit reached (${lost.toFixed(4)} BNB).`);
  }
  if (!s.enabled) return note("Checked open positions (paused, so no new buys).");
  // Telegram only / X only: the trader buys only coins called in what you follow, never from its own scanning.
  if (s.trade_mode !== "general") return note(s.trade_mode === "telegram" ? "Telegram only: buying coins called in your followed Telegram chats (no scanning)." : "X only: buying coins posted by your followed X sources (no scanning).");

  const { data: open } = await tq("ai_trader_positions").select("token").in("status", ["open", "closing"]).eq("mode", s.mode);
  const held = new Set((open || []).map((r: any) => String(r.token).toLowerCase()));
  if (held.size >= s.max_positions) return note(`Holding ${held.size} of ${s.max_positions} coins; waiting for exits.`);
  const fresh = await getSettings();
  const cash = s.mode === "paper" ? fresh.paper_cash : Math.max(0, ((await liveBalance())?.bnb ?? 0) - GAS_KEEP);
  if (cash < (await tradeSize(s)) * 0.5) return note(`Not enough BNB to buy (${cash.toFixed(4)} available).`);
  try { return note(await buyOne(fresh, cash, held)); }
  catch (e) { await log("error", `Buy failed: ${(e as Error).message}`); return note(`Buy failed: ${(e as Error).message}`); }
}

// ---------------------------------------------------------------- Fast loop (every minute): exits and fresh signals

/** Room and money for one more buy, or why not. */
async function buyRoom(s: Settings): Promise<{ cash: number; held: Set<string> } | string> {
  const sb = supabaseService();
  const { data: open } = await tq("ai_trader_positions").select("token").in("status", ["open", "closing"]).eq("mode", s.mode);
  const held = new Set((open || []).map((r: any) => String(r.token).toLowerCase()));
  if (held.size >= s.max_positions) return `Holding ${held.size} of ${s.max_positions} coins.`;
  const cash = s.mode === "paper" ? (await getSettings()).paper_cash : Math.max(0, ((await liveBalance())?.bnb ?? 0) - GAS_KEEP);
  if (cash < (await tradeSize(s)) * 0.5) return `Not enough BNB (${cash.toFixed(4)}).`;
  return { cash, held };
}

/**
 * Decides on one signal. DexScreener signals must be small and not already pumped (in the market-cap window, under
 * +100% in 1h and +300% in 24h, buyers ahead of sellers). Posts from the caller list (Elon and the callers you add) or
 * your Telegram groups may be bigger and already moving (up to the caller market-cap limit), but must be fresh.
 */
export async function actOnSignal(s: Settings, sig: Signal, flow: Flow | null): Promise<string> {
  const sb = supabaseService();
  const save = (result: string, f?: Flow | null) => tq("ai_trader_signals").update({ result, symbol: f?.symbol ?? null, mcap: f?.mcap ?? null })
    .eq("source", sig.source).eq("chain", sig.chain).eq("token", sig.token).eq("url", sig.url);
  const done = async (r: string, f?: Flow | null) => { await save(r, f); return r; };
  if (!s.enabled) return done("skipped: trader stopped");
  const chains = s.mode === "live" ? ["bsc"] : s.chains;
  if (!chains.includes(sig.chain)) return done("skipped: chain not on");
  const f = flow || (await resolve({ chain: sig.chain, token: sig.token }, chains).catch(() => null));
  if (!f || !f.price) return done("skipped: no pool yet", f);
  const caller = sig.source === "x" || sig.source === "telegram";
  if (caller) {
    if (Date.now() - sig.at > 5 * 60_000) return done("skipped: post too old", f);
    if (f.mcap > s.caller_mcap_max) return done(`skipped: market cap $${Math.round(f.mcap).toLocaleString("en-US")} above the caller limit`, f);
    if (f.liquidity < Math.max(5000, s.micro_min_liq)) return done("skipped: pool too thin", f);
  } else {
    if (f.mcap < s.mcap_min || f.mcap > s.mcap_max) return done(`skipped: market cap $${Math.round(f.mcap).toLocaleString("en-US")} outside the window`, f);
    if (f.ch.h1 > 100 || f.ch.h24 > 300) return done(`skipped: already pumped (${f.ch.h1.toFixed(0)}% 1h, ${f.ch.h24.toFixed(0)}% 24h)`, f);
    if (f.liquidity < s.micro_min_liq) return done("skipped: pool too thin", f);
    if (f.ageHours < 0.2) return done("skipped: pool under 12 minutes old", f);
    if (f.buys5 < 3 || f.buys5 < f.sells5) return done(`skipped: no buying pressure (${f.buys5} buys / ${f.sells5} sells in 5m)`, f);
    if (s.need_socials && !f.x && !f.tg) return done("skipped: no X or Telegram", f);
  }
  const room = await buyRoom(s);
  if (typeof room === "string") return done(`skipped: ${room}`, f);
  if (room.held.has(f.token.toLowerCase())) return done("skipped: already holding", f);
  const g = await gate(s, f.chain, f.token, f.symbol);
  if (!g.ok) return done(`${g.honeypot ? "watching: honeypot, bought only once it can be sold — " : "skipped: "}${g.reason}`, f);
  if (!caller && (IMPOSTOR.test(f.symbol.trim()) || f.sells5 < 1)) return done("skipped: copycat name or nobody selling yet", f);
  const label = sig.source === "x" ? `@${sig.who} posted it on X` : sig.source === "telegram" ? `posted in ${sig.who} on Telegram` : sig.source === "dex-profile" ? "fresh DexScreener profile (team just went public)" : sig.source === "dex-boost" ? "fresh DexScreener boost" : "fresh community takeover";
  const why = `${caller ? "📣" : "⚡"} Signal: ${label}. ${f.buys5} buys vs ${f.sells5} sells in 5m, ${f.ch.h1 >= 0 ? "+" : ""}${f.ch.h1.toFixed(0)}% in 1h.`;
  try {
    const out = await executeBuy(s, room.cash, { ...f, mcap: g.mcap, buyTax: g.buyTax }, { sl: s.strat_stop, tp: s.target_profit, why, strategy: caller ? "caller" : "signal" });
    return done(`bought: ${out}`, f);
  } catch (e) { return done(`skipped: buy failed (${(e as Error).message.slice(0, 80)})`, f); }
}

/** Records signals once; returns only the ones not seen before. */
async function unseen(sigs: Signal[]): Promise<Signal[]> {
  if (!sigs.length) return [];
  const rows = sigs.map((g) => ({ source: g.source, who: g.who, body: g.body, url: g.url, chain: g.chain, token: g.token, at: new Date(g.at).toISOString() }));
  const { data } = await tq("ai_trader_signals").upsert(rows, { onConflict: "trader_id,source,chain,token,url", ignoreDuplicates: true }).select("source,chain,token,url");
  const isNew = new Set((data || []).map((r: any) => `${r.source}|${r.chain}|${r.token}|${r.url}`));
  return sigs.filter((g) => isNew.has(`${g.source}|${g.chain}|${g.token}|${g.url}`));
}

/** Every minute: watch open coins for fast exits, then act on fresh signals (if the trader is started). */
export async function runFast() {
  const sb = supabaseService();
  const { data: go } = await sb.rpc("ai_trader_fast_lease_for", { p_trader: T(), p_seconds: 50 });
  if (go !== true) return { skipped: "running" };
  const s = await getSettings();
  if (s.mode === "live" && !(await traderAccount())) return { skipped: "no wallet" };
  await manage(s).catch((e) => log("error", `Exit check failed: ${(e as Error).message}`));
  const general = s.trade_mode === "general";
  if (s.enabled && general) await recheckWatch(s).catch((e) => log("error", `Watch list check failed: ${(e as Error).message}`));
  if (s.enabled && s.copy_on && s.rebuy_on) await rebuyCheck(s).catch((e) => log("error", `Re-buy check failed: ${(e as Error).message}`));
  if (!s.enabled) return { ok: true, buys: "stopped" };
  const chains = s.mode === "live" ? ["bsc"] : s.chains;
  const out: string[] = [];
  // Copy trades from what you follow, depending on the trading mode.
  if (s.copy_on) {
    if (s.trade_mode !== "telegram") {
      const { posts, errors } = await xFollowedPosts().catch((e) => ({ posts: [], errors: [(e as Error).message] }));
      if (errors.length) await sb.from("ai_trader_settings").update({ last_note: `X: ${errors[0]}`.slice(0, 300) }).eq("id", T());
      for (const post of posts.slice(0, 10)) out.push(...(await copyPost({ text: post.text, user: post.user, url: post.url, at: post.at, from: { username: post.user } }, "x", post.label).catch(() => [])));
    }
    if (s.trade_mode !== "x") {
      // Groups, channels and chats read through the admin's own Telegram account.
      const tga = await tgaNewPosts().catch((e) => ({ posts: [], errors: [(e as Error).message] }));
      if (tga.errors.length) await sb.from("ai_trader_settings").update({ last_note: `Telegram: ${tga.errors[0]}`.slice(0, 300) }).eq("id", T());
      for (const post of tga.posts.slice(0, 20)) out.push(...(await copyPost({ text: post.text, user: post.chat, url: post.url, at: post.at, from: post.from }, "telegram", `posted in "${post.chat}"${post.from?.username ? ` by @${post.from.username}` : ""} on Telegram`).catch(() => [])));
    }
  }
  // General mode only: X callers and DexScreener signals.
  if (general && s.signals_on) {
    if (xReady() && s.callers.length) {
      const posts = await xPosts(s.callers).catch(() => []);
      for (const post of posts.slice(0, 5)) {
        const found = await postSignals(post, "x", chains).catch(() => []);
        const newOnes = await unseen(found.map((x) => x.sig));
        for (const x of found.filter((x) => newOnes.includes(x.sig))) out.push(await actOnSignal(s, x.sig, x.flow));
      }
    }
    // Only the newest few are recorded each minute, so none are marked seen without being checked.
    const dex = await unseen((await dexSignals(chains).catch(() => [])).slice(0, 12));
    for (const g of dex) out.push(await actOnSignal(s, g, null));
  }
  return { ok: true, signals: out.length, bought: out.filter((x) => x.startsWith("bought")).length };
}

// ---------------------------------------------------------------- Copy trading (groups and accounts you follow)

/** Buy or sell tax at or above this counts as "can't really be sold" for copy trades. */
export const COPY_MAX_TAX = 25;

/**
 * The only check before a copy trade: it must not be a honeypot. GoPlus and Honeypot.is (a simulated buy and sell
 * on BNB Chain / Ethereum) both look; if either says it can't be sold, the sell tax is extreme, or (Solana) the
 * creator can freeze or change balances, it's skipped. If no check answers at all, it's skipped too.
 */
export async function copyGate(chain: string, token: string): Promise<{ ok: true; buyTax: number; sellTax: number } | { ok: false; reason: string }> {
  const [risk, sim] = await Promise.all([
    riskFor(chain, token).catch(() => null),
    chain === "solana" ? Promise.resolve(null) : simulateHoneypot(chain, token).catch(() => null),
  ]);
  const known = !!risk && risk.level !== "unknown";
  if (!known && !sim) return { ok: false, reason: "the honeypot check didn't answer" };
  if (risk?.honeypot || sim?.honeypot === true) return { ok: false, reason: `honeypot${sim?.reason ? ` (${sim.reason})` : ": it can't be sold"}` };
  if (sim && n(sim.holdersTested) >= 5 && n(sim.holdersFailed) / n(sim.holdersTested) > 0.5) return { ok: false, reason: `honeypot: ${sim.holdersFailed} of ${sim.holdersTested} recent holders couldn't sell` };
  const buyTax = Math.max(n(risk?.buyTax), n(sim?.buyTax)), sellTax = Math.max(n(risk?.sellTax), n(sim?.sellTax));
  if (sellTax >= COPY_MAX_TAX || buyTax >= COPY_MAX_TAX) return { ok: false, reason: `extreme tax (buy ${buyTax.toFixed(0)}%, sell ${sellTax.toFixed(0)}%)` };
  const trap = (risk?.notes || []).find((t) => /freeze|can't be transferred|change your balance|change wallet balances/i.test(t));
  if (trap) return { ok: false, reason: trap.replace(/\.$/, "") };
  return { ok: true, buyTax: +buyTax.toFixed(2), sellTax: +sellTax.toFixed(2) };
}

/**
 * A post from a followed Telegram group or X account / List / Community: every contract address in it is bought
 * (no market-cap, liquidity, socials or momentum rules), as long as it isn't a honeypot, with the copy target and
 * stop-loss. $TICKERS alone are ignored, since many coins share a ticker and copycats use them.
 */
export type From = { id?: string | null; username?: string | null } | null | undefined;

/** The $ amount set for whoever posted (by username or user id), if any. */
async function callerUsd(platform: "tg" | "x", from: From): Promise<{ usd: number; who: string } | null> {
  const keys = [from?.username?.replace(/^@/, "").toLowerCase(), from?.id ? String(from.id) : null].filter(Boolean) as string[];
  if (!keys.length) return null;
  const { data } = await tq("ai_trader_callers").select("who,usd").eq("platform", platform).in("who", keys).limit(1);
  return data?.[0] ? { usd: n(data[0].usd), who: String(data[0].who) } : null;
}

export async function copyPost(post: { text: string; user: string; url: string; at: number; from?: From }, source: "x" | "telegram", label: string): Promise<string[]> {
  const s = await getSettings();
  if (!s.enabled || !s.copy_on) return [];
  // Telegram only mode ignores X, X only mode ignores Telegram.
  if ((source === "x" && s.trade_mode === "telegram") || (source === "telegram" && s.trade_mode === "x")) return [];
  const caller = await callerUsd(source === "x" ? "x" : "tg", post.from).catch(() => null);
  const chains = s.mode === "live" ? ["bsc"] : s.chains;
  const { evm, sol } = extract(post.text);
  const refs: { token: string; chain?: string }[] = [...evm.map((token) => ({ token })), ...(chains.includes("solana") ? sol.map((token) => ({ token, chain: "solana" })) : [])].slice(0, 3);
  const out: string[] = [];
  const sb = supabaseService();
  for (const r of refs) {
    const f = await resolve(r, chains).catch(() => null);
    const sig: Signal = { source, who: post.user, body: post.text.slice(0, 280), url: post.url, chain: f?.chain || r.chain || "bsc", token: f ? (f.chain === "solana" ? f.token : f.token.toLowerCase()) : r.token, at: post.at };
    const { data } = await tq("ai_trader_signals").upsert({ source: sig.source, who: sig.who, body: sig.body, url: sig.url, chain: sig.chain, token: sig.token, at: new Date(sig.at).toISOString() }, { onConflict: "trader_id,source,chain,token,url", ignoreDuplicates: true }).select("id");
    if (!data?.length) continue; // already handled this post
    out.push(await actOnCopy(s, sig, f, label, caller));
  }
  return out;
}

async function actOnCopy(s: Settings, sig: Signal, f: Flow | null, label: string, caller: { usd: number; who: string } | null = null): Promise<string> {
  const sb = supabaseService();
  const done = async (r: string) => {
    await tq("ai_trader_signals").update({ result: r.slice(0, 300), symbol: f?.symbol ?? null, mcap: f?.mcap ?? null }).eq("source", sig.source).eq("chain", sig.chain).eq("token", sig.token).eq("url", sig.url);
    return r;
  };
  const chains = s.mode === "live" ? ["bsc"] : s.chains;
  if (!f || !f.price) return done(s.mode === "live" ? "skipped: no BNB Chain pool for it (live trading buys on BNB Chain only)" : "skipped: no pool on your chains yet");
  if (!chains.includes(f.chain)) return done(`skipped: ${CHAIN_NAME[f.chain] || f.chain} isn't switched on`);
  if (Date.now() - sig.at > 10 * 60_000) return done("skipped: post over 10 minutes old");
  const room = await buyRoom(s);
  if (typeof room === "string") return done(`skipped: ${room}`);
  if (room.held.has(f.token.toLowerCase())) return done("skipped: already holding it");
  const g = await copyGate(f.chain, f.token);
  if (!g.ok) { await tgNotify(`⛔ Skipped ${f.symbol} (${label}): ${g.reason}.`); return done(`skipped: ${g.reason}`); }
  const newProject = f.ageHours < 24;
  const why = `📡 Copy: ${label}.${caller ? ` Caller size $${caller.usd}.` : ""} Sells at +${s.copy_tp}% or -${s.copy_sl}%.${newProject ? " New project: watched for a dump re-buy after a 2x." : ""}`;
  try {
    const r = await executeBuy(s, room.cash, { ...f, mcap: f.mcap, buyTax: g.buyTax }, { sl: s.copy_sl, tp: s.copy_tp, why, strategy: "copy", trail: 0, usd: caller?.usd ?? null, newProject });
    const spend = caller ? caller.usd / (await bnbUsd()) : await tradeSize(s).catch(() => s.per_trade);
    await tgNotify(`📡 Bought ${f.symbol} on ${CHAIN_NAME[f.chain] || f.chain} for ~${fmt(Math.min(spend, room.cash))} BNB${s.mode === "paper" ? " (practice)" : ""}.\n${label}\nMarket cap $${Math.round(f.mcap).toLocaleString("en-US")} · sells at +${s.copy_tp}% or -${s.copy_sl}%.\nhttps://dexscreener.com/${f.chain}/${f.token}`);
    return done(`bought: ${r}`);
  } catch (e) { return done(`skipped: buy failed (${(e as Error).message.slice(0, 80)})`); }
}
const fmt = (x: number) => x.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

// ---------------------------------------------------------------- Every admin's trader

/**
 * The schedules call this: runs the 5-minute scan or the 1-minute loop for every trader that's started or still has
 * coins to watch, side by side. One trader failing doesn't stop the others.
 */
export async function runAll(kind: "scan" | "fast") {
  const sb = supabaseService();
  const [{ data: on }, { data: holding }] = await Promise.all([
    sb.from("ai_trader_settings").select("id").eq("enabled", true),
    sb.from("ai_trader_positions").select("trader_id").in("status", ["open", "closing"]),
  ]);
  const ids = [...new Set([...(on || []).map((r: any) => Number(r.id)), ...(holding || []).map((r: any) => Number(r.trader_id))])].filter((x) => x > 0);
  const out = await Promise.all(ids.map((id) => withTrader(id, () => (kind === "scan" ? runTrader() : runFast())).then((r) => [id, r] as const).catch((e) => [id, { error: (e as Error).message }] as const)));
  return Object.fromEntries(out);
}

// ---------------------------------------------------------------- Dump re-buy (new projects)

/** After a new project (under 24h old when bought) is sold at its copy target, watch it for a deep dump. */
async function startRebuyWatch(p: Position, soldUsd: number) {
  await tq("ai_trader_rebuy").insert({ mode: p.mode, chain: p.chain, token: p.token, symbol: p.symbol, sold_usd: soldUsd, low_usd: soldUsd });
  const s = await getSettings();
  await log("watch", `👀 Re-buy watch: ${p.symbol} sold at 2x; buys back if it dumps ${s.rebuy_dump}% from $${soldUsd.toPrecision(4)} with heavy volume.`);
}

/**
 * Every minute: for each watched coin (up to 48 hours after its sale), buy it back once it has dumped the re-buy
 * amount (default 60%) below the sell price AND trading is heavy (last-hour volume at least half the pool, or 30+
 * trades in 5 minutes) AND buyers are back (at least as many buys as sells in 5 minutes). Still honeypot-checked.
 * It then sells on the bounce (default +40%) or the copy stop-loss.
 */
async function rebuyCheck(s: Settings) {
  const { data } = await tq("ai_trader_rebuy").select("*").eq("status", "watching").eq("mode", s.mode).order("sold_at", { ascending: true }).limit(10);
  const chains = s.mode === "live" ? ["bsc"] : s.chains;
  for (const w of (data || []) as any[]) {
    const set = (v: Record<string, unknown>) => tq("ai_trader_rebuy").update(v).eq("id", w.id);
    if (Date.now() - Date.parse(w.sold_at) > 48 * 36e5) { await set({ status: "expired", note: "no deep dump within 48h" }); continue; }
    const f = await resolve({ chain: w.chain, token: w.token }, [w.chain]).catch(() => null);
    if (!f || !f.price) continue;
    const low = Math.min(n(w.low_usd) || f.price, f.price);
    if (low !== n(w.low_usd)) await set({ low_usd: low });
    const drop = (1 - f.price / n(w.sold_usd)) * 100;
    if (drop < s.rebuy_dump) continue;
    const heavy = f.vol1h >= f.liquidity * 0.5 || f.buys5 + f.sells5 >= 30;
    if (!heavy) { await set({ note: `down ${drop.toFixed(0)}%, waiting for heavy volume` }); continue; }
    if (f.buys5 < f.sells5) { await set({ note: `down ${drop.toFixed(0)}% on heavy volume, waiting for buyers to step in` }); continue; }
    if (!chains.includes(f.chain)) { await set({ status: "expired", note: `${f.chain} isn't switched on` }); continue; }
    const room = await buyRoom(s);
    if (typeof room === "string") { await set({ note: `ready, but ${room}` }); continue; }
    if (room.held.has(f.token.toLowerCase())) { await set({ status: "expired", note: "already holding it" }); continue; }
    const g = await copyGate(f.chain, f.token);
    if (!g.ok) { await set({ status: "expired", note: g.reason }); continue; }
    try {
      const why = `🔁 Dump re-buy: down ${drop.toFixed(0)}% from the 2x sell with heavy volume (${f.buys5} buys / ${f.sells5} sells in 5m). Sells at +${s.rebuy_tp}% or -${s.copy_sl}%.`;
      const r = await executeBuy(s, room.cash, { ...f, mcap: f.mcap, buyTax: g.buyTax }, { sl: s.copy_sl, tp: s.rebuy_tp, why, strategy: "rebuy", trail: 0 });
      await set({ status: "bought", note: r });
      await tgNotify(`🔁 Bought back ${f.symbol} after a ${drop.toFixed(0)}% dump on heavy volume. Sells at +${s.rebuy_tp}% or -${s.copy_sl}%.\nhttps://dexscreener.com/${f.chain}/${f.token}`);
    } catch (e) { await set({ note: `buy failed: ${(e as Error).message.slice(0, 80)}` }); }
  }
}
