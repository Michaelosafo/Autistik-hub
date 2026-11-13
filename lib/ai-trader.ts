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
import { tgaWatch } from "@/lib/tg-account";
import { GAS_KEEP as CHAIN_GAS, LIVE_CHAINS, NATIVE, chainBalance, isLiveChain, liveBuyOn, liveSellOn, nativeUsd, relayBridge, relayBridgeQuote, walletAddress, type LiveChain, type Wallets, tokenBalanceOn } from "@/lib/ai-trader-chains";
import { Keypair } from "@solana/web3.js";

export const TRADE_CHAINS = ["bsc", "ethereum", "robinhood", "elysium", "solana"] as const;
export type TradeChain = (typeof TRADE_CHAINS)[number];
const CHAIN_NAME: Record<string, string> = { bsc: "BNB Chain", ethereum: "Ethereum", robinhood: "Robinhood Chain", elysium: "Elysium", solana: "Solana" };

export type Settings = {
  enabled: boolean; mode: "paper" | "live"; chains: TradeChain[]; need_socials: boolean; paper_cash: number; paper_start: number; per_trade: number; max_positions: number;
  min_liquidity: number; max_tax: number; min_age_hours: number; stop_loss: number; take_profit: number; trail: number;
  max_hold_hours: number; daily_loss_limit: number; use_ai: boolean; last_run: string; last_note: string | null;
  manual_active: boolean; away_take_profit: number; admin_seen_at: string | null;
  hype_on: boolean; dip_on: boolean; mcap_min: number; mcap_max: number; micro_min_liq: number; target_profit: number; strat_stop: number;
  signals_on: boolean; callers: string[]; caller_mcap_max: number; x_since: string | null; per_trade_usd: number;
  copy_on: boolean; copy_tp: number; copy_sl: number; copy_fresh_min: number; copy_max_age_h: number; copy_max_pump: number; tg_user_id: number | null; tg_username: string | null; x_username: string | null;
  trade_mode: "telegram" | "both" | "x" | "general"; rebuy_on: boolean; rebuy_dump: number; rebuy_tp: number;
  live_chains: LiveChain[]; copy_check: boolean; use_tg: boolean; use_x: boolean; use_general: boolean; callers_only: boolean;
  buy_hours_on: boolean; buy_from: string; buy_to: string; buy_tz: string;
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
// Decoded wallets, reused only while the saved key is unchanged. The key itself is read from Vault every time, so an
// import or a new wallet is picked up at once by every server, never an old wallet kept in memory.
const wallets = new Map<number, { key: string; a: ReturnType<typeof privateKeyToAccount> }>();
const envKey = () => (T() === 1 ? process.env.AI_TRADER_KEY?.trim() || "" : "");
export async function traderAccount() {
  let k = envKey();
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) {
    const { data } = await supabaseService().rpc("ai_trader_key_get_for", { p_trader: T() });
    k = typeof data === "string" ? data : "";
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) return null;
  const have = wallets.get(T());
  if (have && have.key === k) return have.a;
  const a = privateKeyToAccount(k as `0x${string}`);
  wallets.set(T(), { key: k, a });
  return a;
}

// Each trader's Solana wallet (optional), kept in Vault like the EVM one.
const solWallets = new Map<number, { key: string; kp: Keypair }>();
export async function solAccount(): Promise<Keypair | null> {
  const { data } = await supabaseService().rpc("ai_trader_sol_key_get_for", { p_trader: T() });
  if (typeof data !== "string" || !data.startsWith("[")) return null;
  const have = solWallets.get(T());
  if (have && have.key === data) return have.kp;
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(data)));
  solWallets.set(T(), { key: data, kp });
  return kp;
}
export async function createSolWallet(): Promise<string> {
  if (await solAccount()) throw new Error("This trader already has a Solana wallet.");
  const kp = Keypair.generate();
  const { error } = await supabaseService().rpc("ai_trader_sol_key_set_for", { p_trader: T(), p_key: JSON.stringify(Array.from(kp.secretKey)), p_replace: false });
  if (error) throw new Error(error.message);
  solWallets.delete(T());
  await log("settings", `Solana trading wallet created: ${kp.publicKey.toBase58()}`);
  return kp.publicKey.toBase58();
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(t: string) {
  let v = 0n;
  for (const ch of t) { const i = B58.indexOf(ch); if (i < 0) throw new Error("bad"); v = v * 58n + BigInt(i); }
  const out: number[] = [];
  while (v > 0n) { out.unshift(Number(v % 256n)); v /= 256n; }
  for (const ch of t) { if (ch !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}

/**
 * Use your own Solana wallet: paste its private key as Phantom / Solflare export it (a long base58 string) or as the
 * 64-number list. Only while the current Solana trading wallet is empty and no live Solana coin is open.
 */
export async function importSolKey(raw: string): Promise<string> {
  const t = raw.trim();
  let bytes: Uint8Array;
  try { bytes = t.startsWith("[") ? Uint8Array.from(JSON.parse(t)) : b58(t); } catch { throw new Error("That isn't a Solana private key. Copy it from Phantom or Solflare: Settings → Show private key."); }
  if (bytes.length !== 64) throw new Error("That isn't a full Solana private key (it should be the long key Phantom or Solflare shows).");
  let kp: Keypair;
  try { kp = Keypair.fromSecretKey(bytes); } catch { throw new Error("That private key isn't valid."); }
  const { data: openSol } = await tq("ai_trader_positions").select("id").eq("mode", "live").eq("chain", "solana").in("status", ["open", "closing"]).limit(1);
  if (openSol?.length) throw new Error("Sell the open live Solana coins first.");
  const cur = await solAccount();
  if (cur && cur.publicKey.toBase58() !== kp.publicKey.toBase58()) {
    const sol = await chainBalance("solana", { evm: null, sol: cur }).catch(() => 0);
    if (sol > 0.002) throw new Error(`The current Solana trading wallet still holds ${sol.toFixed(4)} SOL. Move it out first (show its private key and import it into Phantom), so nothing is left behind.`);
  }
  const { error } = await supabaseService().rpc("ai_trader_sol_key_set_for", { p_trader: T(), p_key: JSON.stringify(Array.from(kp.secretKey)), p_replace: true });
  if (error) throw new Error(error.message);
  solWallets.delete(T());
  await log("settings", `Solana trading now uses your own wallet: ${kp.publicKey.toBase58()}`);
  return kp.publicKey.toBase58();
}

/** The Solana wallet's secret key as the 64-number list Phantom / Solflare accept when importing a private key. */
export async function revealSolKey(): Promise<string> {
  const kp = await solAccount();
  if (!kp) throw new Error("There's no Solana wallet yet.");
  await log("settings", "The Solana wallet's private key was viewed.");
  return JSON.stringify(Array.from(kp.secretKey));
}
// ---- Wallet 2: a second wallet per network, funded separately. On every copy call both wallets buy.
// Always your own wallet (you paste its private key); kept encrypted in Vault like wallet 1.
const w2Cache = new Map<string, { key: string; evm?: ReturnType<typeof privateKeyToAccount>; sol?: Keypair }>();
async function wallet2(): Promise<Wallets> {
  const sb = supabaseService();
  const [{ data: ek }, { data: sk }] = await Promise.all([
    sb.rpc("ai_trader_w2_get", { p_trader: T(), p_kind: "evm" }),
    sb.rpc("ai_trader_w2_get", { p_trader: T(), p_kind: "sol" }),
  ]);
  let evm: ReturnType<typeof privateKeyToAccount> | null = null, sol: Keypair | null = null;
  if (typeof ek === "string" && /^0x[0-9a-fA-F]{64}$/.test(ek)) {
    const c = w2Cache.get(`e${T()}`);
    evm = c?.key === ek && c.evm ? c.evm : privateKeyToAccount(ek as `0x${string}`);
    w2Cache.set(`e${T()}`, { key: ek, evm });
  }
  if (typeof sk === "string" && sk.startsWith("[")) {
    const c = w2Cache.get(`s${T()}`);
    sol = c?.key === sk && c.sol ? c.sol : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(sk)));
    w2Cache.set(`s${T()}`, { key: sk, sol });
  }
  return { evm, sol };
}
const myWallets = async (slot = 1): Promise<Wallets> => (slot === 2 ? wallet2() : { evm: await traderAccount(), sol: await solAccount() });

/** Add (or replace) wallet 2 for BNB-family networks ("evm") or Solana ("sol") from its private key. */
export async function setWallet2(kind: "evm" | "sol", raw: string): Promise<string> {
  const t = raw.trim();
  let key: string, address: string;
  if (kind === "evm") {
    key = t.startsWith("0x") ? t : `0x${t}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("That isn't a private key (64 letters and numbers, from your wallet's Export private key).");
    address = privateKeyToAccount(key as `0x${string}`).address;
  } else {
    let bytes: Uint8Array;
    try { bytes = t.startsWith("[") ? Uint8Array.from(JSON.parse(t)) : b58(t); } catch { throw new Error("That isn't a Solana private key. Copy it from Phantom or Solflare: Settings → Show private key."); }
    if (bytes.length !== 64) throw new Error("That isn't a full Solana private key.");
    let kp: Keypair;
    try { kp = Keypair.fromSecretKey(bytes); } catch { throw new Error("That private key isn't valid."); }
    key = JSON.stringify(Array.from(kp.secretKey)); address = kp.publicKey.toBase58();
  }
  const w1 = await myWallets(1);
  if ((kind === "evm" ? w1.evm?.address : w1.sol?.publicKey.toBase58()) === address) throw new Error("That's already Wallet 1. Use a different wallet for Wallet 2.");
  await removeWallet2Check(kind);
  const { error } = await supabaseService().rpc("ai_trader_w2_set", { p_trader: T(), p_kind: kind, p_key: key });
  if (error) throw new Error(error.message);
  await log("settings", `Wallet 2 (${kind === "sol" ? "Solana" : "BNB Chain & other EVM"}) set: ${address}`);
  return address;
}
async function removeWallet2Check(kind: "evm" | "sol") {
  const q = tq("ai_trader_positions").select("id").eq("mode", "live").eq("wallet", 2).in("status", ["open", "closing"]);
  const { data } = await (kind === "sol" ? q.eq("chain", "solana") : q.neq("chain", "solana")).limit(1);
  if (data?.length) throw new Error("Wallet 2 still has open live coins on this network. Let them sell (or close them) first.");
}
/** Stop using wallet 2 for a network (the wallet itself and its money stay yours, untouched). */
export async function removeWallet2(kind: "evm" | "sol") {
  await removeWallet2Check(kind);
  const { error } = await supabaseService().rpc("ai_trader_w2_set", { p_trader: T(), p_kind: kind, p_key: null });
  if (error) throw new Error(error.message);
  await log("settings", `Wallet 2 (${kind === "sol" ? "Solana" : "BNB Chain & other EVM"}) removed.`);
}
/** Wallet 2 on each live chain: address and balance (for the page). */
export async function liveWallets2(s: Settings) {
  const w = await wallet2();
  return Promise.all(LIVE_CHAINS.map(async (chain) => ({
    chain, native: NATIVE[chain], on: s.live_chains.includes(chain), address: walletAddress(chain, w),
    balance: walletAddress(chain, w) ? await chainBalance(chain, w).catch(() => null) : null,
  })));
}
/** The chains this trader buys on: in live mode the ones switched on for live trading, in practice all its chains. */
export const tradeChains = (s: Settings): string[] => (s.mode === "live" ? s.live_chains : s.chains);

/** Each live chain: wallet address and balance in its own coin (for the page). */
export async function liveWallets(s: Settings) {
  const w = await myWallets();
  return Promise.all(LIVE_CHAINS.map(async (chain) => ({
    chain, native: NATIVE[chain], on: s.live_chains.includes(chain), address: walletAddress(chain, w),
    balance: walletAddress(chain, w) ? await chainBalance(chain, w).catch(() => null) : null,
  })));
}

/** Owner: makes the live trading wallet (once). Returns its address to send BNB to. */
export async function createTraderWallet(): Promise<string> {
  if (await traderAccount()) throw new Error("The AI trader already has a wallet.");
  const key = generatePrivateKey();
  const { error } = await supabaseService().rpc("ai_trader_key_set_for", { p_trader: T(), p_key: key, p_replace: false });
  if (error) throw new Error(error.message);
  const a = privateKeyToAccount(key);
  wallets.delete(T());
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
  wallets.delete(T());
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
  for (const k of ["paper_cash", "paper_start", "per_trade", "min_liquidity", "max_tax", "min_age_hours", "stop_loss", "take_profit", "trail", "max_hold_hours", "daily_loss_limit", "away_take_profit", "mcap_min", "mcap_max", "micro_min_liq", "target_profit", "strat_stop", "caller_mcap_max", "per_trade_usd", "copy_tp", "copy_sl", "rebuy_dump", "rebuy_tp", "copy_fresh_min", "copy_max_age_h", "copy_max_pump"]) s[k] = n(s[k]);
  if (!["telegram", "both", "x", "general"].includes(s.trade_mode)) s.trade_mode = "telegram";
  s.rebuy_on = s.rebuy_on !== false;
  s.copy_check = s.copy_check === true;
  s.callers_only = s.callers_only === true;
  s.use_tg = s.use_tg !== false; s.use_x = s.use_x === true; s.use_general = s.use_general === true;
  s.live_chains = (Array.isArray(s.live_chains) ? s.live_chains : ["bsc"]).filter((c: string) => isLiveChain(c));
  if (!s.live_chains.length) s.live_chains = ["bsc"];
  s.copy_on = s.copy_on !== false;
  s.callers = Array.isArray(s.callers) ? s.callers : [];
  s.chains = (Array.isArray(s.chains) ? s.chains : ["bsc"]).filter((c: string) => (TRADE_CHAINS as readonly string[]).includes(c));
  if (!s.chains.includes("bsc")) s.chains.unshift("bsc");
  s.need_socials = s.need_socials !== false;
  s.buy_hours_on = s.buy_hours_on === true;
  s.buy_from = /^\d{2}:\d{2}$/.test(String(s.buy_from || "")) ? s.buy_from : "00:00";
  s.buy_to = /^\d{2}:\d{2}$/.test(String(s.buy_to || "")) ? s.buy_to : "23:59";
  s.buy_tz = typeof s.buy_tz === "string" && s.buy_tz ? s.buy_tz : "UTC";
  return s as Settings;
}

export async function bnbUsd() {
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
    let receivedNative: number | null = null;
    if (p.mode === "paper") {
      if (!price) throw new Error("No price to sell at.");
      received = (n(p.qty) * price * (1 - tax / 100 - (p.strategy ? 0.03 : PAPER_SLIP))) / (await bnbUsd());
      const s = await getSettings();
      await sb.from("ai_trader_settings").update({ paper_cash: s.paper_cash + Math.max(0, received) }).eq("id", T());
    } else {
      // Live on any chain: sold for that chain's coin, counted in BNB terms like the buy.
      if (!isLiveChain(p.chain)) throw new Error(`Live selling isn't set up for ${p.chain}.`);
      // A stop-loss or rug exit in a crashing coin: if the normal sell is refused (price moved too fast), try again at
      // once allowing 15%, then 35%, then 49% slippage. Getting out beats waiting a minute while it falls further.
      const urgent = /^(Stop-loss|Liquidity|Trailing|Closed by admin|Cancelled)/.test(reason);
      const w = await myWallets(n((p as any).wallet) === 2 ? 2 : 1);
      let r: Awaited<ReturnType<typeof liveSellOn>> | null = null, last: unknown = null;
      for (const extra of urgent ? [0, 1200, 3200, 4600] : [0]) {
        try { r = await liveSellOn(p.chain, w, p.token, BigInt(p.amount_raw || "0"), tax, extra); break; }
        catch (e) { last = e; if (/holds none/i.test(String((e as Error)?.message))) break; }
      }
      if (!r && /holds none/i.test(String((last as Error)?.message)) && price) {
        // The coins are already gone: an earlier sell went through after it was reported as failed (busy network).
        // Close the trade (amount back worked out from the price) instead of retrying a sell of nothing forever.
        received = (n(p.qty) * price * (1 - tax / 100)) / (await bnbUsd());
        reason = `${reason} (the sell went through earlier; amount back estimated)`;
      } else {
        if (!r) throw last instanceof Error ? last : new Error("The sell didn't go through.");
        receivedNative = r.receivedNative; sellTx = r.hash;
        received = p.chain === "bsc" ? r.receivedNative : (r.receivedNative * (await nativeUsd(p.chain))) / (await bnbUsd());
        // Sold, but the amount back wasn't reported: work it out from the price.
        if (!(received > 0) && price) { received = (n(p.qty) * price * (1 - tax / 100)) / (await bnbUsd()); receivedNative = null; reason = `${reason} (amount back estimated)`; }
      }
    }
    const pnl = received - n(p.spent);
    await tq("ai_trader_positions").update({
      status: "closed", received, received_native: receivedNative, pnl, pnl_pct: n(p.spent) ? (pnl / n(p.spent)) * 100 : null, close_reason: reason, sell_tx: sellTx,
      last_usd: price, closed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", p.id);
    if (p.strategy === "copy" && p.new_project && reason.startsWith("Take profit") && price) await startRebuyWatch(p, price).catch(() => {});
    if (p.strategy === "copy" || p.strategy === "rebuy") await tgNotify(`${pnl >= 0 ? "✅" : "🔻"} Sold ${p.symbol}${n((p as any).wallet) === 2 ? " (Wallet 2)" : ""} (${reason}): ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} BNB (${n(p.spent) ? ((pnl / n(p.spent)) * 100).toFixed(1) : "0"}%)${p.mode === "paper" ? " · practice" : ""}.`);
    await log(pnl >= 0 ? "win" : "loss", `Sold ${p.symbol} on ${CHAIN_NAME[p.chain] || p.chain} (${reason}): ${received.toFixed(4)} BNB back for ${n(p.spent).toFixed(4)} in, ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} BNB (${n(p.spent) ? ((pnl / n(p.spent)) * 100).toFixed(1) : "0"}%).`);
  } catch (e) {
    await tq("ai_trader_positions").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", p.id);
    await log("error", `Couldn't sell ${p.symbol}: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------- Buy hours, buy more, sell part

const hm = (t: string) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : null; };
/**
 * Inside the hours you let it buy (always true when Buy hours is off). The times are in your own time zone, and a
 * window like 22:00 to 06:00 runs past midnight. Selling is never limited: stop-loss and take profit work all day.
 */
export function inBuyHours(s: Settings, at = new Date()): boolean {
  if (!s.buy_hours_on) return true;
  const from = hm(s.buy_from), to = hm(s.buy_to);
  if (from == null || to == null || from === to) return true;
  let local: string;
  try { local = new Intl.DateTimeFormat("en-GB", { timeZone: s.buy_tz || "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at); }
  catch { local = at.toISOString().slice(11, 16); }
  const now = hm(local) ?? 0;
  return from < to ? now >= from && now < to : now >= from || now < to;
}
export const buyHoursText = (s: Settings) => `${s.buy_from} to ${s.buy_to}`;

const nowIso = () => new Date().toISOString();

/**
 * Buys more of a coin it already holds (practice or live, from the wallet that bought it). The extra coins join the
 * same trade: amount, cost and average buy price are updated, and its stop-loss / take profit now count from that
 * average.
 */
export async function topUpPosition(p: Position, usd: number): Promise<string> {
  if (!(usd > 0)) throw new Error("Enter how many dollars to add.");
  const { data: claimed } = await tq("ai_trader_positions").update({ status: "closing", updated_at: nowIso() }).eq("id", p.id).eq("status", "open").select("id");
  if (!claimed?.length) throw new Error(`${p.symbol} is being sold right now, so it can't be topped up.`);
  const slot = n((p as any).wallet) === 2 ? 2 : 1;
  let bought = false;
  try {
    const bnb = await bnbUsd();
    const { price } = await priceOf(p.chain, p.token);
    if (!price) throw new Error("No price for this coin right now.");
    const tax = (await riskFor(p.chain, p.token).catch(() => null))?.buyTax ?? 0;
    let addQty: number, addRaw = 0n, addSpent: number, addNative: number | null = null, tx: string | null = null;
    if (p.mode === "live") {
      if (!isLiveChain(p.chain)) throw new Error(`Live buying isn't set up for ${CHAIN_NAME[p.chain] || p.chain}.`);
      const chain = p.chain as LiveChain;
      const w = await myWallets(slot);
      const nUsd = await nativeUsd(chain);
      const free = Math.max(0, (await chainBalance(chain, w)) - CHAIN_GAS[chain]);
      const amount = +(usd / nUsd).toFixed(chain === "solana" ? 6 : 8);
      if (amount > free) throw new Error(`Not enough ${NATIVE[chain]}: ${free.toFixed(4)} free (about $${(free * nUsd).toFixed(2)}).`);
      const r = await liveBuyOn(chain, w, p.token, amount, tax);
      if (r.raw <= 0n) throw new Error("The swap went through but no tokens arrived.");
      bought = true;
      addRaw = r.raw; addQty = Number(r.raw) / 10 ** (r.decimals ?? p.decimals); tx = r.hash; addNative = amount;
      addSpent = +((amount * nUsd) / bnb).toFixed(6);
    } else {
      addSpent = +(usd / bnb).toFixed(6);
      const fresh = await getSettings();
      if (fresh.paper_cash < addSpent) throw new Error(`Not enough practice BNB (${fresh.paper_cash.toFixed(4)} free).`);
      addQty = (usd * (1 - tax / 100 - PAPER_SLIP)) / price;
      await supabaseService().from("ai_trader_settings").update({ paper_cash: fresh.paper_cash - addSpent }).eq("id", T());
      bought = true;
    }
    const oldQty = n(p.qty), qty = oldQty + addQty;
    const entry = qty > 0 ? (oldQty * n(p.entry_usd) + addQty * price) / qty : price;
    const sn = (p as any).spent_native;
    const { data: saved } = await tq("ai_trader_positions").update({
      status: "open", qty, spent: n(p.spent) + addSpent, entry_usd: entry, last_usd: price, updated_at: nowIso(),
      amount_raw: p.mode === "live" ? (BigInt(p.amount_raw || "0") + addRaw).toString() : p.amount_raw,
      spent_native: sn != null || addNative != null ? n(sn) + (addNative ?? 0) : null,
    }).eq("id", p.id).eq("status", "closing").select("id");
    if (!saved?.length) {
      await log("error", `Bought more ${p.symbol}${tx ? ` (tx ${tx.slice(0, 10)}…)` : ""} but the trade was sold meanwhile: the extra coins are in the wallet, not managed by the bot.`);
      throw new Error(`${p.symbol} was sold while buying more. The extra coins are in the wallet.`);
    }
    await log("buy", `➕ Bought more ${p.symbol}: $${usd.toFixed(2)}${addNative != null ? ` (${addNative} ${NATIVE[p.chain as LiveChain] || ""})` : " (practice)"}. Average buy price now $${entry.toPrecision(4)}.`);
    return `Bought $${usd.toFixed(2)} more ${p.symbol}.`;
  } catch (e) {
    if (!bought) await tq("ai_trader_positions").update({ status: "open", updated_at: nowIso() }).eq("id", p.id).eq("status", "closing");
    throw e;
  }
}

/**
 * Sells part of a coin (1–99%; 100% is a normal sell). The sold part is saved as its own closed trade, so the profit
 * and history add up; the rest stays open with the same stop-loss and take profit.
 */
export async function sellPart(p: Position, pct: number): Promise<string> {
  const f = Math.min(100, Math.max(1, Math.round(pct))) / 100;
  if (f >= 1) { await closePosition(p, "Closed by admin"); return `${p.symbol}: selling all of it.`; }
  const { data: claimed } = await tq("ai_trader_positions").update({ status: "closing", updated_at: nowIso() }).eq("id", p.id).eq("status", "open").select("id");
  if (!claimed?.length) throw new Error(`${p.symbol} is already being sold.`);
  const slot = n((p as any).wallet) === 2 ? 2 : 1;
  let sold = false;
  try {
    const tax = (await riskFor(p.chain, p.token).catch(() => null))?.sellTax ?? 0;
    const price = (await priceOf(p.chain, p.token)).price;
    const bnb = await bnbUsd();
    let received: number, receivedNative: number | null = null, sellTx: string | null = null, soldRaw = 0n;
    if (p.mode === "paper") {
      if (!price) throw new Error("No price to sell at.");
      received = (n(p.qty) * f * price * (1 - tax / 100 - PAPER_SLIP)) / bnb;
      const s = await getSettings();
      await supabaseService().from("ai_trader_settings").update({ paper_cash: s.paper_cash + Math.max(0, received) }).eq("id", T());
    } else {
      if (!isLiveChain(p.chain)) throw new Error(`Live selling isn't set up for ${CHAIN_NAME[p.chain] || p.chain}.`);
      soldRaw = (BigInt(p.amount_raw || "0") * BigInt(Math.round(f * 10_000))) / 10_000n;
      if (soldRaw <= 0n) throw new Error("Nothing to sell.");
      const r = await liveSellOn(p.chain, await myWallets(slot), p.token, soldRaw, tax, 0);
      receivedNative = r.receivedNative; sellTx = r.hash;
      received = p.chain === "bsc" ? r.receivedNative : (r.receivedNative * (await nativeUsd(p.chain))) / bnb;
    }
    sold = true;
    const keep = 1 - f, sn = (p as any).spent_native;
    // The part still held first: this is what the bot keeps managing.
    await tq("ai_trader_positions").update({
      status: "open", qty: n(p.qty) * keep, spent: n(p.spent) * keep, spent_native: sn != null ? n(sn) * keep : null,
      amount_raw: p.mode === "live" ? (BigInt(p.amount_raw || "0") - soldRaw).toString() : p.amount_raw,
      last_usd: price ?? p.last_usd, updated_at: nowIso(),
    }).eq("id", p.id).eq("status", "closing");
    const partSpent = n(p.spent) * f, pnl = received - partSpent;
    const { id: _id, ...rest } = p as any;
    const { error } = await tq("ai_trader_positions").insert({
      ...rest, status: "closed", spent: partSpent, qty: n(p.qty) * f, spent_native: sn != null ? n(sn) * f : null,
      amount_raw: p.mode === "live" ? soldRaw.toString() : null, received, received_native: receivedNative, pnl,
      pnl_pct: partSpent ? (pnl / partSpent) * 100 : null, close_reason: `Sold ${Math.round(f * 100)}% by admin`, sell_tx: sellTx,
      last_usd: price, closed_at: nowIso(), updated_at: nowIso(),
    });
    if (error) await log("error", `Sold part of ${p.symbol} but couldn't save the record: ${error.message}`);
    await log(pnl >= 0 ? "win" : "loss", `Sold ${Math.round(f * 100)}% of ${p.symbol}: ${received.toFixed(4)} BNB back for ${partSpent.toFixed(4)} in, ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} BNB. The rest stays open.`);
    return `Sold ${Math.round(f * 100)}% of ${p.symbol}.`;
  } catch (e) {
    if (!sold) await tq("ai_trader_positions").update({ status: "open", updated_at: nowIso() }).eq("id", p.id).eq("status", "closing");
    else await log("error", `Sold part of ${p.symbol} but couldn't update the trade: ${(e as Error).message}`);
    throw e;
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

/**
 * Buys that weren't confirmed in time: if the coins are in the wallet after all, record the trade (at the price it was
 * bought at) so the stop-loss / take profit manage it straight away. Nothing found after 6 hours: forget it.
 */
async function adoptPending() {
  const { data } = await tq("ai_trader_pending").select("*").order("created_at").limit(20);
  for (const q of (data || []) as any[]) {
    const old = Date.now() - Date.parse(q.created_at) > 6 * 36e5;
    try {
      if (!isLiveChain(q.chain)) { await tq("ai_trader_pending").delete().eq("id", q.id); continue; }
      const { data: have } = await tq("ai_trader_positions").select("id").eq("chain", q.chain).eq("token", q.token).in("status", ["open", "closing"]).limit(1);
      if (have?.length) { await tq("ai_trader_pending").delete().eq("id", q.id); continue; }
      const w = await myWallets(q.wallet === 2 ? 2 : 1);
      const bal = await tokenBalanceOn(q.chain as LiveChain, w, q.token);
      if (bal.raw <= 0n) { if (old) await tq("ai_trader_pending").delete().eq("id", q.id); continue; }
      // Today's price and market cap: the buy price is the one it was bought at, or worked out from the market cap then.
      const d = await fetch(`https://api.dexscreener.com/tokens/v1/${q.chain}/${q.token}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => []);
      const pair = (Array.isArray(d) ? d : []).sort((a: any, b: any) => n(b?.liquidity?.usd) - n(a?.liquidity?.usd))[0];
      const now = n(pair?.priceUsd), capNow = n(pair?.marketCap) || n(pair?.fdv);
      if (!now) continue;
      const entry = n(q.entry_usd) || (n(q.entry_mcap) && capNow ? (now * n(q.entry_mcap)) / capNow : now);
      const qty = Number(bal.raw) / 10 ** bal.decimals;
      const bnb = await bnbUsd();
      const spent = q.spent_native ? (n(q.spent_native) * (await nativeUsd(q.chain as LiveChain))) / bnb : (qty * entry) / bnb;
      const { error } = await tq("ai_trader_positions").insert({
        mode: "live", native: q.native || NATIVE[q.chain as LiveChain], spent_native: q.spent_native ?? null, chain: q.chain, token: q.token, symbol: q.symbol || pair?.baseToken?.symbol || null, name: q.name || pair?.baseToken?.name || null, logo: q.logo || pair?.info?.imageUrl || null,
        spent: +spent.toFixed(6), qty, amount_raw: bal.raw.toString(), decimals: bal.decimals,
        entry_usd: entry, high_usd: Math.max(entry, now), last_usd: now, low_usd: Math.min(entry, now), stop_loss: n(q.sl), take_profit: n(q.tp), trail: 0,
        why: `Recovered: the buy went through after it was marked failed. ${q.why || ""}`.slice(0, 500), buy_tx: "unconfirmed", strategy: q.strategy || "copy", wallet: q.wallet === 2 ? 2 : 1,
        source_group: q.source_group, source_who: q.source_who,
      });
      if (error) { await log("error", `Found ${q.symbol || q.token} in the wallet but couldn't record it: ${error.message}`); continue; }
      await tq("ai_trader_pending").delete().eq("id", q.id);
      // You pressed "Sell all now" on it: sell it as soon as it's recorded.
      if (/sold by admin/i.test(String(q.why || ""))) {
        const { data: got } = await tq("ai_trader_positions").select("*").eq("chain", q.chain).eq("token", q.token).eq("status", "open").limit(1);
        if (got?.[0]) await closePosition(got[0] as Position, "Closed by admin", now);
        continue;
      }
      const ch = (now / entry - 1) * 100;
      await log("buy", `🛟 Found ${q.symbol || pair?.baseToken?.symbol || "a coin"} in the wallet: that buy went through after all. It's now a normal trade (${ch >= 0 ? "+" : ""}${ch.toFixed(1)}% since the buy), with stop-loss -${n(q.sl)}% and take profit +${n(q.tp)}%.`);
      await tgNotify(`🛟 ${q.symbol || "A coin"}: the buy went through after all (it was marked failed). Now watched: sells at -${n(q.sl)}% or +${n(q.tp)}%.`).catch(() => {});
    } catch (e) { await log("error", `Couldn't check the wallet for ${q.symbol || q.token}: ${(e as Error).message.slice(0, 120)}`); }
  }
}

export type Holding = { chain: LiveChain; token: string; symbol: string | null; logo: string | null; slot: number; amount: number; usd: number | null; price: number | null; tracked: boolean };

/**
 * Every coin actually in the trading wallets right now (Solana: the whole wallet; other chains: any coin it traded or
 * was called in the last 3 days), with today's value and whether a trade is watching it. Coins that are there but not
 * tracked (a buy that landed after it was reported as failed, or one bought by hand) can then get a stop-loss or be sold.
 */
/**
 * The coins this trader bought or tried to buy (trades, buys reported as failed, recoveries) in the last 30 days.
 * Only these are ever shown or sellable from the wallet card: anything else in the wallet (often spam airdropped to
 * wallets to lure people into approving a scam) is left alone.
 */
async function ownCoins(): Promise<Set<string>> {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data: pos }, { data: pend }, { data: sig }] = await Promise.all([
    tq("ai_trader_positions").select("chain,token").gte("opened_at", since).limit(2000),
    tq("ai_trader_pending").select("chain,token").limit(200),
    tq("ai_trader_signals").select("chain,token").gte("at", since).or(`result.like.bought*,result.like."skipped: buy failed*"`).limit(2000),
  ]);
  return new Set(([...(pos || []), ...(pend || []), ...(sig || [])] as any[]).map((r) => `${r.chain}:${String(r.token).toLowerCase()}`));
}
export const isOwnCoin = async (chain: string, token: string) => (await ownCoins()).has(`${chain}:${token.toLowerCase()}`);

export async function walletHoldings(): Promise<Holding[]> {
  const out: Holding[] = [];
  const own = await ownCoins();
  const { data: open } = await tq("ai_trader_positions").select("chain,token,wallet").in("status", ["open", "closing"]);
  const watched = new Set(((open || []) as any[]).map((p) => `${p.chain}:${String(p.token).toLowerCase()}:${n(p.wallet) === 2 ? 2 : 1}`));
  for (const slot of [1, 2]) {
    const w = await myWallets(slot).catch(() => null);
    if (!w) continue;
    // Solana: Jupiter lists every coin the wallet holds (the free Solana RPC refuses that lookup).
    const sol = w.sol ? w.sol.publicKey.toBase58() : null;
    if (sol) {
      const h = await fetch(`https://lite-api.jup.ag/ultra/v1/holdings/${sol}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
      for (const [mint, accs] of Object.entries((h?.tokens || {}) as Record<string, any[]>)) {
        const amount = (accs || []).reduce((a, x) => a + (Number(x?.uiAmount) || 0), 0);
        if (amount > 0 && own.has(`solana:${mint.toLowerCase()}`)) out.push({ chain: "solana", token: mint, symbol: null, logo: null, slot, amount, usd: null, price: null, tracked: watched.has(`solana:${mint.toLowerCase()}:${slot}`) });
      }
    }
    // EVM chains: the coins it traded or was called recently.
    if (w.evm) {
      const since = new Date(Date.now() - 3 * 864e5).toISOString();
      const [{ data: sigs }, { data: pos }] = await Promise.all([
        tq("ai_trader_signals").select("chain,token").neq("chain", "solana").gte("at", since).limit(200),
        tq("ai_trader_positions").select("chain,token").neq("chain", "solana").gte("opened_at", since).limit(200),
      ]);
      const seen = new Set<string>();
      for (const r of [...(sigs || []), ...(pos || [])] as any[]) {
        const k = `${r.chain}:${String(r.token).toLowerCase()}`;
        if (seen.has(k) || !isLiveChain(r.chain) || r.chain === "solana" || !own.has(k)) continue;
        seen.add(k);
        const b = await tokenBalanceOn(r.chain as LiveChain, w, r.token).catch(() => null);
        if (b && b.raw > 0n) out.push({ chain: r.chain, token: r.token, symbol: null, logo: null, slot, amount: Number(b.raw) / 10 ** b.decimals, usd: null, price: null, tracked: watched.has(`${k}:${slot}`) });
      }
    }
  }
  // Names, logos and values from DexScreener.
  const byChain = new Map<string, Holding[]>();
  for (const h of out) byChain.set(h.chain, [...(byChain.get(h.chain) || []), h]);
  for (const [chain, list] of byChain) {
    for (let i = 0; i < list.length; i += 30) {
      const part = list.slice(i, i + 30);
      const d = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${part.map((h) => h.token).join(",")}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => []);
      for (const h of part) {
        const pair = (Array.isArray(d) ? d : []).filter((x: any) => String(x?.baseToken?.address || "").toLowerCase() === h.token.toLowerCase()).sort((a: any, b: any) => n(b?.liquidity?.usd) - n(a?.liquidity?.usd))[0];
        if (!pair) continue;
        h.symbol = pair.baseToken?.symbol || null; h.logo = pair.info?.imageUrl || null; h.price = n(pair.priceUsd) || null;
        h.usd = h.price ? h.price * h.amount : null;
      }
    }
  }
  return out.filter((h) => h.usd == null || h.usd >= 0.05).sort((a, b) => Number(a.tracked) - Number(b.tracked) || (b.usd || 0) - (a.usd || 0));
}

/** Start watching a coin that's in the wallet but not tracked: a trade from today's price, with this stop-loss / take profit. */
export async function adoptCoin(chain: LiveChain, token: string, slot: number, sl: number, tp: number, sellNow = false): Promise<string> {
  await tq("ai_trader_pending").upsert({ chain, token, wallet: slot === 2 ? 2 : 1, sl, tp, why: sellNow ? "Found in the wallet; sold by admin." : "Found in the wallet; watched from here.", strategy: "copy", created_at: new Date().toISOString() }, { onConflict: "trader_id,chain,token,wallet" });
  await adoptPending();
  const { data } = await tq("ai_trader_positions").select("*").eq("chain", chain).eq("token", token).in("status", ["open", "closing"]).limit(1);
  const p = (data || [])[0] as Position | undefined;
  if (!p && sellNow) {
    const { data: sold } = await tq("ai_trader_positions").select("symbol,status,close_reason").eq("chain", chain).eq("token", token).eq("status", "closed").gte("closed_at", new Date(Date.now() - 5 * 60_000).toISOString()).limit(1);
    if (sold?.[0]) return `Sold ${(sold[0] as any).symbol || "it"}.`;
    const { data: err } = await tq("ai_trader_log").select("text").eq("kind", "error").gte("at", new Date(Date.now() - 2 * 60_000).toISOString()).order("at", { ascending: false }).limit(1);
    throw new Error((err?.[0] as any)?.text || "Couldn't sell it yet. The bot keeps trying every minute.");
  }
  if (!p) throw new Error("Couldn't read that coin in the wallet (no price yet?). Try again in a minute.");
  if (sellNow) {
    await closePosition(p, "Closed by admin");
    const { data: after } = await tq("ai_trader_positions").select("status").eq("id", p.id).maybeSingle();
    if ((after as any)?.status === "closed") return `Sold ${p.symbol || "it"}.`;
    const { data: err } = await tq("ai_trader_log").select("text").eq("kind", "error").gte("at", new Date(Date.now() - 2 * 60_000).toISOString()).order("at", { ascending: false }).limit(1);
    throw new Error(`${(err?.[0] as any)?.text || "The sell didn't go through."} It's now watched with a stop-loss, and you can press Sell again.`);
  }
  return `${p.symbol || "It"} is now watched: sells at -${sl}% or +${tp}%.`;
}

async function manage(s: Settings) {
  await adoptPending().catch(() => {});
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
    const low = Math.min(n((p as any).low_usd) || n(p.entry_usd) || price, price);
    await tq("ai_trader_positions").update({ last_usd: price, high_usd: high, low_usd: low, updated_at: new Date().toISOString() }).eq("id", p.id);
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
  o: { sl: number; tp: number; why: string; strategy: string; trail?: number; usd?: number | null; newProject?: boolean; src?: { group: string; who: string | null; sharedAt?: number }; slot?: number }) {
  const slot = o.slot === 2 ? 2 : 1;
  const sb = supabaseService();
  const bnb = await bnbUsd();
  const live = s.mode === "live" && isLiveChain(c.chain) && s.live_chains.includes(c.chain);
  // A caller with their own size buys that many dollars' worth; everyone else uses the normal trade size.
  let spend = Math.min(o.usd && o.usd > 0 ? +(o.usd / bnb).toFixed(6) : await tradeSize(s), live ? Infinity : cash);
  let qty: number, raw: string | null = null, tx: string | null = null, decimals = 18, native: string | null = null, spentNative: number | null = null;
  if (live) {
    // Live on any chain: pays with that chain's own coin, worth the same dollars.
    const chain = c.chain as LiveChain;
    const w = await myWallets(slot);
    const nUsd = await nativeUsd(chain);
    const wantUsd = spend * bnb;
    const avail = Math.max(0, (await chainBalance(chain, w)) - CHAIN_GAS[chain]);
    const amount = +Math.min(wantUsd / nUsd, avail).toFixed(chain === "solana" ? 6 : 8);
    if (amount * nUsd < wantUsd * 0.5) throw new Error(`Not enough ${NATIVE[chain]} on ${CHAIN_NAME[chain]}.`);
    let r: Awaited<ReturnType<typeof liveBuyOn>>;
    try { r = await liveBuyOn(chain, w, c.token, amount, c.buyTax ?? 0); }
    catch (e) {
      // The swap may still land after we stop waiting (busy network). Note it: the trader checks the wallet every
      // minute and, if the coins show up, records the trade so its stop-loss / take profit protect it.
      if (!/failed on-chain|No Solana route|Couldn't build|Not enough|Create the|no answer|didn't answer/i.test((e as Error).message)) {
        await tq("ai_trader_pending").upsert({
          chain: c.chain, token: c.token, symbol: c.symbol, name: c.name, logo: c.image, wallet: slot, entry_usd: c.price, entry_mcap: c.mcap || null,
          spent_native: amount, native: NATIVE[chain], sl: o.sl, tp: o.tp, why: o.why, strategy: o.strategy,
          source_group: o.src?.group?.slice(0, 120) ?? null, source_who: o.src?.who?.slice(0, 60) ?? null, created_at: new Date().toISOString(),
        }, { onConflict: "trader_id,chain,token,wallet" }).then(() => {}, () => {});
      }
      throw e;
    }
    if (r.raw <= 0n) throw new Error("The swap went through but no tokens arrived.");
    decimals = r.decimals; raw = r.raw.toString(); tx = r.hash; native = NATIVE[chain]; spentNative = amount;
    qty = Number(r.raw) / 10 ** decimals;
    spend = +((amount * nUsd) / bnb).toFixed(6); // kept in BNB terms so totals add up across chains
  } else {
    const slip = Math.min(0.15, 0.01 + ((spend * bnb) / Math.max(1, c.liquidity)) * 2); // small pools move a lot
    qty = (spend * bnb * (1 - (c.buyTax ?? 0) / 100 - slip)) / c.price;
    const fresh = await getSettings();
    await sb.from("ai_trader_settings").update({ paper_cash: fresh.paper_cash - spend }).eq("id", T());
  }
  const { error } = await tq("ai_trader_positions").insert({
    mode: live ? "live" : "paper", native, spent_native: spentNative, chain: c.chain, token: c.token, symbol: c.symbol, name: c.name, logo: c.image, spent: spend, qty, amount_raw: raw, decimals,
    entry_usd: c.price, high_usd: c.price, last_usd: c.price, stop_loss: o.sl, take_profit: o.tp, trail: o.trail ?? 25, why: `${o.why} (mcap $${Math.round(c.mcap).toLocaleString("en-US")})`, buy_tx: tx,
    strategy: o.strategy, pool: c.pool || null, new_project: !!o.newProject, wallet: slot,
    low_usd: c.price, source_group: o.src?.group?.slice(0, 120) ?? null, source_who: o.src?.who?.slice(0, 60) ?? null,
    shared_at: o.src?.sharedAt ? new Date(o.src.sharedAt).toISOString() : null, coin_age_hours: (c as any).ageHours ?? null, pump_1h: (c as any).ch?.h1 ?? null,
  });
  if (error) { await log("error", `Bought ${c.symbol} but couldn't save it: ${error.message}`); throw new Error("Save failed."); }
  const icon = o.strategy === "hype" ? "🔥" : o.strategy === "dip" ? "📉" : o.strategy === "caller" ? "📣" : o.strategy === "copy" ? "📡" : "⚡";
  await log("buy", `${icon}${slot === 2 ? " Wallet 2:" : ""} Bought ${c.symbol} on ${CHAIN_NAME[c.chain] || c.chain} at $${Math.round(c.mcap).toLocaleString("en-US")} market cap for ${spentNative != null ? `${spentNative} ${native}` : `${spend} BNB`}${live ? "" : " (practice)"}. Target +${o.tp}%, stop -${o.sl}%. ${o.why}`);
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
  return executeBuy(s, cash, { ...c, mcap: c.mcap ?? 0 }, { sl: s.stop_loss, tp: s.take_profit, trail: s.trail, why: p.why, strategy: "" });
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
  if (!inBuyHours(s)) return note(`Outside your buy hours (${buyHoursText(s)}): not buying now. Open coins still sell on their stop-loss and target.`);
  // Telegram only / X only: the trader buys only coins called in what you follow, never from its own scanning.
  if (!s.use_general) return note(`${[s.use_tg && "Telegram", s.use_x && "X"].filter(Boolean).join(" + ") || "Nothing"} ticked: buying only called coins (General is off, so no scanning).`);

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
/**
 * Room and money for one more buy on a chain. Practice: pretend BNB. Live: that chain's own coin in the wallet
 * (BNB, ETH or SOL), less what's kept for fees, must cover at least half a normal trade.
 */
async function buyRoom(s: Settings, chain = "bsc", slot = 1): Promise<{ cash: number; held: Set<string> } | string> {
  if (!inBuyHours(s)) return `outside your buy hours (${buyHoursText(s)})`;
  // Each wallet counts its own coins (both buy every call, so each has its own max).
  const { data: open } = await tq("ai_trader_positions").select("token").in("status", ["open", "closing"]).eq("mode", s.mode).eq("wallet", slot);
  const held = new Set((open || []).map((r: any) => String(r.token).toLowerCase()));
  if (held.size >= s.max_positions) return `Holding ${held.size} of ${s.max_positions} coins.`;
  if (s.mode === "paper") {
    const cash = (await getSettings()).paper_cash;
    if (cash < (await tradeSize(s)) * 0.5) return `Not enough practice BNB (${cash.toFixed(4)}).`;
    return { cash, held };
  }
  if (!isLiveChain(chain) || !s.live_chains.includes(chain)) return `${CHAIN_NAME[chain] || chain} isn't switched on for live trading`;
  const w = await myWallets(slot);
  if (!walletAddress(chain, w)) return slot === 2 ? "no Wallet 2 on this network" : chain === "solana" ? "there's no Solana wallet yet" : "there's no trading wallet yet";
  const have = Math.max(0, (await chainBalance(chain, w)) - CHAIN_GAS[chain]);
  const needUsd = (s.per_trade_usd > 0 ? s.per_trade_usd : s.per_trade * (await bnbUsd())) * 0.5;
  if (have * (await nativeUsd(chain)) < needUsd) return `not enough ${NATIVE[chain]} on ${CHAIN_NAME[chain]} (${have.toFixed(4)} ${NATIVE[chain]})`;
  return { cash: have, held };
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
  const started = Date.now();
  const sb = supabaseService();
  const { data: go } = await sb.rpc("ai_trader_fast_lease_for", { p_trader: T(), p_seconds: 50 });
  if (go !== true) return { skipped: "running" };
  const s = await getSettings();
  if (s.mode === "live" && !(await traderAccount())) return { skipped: "no wallet" };
  await manage(s).catch((e) => log("error", `Exit check failed: ${(e as Error).message}`));
  // Exit guard: while this minute runs, re-check open trades every ~4 seconds (stop-loss, take profit, rug) instead of
  // once a minute, so a crash is sold seconds after it starts.
  let guardOn = true;
  const guard = (async () => {
    while (guardOn && Date.now() - started < 52_000) {
      await new Promise((ok) => setTimeout(ok, 4_000));
      if (!guardOn) break;
      const { count } = await tq("ai_trader_positions").select("id", { count: "exact", head: true }).in("status", ["open", "closing"]);
      if (count) await manage(s).catch(() => {});
    }
  })();
  const general = s.use_general;
  if (s.enabled && general) await recheckWatch(s).catch((e) => log("error", `Watch list check failed: ${(e as Error).message}`));
  if (s.enabled && s.copy_on && s.rebuy_on) await rebuyCheck(s).catch((e) => log("error", `Re-buy check failed: ${(e as Error).message}`));
  if (!s.enabled) { await guard; return { ok: true, buys: "stopped" }; }
  const chains = s.mode === "live" ? ["bsc"] : s.chains;
  const out: string[] = [];
  // Copy trades from what you follow, depending on the trading mode.
  if (s.copy_on) {
    if (s.use_x) {
      const { posts, errors } = await xFollowedPosts().catch((e) => ({ posts: [], errors: [(e as Error).message] }));
      if (errors.length) await sb.from("ai_trader_settings").update({ last_note: `X: ${errors[0]}`.slice(0, 300) }).eq("id", T());
      for (const post of posts.slice(0, 10)) out.push(...(await copyPost({ text: post.text, user: post.user, url: post.url, at: post.at, from: { username: post.user } }, "x", post.label).catch(() => [])));
    }
    if (s.use_tg) {
      // Groups, channels and chats read through the admin's own Telegram account.
      // Kept open for most of the minute, checking every chat every ~2 seconds: buys land seconds after the call.
      // Watch until ~50 seconds after this run started (the next run takes over a few seconds later).
      const watchMs = Math.max(8_000, 50_000 - (Date.now() - started));
      const errs = await tgaWatch(async (post) => out.push(...(await copyPost({ text: post.text, user: post.chat, url: post.url, at: post.at, from: post.from, chat: post.chatRef, isChannel: post.isChannel, isBot: post.isBot }, "telegram", `posted in "${post.chat}"${post.from?.username ? ` by @${post.from.username}` : ""} on Telegram`).catch(() => []))), watchMs).catch((e) => [(e as Error).message]);
      if (errs.length) await sb.from("ai_trader_settings").update({ last_note: `Telegram: ${errs[0]}`.slice(0, 300) }).eq("id", T());
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
  await guard; // keep guarding open trades until the minute's run ends
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
 * Copy trades buy with no checks unless the trader switched the honeypot check on. Without it, the coin's buy tax is
 * still looked up (never blocking) only to set enough slippage for the swap to go through.
 */
async function copyCheckFor(s: Settings, chain: string, token: string): Promise<{ ok: true; buyTax: number; sellTax: number } | { ok: false; reason: string }> {
  if (s.copy_check) return copyGate(chain, token);
  const risk = await Promise.race([riskFor(chain, token).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
  return { ok: true, buyTax: Math.min(50, n(risk?.buyTax)), sellTax: Math.min(50, n(risk?.sellTax)) };
}

/**
 * A post from a followed Telegram group or X account / List / Community: every contract address in it is bought
 * (no market-cap, liquidity, socials or momentum rules), as long as it isn't a honeypot, with the copy target and
 * stop-loss. $TICKERS alone are ignored, since many coins share a ticker and copycats use them.
 */
export type From = { id?: string | null; username?: string | null } | null | undefined;

/** The $ amount set for whoever posted (by username or user id), if any. */
/** A Telegram chat's id in one form, whether it came from the account login ("c:123:hash", "g:123") or the bot (-100123, -123). */
export const chatKey = (ref: string | number | null | undefined): string => {
  const r = String(ref ?? "");
  if (/^[cgu]:/.test(r)) return r.split(":")[1] || "";
  return r.replace(/^-100/, "").replace(/^-/, "");
};

/**
 * Who may buy from a post, and how much. A group with callers picked for it buys ONLY their calls (anyone else in that
 * group is skipped); a group with nobody picked buys every call. Callers picked for "all groups" set their own size
 * wherever they post. Returns skip: true when the group has its own callers and the poster isn't one of them.
 */
export type CallerRule = { usd: number; who: string; sl?: number | null; tp?: number | null };
async function callerFor(platform: "tg" | "x", from: From, chat: string): Promise<{ skip: true } | { skip: false; caller: CallerRule | null }> {
  const keys = [from?.username?.replace(/^@/, "").toLowerCase(), from?.id ? String(from.id) : null].filter(Boolean) as string[];
  const { data } = await tq("ai_trader_callers").select("who,usd,chat,sl,tp").eq("platform", platform).in("chat", chat ? [chat, ""] : [""]);
  const rows = (data || []) as { who: string; usd: number; chat: string; sl: number | null; tp: number | null }[];
  const rule = (r: (typeof rows)[number]): CallerRule => ({ usd: n(r.usd), who: String(r.who), sl: r.sl != null ? n(r.sl) : null, tp: r.tp != null ? n(r.tp) : null });
  const mine = chat ? rows.filter((r) => r.chat === chat) : [];
  const hit = (list: typeof rows) => list.find((r) => keys.includes(String(r.who)));
  if (mine.length) {
    const m = hit(mine);
    return m ? { skip: false, caller: rule(m) } : { skip: true };
  }
  const g = hit(rows.filter((r) => r.chat === ""));
  return { skip: false, caller: g ? rule(g) : null };
}

/**
 * Squads: named groups of people (Telegram), chats (groups/channels), X accounts and wallets. A post from (or in, or
 * mentioning) a member of a squad that's switched on is always bought, even in a group with its own picked callers,
 * at the squad's size ($0 = the normal size). The biggest matching squad wins.
 */
export async function squadFor(post: { text: string; user: string; from?: From; chat?: string }, source: "x" | "telegram"): Promise<{ usd: number; name: string; member: string; sl: number | null; tp: number | null } | null> {
  const { data } = await tq("ai_trader_squad_members").select("kind,value,label,usd,sl,tp,squad:ai_trader_squads!inner(name,usd,sl,tp,enabled)").eq("squad.enabled", true);
  const rows = (data || []) as any[];
  if (!rows.length) return null;
  const uname = post.from?.username?.replace(/^@/, "").toLowerCase() || null;
  const uid = post.from?.id ? String(post.from.id) : null;
  const ck = source === "telegram" ? chatKey(post.chat) : "";
  const text = post.text.toLowerCase();
  const hits = rows.filter((m) => {
    const v = String(m.value);
    if (m.kind === "person") return source === "telegram" && (v === uname || v === uid);
    if (m.kind === "x") return source === "x" && (v === uname || v === String(post.user || "").replace(/^@/, "").toLowerCase());
    if (m.kind === "chat") return source === "telegram" && !!ck && v === ck;
    if (m.kind === "wallet") return text.includes(v.toLowerCase());
    return false;
  });
  if (!hits.length) return null;
  // The person's own size / stop-loss / take profit if set, else the squad's.
  const eff = (m: any) => ({ usd: m.usd != null ? n(m.usd) : n(m.squad.usd), sl: m.sl != null ? n(m.sl) : m.squad.sl != null ? n(m.squad.sl) : null, tp: m.tp != null ? n(m.tp) : m.squad.tp != null ? n(m.squad.tp) : null });
  const best = hits.sort((a, b) => eff(b).usd - eff(a).usd)[0];
  const e = eff(best);
  return { usd: e.usd, sl: e.sl, tp: e.tp, name: String(best.squad.name), member: String(best.label || best.value) };
}

/** The $ buy size set for one Telegram channel / group (0 = none set). */
async function chatSize(ref: string): Promise<number> {
  const { data } = await tq("ai_trader_sources").select("usd").eq("kind", "tg_chat").eq("ref", ref).limit(1);
  return n((data as any)?.[0]?.usd);
}

/** CAs this server has already acted on (stops two chats posting the same coin at the same moment both buying it). */
const claimed = new Set<string>();

// ---- Token scanners in groups (Rick, Phanes and the like): when a call is posted, the group's scanner bot replies
// with the token's details, including when it was FIRST shared ("first shared 8d ago", "🆕 new"). For picked callers
// in groups, the AI waits for that reply (up to 20 s) and buys only if the scanner says new or under 1 minute.
export type Scan = { ageSec: number; text: string } | "none";
const scans = new Map<string, { ageSec: number; text: string; at: number }>();
const waiting = new Map<string, (sc: Scan) => void>();
const UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31536000 };
const unitOf = (u: string) => { const x = u.toLowerCase(); return x.startsWith("mo") ? "mo" : x.startsWith("mi") || x === "m" ? "m" : x[0]; };
const AGE = "(\\d+(?:\\.\\d+)?)\\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mo|years?|yrs?|y)\\b";
/** Seconds since the token was first shared, from a scanner bot's reply (0 = new); null if the reply doesn't say. */
export function scannerAge(text: string): number | null {
  const t = text.replace(/[*_`~|]/g, "");
  const keyed = new RegExp(`(?:first\\s*(?:shared|call(?:ed)?|seen|mention(?:ed)?|posted)|shared|called|seen|mentioned)[^\\n]{0,40}?${AGE}`, "i").exec(t)
    || new RegExp(`${AGE}\\s*ago`, "i").exec(t);
  if (keyed) return Number(keyed[1]) * (UNIT[unitOf(keyed[2])] ?? 60);
  if (/🆕|\bfirst\s*(?:call|share|time)\b|\bjust\s*now\b|\bnew\s*(?:call|token|share|pair)?\b|\bnever\s*(?:been\s*)?(?:shared|called)\b/i.test(t)) return 0;
  return null;
}
const scanKey = (chat: string | undefined, token: string) => `${T()}:${chatKey(chat)}:${token.startsWith("0x") ? token.toLowerCase() : token}`;
/** A scanner bot's reply: remember what it says about each token in it, and wake a call waiting for it. */
function scannerPost(post: { text: string; chat?: string }) {
  const age = scannerAge(post.text);
  if (age == null) return;
  const { evm, sol } = extract(post.text);
  for (const tok of [...evm, ...sol].slice(0, 3)) {
    const k = scanKey(post.chat, tok);
    scans.set(k, { ageSec: age, text: post.text.slice(0, 200), at: Date.now() });
    const w = waiting.get(k);
    if (w) { waiting.delete(k); w({ ageSec: age, text: post.text.slice(0, 200) }); }
  }
  if (scans.size > 500) for (const [k, v] of scans) if (Date.now() - v.at > 10 * 60_000) scans.delete(k);
}

export async function copyPost(post: { text: string; user: string; url: string; at: number; from?: From; chat?: string; isChannel?: boolean; isBot?: boolean }, source: "x" | "telegram", label: string, scan?: Scan): Promise<string[]> {
  // (label gets the squad's name added when a squad member posted)
  const label0 = label;
  const s = await getSettings();
  if (!s.enabled || !s.copy_on) return [];
  // A bot in a group (the token scanner): never a call to buy; read what it says about when the token was first shared.
  if (source === "telegram" && post.isBot) { scannerPost(post); return []; }
  // Telegram only mode ignores X, X only mode ignores Telegram.
  if ((source === "x" && !s.use_x) || (source === "telegram" && !s.use_tg)) return [];
  // Channels always buy every call (their posts come from the channel, not a person). Groups follow their picked callers.
  const who = post.isChannel ? { skip: false as const, caller: null } : await callerFor(source === "x" ? "x" : "tg", post.from, source === "telegram" ? chatKey(post.chat) : "").catch(() => ({ skip: false as const, caller: null }));
  // A squad member always buys (at the squad's size), even in a group that has its own picked callers.
  const squad = await squadFor(post, source).catch(() => null);
  // This group has its own callers and the poster isn't one of them (and isn't in a squad): not bought.
  if (who.skip && !squad) return [];
  // "Only my callers" (on): in a Telegram group, only your picked callers' (and squads') calls are bought, never other
  // people's. Channels still buy every call, since their posts come from the channel itself.
  if (source === "telegram" && !post.isChannel && s.callers_only && !squad && !who.caller) return [];
  const base = who.skip ? null : who.caller;
  // The channel's / group's own buy size (set next to it in the Telegram list), used when the caller or squad has none.
  const chatUsd = source === "telegram" && post.chat ? await chatSize(post.chat).catch(() => 0) : 0;
  let caller: CallerRule | null = squad
    ? { usd: squad.usd > 0 ? squad.usd : base?.usd ?? 0, who: `${squad.member} (squad ${squad.name})`, sl: squad.sl ?? base?.sl ?? null, tp: squad.tp ?? base?.tp ?? null }
    : base;
  // A channel's own amount is exactly what each of its calls buys. In a group, a picked caller's own amount comes
  // first (set and edited per person); the group's amount is used for anyone without one.
  if (chatUsd > 0 && (post.isChannel || !(caller && caller.usd > 0))) caller = { usd: chatUsd, who: caller?.who || "channel size", sl: caller?.sl ?? null, tp: caller?.tp ?? null };
  if (squad) label = `${label} · squad "${squad.name}"`;
  const chains = tradeChains(s);
  const { evm, sol } = extract(post.text);
  const refs: { token: string; chain?: string }[] = [...evm.map((token) => ({ token })), ...(chains.includes("solana") ? sol.map((token) => ({ token, chain: "solana" })) : [])].slice(0, 3);
  // A picked caller (or squad member) in a group: wait for the group's token scanner to say when it was first shared.
  const picked = source === "telegram" && !post.isChannel && (!!base || !!squad);
  if (picked && scan === undefined && refs.length) {
    const k = scanKey(post.chat, refs[0].token);
    const have = scans.get(k);
    if (have && Date.now() - have.at < 120_000) scan = { ageSec: have.ageSec, text: have.text };
    else {
      const tid = T();
      let done = false;
      const go = (sc: Scan) => { if (done) return; done = true; withTrader(tid, () => copyPost(post, source, label0, sc)).catch(() => {}); };
      waiting.set(k, go);
      setTimeout(() => { if (waiting.get(k) === go) waiting.delete(k); go("none"); }, 20_000);
      return ["waiting for the group's token scanner"];
    }
  }
  const out: string[] = [];
  const sb = supabaseService();
  for (const r of refs) {
    // First call only, decided BEFORE anything slow: the first post of a CA claims it (one database insert wins, even
    // when two chats post it at the same second on different servers). Any later post of it, from any chat, group,
    // channel or X account, is a repeat and isn't bought. CAs called or traded before count as seen.
    const key = r.chain === "solana" ? r.token : r.token.toLowerCase();
    const { data: claim } = await tq("ai_trader_ca_seen").upsert({ token: key, first_from: label.slice(0, 120) }, { onConflict: "trader_id,token", ignoreDuplicates: true }).select("token");
    if (!claim?.length || claimed.has(`${T()}:${key}`)) {
      await tq("ai_trader_signals").upsert({ source, who: post.user, body: post.text.slice(0, 280), url: post.url, chain: r.chain || "bsc", token: key, at: new Date(post.at).toISOString(), result: "skipped: repeat call (this CA was posted before; only the first call is bought)" }, { onConflict: "trader_id,source,chain,token,url", ignoreDuplicates: true });
      out.push("skipped: repeat call");
      continue;
    }
    claimed.add(`${T()}:${key}`);
    // A brand-new coin can take a few seconds to show up on the price feeds: look again a couple of times.
    let f = await resolve(r, chains).catch(() => null);
    for (let i = 0; !f && i < 3; i++) { await new Promise((ok) => setTimeout(ok, 3000)); f = await resolve(r, chains).catch(() => null); }
    const sig: Signal = { source, who: post.user, body: post.text.slice(0, 280), url: post.url, chain: f?.chain || r.chain || "bsc", token: f ? (f.chain === "solana" ? f.token : f.token.toLowerCase()) : r.token, at: post.at };
    const { data } = await tq("ai_trader_signals").upsert({ source: sig.source, who: sig.who, body: sig.body, url: sig.url, chain: sig.chain, token: sig.token, at: new Date(sig.at).toISOString() }, { onConflict: "trader_id,source,chain,token,url", ignoreDuplicates: true }).select("id");
    if (!data?.length) continue; // already handled this post
    out.push(await actOnCopy(s, sig, f, label, caller, scan, {
      group: source === "telegram" ? post.user : `X · ${post.user}`,
      who: post.from?.username ? `@${post.from.username}` : source === "x" ? null : null,
    }));
  }
  return out;
}

async function actOnCopy(s: Settings, sig: Signal, f: Flow | null, label: string, caller: CallerRule | null = null, scan: Scan | undefined, src0?: { group: string; who: string | null }): Promise<string> {
  const src = src0 ? { ...src0, sharedAt: sig.at } : undefined;
  // This caller's own stop-loss / take profit (set on Callers or Squads), else the copy-trading ones.
  const sl = caller?.sl && caller.sl > 0 ? caller.sl : s.copy_sl, tp = caller?.tp && caller.tp > 0 ? caller.tp : s.copy_tp;
  const usdSize = caller && caller.usd > 0 ? caller.usd : null;
  const sb = supabaseService();
  const done = async (r: string) => {
    await tq("ai_trader_signals").update({ result: r.slice(0, 300), symbol: f?.symbol ?? null, mcap: f?.mcap ?? null }).eq("source", sig.source).eq("chain", sig.chain).eq("token", sig.token).eq("url", sig.url);
    return r;
  };
  const chains = tradeChains(s);
  if (!f || !f.price) return done(`skipped: no trading pool found for it yet (too new to trade, or not on your ticked chains: ${tradeChains(s).join(", ")})`);
  if (!chains.includes(f.chain)) return done(`skipped: ${CHAIN_NAME[f.chain] || f.chain} isn't switched on`);
  // Only brand-new calls: the post itself must be fresh (seconds / a few minutes), the coin must be new (not one that's
  // been around for hours or days and is being shared again), and it mustn't have already pumped.
  const postMin = (Date.now() - sig.at) / 60_000;
  const freshMin = s.copy_fresh_min > 0 ? s.copy_fresh_min : 3;
  if (postMin > freshMin) return done(`skipped: shared ${ageTxt(postMin * 60)} ago (only calls newer than ${freshMin} min are bought)`);
  // The group's token scanner is the judge for picked callers: new / under 1 minute = buy; older = a reshare.
  if (scan && scan !== "none") {
    if (scan.ageSec > 60) return done(`skipped: the group's token scanner says it was first shared ${ageTxt(scan.ageSec)} ago (only new / under 1 min is bought)`);
    label = `${label} · scanner: ${scan.ageSec ? `first shared ${ageTxt(scan.ageSec)} ago` : "new"}`;
  }
  const maxAge = s.copy_max_age_h > 0 ? s.copy_max_age_h : 3;
  if (!(scan && scan !== "none") && f.ageHours > maxAge) return done(`skipped: old coin (launched ${ageTxt(f.ageHours * 3600)} ago, limit ${maxAge}h): a reshare, not a new call`);
  const maxPump = s.copy_max_pump > 0 ? s.copy_max_pump : 150;
  if (f.ch.h1 >= maxPump || f.ch.h6 >= maxPump * 1.5) return done(`skipped: already pumped (+${Math.round(Math.max(f.ch.h1, 0))}% in 1h, +${Math.round(Math.max(f.ch.h6, 0))}% in 6h)`);
  // Money check (both wallets) and coin check side by side: every second counts on a fresh call.
  const [room, room2, g] = await Promise.all([
    buyRoom(s, f.chain),
    s.mode === "live" ? buyRoom(s, f.chain, 2) : Promise.resolve("no Wallet 2"),
    copyCheckFor(s, f.chain, f.token),
  ]);
  const key = f.token.toLowerCase();
  // Why each wallet can't buy ("" = it can). Wallet 2 not added for this network = nothing to report.
  const why1 = typeof room === "string" ? room : room.held.has(key) ? "already holding it" : "";
  const why2 = typeof room2 === "string" ? (room2.startsWith("no Wallet 2") ? "none" : room2) : room2.held.has(key) ? "already holding it" : "";
  if (why1 && (why2 === "none" || why2)) return done(`skipped: ${why1}${why2 && why2 !== "none" ? ` · Wallet 2: ${why2}` : ""}`);
  if (!g.ok) { await tgNotify(`⛔ Skipped ${f.symbol} (${label}): ${g.reason}.`); return done(`skipped: ${g.reason}`); }
  const newProject = f.ageHours < 24;
  const why = `📡 Copy: ${label}.${usdSize ? ` Buy size $${usdSize}.` : ""} Sells at +${tp}% or -${sl}%${caller && (caller.sl || caller.tp) ? " (this caller's own)" : ""}.${newProject ? " New project: watched for a dump re-buy after a 2x." : ""}`;
  const coin = { ...f, mcap: f.mcap, buyTax: g.buyTax };
  const tryBuy = (cash: number, slot: number) => executeBuy(s, cash, coin, { sl, tp, why: slot === 2 ? `${why} (Wallet 2)` : why, strategy: "copy", trail: 0, usd: usdSize, newProject, src, slot })
    .then((r) => ({ ok: true as const, r }), (e) => ({ ok: false as const, r: (e as Error).message.slice(0, 80) }));
  // Both wallets buy at the same moment, each with its own money.
  const [one, two] = await Promise.all([
    why1 ? Promise.resolve({ ok: false as const, r: why1 }) : tryBuy((room as { cash: number }).cash, 1),
    why2 ? Promise.resolve({ ok: false as const, r: why2 }) : tryBuy((room2 as { cash: number }).cash, 2),
  ]);
  const w2txt = why2 === "none" ? "" : two.ok ? "Wallet 2 bought too" : `Wallet 2: ${two.r}`;
  if (!one.ok && !two.ok) return done(`skipped: buy failed (${one.r})${w2txt ? ` · ${w2txt}` : ""}`);
  const spend = usdSize ? usdSize / (await bnbUsd()) : await tradeSize(s).catch(() => s.per_trade);
  const who = one.ok && two.ok ? " (both wallets)" : two.ok ? " (Wallet 2)" : "";
  label = `${label} · shared ${ageTxt(postMin * 60)} ago · coin ${ageTxt(f.ageHours * 3600)} old`;
  await tgNotify(`📡 Bought ${f.symbol}${who} on ${CHAIN_NAME[f.chain] || f.chain} for ~${fmt(spend)} BNB each${s.mode === "paper" ? " (practice)" : ""}.\n${label}\nMarket cap $${Math.round(f.mcap).toLocaleString("en-US")} · sells at +${tp}% or -${sl}%.\nhttps://dexscreener.com/${f.chain}/${f.token}`);
  return done(`bought: ${one.ok ? one.r : `Wallet 1: ${one.r}`}${w2txt ? ` · ${w2txt}` : ""}`);
}
/** 42 → "42s", 600 → "10m", 7200 → "2h", 691200 → "8d". */
export const ageTxt = (sec: number) => (sec < 60 ? `${Math.max(0, Math.round(sec))}s` : sec < 3600 ? `${Math.round(sec / 60)}m` : sec < 86400 ? `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)}h` : `${Math.round(sec / 86400)}d`);
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
 * trades in 5 minutes) AND buyers are back (at least as many buys as sells in 5 minutes). Honeypot-checked only if
 * the copy-trade check is on.
 * It then sells on the bounce (default +40%) or the copy stop-loss.
 */
async function rebuyCheck(s: Settings) {
  const { data } = await tq("ai_trader_rebuy").select("*").eq("status", "watching").eq("mode", s.mode).order("sold_at", { ascending: true }).limit(10);
  const chains = tradeChains(s);
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
    const room = await buyRoom(s, f.chain);
    if (typeof room === "string") { await set({ note: `ready, but ${room}` }); continue; }
    if (room.held.has(f.token.toLowerCase())) { await set({ status: "expired", note: "already holding it" }); continue; }
    const g = await copyCheckFor(s, f.chain, f.token);
    if (!g.ok) { await set({ status: "expired", note: g.reason }); continue; }
    try {
      const why = `🔁 Dump re-buy: down ${drop.toFixed(0)}% from the 2x sell with heavy volume (${f.buys5} buys / ${f.sells5} sells in 5m). Sells at +${s.rebuy_tp}% or -${s.copy_sl}%.`;
      const r = await executeBuy(s, room.cash, { ...f, mcap: f.mcap, buyTax: g.buyTax }, { sl: s.copy_sl, tp: s.rebuy_tp, why, strategy: "rebuy", trail: 0 });
      await set({ status: "bought", note: r });
      await tgNotify(`🔁 Bought back ${f.symbol} after a ${drop.toFixed(0)}% dump on heavy volume. Sells at +${s.rebuy_tp}% or -${s.copy_sl}%.\nhttps://dexscreener.com/${f.chain}/${f.token}`);
    } catch (e) { await set({ note: `buy failed: ${(e as Error).message.slice(0, 80)}` }); }
  }
}

// ---------------------------------------------------------------- Moving money between the trader's chains (Relay)

export async function relayMoveQuote(from: string, to: string, amount: number) {
  if (!isLiveChain(from) || !isLiveChain(to)) throw new Error("Pick two of the trader's chains.");
  if (!(amount > 0)) throw new Error("Type an amount.");
  const q = await relayBridgeQuote(from, to, amount, await myWallets());
  return { receive: q.receive, receiveSymbol: q.receiveSymbol, feeUsd: q.feeUsd, seconds: q.seconds };
}

export async function relayMove(from: string, to: string, amount: number) {
  if (!isLiveChain(from) || !isLiveChain(to)) throw new Error("Pick two of the trader's chains.");
  if (!(amount > 0)) throw new Error("Type an amount.");
  const r = await relayBridge(from, to, amount, await myWallets());
  await log("settings", `Moved ${amount} ${NATIVE[from]} from ${CHAIN_NAME[from]} to ${CHAIN_NAME[to]} through Relay (about ${r.receive ?? "?"} ${NATIVE[to]}).`);
  return { requestId: r.requestId, hashes: r.hashes, receive: r.receive };
}
