/**
 * AI Futures: a futures trader separate from the copy-trading bot. Each admin's AI trader (same id) can have one.
 * Its own settings, its own wallet, its own trades and log.
 *
 * Every minute it:
 *  1. Manages open positions: stop-loss, take profit, break-even and trailing stop, time limit, news turning against
 *     it, and (live) checks the position is still on the exchange.
 *  2. Reads fresh news (CoinDesk, Cointelegraph, Decrypt, The Block) and posts from the X accounts it watches. The AI
 *     (Claude) reads each new headline once and says which coin it moves, up or down, and how strongly.
 *  3. Scores every coin with technical analysis on Hyperliquid candles (1-hour trend, 5-minute momentum, breakouts on
 *     high volume, RSI, ATR) and blends in the news score. Strong news that the chart doesn't fight trades first.
 *  4. Opens at most a few positions, never above 3x leverage, sized so a stop-loss costs only a set % of the
 *     account. Stops sit well before the liquidation price. A daily loss limit pauses new trades for the day.
 *
 * Practice: pretend dollars, real prices, real fees. Live: Hyperliquid, from its own wallet, with every stop-loss
 * also resting on Hyperliquid (so it still protects the position if this site is down). Aster: practice only for now.
 *
 * Forex (third venue): the currency markets on trade.xyz inside Hyperliquid (EUR/USD, USD/JPY, GBP/USD, DXY, …). Same
 * wallet and the same money funded from Solana; for each live forex trade the margin is moved into the forex account
 * and back when it closes. It reads forex news (FXStreet, investingLive) as well, is stricter than for crypto (news
 * and chart must agree), sits out the weekend and closes forex trades before Friday's close.
 */
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { Keypair } from "@solana/web3.js";
import { createPublicClient, createWalletClient, erc20Abi, http, parseUnits } from "viem";
import { arbitrum } from "viem/chains";
import { supabaseService } from "@/lib/supabase/server";
import { T } from "@/lib/ai-trader-ctx";
import { anthropic, FAST_MODEL } from "@/lib/ai";
import { accountPosts } from "@/lib/ai-trader-copy";
import { FX_DEX, HLP_VAULT, hlVaultApr, hlVaultEquity, hlVaultTransfer, hlAccount, hlCancel, hlCandles, hlDexTransfer, hlFxMarket, hlMarket, hlMarketOrder, hlSetLeverage, hlStopLoss, type Candle, type HlAsset } from "@/lib/hyperliquid";
import { fxLabel, fxOpen, fxWeekendSoon, isFx, usdSign } from "@/lib/fx";

export const VENUES = ["hyperliquid", "aster", "forex"] as const;
export const LIVE_VENUES = ["hyperliquid", "forex"];
export const VENUE_NAME: Record<string, string> = { hyperliquid: "Hyperliquid", aster: "Aster", forex: "Forex (trade.xyz)" };
const FEE = { hyperliquid: 0.00045, aster: 0.00035, forex: 0.0009 } as Record<string, number>; // taker fee per side
const MAX_LEV = 50;
/**
 * The Forex trader is a third trader of its own (next to the copy bot and Futures): same engine, but its own id
 * (FX_DESK + the admin's trader id), so its own wallet, Solana wallet, settings, money, trades and log. It only
 * trades forex; the Futures trader only trades crypto.
 */
export const FX_DESK = 100000;
/** The Earn desk (200000 + id): no trading; its money sits in Hyperliquid's HLP vault. Own wallet and Solana funding. */
export const EARN_DESK = 200000;
export const isFxDesk = () => T() >= FX_DESK && T() < EARN_DESK;
export const isEarnDesk = () => T() >= EARN_DESK; // the most anyone can set (each coin's own exchange maximum still applies)

export type FSettings = {
  id: number; enabled: boolean; mode: "paper" | "live"; paper_usd: number; paper_start: number; venues: string[]; coins: string[];
  max_lev: number; max_loss_pct: number; risk_pct: number; max_positions: number; daily_loss_pct: number; max_hold_hours: number;
  use_ta: boolean; use_news: boolean; use_x: boolean; x_handles: string[]; last_run: string | null; last_note: string | null;
  day_start_usd: number | null; day: string | null; no_liq: boolean; auto_fund: boolean; fund_at: string | null;
};
export type FPos = {
  id: number; mode: string; venue: string; coin: string; side: "long" | "short"; lev: number; margin_usd: number; notional_usd: number;
  entry: number; stop: number; target: number; liq: number | null; best: number | null; last: number | null; status: string;
  exit: number | null; pnl_usd: number | null; fees_usd: number; reason: string | null; why: string | null; opened_at: string; closed_at: string | null;
  size: number | null; sl_oid: number | null;
};

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const sb = () => supabaseService();
const fq = (table: "ai_futures_positions" | "ai_futures_log" | "ai_futures_news" | "ai_futures_transfers") => ({
  select: (cols = "*"): any => sb().from(table).select(cols).eq("fut_id", T()),
  update: (v: Record<string, unknown>): any => sb().from(table).update(v).eq("fut_id", T()),
  insert: (v: any): any => sb().from(table).insert(Array.isArray(v) ? v.map((r) => ({ ...r, fut_id: T() })) : { ...v, fut_id: T() }),
  upsert: (v: any, o?: any): any => sb().from(table).upsert(Array.isArray(v) ? v.map((r) => ({ ...r, fut_id: T() })) : { ...v, fut_id: T() }, o),
});
export async function flog(kind: string, text: string) { await fq("ai_futures_log").insert({ kind, text: text.slice(0, 600) }); }

export async function getF(): Promise<FSettings> {
  const made = await sb().from("ai_futures_settings").upsert(isEarnDesk() ? { id: T(), venues: [], coins: [], enabled: false } : isFxDesk() ? { id: T(), venues: ["forex"], coins: [] } : { id: T() }, { onConflict: "id", ignoreDuplicates: true });
  const { data } = await sb().from("ai_futures_settings").select("*").eq("id", T()).single();
  if (!data) throw new Error(`Couldn't set up this ${isEarnDesk() ? "Earn" : isFxDesk() ? "Forex" : "Futures"} trader${made.error ? `: ${made.error.message}` : ""}.`);
  const s = data as any;
  for (const k of ["paper_usd", "paper_start", "max_lev", "max_loss_pct", "risk_pct", "max_positions", "daily_loss_pct", "max_hold_hours", "day_start_usd"]) s[k] = s[k] == null ? s[k] : n(s[k]);
  s.max_lev = Math.min(MAX_LEV, Math.max(1, s.max_lev));
  s.max_loss_pct = s.max_loss_pct > 0 ? s.max_loss_pct : 5;
  s.no_liq = s.no_liq !== false;
  s.auto_fund = s.auto_fund !== false;
  if (isEarnDesk()) { s.venues = []; s.coins = []; s.enabled = false; }
  else if (isFxDesk()) { s.venues = ["forex"]; s.coins = []; }
  else s.venues = (s.venues || []).filter((v: string) => v !== "forex");
  return s as FSettings;
}

// ---------------------------------------------------------------- Wallet

const keyCache = new Map<number, { key: string; a: PrivateKeyAccount }>();
export async function futAccount(): Promise<PrivateKeyAccount | null> {
  const { data } = await sb().rpc("ai_futures_key_get", { p_id: T() });
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data)) return null;
  const c = keyCache.get(T());
  if (c?.key === data) return c.a;
  const a = privateKeyToAccount(data as `0x${string}`);
  keyCache.set(T(), { key: data, a });
  return a;
}
export async function createFutWallet(): Promise<string> {
  if (await futAccount()) throw new Error("The AI Futures wallet already exists.");
  const key = generatePrivateKey();
  const { error } = await sb().rpc("ai_futures_key_set", { p_id: T(), p_key: key });
  if (error) throw new Error(error.message);
  const a = privateKeyToAccount(key);
  await flog("settings", `AI Futures wallet created: ${a.address}`);
  return a.address;
}
/** Use your own wallet for futures: paste its private key. Only when nothing live is open and the current wallet is empty. */
export async function importFutKey(raw: string): Promise<string> {
  const key = (raw.trim().startsWith("0x") ? raw.trim() : `0x${raw.trim()}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("That isn't a private key (64 letters and numbers, from your wallet's Export private key).");
  const a = privateKeyToAccount(key);
  const { data: openLive } = await fq("ai_futures_positions").select("id").eq("mode", "live").in("status", ["open", "closing"]).limit(1);
  if (openLive?.length) throw new Error("Close the open live futures positions first.");
  const cur = await futWallet().catch(() => null);
  if (cur && cur.address.toLowerCase() !== a.address.toLowerCase() && ((cur.hlValue ?? 0) > 1 || (cur.arbUsdc ?? 0) > 1)) {
    throw new Error(`The current futures wallet still holds money (${(cur.hlValue ?? 0).toFixed(2)} on Hyperliquid, ${(cur.arbUsdc ?? 0).toFixed(2)} USDC on Arbitrum). Move it out first (Show private key → open it in Rabby / MetaMask), so nothing is left behind.`);
  }
  await getF();
  const { error } = await sb().rpc("ai_futures_key_replace", { p_id: T(), p_key: key });
  if (error) throw new Error(error.message);
  keyCache.delete(T());
  await flog("settings", `AI Futures now uses your own wallet: ${a.address}`);
  return a.address;
}
export async function revealFutKey(): Promise<string> {
  const { data } = await sb().rpc("ai_futures_key_get", { p_id: T() });
  if (typeof data !== "string") throw new Error("There's no AI Futures wallet yet.");
  await flog("settings", "The AI Futures wallet's private key was viewed.");
  return data;
}

// ---------------------------------------------------------------- Its own Solana wallet (fund it from Solana)

const solCache = new Map<number, { key: string; kp: Keypair }>();
/** AI Futures' own Solana wallet: send USDT / USDC here and it's moved into the Hyperliquid account by itself. */
export async function futSolAccount(): Promise<Keypair | null> {
  const { data } = await sb().rpc("ai_futures_sol_key_get", { p_id: T() });
  if (typeof data !== "string" || !data.startsWith("[")) return null;
  const c = solCache.get(T());
  if (c?.key === data) return c.kp;
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(data)));
  solCache.set(T(), { key: data, kp });
  return kp;
}
export async function createFutSolWallet(): Promise<string> {
  if (await futSolAccount()) throw new Error("AI Futures already has a Solana wallet.");
  await getF();
  const kp = Keypair.generate();
  const { error } = await sb().rpc("ai_futures_sol_key_set", { p_id: T(), p_key: JSON.stringify(Array.from(kp.secretKey)), p_replace: false });
  if (error) throw new Error(error.message);
  solCache.delete(T());
  await flog("settings", `AI Futures Solana wallet created: ${kp.publicKey.toBase58()}. Send USDT or USDC (and ~0.01 SOL for fees) to it.`);
  return kp.publicKey.toBase58();
}
/** Use your own Solana wallet (Phantom / Solflare private key). Only when the current one is empty. */
export async function importFutSolKey(raw: string): Promise<string> {
  const { solKeypairFrom } = await import("@/lib/ai-trader");
  const kp = solKeypairFrom(raw);
  const cur = await futSolAccount();
  if (cur && cur.publicKey.toBase58() !== kp.publicKey.toBase58()) {
    const b = await futSolBalances(cur).catch(() => null);
    if (b && (b.usdt + b.usdc > 1 || b.sol > 0.01)) throw new Error(`The current AI Futures Solana wallet still holds money ($${(b.usdt + b.usdc).toFixed(2)}, ${b.sol.toFixed(4)} SOL). Move it out first (Show private key → Phantom).`);
  }
  await getF();
  const { error } = await sb().rpc("ai_futures_sol_key_set", { p_id: T(), p_key: JSON.stringify(Array.from(kp.secretKey)), p_replace: true });
  if (error) throw new Error(error.message);
  solCache.delete(T());
  await flog("settings", `AI Futures now uses your Solana wallet: ${kp.publicKey.toBase58()}.`);
  return kp.publicKey.toBase58();
}
export async function revealFutSolKey(): Promise<string> {
  const kp = await futSolAccount();
  if (!kp) throw new Error("There's no AI Futures Solana wallet yet.");
  await flog("settings", "The AI Futures Solana wallet's private key was viewed.");
  const { b58encode } = await import("@/lib/ai-trader");
  return b58encode(kp.secretKey);
}
async function futSolBalances(kp: Keypair) {
  const { solWalletBalances } = await import("@/lib/ai-trader-chains");
  return solWalletBalances(kp.publicKey.toBase58());
}

// ---------------------------------------------------------------- Money in and out: every transfer is recorded

type Xfer = { dir: "in" | "out"; route: string; amount_usd: number; symbol: string; from_addr?: string | null; to_addr?: string | null; detail?: string };
/** One transfer at a time: a second tap (or the auto-funder) while one is being sent is refused, so money never goes twice. */
async function beginTransfer(x: Xfer): Promise<number> {
  const { data: busy } = await fq("ai_futures_transfers").select("id").eq("status", "sending").gte("at", new Date(Date.now() - 3 * 60_000).toISOString()).limit(1);
  if (busy?.length) throw new Error("A transfer is already being sent. Wait a minute and check Money in & out.");
  const { data, error } = await fq("ai_futures_transfers").insert({ ...x, status: "sending" }).select("id").single();
  if (error) throw new Error(error.message);
  return Number(data.id);
}
async function endTransfer(id: number, v: Record<string, unknown>) {
  await sb().from("ai_futures_transfers").update({ ...v, updated_at: new Date().toISOString() }).eq("id", id);
}
const DONE = new Set(["success", "arrived", "failure", "failed", "refund", "refunded"]);
/** Asks Relay where the recent transfers stand (sending → pending → arrived / refunded / failed). */
async function refreshTransfers(limit = 5) {
  const { data } = await fq("ai_futures_transfers").select("id,request_id,status,at").not("request_id", "is", null).gte("at", new Date(Date.now() - 2 * 86400_000).toISOString()).order("at", { ascending: false }).limit(20);
  const todo = ((data || []) as any[]).filter((t) => !DONE.has(String(t.status))).slice(0, limit);
  const { relayStatus } = await import("@/lib/ai-trader-chains");
  await Promise.all(todo.map(async (t) => {
    const st = await relayStatus(String(t.request_id)).catch(() => null);
    if (!st || st.status === "unknown") return;
    const status = st.status === "success" ? "arrived" : st.status === "refund" ? "refunded" : st.status;
    if (status !== t.status) await endTransfer(Number(t.id), { status, detail: st.txs.length ? `tx ${st.txs[st.txs.length - 1]}` : undefined });
  }));
}

/**
 * Funds arriving by themselves (on, by default), checked every minute, at most every 4 minutes:
 *  - USDT / USDC in AI Futures' Solana wallet (at least $5) goes straight into the Hyperliquid account (Relay).
 *  - SOL there beyond ~0.015 kept for fees goes too (swapped to trading USDC on the way), if it's worth $5+.
 *  - USDC on Arbitrum in its EVM wallet (at least 5, with a little ETH for gas) is deposited to Hyperliquid.
 */
const SOL_KEEP = 0.015;
async function autoFund(s: FSettings) {
  if (!s.auto_fund || (s.fund_at && Date.now() - Date.parse(s.fund_at) < 4 * 60_000)) return;
  const a = await futAccount();
  if (!a) return;
  const kp = await futSolAccount();
  const stamp = () => sb().from("ai_futures_settings").update({ fund_at: new Date().toISOString() }).eq("id", T());
  if (kp) {
    const b = await futSolBalances(kp).catch((e) => { throw new Error(`couldn't read the Solana wallet (${(e as Error).message})`); });
    const sym = b.usdt >= b.usdc ? "USDT" : "USDC";
    const amt = Math.floor((sym === "USDT" ? b.usdt : b.usdc) * 100) / 100;
    if (amt >= 5) {
      await stamp();
      if (b.sol != null && b.sol < 0.004) { await flog("error", `$${amt} ${sym} is waiting in the AI Futures Solana wallet, but it needs about 0.01 SOL for the network fee to move it. Send a little SOL to it.`); return; }
      await sendSolToHl(kp, a.address, { usd: amt, symbol: sym }, "auto");
      return;
    }
    const spare = b.sol == null ? 0 : Math.floor((b.sol - SOL_KEEP) * 1e6) / 1e6;
    if (spare >= 0.03) {
      const { solNativeToHyperliquid } = await import("@/lib/ai-trader-chains");
      const q = await solNativeToHyperliquid(kp, a.address, spare, true).catch(() => null);
      if (q?.receive && q.receive >= 5) { await stamp(); await sendSolToHl(kp, a.address, { sol: spare, usdGuess: q.receive }, "auto"); return; }
    }
  }
  const w = await futWallet().catch(() => null);
  if (w && (w.arbUsdc ?? 0) >= 5 && (w.arbEth ?? 0) > 0.00002) {
    await stamp();
    const id = await beginTransfer({ dir: "in", route: "Arbitrum → Hyperliquid (auto)", amount_usd: w.arbUsdc!, symbol: "USDC", from_addr: a.address, to_addr: a.address });
    await depositToHl().then(async (h) => { await endTransfer(id, { status: "arrived", detail: `tx ${h}` }); await flog("settings", `💸 Funds added automatically: ${(w.arbUsdc ?? 0).toFixed(2)} USDC from Arbitrum → Hyperliquid.`); },
      async (e) => { await endTransfer(id, { status: "failed", detail: (e as Error).message }); await flog("error", `Couldn't deposit the Arbitrum USDC: ${(e as Error).message}`); });
  }
}

/** Solana → Hyperliquid account, recorded. Either stablecoins ({usd, symbol}) or SOL ({sol}). */
async function sendSolToHl(kp: Keypair, hlAddr: string, what: { usd: number; symbol: "USDT" | "USDC" } | { sol: number; usdGuess: number }, how: "auto" | "manual", fromLabel = "Perps Solana wallet") {
  const { solToHyperliquid, solNativeToHyperliquid } = await import("@/lib/ai-trader-chains");
  const isSol = "sol" in what;
  const label = isSol ? `${what.sol.toFixed(4)} SOL` : `$${what.usd.toFixed(2)} ${what.symbol}`;
  const id = await beginTransfer({ dir: "in", route: `${fromLabel} → Hyperliquid${how === "auto" ? " (auto)" : ""}`, amount_usd: isSol ? what.usdGuess : what.usd, symbol: isSol ? "SOL" : what.symbol, from_addr: kp.publicKey.toBase58(), to_addr: hlAddr, detail: isSol ? label : undefined });
  try {
    const r = isSol ? await solNativeToHyperliquid(kp, hlAddr, what.sol) : await solToHyperliquid({ evm: null, sol: kp }, hlAddr, what.usd, what.symbol);
    await endTransfer(id, { status: "pending", request_id: r.requestId, receive_usd: r.receive, fee_usd: r.feeUsd });
    await flog("settings", `💸 ${how === "auto" ? "Funds added automatically" : "Sent"}: ${label} from the ${fromLabel} → Hyperliquid (≈$${(r.receive ?? 0).toFixed(2)} arrives in about a minute, fee ≈$${r.feeUsd.toFixed(2)}).`);
    return r;
  } catch (e) {
    await endTransfer(id, { status: "failed", detail: (e as Error).message.slice(0, 300) });
    await flog("error", `Couldn't move ${label} to Hyperliquid: ${(e as Error).message}`);
    throw e;
  }
}

const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const HL_BRIDGE = "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7";
const arb = () => createPublicClient({ chain: arbitrum, transport: http("https://arb1.arbitrum.io/rpc", { timeout: 10_000 }) });
/** The wallet: address, money on Hyperliquid, and USDC / ETH waiting on Arbitrum (to deposit). */
export async function futWallet() {
  const a = await futAccount();
  if (!a) return null;
  const [hl, usdc, eth] = await Promise.all([
    hlAccount(a.address).catch(() => null),
    arb().readContract({ address: USDC_ARB, abi: erc20Abi, functionName: "balanceOf", args: [a.address] }).then((x) => Number(x) / 1e6).catch(() => null),
    arb().getBalance({ address: a.address }).then((x) => Number(x) / 1e18).catch(() => null),
  ]);
  const kp = await futSolAccount().catch(() => null);
  const sol = kp ? { address: kp.publicKey.toBase58(), ...(await futSolBalances(kp).catch(() => ({ usdt: null, usdc: null, sol: null }))) } : null;
  return { address: a.address, hlValue: hl?.value ?? null, hlFree: hl?.free ?? null, arbUsdc: usdc, arbEth: eth, sol };
}
/** Sends the wallet's USDC on Arbitrum into its Hyperliquid account (Hyperliquid's bridge; arrives in about a minute). */
export async function depositToHl(): Promise<string> {
  const a = await futAccount();
  if (!a) throw new Error("Create the wallet first.");
  const bal = await arb().readContract({ address: USDC_ARB, abi: erc20Abi, functionName: "balanceOf", args: [a.address] });
  if (bal < parseUnits("5", 6)) throw new Error("Hyperliquid needs at least 5 USDC per deposit. Send USDC on Arbitrum to the wallet first.");
  const w = createWalletClient({ account: a, chain: arbitrum, transport: http("https://arb1.arbitrum.io/rpc", { timeout: 20_000 }) });
  const hash = await w.writeContract({ address: USDC_ARB, abi: erc20Abi, functionName: "transfer", args: [HL_BRIDGE, bal] });
  await flog("settings", `Deposited ${(Number(bal) / 1e6).toFixed(2)} USDC into Hyperliquid (tx ${hash}).`);
  return hash;
}

/**
 * Fund it from Solana: sends USDT / USDC from the AI trader's Solana wallet straight into this futures account on
 * Hyperliquid (Relay). Arrives as trading USDC in about a minute. quoteOnly: what you'd receive and the fee.
 */
export async function fundFromSolana(usd: number, symbol: "USDT" | "USDC", quoteOnly = false, from: "perps" | "trader" = "perps") {
  const a = await futAccount();
  if (!a) throw new Error("Create the AI Futures wallet first.");
  const { solToHyperliquid } = await import("@/lib/ai-trader-chains");
  let kp = from === "perps" ? await futSolAccount() : null;
  if (from === "trader") kp = (await (await import("@/lib/ai-trader")).myWallets(1)).sol;
  if (!kp) throw new Error(from === "perps" ? "Create or import the perps Solana wallet first." : "There's no copy-trader Solana wallet.");
  if (quoteOnly) return solToHyperliquid({ evm: null, sol: kp }, a.address, usd, symbol, true);
  return sendSolToHl(kp, a.address, { usd, symbol }, "manual", from === "perps" ? "Perps Solana wallet" : "Copy-trader Solana wallet");
}

/**
 * Take money out of the Hyperliquid account. Only the free part (not tied up in open trades) can leave.
 *  - to "solana": USDT / USDC lands at that Solana address (Relay, ~1 minute, no gas).
 *  - to "arbitrum": USDC lands at that Arbitrum address, e.g. an exchange deposit address (Hyperliquid, $1 fee, ~5 minutes).
 *  - to "hyperliquid": USDC to another Hyperliquid account (instant, free).
 */
export async function withdrawFut(o: { usd: number; to: "solana" | "arbitrum" | "hyperliquid"; address: string; symbol?: "USDT" | "USDC"; quoteOnly?: boolean }) {
  const a = await futAccount();
  if (!a) throw new Error("There's no AI Futures wallet.");
  const acct = await hlAccount(a.address);
  const usd = Math.floor(Math.min(o.usd, acct.free) * 100) / 100;
  if (!(o.usd > 0)) throw new Error("Enter an amount.");
  if (o.usd > acct.free + 0.01) throw new Error(`Only $${acct.free.toFixed(2)} is free to withdraw${acct.value > acct.free + 0.5 ? " (the rest is in open trades: close them first)" : ""}.`);
  const addr = o.address.trim();
  if (o.to === "solana") {
    const { hlToSolana } = await import("@/lib/ai-trader-chains");
    const sym = o.symbol === "USDC" ? "USDC" : "USDT";
    if (o.quoteOnly) return hlToSolana(a, addr, usd, sym, true);
    // Sending to the perps Solana wallet with auto-fund on would just send it straight back.
    const own = await futSolAccount().catch(() => null);
    const s = await getF();
    if (own && own.publicKey.toBase58() === addr && s.auto_fund) { await sb().from("ai_futures_settings").update({ auto_fund: false }).eq("id", T()); await flog("settings", "Auto-fund turned off, so the withdrawal to the perps Solana wallet isn't sent back."); }
    const id = await beginTransfer({ dir: "out", route: "Hyperliquid → Solana", amount_usd: usd, symbol: sym, from_addr: a.address, to_addr: addr });
    try {
      const r = await hlToSolana(a, addr, usd, sym);
      await endTransfer(id, { status: "pending", request_id: r.requestId, receive_usd: r.receive, fee_usd: r.feeUsd });
      await flog("settings", `🏧 Withdrawing $${usd.toFixed(2)} from Hyperliquid → ${sym} on Solana ${addr.slice(0, 4)}…${addr.slice(-4)} (≈$${(r.receive ?? 0).toFixed(2)} arrives in about a minute).`);
      return r;
    } catch (e) { await endTransfer(id, { status: "failed", detail: (e as Error).message.slice(0, 300) }); throw e; }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error("That isn't an Arbitrum / EVM address (0x…).");
  if (o.to === "arbitrum" && usd < 2) throw new Error("Withdraw at least $2 (Hyperliquid keeps $1 as its fee).");
  if (o.quoteOnly) return { receive: o.to === "arbitrum" ? usd - 1 : usd, feeUsd: o.to === "arbitrum" ? 1 : 0, seconds: o.to === "arbitrum" ? 300 : 1, requestId: null };
  const id = await beginTransfer({ dir: "out", route: o.to === "arbitrum" ? "Hyperliquid → Arbitrum" : "Hyperliquid → Hyperliquid account", amount_usd: usd, symbol: "USDC", from_addr: a.address, to_addr: addr });
  try {
    const { hlWithdraw, hlUsdSend } = await import("@/lib/hyperliquid");
    if (o.to === "arbitrum") await hlWithdraw(a, addr, usd); else await hlUsdSend(a, addr, usd);
    await endTransfer(id, { status: o.to === "arbitrum" ? "pending" : "arrived", receive_usd: o.to === "arbitrum" ? usd - 1 : usd, fee_usd: o.to === "arbitrum" ? 1 : 0, detail: o.to === "arbitrum" ? "Arrives on Arbitrum in about 5 minutes" : undefined });
    await flog("settings", `🏧 Withdrew $${usd.toFixed(2)} from Hyperliquid → ${o.to === "arbitrum" ? "Arbitrum" : "Hyperliquid account"} ${addr.slice(0, 6)}…${addr.slice(-4)}.`);
    return { receive: usd, feeUsd: o.to === "arbitrum" ? 1 : 0, seconds: null, requestId: null };
  } catch (e) { await endTransfer(id, { status: "failed", detail: (e as Error).message.slice(0, 300) }); throw e; }
}

/**
 * Performance of the current mode (practice or live): the account over time, return, win rate, average win / loss,
 * profit factor, biggest drop from a high (drawdown), fees, best / worst trade, by coin, by exit reason, and for every
 * trade why it opened, why it closed and what it did to the account.
 */
async function performance(s: FSettings, eqTotal: number, openUpnl: number) {
  const { data } = await fq("ai_futures_positions").select("id,coin,side,lev,venue,entry,exit,pnl_usd,fees_usd,reason,why,opened_at,closed_at,risk_usd,equity_at_open,notional_usd").eq("status", "closed").eq("mode", s.mode).order("closed_at", { ascending: true }).limit(2000);
  const ts = ((data || []) as any[]).filter((t) => t.closed_at);
  const total = ts.reduce((a, t) => a + n(t.pnl_usd), 0);
  // Starting money: practice = the reset amount; live = today's value minus everything the trades made (so deposits count as starting money).
  const start = s.mode === "paper" ? n(s.paper_start) : Math.max(0.01, eqTotal - total - openUpnl);
  let run = start, peak = start, maxDd = 0;
  const curve: { t: string; v: number }[] = [{ t: ts[0]?.opened_at || new Date().toISOString(), v: +start.toFixed(2) }];
  const trades = ts.map((t) => {
    const before = n(t.equity_at_open) || run;
    run += n(t.pnl_usd);
    peak = Math.max(peak, run);
    maxDd = Math.max(maxDd, peak > 0 ? (peak - run) / peak : 0);
    curve.push({ t: t.closed_at, v: +run.toFixed(2) });
    const r = n(t.risk_usd) > 0 ? n(t.pnl_usd) / n(t.risk_usd) : null;
    return {
      id: t.id, coin: t.coin, side: t.side, lev: n(t.lev), venue: t.venue, entry: n(t.entry), exit: n(t.exit), pnl: n(t.pnl_usd), fees: n(t.fees_usd),
      impactPct: before > 0 ? (n(t.pnl_usd) / before) * 100 : null, r, holdMin: Math.round((Date.parse(t.closed_at) - Date.parse(t.opened_at)) / 60000),
      opened: t.why || "", closed: t.reason || "", driver: /news|headline|📰|\bX\b|tweet/i.test(String(t.why || "")) ? "news" : "chart", at: t.closed_at,
    };
  });
  curve.push({ t: new Date().toISOString(), v: +eqTotal.toFixed(2) });
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const sumW = wins.reduce((a, t) => a + t.pnl, 0), sumL = -losses.reduce((a, t) => a + t.pnl, 0);
  const group = (key: (t: (typeof trades)[number]) => string) => {
    const m = new Map<string, { trades: number; wins: number; pnl: number }>();
    for (const t of trades) { const k = key(t); const g = m.get(k) || { trades: 0, wins: 0, pnl: 0 }; g.trades++; if (t.pnl > 0) g.wins++; g.pnl += t.pnl; m.set(k, g); }
    return [...m.entries()].map(([k, g]) => ({ key: k, ...g, pnl: +g.pnl.toFixed(2) })).sort((a, b) => b.pnl - a.pnl);
  };
  const today = new Date().toISOString().slice(0, 10);
  const day = trades.filter((t) => String(t.at).slice(0, 10) === today).reduce((a, t) => a + t.pnl, 0);
  return {
    start: +start.toFixed(2), now: +eqTotal.toFixed(2), returnPct: start > 0 ? ((eqTotal - start) / start) * 100 : null, today: +day.toFixed(2),
    trades: trades.length, winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    avgWin: wins.length ? sumW / wins.length : null, avgLoss: losses.length ? -sumL / losses.length : null,
    profitFactor: sumL > 0 ? sumW / sumL : wins.length ? null : null, maxDrawdownPct: maxDd * 100,
    fees: trades.reduce((a, t) => a + t.fees, 0), best: trades.reduce<any>((b, t) => (!b || t.pnl > b.pnl ? t : b), null), worst: trades.reduce<any>((b, t) => (!b || t.pnl < b.pnl ? t : b), null),
    avgHoldMin: trades.length ? Math.round(trades.reduce((a, t) => a + t.holdMin, 0) / trades.length) : null,
    byCoin: group((t) => t.coin), byExit: group((t) => t.closed.replace(/\s*\(.*$/, "")), byDriver: group((t) => t.driver),
    curve: curve.slice(-400), journal: trades.slice(-60).reverse(),
  };
}

// ---------------------------------------------------------------- Market data

type Mkt = { hl: Map<string, HlAsset>; aster: Map<string, { mark: number; funding: number }>; fx: Map<string, HlAsset> };
/** Prices for every venue that's needed: Aster and forex only when switched on (or asked for with all). */
async function market(s: FSettings | null, all = false, fxToo = false): Promise<Mkt> {
  const [hl, aster, fx] = await Promise.all([
    all ? hlMarket().catch(() => new Map<string, HlAsset>()) : hlMarket(),
    all || s?.venues.includes("aster") ? asterMarket().catch(() => new Map()) : Promise.resolve(new Map()),
    all || fxToo || s?.venues.includes("forex") ? hlFxMarket().catch(() => new Map<string, HlAsset>()) : Promise.resolve(new Map<string, HlAsset>()),
  ]);
  return { hl, aster, fx };
}
async function asterMarket(): Promise<Map<string, { mark: number; funding: number }>> {
  const r = await fetch("https://fapi.asterdex.com/fapi/v1/premiumIndex", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const j = r.ok ? await r.json() : [];
  const out = new Map<string, { mark: number; funding: number }>();
  for (const x of Array.isArray(j) ? j : []) {
    const sym = String(x.symbol || "");
    if (!sym.endsWith("USDT")) continue;
    // Aster funding is per 8 hours: turned into per hour, like Hyperliquid's.
    out.set(sym.slice(0, -4), { mark: n(x.markPrice), funding: n(x.lastFundingRate) / 8 });
  }
  return out;
}
/** The Hyperliquid market a live order goes to (main exchange, or trade.xyz for forex). */
const assetOn = (m: Mkt, venue: string, coin: string) => (venue === "forex" ? m.fx.get(coin) : m.hl.get(coin));
const priceOn = (m: Mkt, venue: string, coin: string) => (venue === "aster" ? m.aster.get(coin)?.mark : assetOn(m, venue, coin)?.mark) || 0;
const fundingOn = (m: Mkt, venue: string, coin: string) => (venue === "aster" ? m.aster.get(coin)?.funding : assetOn(m, venue, coin)?.funding) ?? 0;
const dexOf = (venue: string) => (venue === "forex" ? FX_DEX : "");

// ---------------------------------------------------------------- Technical analysis

const ema = (xs: number[], p: number) => { const k = 2 / (p + 1); let e = xs[0]; const out = [e]; for (let i = 1; i < xs.length; i++) { e = xs[i] * k + e * (1 - k); out.push(e); } return out; };
function rsi(xs: number[], p = 14) {
  if (xs.length <= p) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = xs[i] - xs[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= p; l /= p;
  for (let i = p + 1; i < xs.length; i++) { const d = xs[i] - xs[i - 1]; g = (g * (p - 1) + Math.max(0, d)) / p; l = (l * (p - 1) + Math.max(0, -d)) / p; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function atr(cs: Candle[], p = 14) {
  const tr = cs.slice(1).map((c, i) => Math.max(c.h - c.l, Math.abs(c.h - cs[i].c), Math.abs(c.l - cs[i].c)));
  const last = tr.slice(-p);
  return last.reduce((a, b) => a + b, 0) / Math.max(1, last.length);
}
export type TA = { score: number; atrPct: number; rsi5: number; notes: string[] };
/** -1 (strong short) … +1 (strong long), from 1-hour trend, 5-minute momentum and breakouts on high volume. */
async function analyse(coin: string): Promise<TA | null> {
  const [m5, h1] = await Promise.all([hlCandles(coin, "5m", 120), hlCandles(coin, "1h", 120)]);
  if (m5.length < 60 || h1.length < 60) return null;
  const c5 = m5.map((c) => c.c), c1 = h1.map((c) => c.c), price = c5[c5.length - 1];
  const e21h = ema(c1, 21), e50h = ema(c1, 50);
  const trend = Math.sign(e21h.at(-1)! - e50h.at(-1)!) * (Math.sign(e21h.at(-1)! - e21h.at(-6)!) === Math.sign(e21h.at(-1)! - e50h.at(-1)!) ? 1 : 0.5);
  const e9 = ema(c5, 9), e21 = ema(c5, 21);
  // Currencies move about a tenth as much as coins, so their momentum is scaled up to the same -1…+1.
  const mom = Math.max(-1, Math.min(1, ((e9.at(-1)! - e21.at(-1)!) / price) * (isFx(coin) ? 3000 : 400)));
  const prev = m5.slice(-21, -1), last = m5.at(-1)!;
  const hi = Math.max(...prev.map((c) => c.h)), lo = Math.min(...prev.map((c) => c.l));
  const vAvg = prev.reduce((a, c) => a + c.v, 0) / prev.length;
  const loud = last.v > vAvg * 1.5 || m5.at(-2)!.v > vAvg * 1.5;
  const brk = last.c > hi && loud ? 1 : last.c < lo && loud ? -1 : 0;
  const r = rsi(c5);
  const notes: string[] = [];
  notes.push(trend > 0 ? "1h uptrend" : trend < 0 ? "1h downtrend" : "1h flat");
  if (Math.abs(mom) > 0.3) notes.push(mom > 0 ? "5m momentum up" : "5m momentum down");
  if (brk) notes.push(brk > 0 ? "breakout on high volume" : "breakdown on high volume");
  let score = 0.35 * trend + 0.25 * mom + 0.4 * brk;
  // Don't chase: no long when it's already stretched (RSI > 75), no short when it's already washed out (RSI < 25).
  if (score > 0 && r > 75) { score *= 0.3; notes.push(`RSI ${r.toFixed(0)}: stretched`); }
  if (score < 0 && r < 25) { score *= 0.3; notes.push(`RSI ${r.toFixed(0)}: washed out`); }
  return { score: Math.max(-1, Math.min(1, score)), atrPct: atr(m5) / price, rsi5: r, notes };
}

// ---------------------------------------------------------------- News and X

const FEEDS = [
  ["CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"],
  ["Cointelegraph", "https://cointelegraph.com/rss"],
  ["Decrypt", "https://decrypt.co/feed"],
  ["The Block", "https://www.theblock.co/rss.xml"],
] as const;
const FX_FEEDS = [
  ["FXStreet", "https://www.fxstreet.com/rss/news"],
  ["investingLive", "https://investinglive.com/feed/"],
] as const;
type Item = { key: string; source: string; title: string; url: string; at: number };
const tag = (x: string, t: string) => (x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i"))?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
async function rss(fx = false): Promise<Item[]> {
  const all = await Promise.all((fx ? FX_FEEDS : FEEDS).map(async ([name, url]) => {
    const x = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000), headers: { "user-agent": "Mozilla/5.0 AUTISTIK-Hub" } }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    return (x.match(/<item[\s>][\s\S]*?<\/item>/gi) || []).slice(0, 15).map((it) => {
      const link = tag(it, "link") || tag(it, "guid");
      return { key: `n:${link || tag(it, "title")}`.slice(0, 300), source: name, title: tag(it, "title").slice(0, 300), url: link, at: Date.parse(tag(it, "pubDate")) || Date.now() };
    });
  }));
  return all.flat().filter((i) => i.title && Date.now() - i.at < 20 * 60_000);
}

/** New headlines and X posts (each judged once), read by the AI: which coin, up or down, how strongly. */
async function readNews(s: FSettings, m: Mkt): Promise<number> {
  const items: Item[] = [];
  const fx = s.venues.includes("forex") ? [...m.fx.keys()] : [];
  if (s.use_news) items.push(...(await rss(fx.length > 0).catch(() => [])));
  if (s.use_x && s.x_handles.length) {
    const posts = await accountPosts(s.x_handles.slice(0, 20)).catch(() => []);
    items.push(...posts.map((p) => ({ key: `x:${p.id}`, source: `@${p.user}`, title: p.text.slice(0, 400), url: p.url, at: p.at })));
  }
  if (!items.length) return 0;
  // Only ones not seen before: the insert decides (each item is judged once, even with two runs at once).
  const { data: fresh } = await fq("ai_futures_news").upsert(items.slice(0, 40).map((i) => ({ key: i.key, source: i.source, title: i.title, url: i.url, at: new Date(i.at).toISOString() })), { onConflict: "fut_id,key", ignoreDuplicates: true }).select("key");
  const keys = new Set((fresh || []).map((r: any) => r.key));
  const todo = items.filter((i) => keys.has(i.key)).slice(0, 20);
  if (!todo.length || !process.env.ANTHROPIC_API_KEY) return 0;
  const coins = s.coins.join(", ") || "none (forex only)";
  // Forex markets, with what "up" means for each (dir 1 = this market's price rises).
  const fxList = fx.map((c) => `${c} (${fxLabel(c, m.fx.get(c)?.mark)}: price up = ${fxLabel(c, m.fx.get(c)?.mark).startsWith("USD/") ? "dollar stronger" : c.endsWith("DXY") ? "dollar stronger" : `${c.slice(4)} stronger`})`).join(", ");
  const fxRule = fx.length ? ` Forex markets: ${fxList}. Use "USD" for news that moves the US dollar against everything (Fed decisions and speeches, US CPI, jobs/NFP, GDP, Treasury yields): dir 1 = dollar stronger. For news about one currency (ECB, BoE, BoJ, RBA decisions, that country's data), use that market's exact name and dir for ITS price. Scheduled data only counts once the actual number is out (beat or miss vs forecast), never previews.` : "";
  const msg = await anthropic().messages.create({
    model: FAST_MODEL, max_tokens: 900,
    system: `You are a futures desk reading breaking news. For each numbered item decide if it should move a market's price in the next hour. Coins: ${coins}. Use "MARKET" for news that moves all crypto (macro, ETF flows, regulation, exchange hacks, big liquidations).${fxRule} Reply ONLY with a JSON array: [{"i":1,"coin":"BTC"|"MARKET"${fx.length ? '|"USD"|"xyz:EUR"' : ""}|null,"dir":1|-1|0,"strength":0..1}]. strength 0.8+ only for clearly market-moving, fresh, confirmed news (listings, hacks, ETF approvals, rate decisions, data surprises, big partnerships). Opinion, price recaps, old news, ads and rumours are dir 0.`,
    messages: [{ role: "user", content: todo.map((t, i) => `${i + 1}. [${t.source}] ${t.title}`).join("\n") }],
  } as any).catch(() => null);
  const text = (msg as any)?.content?.find?.((b: any) => b.type === "text")?.text || "";
  let out: any[] = [];
  try { out = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)); } catch { /* bad reply: skip this batch */ }
  let hits = 0;
  for (const o of Array.isArray(out) ? out : []) {
    const it = todo[Number(o.i) - 1];
    if (!it) continue;
    const coin = typeof o.coin === "string" && (o.coin === "MARKET" || s.coins.includes(o.coin) || (fx.length && (o.coin === "USD" || fx.includes(o.coin)))) ? o.coin : null;
    const dir = [1, -1].includes(Number(o.dir)) ? Number(o.dir) : 0;
    const strength = Math.max(0, Math.min(1, n(o.strength)));
    await fq("ai_futures_news").update({ coin, direction: dir, strength }).eq("key", it.key);
    if (coin && dir && strength >= 0.5) { hits++; await flog("news", `${dir > 0 ? "🟢" : "🔴"} ${coin} ${dir > 0 ? "up" : "down"} (${Math.round(strength * 100)}%): ${it.title.slice(0, 160)} · ${it.source}`); }
  }
  return hits;
}

/**
 * The news score per coin: recent judged items, fading to nothing over 30 minutes. MARKET news counts for every crypto
 * coin; USD (dollar) news counts for every forex market, turned the right way for how that pair is quoted.
 */
async function newsScores(coins: string[], m?: Mkt): Promise<Map<string, { score: number; why: string }>> {
  const { data } = await fq("ai_futures_news").select("coin,direction,strength,at,title,source").gte("at", new Date(Date.now() - 30 * 60_000).toISOString()).not("coin", "is", null).neq("direction", 0);
  const out = new Map<string, { score: number; why: string }>();
  for (const c of coins) {
    let score = 0, why = "", best = 0;
    const fx = isFx(c);
    for (const r of (data || []) as any[]) {
      if (r.coin !== c && r.coin !== (fx ? "USD" : "MARKET")) continue;
      const w = (1 - (Date.now() - Date.parse(r.at)) / (30 * 60_000)) * n(r.strength) * (r.coin === "MARKET" ? 0.7 : 1);
      const sign = r.coin === "USD" ? usdSign(c, m?.fx.get(c)?.mark || 0) : 1;
      score += Number(r.direction) * sign * w;
      if (w > best) { best = w; why = `${r.source}: ${String(r.title).slice(0, 120)}`; }
    }
    out.set(c, { score: Math.max(-1, Math.min(1, score)), why });
  }
  return out;
}

// ---------------------------------------------------------------- Positions

const pnlOf = (p: FPos, price: number) => (p.side === "long" ? 1 : -1) * p.notional_usd * (price / p.entry - 1);

async function equity(s: FSettings, m: Mkt): Promise<{ total: number; free: number }> {
  if (s.mode === "live") {
    const a = await futAccount();
    if (!a) return { total: 0, free: 0 };
    const [acc, fxAcc] = await Promise.all([hlAccount(a.address), s.venues.includes("forex") ? hlAccount(a.address, FX_DEX).catch(() => null) : Promise.resolve(null)]);
    // Forex margin sits in its own account on trade.xyz: counted in the total, and free money there can be used too.
    return { total: acc.value + (fxAcc?.value ?? 0), free: acc.free + (fxAcc?.free ?? 0) };
  }
  const { data } = await fq("ai_futures_positions").select("*").eq("mode", "paper").in("status", ["open", "closing"]);
  const open = (data || []) as FPos[];
  const locked = open.reduce((a, p) => a + n(p.margin_usd), 0);
  const upnl = open.reduce((a, p) => a + pnlOf(p, priceOn(m, p.venue, p.coin) || n(p.last) || n(p.entry)), 0);
  return { total: s.paper_usd + locked + upnl, free: s.paper_usd };
}

async function closePos(s: FSettings, m: Mkt, p: FPos, reason: string, price?: number) {
  const { data: claimed } = await fq("ai_futures_positions").update({ status: "closing" }).eq("id", p.id).eq("status", "open").select("id");
  if (!claimed?.length) return;
  try {
    let exit = price ?? priceOn(m, p.venue, p.coin), tx: string | null = null;
    if (p.mode === "live") {
      const a = await futAccount(), asset = assetOn(m, p.venue, p.coin);
      if (!a || !asset) throw new Error("wallet or market missing");
      if (p.sl_oid) await hlCancel(a, asset.index, Number(p.sl_oid));
      const acc = await hlAccount(a.address, dexOf(p.venue));
      const held = Math.abs(acc.positions.get(p.coin)?.size || 0);
      if (held > 0) {
        const r = await hlMarketOrder(a, asset, p.side === "short", held, true, 0.05);
        exit = r.avgPx; tx = String(r.oid);
      } else reason = `${reason} (already closed on Hyperliquid, likely by its stop-loss)`;
      if (p.venue === "forex") await sweepFx(a).catch((e) => flog("error", `Couldn't move forex money back to the main account: ${(e as Error).message}`));
    }
    const fees = n(p.fees_usd) + n(p.notional_usd) * (exit / n(p.entry)) * (FEE[p.venue] ?? 0.0005);
    let pnl = pnlOf(p, exit) - fees;
    if (pnl < -n(p.margin_usd)) pnl = -n(p.margin_usd); // isolated margin: can't lose more than the margin
    await fq("ai_futures_positions").update({ status: "closed", exit, pnl_usd: pnl, fees_usd: fees, reason, closed_at: new Date().toISOString(), last: exit, close_tx: tx }).eq("id", p.id);
    if (p.mode === "paper") {
      const fresh = await getF();
      await sb().from("ai_futures_settings").update({ paper_usd: fresh.paper_usd + n(p.margin_usd) + pnl }).eq("id", T());
    }
    await flog(pnl >= 0 ? "win" : "loss", `${pnl >= 0 ? "✅" : "🔻"} Closed ${p.side} ${fxLabel(p.coin, exit)} on ${VENUE_NAME[p.venue]} (${reason}): ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${((pnl / n(p.margin_usd)) * 100).toFixed(1)}% of margin)${p.mode === "paper" ? " · practice" : ""}.`);
  } catch (e) {
    await fq("ai_futures_positions").update({ status: "open" }).eq("id", p.id);
    await flog("error", `Couldn't close ${p.coin}: ${(e as Error).message}`);
  }
}

/** With no forex trade left open, the forex account's money goes back to the main account (instant, free). */
async function sweepFx(a: PrivateKeyAccount) {
  const fxAcc = await hlAccount(a.address, FX_DEX);
  if ([...fxAcc.positions.values()].some((q) => q.size !== 0)) return;
  if (fxAcc.free >= 0.5) await hlDexTransfer(a, FX_DEX, "", fxAcc.free);
}

/** Stops, targets, break-even and trailing, time limit, news against it. */
async function manage(s: FSettings, m: Mkt, news: Map<string, { score: number; why: string }>) {
  const { data } = await fq("ai_futures_positions").select("*").eq("status", "open");
  for (const p of (data || []) as FPos[]) {
    const price = priceOn(m, p.venue, p.coin);
    if (!price) continue;
    const long = p.side === "long";
    const best = long ? Math.max(n(p.best) || p.entry, price) : Math.min(n(p.best) || p.entry, price);
    const risk = Math.abs(p.entry - n(p.stop)) || p.entry * 0.01;
    const gainR = ((long ? best - p.entry : p.entry - best) / risk);
    let stop = n(p.stop);
    // At +1R the stop moves to break-even (plus fees); past +1.5R it trails 0.8R behind the best price.
    if (gainR >= 1) stop = long ? Math.max(stop, p.entry * 1.001) : Math.min(stop, p.entry * 0.999);
    if (gainR >= 1.5) stop = long ? Math.max(stop, best - 0.8 * risk) : Math.min(stop, best + 0.8 * risk);
    const hit = (long ? price <= stop : price >= stop) ? "Stop-loss" : (long ? price >= p.target : price <= p.target) ? "Take profit" : null;
    const liqHit = p.liq && (long ? price <= p.liq : price >= p.liq);
    const ns = news.get(p.coin)?.score ?? 0;
    const old = Date.now() - Date.parse(p.opened_at) > s.max_hold_hours * 3600e3;
    // Forex: closed before Friday's close, so a weekend gap can't jump over the stop.
    if (p.venue === "forex" && fxWeekendSoon()) { await closePos(s, m, p, "Closed before the forex weekend", price); continue; }
    if (liqHit && p.mode === "paper") { await closePos(s, m, p, "Liquidated", p.liq!); continue; }
    // Auto-sell: the trade is down the set % of its margin (like the P&L % the exchange shows).
    const roe = (pnlOf(p, price) / n(p.margin_usd)) * 100;
    if (roe <= -s.max_loss_pct) { await closePos(s, m, p, `Auto-sell at -${s.max_loss_pct}%`, price); continue; }
    const lockedIn = long ? stop >= p.entry : stop <= p.entry; // the stop had moved to break-even or better
    if (hit) { await closePos(s, m, p, hit === "Stop-loss" && lockedIn ? (gainR >= 1.5 ? "Trailing stop" : "Break-even stop") : hit, price); continue; }
    if ((long ? ns <= -0.6 : ns >= 0.6)) { await closePos(s, m, p, `News turned against it (${news.get(p.coin)?.why || ""})`, price); continue; }
    if (old) { await closePos(s, m, p, `Held ${s.max_hold_hours}h`, price); continue; }
    // Live: the stop moved, so move the one resting on Hyperliquid too.
    let sl_oid = p.sl_oid;
    if (p.mode === "live" && stop !== n(p.stop)) {
      const a = await futAccount(), asset = assetOn(m, p.venue, p.coin);
      if (a && asset && p.size) {
        const fresh = await hlStopLoss(a, asset, !long, n(p.size), stop).catch(() => null);
        if (fresh) { if (sl_oid) await hlCancel(a, asset.index, Number(sl_oid)); sl_oid = fresh; }
        else stop = n(p.stop); // couldn't move it: keep the old one
      }
    }
    await fq("ai_futures_positions").update({ best, last: price, stop, sl_oid }).eq("id", p.id);
  }
}

async function open(s: FSettings, m: Mkt, eq: { total: number; free: number }, coin: string, side: "long" | "short", ta: TA | null, why: string, newsDriven: boolean) {
  const long = side === "long";
  // Venue: of the switched-on ones (live: Hyperliquid and forex) that list the coin, the one with the cheaper funding for this side.
  const fx = isFx(coin);
  const venues = s.venues.filter((v) => (v === "forex") === fx && (s.mode === "live" ? LIVE_VENUES.includes(v) : true) && priceOn(m, v, coin) > 0);
  if (!venues.length) return `no venue lists ${coin}`;
  const venue = venues.sort((a, b) => (long ? fundingOn(m, a, coin) - fundingOn(m, b, coin) : fundingOn(m, b, coin) - fundingOn(m, a, coin)))[0];
  const f = fundingOn(m, venue, coin);
  if (long ? f > 0.0005 : f < -0.0005) return `funding too costly on ${VENUE_NAME[venue]}`;
  const price = priceOn(m, venue, coin);
  // Stop: 3× the 5-minute ATR, between 0.6% and 4% away. At 3x, liquidation is ~32% away, far past any stop.
  let lev = Math.min(MAX_LEV, s.max_lev, (assetOn(m, venue, coin) ?? m.hl.get(coin))?.maxLev ?? MAX_LEV);
  // "Never get liquidated" (on): liquidation at least 15% away (6x at most), so even a sudden crash reaches the
  // stop-loss resting on Hyperliquid long before it could reach liquidation.
  if (s.no_liq) lev = Math.min(lev, 6);
  // Stop: 3× the 5-minute ATR (0.6%–4% away), but never more than the auto-sell loss (e.g. -5% of the margin = 5% ÷
  // leverage of price). Liquidation is about 1 ÷ leverage away, so the stop always comes first.
  // Currencies move far less, so their stop is 0.15%–1% away instead.
  const stopPct = fx ? Math.min(0.01, Math.max(0.0015, (ta?.atrPct ?? 0.0008) * 3), s.max_loss_pct / 100 / lev)
    : Math.min(0.04, Math.max(0.006, (ta?.atrPct ?? 0.004) * 3), s.max_loss_pct / 100 / lev);
  // Size: a stop-loss costs risk_pct of the account; margin never more than a third of the account or 90% of free cash.
  let notional = (eq.total * (s.risk_pct / 100)) / stopPct;
  notional = Math.min(notional, eq.total * 0.33 * lev, eq.free * 0.9 * lev);
  if (notional < 11) return "not enough money for a minimum-size position";
  const margin = notional / lev;
  const stop = long ? price * (1 - stopPct) : price * (1 + stopPct);
  const target = long ? price * (1 + stopPct * (newsDriven ? 2.5 : 2.2)) : price * (1 - stopPct * (newsDriven ? 2.5 : 2.2));
  const liq = long ? price * (1 - 1 / lev + 0.005) : price * (1 + 1 / lev - 0.005);
  // Always: the stop must sit far before liquidation (at least 8x nearer), or no trade.
  if (Math.abs(price - liq) / price < stopPct * 8) return `${fxLabel(coin, price)}: liquidation too close to the stop at ${lev}x`;
  let entry = price, size: number | null = null, sl_oid: number | null = null, tx: string | null = null;
  if (s.mode === "live") {
    const a = await futAccount(), asset = assetOn(m, venue, coin);
    if (!a || !asset) return "no wallet";
    if (fx) {
      // The forex account has its own margin: move this trade's margin (plus a little for fees) in from the main one.
      const fxAcc = await hlAccount(a.address, FX_DEX);
      const need = notional / lev * 1.05 + 1 - fxAcc.free;
      if (need > 0) await hlDexTransfer(a, "", FX_DEX, need);
    }
    await hlSetLeverage(a, asset.index, lev);
    const r = await hlMarketOrder(a, asset, long, notional / price, false, fx ? 0.003 : 0.01).catch(async (e) => {
      if (fx) await sweepFx(a).catch(() => {}); // nothing opened: the margin goes back to the main account
      throw e;
    });
    entry = r.avgPx; size = r.size; tx = String(r.oid);
    const st = long ? entry * (1 - stopPct) : entry * (1 + stopPct);
    sl_oid = await hlStopLoss(a, asset, !long, size, st).catch(async (e) => {
      // No stop on the exchange = too risky to keep: close it at once.
      await hlMarketOrder(a, asset, !long, size!, true, 0.05).catch(() => {});
      if (fx) await sweepFx(a).catch(() => {});
      throw new Error(`Couldn't place the stop-loss, so closed it again: ${(e as Error).message}`);
    });
    notional = size * entry;
  } else {
    entry = price * (long ? 1.0005 : 0.9995); // a little slippage
    const fresh = await getF();
    await sb().from("ai_futures_settings").update({ paper_usd: fresh.paper_usd - margin }).eq("id", T());
  }
  const fees = notional * (FEE[venue] ?? 0.0005);
  const { error } = await fq("ai_futures_positions").insert({
    mode: s.mode, venue, coin, side, lev, margin_usd: notional / lev, notional_usd: notional, entry,
    stop: long ? entry * (1 - stopPct) : entry * (1 + stopPct), target: long ? entry * (target / price) : entry * (target / price), liq, best: entry, last: entry,
    fees_usd: fees, why: why.slice(0, 500), size, sl_oid, open_tx: tx,
    risk_usd: +(notional * stopPct).toFixed(4), equity_at_open: +eq.total.toFixed(2),
  });
  if (error) await flog("error", `Opened ${coin} but couldn't save it: ${error.message}`);
  await flog("open", `${long ? "📈 Long" : "📉 Short"} ${fxLabel(coin, entry)} on ${VENUE_NAME[venue]} at $${entry.toPrecision(6)}, ${lev}x, $${notional.toFixed(0)} position ($${(notional / lev).toFixed(0)} margin). Stop $${(long ? entry * (1 - stopPct) : entry * (1 + stopPct)).toPrecision(6)} (-${(stopPct * 100).toFixed(2)}%), target +${(stopPct * (newsDriven ? 250 : 220)).toFixed(2)}%. ${why}${s.mode === "paper" ? " · practice" : ""}`);
  return "opened";
}

// ---------------------------------------------------------------- One run

export async function runFutures(): Promise<string> {
  const s = await getF();
  const { data: go } = await sb().rpc("ai_futures_lease", { p_id: T(), p_seconds: 55 });
  if (!go) return "busy";
  try {
    await autoFund(s).catch((e) => flog("error", `Auto-fund: ${(e as Error).message}`));
    await refreshTransfers(3).catch(() => null);
    // Earn: nothing to trade. Money sent from Solana arrives on Hyperliquid above; you put it into HLP from the page.
    if (isEarnDesk()) { const e = await earnState().catch(() => null); return note(e ? `Earn: $${e.inHlp.toFixed(2)} in HLP, $${e.free.toFixed(2)} free on Hyperliquid.` : "Earn: no wallet yet."); }
    // Open forex trades are always watched, even if Forex was switched off after they opened.
    const { data: heldFx } = await fq("ai_futures_positions").select("coin").eq("status", "open").eq("venue", "forex");
    const m = await market(s, false, !!heldFx?.length);
    const { hl } = m;
    // Forex markets it trades (when Forex is switched on and the forex market is open).
    const fxCoins = s.venues.includes("forex") ? [...m.fx.keys()] : [];
    if (s.enabled && (s.use_news || s.use_x)) await readNews(s, m).catch((e) => flog("error", `News: ${(e as Error).message}`));
    const news = await newsScores([...s.coins, ...new Set([...fxCoins, ...((heldFx || []) as any[]).map((r) => r.coin)])], m);
    await manage(s, m, news);
    if (!s.enabled) return note("Off. Open positions are still watched.");
    const eq = await equity(s, m);
    // Daily loss limit: from the account value at the start of the day (UTC).
    const today = new Date().toISOString().slice(0, 10);
    if (s.day !== today || s.day_start_usd == null) { await sb().from("ai_futures_settings").update({ day: today, day_start_usd: eq.total }).eq("id", T()); s.day_start_usd = eq.total; }
    if (eq.total < n(s.day_start_usd) * (1 - s.daily_loss_pct / 100)) return note(`Paused for today: down ${(100 - (eq.total / n(s.day_start_usd)) * 100).toFixed(1)}% (limit ${s.daily_loss_pct}%).`);
    const { data: openRows } = await fq("ai_futures_positions").select("coin").in("status", ["open", "closing"]);
    const held = new Set((openRows || []).map((r: any) => r.coin));
    if (held.size >= s.max_positions) return note(`Holding ${held.size} of ${s.max_positions}. Account $${eq.total.toFixed(2)}.`);
    // Score every coin not held: chart and news side by side.
    const cands: { coin: string; side: "long" | "short"; score: number; why: string; news: boolean; ta: TA | null }[] = [];
    const scan = [...s.coins.filter((c) => !held.has(c) && hl.has(c)), ...(fxOpen() ? fxCoins.filter((c) => !held.has(c)) : [])];
    await Promise.all(scan.map(async (coin) => {
      const ta = s.use_ta ? await analyse(coin).catch(() => null) : null;
      const ns = news.get(coin) || { score: 0, why: "" };
      const t = ta?.score ?? 0;
      if (isFx(coin)) {
        // Forex is stricter: news trades only when the chart already leans the same way; chart-only trades need a
        // stronger setup. Fewer trades, but more of them should win.
        if (!ta) return;
        const label = fxLabel(coin, m.fx.get(coin)?.mark);
        if (Math.abs(ns.score) >= 0.6 && Math.sign(t) === Math.sign(ns.score) && Math.abs(t) >= 0.15) {
          cands.push({ coin, side: ns.score > 0 ? "long" : "short", score: Math.abs(ns.score) + 0.5, why: `${label} news: ${ns.why} · chart: ${ta.notes.join(", ")}`, news: true, ta });
        } else {
          const blended = ns.score ? 0.65 * t + 0.35 * ns.score : t;
          if (Math.abs(blended) >= 0.75 && !(ns.score && Math.sign(ns.score) !== Math.sign(blended))) cands.push({ coin, side: blended > 0 ? "long" : "short", score: Math.abs(blended), why: `${label} chart: ${ta.notes.join(", ")}${ns.score ? ` · news ${ns.score > 0 ? "+" : ""}${ns.score.toFixed(2)}` : ""}`, news: false, ta });
        }
        return;
      }
      // Strong news trades first, as long as the chart isn't clearly against it.
      if (Math.abs(ns.score) >= 0.6 && !(Math.sign(t) === -Math.sign(ns.score) && Math.abs(t) >= 0.3)) {
        cands.push({ coin, side: ns.score > 0 ? "long" : "short", score: Math.abs(ns.score) + 0.5, why: `News: ${ns.why}${ta ? ` · chart: ${ta.notes.join(", ")}` : ""}`, news: true, ta });
        return;
      }
      const blended = ns.score ? 0.65 * t + 0.35 * ns.score : t;
      if (ta && Math.abs(blended) >= 0.65) cands.push({ coin, side: blended > 0 ? "long" : "short", score: Math.abs(blended), why: `Chart: ${ta.notes.join(", ")}${ns.score ? ` · news ${ns.score > 0 ? "+" : ""}${ns.score.toFixed(2)}` : ""}`, news: false, ta });
    }));
    cands.sort((a, b) => b.score - a.score);
    const notes: string[] = [];
    for (const c of cands.slice(0, s.max_positions - held.size)) {
      const r = await open(s, m, await equity(s, m), c.coin, c.side, c.ta, c.why, c.news).catch((e) => `failed: ${(e as Error).message}`);
      notes.push(`${fxLabel(c.coin, m.fx.get(c.coin)?.mark)} ${c.side}: ${r}`);
      if (/^failed/.test(r)) await flog("error", `${fxLabel(c.coin, m.fx.get(c.coin)?.mark)}: ${r}`);
    }
    const watching = isFxDesk() ? (fxOpen() ? `Watching ${fxCoins.length} forex pairs` : "Forex is closed for the weekend (opens Sunday 21:00 UTC)") : `Watching ${s.coins.length} coins`;
    return note(notes.length ? notes.join(" · ") : `${watching}; no setup strong enough. Account $${eq.total.toFixed(2)}.`);
  } finally {
    await sb().from("ai_futures_settings").update({ lease_until: null, last_run: new Date().toISOString() }).eq("id", T());
  }
  async function note(t: string) { await sb().from("ai_futures_settings").update({ last_note: t.slice(0, 400) }).eq("id", T()); return t; }
}

/** Close one position now (from the page). */
export async function closeNow(id: number) {
  const s = await getF();
  const { data } = await fq("ai_futures_positions").select("*").eq("id", id).eq("status", "open").maybeSingle();
  if (!data) throw new Error("That position isn't open.");
  await closePos(s, await market(s, true), data as FPos, "Closed by admin");
}

/** Close every open trade now (current mode first, then any other), at the market price. */
export async function closeAllNow(onlyMode?: "paper" | "live") {
  const s = await getF();
  let qy = fq("ai_futures_positions").select("*").eq("status", "open");
  if (onlyMode) qy = qy.eq("mode", onlyMode);
  const { data } = await qy;
  const list = (data || []) as FPos[];
  if (!list.length) return 0;
  const m = await market(s, true);
  let n = 0;
  for (const p of list) { await closePos(s, m, p, "Closed by admin (close all)").then(() => n++, (e) => flog("error", `Couldn't close ${p.coin}: ${(e as Error).message}`)); }
  return n;
}

/** The page: settings, wallet, account value, open and closed positions, log, latest judged news. */
export async function futStatus() {
  const s = await getF();
  const m = await market(s, true);
  const [{ data: openP }, { data: closedP }, { data: logs }, { data: news }, wallet] = await Promise.all([
    fq("ai_futures_positions").select("*").in("status", ["open", "closing"]).order("opened_at", { ascending: false }),
    fq("ai_futures_positions").select("*").eq("status", "closed").order("closed_at", { ascending: false }).limit(50),
    fq("ai_futures_log").select("*").order("at", { ascending: false }).limit(60),
    fq("ai_futures_news").select("*").not("direction", "is", null).neq("direction", 0).order("at", { ascending: false }).limit(20),
    futWallet().catch(() => null),
    refreshTransfers().catch(() => null),
  ]);
  const { data: transfers } = await fq("ai_futures_transfers").select("id,at,dir,route,amount_usd,symbol,to_addr,request_id,status,receive_usd,fee_usd,detail").order("at", { ascending: false }).limit(25);
  const eq = await equity(s, m).catch(() => ({ total: 0, free: 0 }));
  const done = ((closedP || []) as FPos[]).filter((p) => p.mode === s.mode);
  const pnl = done.reduce((a, p) => a + n(p.pnl_usd), 0), wins = done.filter((p) => n(p.pnl_usd) > 0).length;
  const openNow = ((openP || []) as FPos[]).map((p) => { const px = priceOn(m, p.venue, p.coin) || n(p.last); return { ...p, price: px, upnl: px ? pnlOf(p, px) - n(p.fees_usd) : null }; });
  const perf = await performance(s, eq.total, openNow.filter((p) => p.mode === s.mode).reduce((a, p) => a + n(p.upnl), 0)).catch(() => null);
  return {
    settings: s, equity: eq, wallet, liveVenues: LIVE_VENUES, perf, transfers: transfers || [],
    earn: isEarnDesk() ? await earnState() : null,
    fx: { pairs: [...m.fx.values()].map((a) => ({ coin: a.name, label: fxLabel(a.name, a.mark), price: a.mark, maxLev: a.maxLev })), open: fxOpen() },
    open: openNow,
    closed: closedP || [], log: logs || [], news: news || [],
    stats: { trades: done.length, wins, winRate: done.length ? Math.round((wins / done.length) * 100) : null, pnl },
  };
}

// ---------------------------------------------------------------- Earn (HLP vault)

/** The Earn desk's money: free on Hyperliquid, in HLP, its lock, and HLP's recent yearly rate. */
async function earnState() {
  const a = await futAccount();
  if (!a) return { free: 0, inHlp: 0, lockedUntil: null as number | null, apr: await hlVaultApr().catch(() => null), vault: HLP_VAULT };
  const [acc, v, apr] = await Promise.all([hlAccount(a.address).catch(() => null), hlVaultEquity(a.address).catch(() => ({ equity: 0, lockedUntil: null })), hlVaultApr().catch(() => null)]);
  return { free: acc?.free ?? 0, inHlp: v.equity, lockedUntil: v.lockedUntil, apr, vault: HLP_VAULT };
}

/** Deposit into / withdraw from HLP (Earn desk only). Withdrawals only after the 4-day lock of the newest deposit. */
export async function earnMove(isDeposit: boolean, usd: number) {
  if (!isEarnDesk()) throw new Error("Only the Earn page does this.");
  const a = await futAccount();
  if (!a) throw new Error("Create or import the Earn wallet first.");
  const st = await earnState();
  if (isDeposit && usd > st.free + 1e-6) throw new Error(`Only $${st.free.toFixed(2)} is free on Hyperliquid. Fund the wallet first (from Solana below).`);
  if (!isDeposit && usd > st.inHlp + 1e-6) throw new Error(`Only $${st.inHlp.toFixed(2)} is in HLP.`);
  if (!isDeposit && st.lockedUntil && st.lockedUntil > Date.now()) throw new Error(`Locked until ${new Date(st.lockedUntil).toUTCString().slice(0, 22)} UTC (HLP keeps each deposit for 4 days).`);
  await hlVaultTransfer(a, isDeposit, usd);
  await flog(isDeposit ? "transfer" : "transfer", isDeposit ? `💰 Put $${usd.toFixed(2)} into HLP (Hyperliquid's market-making vault). It can come out 4 days after this deposit.` : `💰 Took $${usd.toFixed(2)} out of HLP back to the wallet's Hyperliquid balance.`);
  return isDeposit ? `Put $${usd.toFixed(2)} into HLP.` : `Took $${usd.toFixed(2)} out of HLP.`;
}
