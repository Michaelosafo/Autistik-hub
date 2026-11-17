/**
 * 👥 Copy (server only), BNB Chain only. Paste the wallets to copy; when one of them buys a coin on BSC, Copy buys it
 * too from YOUR wallets (up to 5 private keys you add, each paying with its own BNB); when that wallet sells, Copy
 * sells the same share (they sell half, Copy sells half; they sell it all, Copy sells it all) back into BNB.
 *
 * Watching: every ~second, coin Transfer logs in and out of the copied wallets are read from a BSC node that serves
 * eth_getLogs (the default bsc-dataseed nodes don't, which is why nothing was ever copied before). Only trades the
 * wallet made itself count: it sent the transaction, the transaction called it (bot contracts), or it paid for the
 * coins in the same transaction. Airdrop spam sent to it is ignored. Old trades are never copied.
 *
 * Each of your wallets (slots 1–5) gets its own trade, so with two keys every copy is bought twice. A key's buy is
 * skipped if it doesn't hold the buy amount plus a little BNB for gas.
 *
 * Low profile: each copy waits a random 0.3–1.8 s and buys a slightly different amount (±12%).
 * Safety: safety stop-loss / take profit, max coins at once, the daily loss limit, coins with almost no liquidity skipped.
 * Practice: pretend dollars at real prices (1% slippage and 1% fees each way). Live: real swaps (PancakeSwap / four.meme).
 */
import { createPublicClient, fallback, http } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { supabaseService } from "@/lib/supabase/server";
import { T } from "@/lib/ai-trader-ctx";
import { flog, type FPos, type FSettings } from "@/lib/ai-futures";
import { resolve } from "@/lib/ai-signals";
import { profitLocked, trackPeak } from "@/lib/ai-judge";
import { snipeCfg, snipeEquity } from "@/lib/ai-sniper";

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const sb = () => supabaseService();
const pos = () => sb().from("ai_futures_positions");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const CHAIN_NAME: Record<string, string> = { bsc: "BNB Chain" };
export type CopyWallet = { address: string; chain?: "bsc"; label?: string; usd?: number; on?: boolean };
export const isEvmAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
/** Only BNB Chain wallets (older Solana / Ethereum entries are ignored). */
export const copyWallets = (s: FSettings): CopyWallet[] => (Array.isArray((s as any).copy_wallets) ? (s as any).copy_wallets : [])
  .filter((w: any) => w && isEvmAddr(String(w.address || "")) && (!w.chain || w.chain === "bsc"));
/** Trades are stored as "bsc:0x…". */
const tokenOf = (coin: string) => /^bsc:(0x[0-9a-fA-F]{40})$/.exec(coin)?.[1] || null;

/** Moving these is paying, not a coin "buy" to copy: USDT, USDC, WBNB, BUSD, USD1, FDUSD. */
const MONEY = new Set(["0x55d398326f99059ff775485246999027b3197955", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0xe9e7cea3dedca5984780bafc599bd69add087d56", "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d", "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409"]);

// ---------- Your wallets (private keys in Vault, slots 1–5) ----------

export const MAX_KEYS = 5;
export const SLOTS = [1, 2, 3, 4, 5] as const;
const keyCache = new Map<string, { key: string; a: PrivateKeyAccount }>();
export async function copyKey(slot: number): Promise<PrivateKeyAccount | null> {
  const { data } = await sb().rpc("ai_copy_key_get", { p_id: T(), p_slot: slot });
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data)) return null;
  const k = `${T()}:${slot}`, c = keyCache.get(k);
  if (c?.key === data) return c.a;
  const a = privateKeyToAccount(data as `0x${string}`);
  keyCache.set(k, { key: data, a });
  return a;
}
export async function setCopyKey(slot: number, raw: string): Promise<string> {
  if (!SLOTS.includes(slot as any)) throw new Error(`Pick a wallet from 1 to ${MAX_KEYS}.`);
  const key = (raw.trim().startsWith("0x") ? raw.trim() : `0x${raw.trim()}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("That isn't a private key (64 letters and numbers, from your wallet's Export private key).");
  const a = privateKeyToAccount(key);
  for (const o of SLOTS) if (o !== slot && (await copyKey(o))?.address === a.address) throw new Error(`That wallet is already added as wallet ${o}.`);
  await mustBeIdle(slot);
  const { error } = await sb().rpc("ai_copy_key_set", { p_id: T(), p_slot: slot, p_key: key });
  if (error) throw new Error(error.message);
  keyCache.delete(`${T()}:${slot}`);
  await flog("settings", `Copy wallet ${slot} set: ${a.address}. It buys with its own BNB on BNB Chain.`);
  return a.address;
}
export async function removeCopyKey(slot: number) {
  await mustBeIdle(slot);
  const { error } = await sb().rpc("ai_copy_key_del", { p_id: T(), p_slot: slot });
  if (error) throw new Error(error.message);
  keyCache.delete(`${T()}:${slot}`);
  await flog("settings", `Copy wallet ${slot} removed.`);
}
async function mustBeIdle(slot: number) {
  const { data } = await pos().select("id").eq("fut_id", T()).eq("mode", "live").eq("copy_slot", slot).in("status", ["open", "closing"]).limit(1);
  if (data?.length) throw new Error(`Wallet ${slot} still has open copy trades. Close them first.`);
}
/** For the page: each slot's address and BNB. */
export async function copyKeys() {
  const c = await import("@/lib/ai-trader-chains");
  const bnbUsd = await c.nativeUsd("bsc").catch(() => 0);
  const keys = await Promise.all(SLOTS.map(async (slot) => {
    const a = await copyKey(slot).catch(() => null);
    if (!a) return { slot, address: null, bnb: null };
    return { slot, address: a.address, bnb: await c.chainBalance("bsc", { evm: a, sol: null }).catch(() => null) };
  }));
  return { bnbUsd, keys };
}

// ---------- Watching the copied wallets ----------

/** BSC nodes that serve eth_getLogs, first that answers wins. COPY_BSC_RPC (e.g. a QuickNode / Ankr / NodeReal URL) goes first. */
const LOG_RPCS = [process.env.COPY_BSC_RPC, "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org", "https://1rpc.io/bnb", "https://bsc.blockpi.network/v1/rpc/public"].filter(Boolean) as string[];
let logClient: any = null;
const bscLogs = () => (logClient ||= createPublicClient({ chain: bsc, transport: fallback(LOG_RPCS.map((u) => http(u, { timeout: 8000 }))) }));

type Move = { wallet: CopyWallet; sig: string; mint: string; kind: "buy" | "sell"; frac: number };
const TRANSFER = { type: "event", name: "Transfer", inputs: [{ type: "address", name: "from", indexed: true }, { type: "address", name: "to", indexed: true }, { type: "uint256", name: "value", indexed: false }] } as const;
const ERC20_BAL = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address", name: "a" }], outputs: [{ type: "uint256", name: "" }] }] as const;

let lastWatchErr = 0;
/** New buys / sells by the copied wallets since last time (first look: just remembers the newest block). */
async function newMoves(s: FSettings): Promise<Move[]> {
  const seen: Record<string, string> = { ...((s as any).copy_seen || {}) };
  const ws = copyWallets(s).filter((w) => w.on !== false);
  if (!ws.length) return [];
  const last = Number(seen["bsc:block"]) || 0;
  let r: { head: number; moves: Move[] };
  try { r = await bscMoves(ws, last); }
  catch (e) {
    // Never fail silently again: log it (at most once every 5 minutes).
    if (Date.now() - lastWatchErr > 300_000) { lastWatchErr = Date.now(); await flog("error", `Couldn't read BNB Chain: ${(e as Error).message.slice(0, 140)}. Set COPY_BSC_RPC in Vercel to a BSC node that allows eth_getLogs.`); }
    return [];
  }
  if (String(r.head) !== String(seen["bsc:block"])) {
    seen["bsc:block"] = String(r.head);
    await sb().from("ai_futures_settings").update({ copy_seen: seen }).eq("id", T());
    (s as any).copy_seen = seen;
  }
  return r.moves;
}

async function bscMoves(ws: CopyWallet[], last: number): Promise<{ head: number; moves: Move[] }> {
  const c = bscLogs();
  const head = Number(await c.getBlockNumber());
  if (!last || head - last > 400) return { head, moves: [] }; // first look (or a gap over ~3 min): never copy old trades
  if (head <= last) return { head: last, moves: [] };
  const from = BigInt(last + 1), to = BigInt(Math.min(head, last + 100));
  const addrs = ws.map((w) => w.address as `0x${string}`);
  const [ins, outs] = await Promise.all([
    c.getLogs({ event: TRANSFER, args: { to: addrs }, fromBlock: from, toBlock: to }),
    c.getLogs({ event: TRANSFER, args: { from: addrs }, fromBlock: from, toBlock: to }),
  ]);
  const byAddr = (a: string) => ws.find((x) => x.address.toLowerCase() === a.toLowerCase());
  // Per transaction, wallet and coin: coins in / out. Also which wallets paid something (any token out) in each tx.
  const agg = new Map<string, { w: CopyWallet; tx: string; token: string; inn: bigint; out: bigint }>();
  const paid = new Set<string>();
  for (const [list, dir] of [[ins, "inn"], [outs, "out"]] as const) {
    for (const l of list as any[]) {
      const w = byAddr(String(dir === "inn" ? l.args?.to : l.args?.from || ""));
      if (!w) continue;
      const token = String(l.address).toLowerCase();
      if (dir === "out") paid.add(`${l.transactionHash}|${w.address}`);
      if (MONEY.has(token)) continue;
      const k = `${l.transactionHash}|${w.address}|${token}`;
      const a = agg.get(k) || { w, tx: String(l.transactionHash), token, inn: 0n, out: 0n };
      a[dir] += BigInt(l.args?.value ?? 0);
      agg.set(k, a);
    }
  }
  const txs = new Map<string, { from: string; to: string }>();
  const txOf = async (h: string) => {
    if (!txs.has(h)) { const t = await c.getTransaction({ hash: h }).catch(() => null); txs.set(h, { from: String(t?.from || "").toLowerCase(), to: String(t?.to || "").toLowerCase() }); }
    return txs.get(h)!;
  };
  const moves: Move[] = [];
  for (const a of agg.values()) {
    const me = a.w.address.toLowerCase(), t = await txOf(a.tx);
    // Its own trade: it sent the tx, the tx called it (a bot contract), or it paid for the coins in this tx.
    if (t.from !== me && t.to !== me && !paid.has(`${a.tx}|${a.w.address}`)) continue;
    const mint = `bsc:${a.token}`;
    if (a.inn > a.out) moves.push({ wallet: a.w, sig: a.tx, mint, kind: "buy", frac: 0 });
    else if (a.out > a.inn) {
      const left = BigInt(await c.readContract({ address: a.token as `0x${string}`, abi: ERC20_BAL, functionName: "balanceOf", args: [a.w.address as `0x${string}`] }).catch(() => 0n));
      const sold = a.out - a.inn;
      moves.push({ wallet: a.w, sig: a.tx, mint, kind: "sell", frac: Math.min(1, Number(sold) / Number(sold + left || 1n)) });
    }
  }
  return { head: Number(to), moves };
}

// ---------- Prices ----------

async function coinInfo(mint: string) {
  const token = tokenOf(mint);
  if (!token) return null;
  const f = await resolve({ chain: "bsc", token }, ["bsc"]).catch(() => null);
  return f ? { symbol: f.symbol || token.slice(0, 6), price: n(f.price), liq: n(f.liquidity) } : null;
}
async function priceOf(mints: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all([...new Set(mints)].map(async (m) => { out[m] = n((await coinInfo(m).catch(() => null))?.price); }));
  return out;
}

/** Live: what your wallets hold in BNB plus open trades. Practice: the pretend balance. */
async function copyEquity(s: FSettings): Promise<{ total: number; free: number }> {
  if (s.mode !== "live") return snipeEquity(s);
  const { data } = await pos().select("*").eq("fut_id", T()).eq("mode", "live").in("status", ["open", "closing"]);
  const inTrades = ((data || []) as FPos[]).reduce((a, p) => a + n(p.notional_usd) * (n(p.last) || n(p.entry)) / n(p.entry), 0);
  const k = await copyKeys();
  const bnb = k.keys.reduce((a, x) => a + n(x.bnb), 0);
  return { total: bnb * k.bnbUsd + inTrades, free: bnb * k.bnbUsd };
}

// ---------- Buying and selling ----------

async function copyBuy(s: FSettings, mv: Move): Promise<string> {
  const cfg = snipeCfg(s);
  const token = tokenOf(mv.mint)!;
  const { data: open } = await pos().select("id,coin").eq("fut_id", T()).in("status", ["open", "closing"]);
  if ((open || []).some((p: any) => p.coin === mv.mint)) return "already holding it";
  const coins = new Set((open || []).map((p: any) => p.coin));
  if (coins.size >= s.max_positions) return `holding ${coins.size} of ${s.max_positions} coins`;
  const info = await coinInfo(mv.mint);
  if (!info || !(info.price > 0)) return "no price for it yet";
  if (info.liq > 0 && info.liq < 2000) return `too little liquidity ($${Math.round(info.liq)})`;
  const eq = await copyEquity(s);
  const base = Math.max(1, n(mv.wallet.usd) || cfg.usd);
  const who = mv.wallet.label || short(mv.wallet.address);
  const link = `https://bscscan.com/tx/${mv.sig}`;
  await sleep(300 + Math.random() * 1500); // a short random wait, so it never lands in the same moment as the wallet
  const row = (usd: number, entry: number, qty: number, tx: string | null, slot: number | null) => pos().insert({
    fut_id: T(), mode: s.mode, venue: "copy", coin: mv.mint, side: "long", lev: 1, margin_usd: usd, notional_usd: usd,
    entry, stop: entry * (1 - cfg.sl / 100), target: entry * (1 + cfg.tp / 100), liq: null, best: entry, last: entry, size: qty,
    fees_usd: s.mode === "paper" ? usd * 0.01 : 0, why: `${info.symbol}: copied ${who}`, open_tx: tx, risk_usd: usd * cfg.sl / 100,
    equity_at_open: eq.total, copy_from: mv.wallet.address, copy_slot: slot,
  });

  if (s.mode !== "live") {
    const usd = +Math.min(base * (0.88 + Math.random() * 0.24), eq.free).toFixed(2);
    if (usd < 1) return `not enough practice money ($${eq.free.toFixed(2)})`;
    await sb().from("ai_futures_settings").update({ paper_usd: s.paper_usd - usd }).eq("id", T());
    s.paper_usd -= usd;
    const entry = info.price * 1.01;
    await row(usd, entry, usd / entry, null, null);
    await flog("open", `👥 Bought ${info.symbol} for $${usd.toFixed(2)} (practice): ${who} just bought it. ${link}`);
    return `bought ${info.symbol}`;
  }

  // Live: every wallet you added buys it with its own BNB, at the same time.
  const c = await import("@/lib/ai-trader-chains");
  const bnbUsd = await c.nativeUsd("bsc");
  const done = await Promise.all(SLOTS.map(async (slot) => {
    const a = await copyKey(slot);
    if (!a) return null;
    const w = { evm: a, sol: null };
    const usd = +(base * (0.88 + Math.random() * 0.24)).toFixed(2); // ±12%: never exactly the same size
    const bnb = usd / bnbUsd;
    const have = await c.chainBalance("bsc", w).catch(() => 0);
    if (have < bnb + c.GAS_KEEP.bsc) { await flog("skip", `Wallet ${slot} skipped ${info.symbol}: it has ${have.toFixed(4)} BNB, needs ${(bnb + c.GAS_KEEP.bsc).toFixed(4)} (buy + gas).`); return null; }
    try {
      const r = await c.liveBuyOn("bsc", w, token, bnb, 10);
      if (!(r.raw > 0n)) throw new Error("the swap went through but no coins arrived");
      const qty = Number(r.raw) / 10 ** r.decimals;
      await row(usd, usd / qty, qty, r.hash, slot);
      await flog("open", `👥 Wallet ${slot} bought ${info.symbol} for ${bnb.toFixed(4)} BNB ($${usd.toFixed(2)}): ${who} just bought it. ${link}`);
      return slot;
    } catch (e) {
      await flog("error", `Wallet ${slot} couldn't buy ${info.symbol}: ${(e as Error).message.slice(0, 160)}`);
      return null;
    }
  }));
  const ok = done.filter(Boolean);
  if (!ok.length) return (await Promise.all(SLOTS.map((x) => copyKey(x)))).some(Boolean) ? `couldn't buy ${info.symbol}` : "add a wallet (private key) to buy with";
  return `bought ${info.symbol} (wallet ${ok.join(" + ")})`;
}

/** Sell `frac` (0–1) of a copy trade back into BNB. The sold part is recorded as its own closed trade; the rest stays open. */
export async function sellCopy(s: FSettings, p: FPos, frac: number, reason: string, price?: number) {
  const all = frac >= 0.85; // they sold most of it: sell everything (leftover dust is useless)
  const { data: claimed } = await pos().update({ status: "closing" }).eq("id", p.id).eq("status", "open").select("id");
  if (!claimed?.length) return;
  const part = all ? 1 : frac;
  const slot = Number((p as any).copy_slot) || 0;
  try {
    let px = price || n(p.last) || n(p.entry), got = 0, tx: string | null = null;
    const token = tokenOf(p.coin);
    if (p.mode === "live") {
      if (!token) throw new Error("not a BNB Chain coin");
      const a = slot ? await copyKey(slot) : null;
      if (!a) throw new Error(`wallet ${slot || "?"} was removed, so this has to be sold from that wallet yourself`);
      const c = await import("@/lib/ai-trader-chains");
      const w = { evm: a, sol: null };
      const bal = await c.tokenBalanceOn("bsc", w, token);
      // Only this trade's coins (you may hold more of it yourself), never more than the wallet has.
      const mine = BigInt(Math.floor(n(p.size) * 10 ** bal.decimals));
      const own = mine > 0n && mine < bal.raw ? mine : bal.raw;
      const raw = all ? own : BigInt(Math.floor(Number(own) * part));
      if (raw > 0n) {
        const r = await c.liveSellOn("bsc", w, token, raw, 10, /stop/i.test(reason) ? 2000 : 0);
        got = r.receivedNative * (await c.nativeUsd("bsc"));
        tx = r.hash;
        if (n(p.size) > 0) px = got / (n(p.size) * part);
      } else reason = `${reason} (the wallet held none of it any more)`;
    } else {
      got = n(p.notional_usd) * part * (px / n(p.entry)) * 0.98;
      await sb().from("ai_futures_settings").update({ paper_usd: s.paper_usd + got }).eq("id", T());
      s.paper_usd += got;
    }
    const cost = n(p.notional_usd) * part, fees = p.mode === "paper" ? n(p.fees_usd) * part : 0;
    const pnl = got - cost - fees;
    const now = new Date().toISOString();
    if (part >= 1) await pos().update({ status: "closed", exit: px, pnl_usd: pnl, reason, closed_at: now, close_tx: tx }).eq("id", p.id);
    else {
      const rest: any = { ...p };
      delete rest.id; delete rest.price; delete rest.upnl;
      await pos().insert({ ...rest, status: "closed", size: n(p.size) * part, notional_usd: cost, margin_usd: n(p.margin_usd) * part, fees_usd: n(p.fees_usd) * part, exit: px, pnl_usd: pnl, reason, closed_at: now, close_tx: tx });
      await pos().update({ status: "open", size: n(p.size) * (1 - part), notional_usd: n(p.notional_usd) * (1 - part), margin_usd: n(p.margin_usd) * (1 - part), fees_usd: n(p.fees_usd) * (1 - part), risk_usd: n((p as any).risk_usd) * (1 - part) }).eq("id", p.id);
    }
    const name = p.why?.split(":")[0] || p.coin.slice(4, 10);
    await flog(pnl >= 0 ? "win" : "loss", `${pnl >= 0 ? "✅" : "🔻"} ${slot ? `Wallet ${slot} sold` : "Sold"} ${part >= 1 ? "all" : `${Math.round(part * 100)}%`} of ${name}: ${reason}. ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${cost ? ((got / cost - 1) * 100).toFixed(0) : 0}%)${p.mode === "paper" ? " (practice)" : ""}.`);
  } catch (e) {
    await pos().update({ status: "open" }).eq("id", p.id);
    await flog("error", `Couldn't sell ${p.why?.split(":")[0] || p.coin}: ${(e as Error).message}`);
  }
}

/** Act on the copied wallets' new trades: buy what they buy (when Copy is on), sell what they sell (always). */
async function follow(s: FSettings): Promise<string[]> {
  const moves = await newMoves(s);
  const notes: string[] = [];
  for (const mv of moves) {
    if (mv.kind === "sell") {
      const { data } = await pos().select("*").eq("fut_id", T()).eq("status", "open").eq("coin", mv.mint).eq("copy_from", mv.wallet.address);
      await Promise.all(((data || []) as FPos[]).map((p) => sellCopy(s, p, mv.frac, `${mv.wallet.label || short(mv.wallet.address)} sold ${Math.round(mv.frac * 100)}%`)));
      if (data?.length) notes.push(`sold ${(data[0] as FPos).why?.split(":")[0]}`);
    } else if (s.enabled) {
      const r = await copyBuy(s, mv).catch((e) => `failed: ${(e as Error).message}`);
      if (/^failed/.test(r)) await flog("error", `Copy buy ${mv.mint.slice(4, 12)}…: ${r}`);
      else if (!/^bought/.test(r)) await flog("skip", `Saw ${mv.wallet.label || short(mv.wallet.address)} buy ${mv.mint.slice(4, 12)}… but skipped: ${r}. https://bscscan.com/tx/${mv.sig}`);
      notes.push(r);
    }
  }
  return notes;
}

/** Safety stop-loss / take profit for every open copy trade. */
async function stops(s: FSettings) {
  const { data } = await pos().select("*").eq("fut_id", T()).eq("status", "open").eq("venue", "copy");
  const open = (data || []) as FPos[];
  if (!open.length) return;
  const px = await priceOf(open.map((p) => p.coin));
  await Promise.all(open.map(async (p) => {
    const price = px[p.coin];
    if (!price) return;
    const best = Math.max(n(p.best) || n(p.entry), price);
    if (price <= n(p.stop)) await sellCopy(s, { ...p, last: price, best }, 1, `Stop-loss (${((price / n(p.entry) - 1) * 100).toFixed(0)}%)`, price);
    else if (price >= n(p.target)) await sellCopy(s, { ...p, last: price, best }, 1, `Take profit (+${((price / n(p.entry) - 1) * 100).toFixed(0)}%)`, price);
    else await pos().update({ last: price, best }).eq("id", p.id);
  }));
}

/** One minute of Copy: watch the wallets about every second for ~48 s, stop-losses every ~5 s. */
export async function runCopy(s: FSettings): Promise<string> {
  const ws = copyWallets(s).filter((w) => w.on !== false);
  if (!ws.length) { await stops(s).catch(() => {}); return "Paste a BNB Chain wallet to copy."; }
  const eq = await copyEquity(s).catch(() => ({ total: 0, free: 0 }));
  const today = new Date().toISOString().slice(0, 10);
  if (s.day !== today || s.day_start_usd == null) { await sb().from("ai_futures_settings").update({ day: today, day_start_usd: eq.total, day_peak_usd: eq.total }).eq("id", T()); s.day = today; s.day_start_usd = eq.total; (s as any).day_peak_usd = eq.total; }
  const down = eq.total < n(s.day_start_usd) * (1 - s.daily_loss_pct / 100);
  await trackPeak(s as any, eq.total).catch(() => {});
  const locked = profitLocked(s, eq.total);
  const buying = s.enabled && !down && !locked;
  const until = Date.now() + 48_000;
  const notes: string[] = [];
  let lastStop = 0;
  const run = { ...s, enabled: buying } as FSettings;
  while (Date.now() < until) {
    const t = Date.now();
    notes.push(...(await follow(run).catch((e) => [`watch error: ${(e as Error).message}`])));
    if (t - lastStop > 5000) { lastStop = t; await stops(run).catch(() => {}); }
    await sleep(Math.max(250, 1000 - (Date.now() - t)));
  }
  const head = !s.enabled ? "Off: sells still follow the wallets." : down ? `Paused buying for today (down past ${s.daily_loss_pct}%); sells still follow.` : locked || `Watching ${ws.length} BNB Chain wallet${ws.length === 1 ? "" : "s"}.`;
  const did = notes.filter((x) => /^(bought|sold)/.test(x));
  return did.length ? `${head} ${did.join(" · ")}` : `${head} Account $${eq.total.toFixed(2)}.`;
}
