/**
 * 👥 Copy (server only), BNB Chain only. Paste the wallets to copy; when one of them buys a coin on BSC, Copy buys it
 * too from YOUR wallets (up to 13 private keys you add, each paying with its own BNB); when that wallet sells, Copy
 * sells the same share (they sell half, Copy sells half; they sell it all, Copy sells it all) back into BNB.
 *
 * Watching: every ~second, coin Transfer logs in and out of the copied wallets are read from a BSC node that serves
 * eth_getLogs (the default bsc-dataseed nodes don't, which is why nothing was ever copied before). Only trades the
 * wallet made itself count: it sent the transaction, the transaction called it (bot contracts), or it paid for the
 * coins in the same transaction. Airdrop spam sent to it is ignored. Old trades are never copied.
 *
 * Each of your wallets (slots 1–10) gets its own trade, so with two keys every copy is bought twice. A key's buy is
 * skipped if it doesn't hold the buy amount plus a little BNB for gas.
 *
 * Low profile: each copy waits a random 0.3–1.8 s and buys a slightly different amount (±12%).
 * Safety: safety stop-loss / take profit, max coins at once, the daily loss limit, coins with almost no liquidity skipped.
 * Practice: pretend dollars at real prices (1% slippage and 1% fees each way). Live: real swaps (PancakeSwap / four.meme).
 */
import { createPublicClient, createWalletClient, fallback, formatUnits, http, parseUnits, webSocket } from "viem";
import { bsc } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
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

// ---------- Your wallets (private keys in Vault, slots 1–13) ----------

export const MAX_KEYS = 13;
/** $ one of your wallets spends per buy, if you set one for it (else null: the normal amount). */
export const keyUsd = (s: FSettings, slot: number): number | null => { const v = n(((s as any).copy_key_usd || {})[String(slot)]); return v > 0 ? v : null; };
export const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
/** BNB kept for gas in each wallet (a swap on BNB Chain costs well under a cent; this covers many). */
const COPY_GAS = 0.0002;
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
/** A brand-new wallet in the first free slot (or the one asked for): fund it with BNB and it starts buying. */
export async function createCopyKey(slot?: number): Promise<{ slot: number; address: string }> {
  let use = Number(slot) || 0;
  if (!use) for (const x of SLOTS) if (!(await copyKey(x))) { use = x; break; }
  if (!use) throw new Error(`All ${MAX_KEYS} wallets are in use. Remove one first.`);
  if (await copyKey(use)) throw new Error(`Wallet ${use} already exists.`);
  const address = await setCopyKey(use, generatePrivateKey());
  return { slot: use, address };
}
/** The private key, so you can import the wallet into Bitget / MetaMask / Trust and take the money out. */
export async function revealCopyKey(slot: number): Promise<string> {
  const { data } = await sb().rpc("ai_copy_key_get", { p_id: T(), p_slot: slot });
  if (typeof data !== "string") throw new Error(`Wallet ${slot} doesn't exist.`);
  await flog("settings", `Private key of copy wallet ${slot} was shown.`);
  return data;
}
/**
 * Remove a wallet, whatever state its trades are in (open, stuck "closing", rugged). Its trades are taken off the
 * board (the coins stay in that wallet: import its private key into a wallet app to deal with them) and it never
 * buys or sells here again. Returns how many trades were taken off.
 */
export async function removeCopyKey(slot: number): Promise<number> {
  if (!SLOTS.includes(slot as any)) throw new Error(`Pick a wallet from 1 to ${MAX_KEYS}.`);
  // Delete the key first, so a run that's going right now can't buy with it any more.
  const { error } = await sb().rpc("ai_copy_key_del", { p_id: T(), p_slot: slot });
  if (error) throw new Error(error.message);
  keyCache.delete(`${T()}:${slot}`);
  const { data } = await pos().select("*").eq("fut_id", T()).eq("copy_slot", slot).in("status", ["open", "closing"]);
  const rows = (data || []) as FPos[];
  const now = new Date().toISOString();
  await Promise.all(rows.map((p) => {
    const last = n(p.last) || n(p.entry);
    const pnl = n(p.entry) > 0 ? n(p.notional_usd) * (last / n(p.entry) - 1) : 0;
    return pos().update({ status: "closed", exit: last, pnl_usd: pnl, reason: `Wallet ${slot} removed: coins left in that wallet (written off)`, closed_at: now }).eq("id", p.id);
  }));
  await flog("settings", `Copy wallet ${slot} removed${rows.length ? `; ${rows.length} trade${rows.length === 1 ? "" : "s"} taken off the board (the coins stay in that wallet)` : ""}.`);
  return rows.length;
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
    if (!a) return { slot, address: null, bnb: null, usd: null };
    const w = { evm: a, sol: null };
    const [bnb, st] = await Promise.all([c.chainBalance("bsc", w).catch(() => null), c.stableBalances("bsc", w).catch(() => [])]);
    return { slot, address: a.address, bnb, usd: st.reduce((x, y) => x + y.balance, 0) };
  }));
  return { bnbUsd, keys };
}

// ---------- Moving money between your wallets ----------

const SEND_RPCS = [process.env.COPY_BSC_RPC, "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org", "https://bsc-dataseed.bnbchain.org"].filter(Boolean) as string[];
const ERC20_T = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address", name: "a" }], outputs: [{ type: "uint256", name: "" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8", name: "" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string", name: "" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address", name: "to" }, { type: "uint256", name: "v" }], outputs: [{ type: "bool", name: "" }] },
] as const;
const amountStr = (x: number, dec: number) => x.toFixed(Math.min(dec, 18)).replace(/\.?0+$/, "") || "0";

/**
 * Send BNB, USDT, USDC or any token from one of your wallets to another (a plain, direct BNB Chain transfer).
 * asset: "BNB" | "USDT" | "USDC" | a token address. amount: a number, or "max" (all of it; for BNB, all minus the fee).
 * Moving a coin you hold in an open trade moves that trade (its share of the cost) to the other wallet, so its
 * Sell buttons and auto-sell follow the coins.
 */
export async function transferBetween(fromSlot: number, toSlot: number, asset: string, amount: number | "max"): Promise<string> {
  if (!SLOTS.includes(fromSlot as any) || !SLOTS.includes(toSlot as any)) throw new Error(`Pick wallets from 1 to ${MAX_KEYS}.`);
  if (fromSlot === toSlot) throw new Error("Pick a different wallet to send to.");
  if (amount !== "max" && !(Number(amount) > 0)) throw new Error("Type an amount, or tap Max.");
  const [a, b] = await Promise.all([copyKey(fromSlot), copyKey(toSlot)]);
  if (!a) throw new Error(`Wallet ${fromSlot} doesn't exist.`);
  if (!b) throw new Error(`Wallet ${toSlot} doesn't exist.`);
  const c = bscLogs();
  const wc = createWalletClient({ account: a, chain: bsc, transport: fallback(SEND_RPCS.map((u) => http(u, { timeout: 8000, retryCount: 0 })), { retryCount: 1 }) });
  const [gasPrice, bnb] = await Promise.all([c.getGasPrice() as Promise<bigint>, c.getBalance({ address: a.address }) as Promise<bigint>]);
  let hash: `0x${string}`, what: string, token: string | null = null, raw = 0n, dec = 18;
  if (asset.toUpperCase() === "BNB") {
    const fee = 21000n * gasPrice;
    raw = amount === "max" ? bnb - fee : parseUnits(amountStr(Number(amount), 18), 18);
    if (raw <= 0n || raw + fee > bnb) throw new Error(`Wallet ${fromSlot} has ${Number(formatUnits(bnb, 18)).toFixed(5)} BNB: not enough for that plus the fee (~${Number(formatUnits(fee, 18)).toFixed(6)} BNB).`);
    hash = await wc.sendTransaction({ account: a, chain: bsc, to: b.address, value: raw, gas: 21000n, gasPrice });
    what = `${Number(formatUnits(raw, 18)).toFixed(5)} BNB`;
  } else {
    const st = stableBySymbolBsc(asset);
    token = st ? st : isEvmAddr(asset.trim()) ? asset.trim() : null;
    if (!token) throw new Error("Pick BNB, USDT, USDC, or paste the token's contract address.");
    const t = token as `0x${string}`;
    const [bal, d, sym] = await Promise.all([
      c.readContract({ address: t, abi: ERC20_T, functionName: "balanceOf", args: [a.address] }).then((x: any) => BigInt(x)),
      c.readContract({ address: t, abi: ERC20_T, functionName: "decimals" }).then(Number).catch(() => 18),
      c.readContract({ address: t, abi: ERC20_T, functionName: "symbol" }).then(String).catch(() => short(t)),
    ]);
    dec = d;
    raw = amount === "max" ? bal : parseUnits(amountStr(Number(amount), dec), dec);
    if (raw <= 0n || raw > bal) throw new Error(`Wallet ${fromSlot} holds ${Number(formatUnits(bal, dec)).toPrecision(6)} ${sym}${raw > bal ? ": less than that" : ""}.`);
    const est = await (c as any).estimateContractGas({ account: a, address: t, abi: ERC20_T, functionName: "transfer", args: [b.address, raw] }).catch((e: Error) => { throw new Error(`The token refused the transfer (${(e as any).shortMessage || e.message}`.slice(0, 160) + ")"); });
    const limit = (BigInt(est) * 13n) / 10n;
    if (bnb < limit * gasPrice) throw new Error(`Wallet ${fromSlot} needs about ${Number(formatUnits(limit * gasPrice, 18)).toFixed(6)} BNB for the fee; it has ${Number(formatUnits(bnb, 18)).toFixed(6)}.`);
    hash = await wc.writeContract({ account: a, chain: bsc, address: t, abi: ERC20_T, functionName: "transfer", args: [b.address, raw], gas: limit, gasPrice });
    what = `${Number(formatUnits(raw, dec)).toPrecision(6)} ${sym}`;
  }
  const rc = await c.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 500 });
  if (rc.status !== "success") throw new Error(`The transfer failed on-chain: https://bscscan.com/tx/${hash}`);
  if (token && !stableBySymbolBsc(asset)) await moveTrades(token, fromSlot, toSlot, Number(formatUnits(raw, dec))).catch(() => {});
  const msg = `Sent ${what} from wallet ${fromSlot} to wallet ${toSlot}. https://bscscan.com/tx/${hash}`;
  await flog("settings", msg);
  return msg;
}
const stableBySymbolBsc = (x: string) => ({ USDT: "0x55d398326f99059fF775485246999027B3197955", USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" } as Record<string, string>)[x.toUpperCase()] || null;

/** Coins moved between your wallets: their open trade moves too (the same share of the cost). */
async function moveTrades(token: string, from: number, to: number, qty: number) {
  const { data } = await pos().select("*").eq("fut_id", T()).eq("copy_slot", from).eq("coin", `bsc:${token.toLowerCase()}`).eq("status", "open");
  let left = qty;
  for (const p of (data || []) as FPos[]) {
    if (left <= 0) break;
    const size = n(p.size), take = Math.min(size, left), f = size > 0 ? take / size : 0;
    left -= take;
    if (f <= 0) continue;
    if (f >= 0.999) { await pos().update({ copy_slot: to }).eq("id", p.id); continue; }
    const rest: any = { ...p };
    delete rest.id; delete rest.price; delete rest.upnl;
    await pos().insert({ ...rest, copy_slot: to, size: take, notional_usd: n(p.notional_usd) * f, margin_usd: n(p.margin_usd) * f, fees_usd: n(p.fees_usd) * f, risk_usd: n((p as any).risk_usd) * f });
    await pos().update({ size: size - take, notional_usd: n(p.notional_usd) * (1 - f), margin_usd: n(p.margin_usd) * (1 - f), fees_usd: n(p.fees_usd) * (1 - f), risk_usd: n((p as any).risk_usd) * (1 - f) }).eq("id", p.id);
  }
}

// ---------- Watching the copied wallets ----------

/** BSC nodes that serve eth_getLogs, first that answers wins. COPY_BSC_RPC (e.g. a QuickNode / Ankr / NodeReal URL) goes first. */
const LOG_RPCS = [process.env.COPY_BSC_RPC, "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org", "https://bsc-mainnet.public.blastapi.io", "https://binance.llamarpc.com", "https://bsc.meowrpc.com"].filter(Boolean) as string[];
let logClient: any = null;
const bscLogs = () => (logClient ||= createPublicClient({ chain: bsc, transport: fallback(LOG_RPCS.map((u) => http(u, { timeout: 6000, retryCount: 0 })), { retryCount: 1 }) }));

type Move = { wallet: CopyWallet; sig: string; mint: string; kind: "buy" | "sell"; frac: number };
const TRANSFER = { type: "event", name: "Transfer", inputs: [{ type: "address", name: "from", indexed: true }, { type: "address", name: "to", indexed: true }, { type: "uint256", name: "value", indexed: false }] } as const;
const ERC20_BAL = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address", name: "a" }], outputs: [{ type: "uint256", name: "" }] }] as const;

let lastWatchErr = 0;
/** New buys / sells by the copied wallets since last time (first look: just remembers the newest block). */
async function newMoves(s: FSettings): Promise<Move[]> {
  const seen: Record<string, any> = { ...((s as any).copy_seen || {}) };
  const ws = copyWallets(s).filter((w) => w.on !== false);
  if (!ws.length) return [];
  const last = Number(seen["bsc:block"]) || 0;
  let r: { head: number; moves: Move[] };
  try { r = await bscMoves(ws, last); }
  catch (e) {
    // Never fail silently again: log it (at most once every 5 minutes).
    if (!/invalid param|missing or invalid/i.test((e as Error).message) && Date.now() - lastWatchErr > 300_000) { lastWatchErr = Date.now(); await flog("error", `Couldn't read BNB Chain: ${(e as Error).message.slice(0, 140)}. Set COPY_BSC_RPC in Vercel to a BSC node that allows eth_getLogs.`); }
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
  // One block behind the newest: the public nodes are a moment apart, and asking a node for a block it hasn't got yet
  // fails ("invalid parameters"). The live push covers the newest block anyway.
  const top = head - 1;
  if (top <= last) return { head: last, moves: [] };
  const from = BigInt(last + 1), to = BigInt(Math.min(top, last + 50));
  const addrs = ws.map((w) => w.address as `0x${string}`);
  const [ins, outs] = await Promise.all([
    c.getLogs({ event: TRANSFER, args: { to: addrs }, fromBlock: from, toBlock: to }),
    c.getLogs({ event: TRANSFER, args: { from: addrs }, fromBlock: from, toBlock: to }),
  ]);
  return { head: Number(to), moves: await movesFrom(ins as any[], outs as any[], ws, [c]) };
}

/** Coin transfers in / out of the copied wallets → their buys and sells. `cs`: clients to read the transaction with. */
async function movesFrom(ins: any[], outs: any[], ws: CopyWallet[], cs: any[]): Promise<Move[]> {
  const byAddr = (a: string) => ws.find((x) => x.address.toLowerCase() === a.toLowerCase());
  // Per transaction, wallet and coin: coins in / out. Also which wallets paid something (any token out) in each tx.
  const agg = new Map<string, { w: CopyWallet; tx: string; token: string; inn: bigint; out: bigint }>();
  const paid = new Set<string>();
  for (const [list, dir] of [[ins, "inn"], [outs, "out"]] as const) {
    for (const l of list) {
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
    if (!txs.has(h)) {
      let t: any = null;
      // A transaction seen the instant it lands may not be on every node yet: try each client, a few times.
      for (let i = 0; i < 4 && !t; i++) {
        for (const c of cs) { t = await c.getTransaction({ hash: h }).catch(() => null); if (t) break; }
        if (!t) await sleep(250);
      }
      txs.set(h, { from: String(t?.from || "").toLowerCase(), to: String(t?.to || "").toLowerCase() });
    }
    return txs.get(h)!;
  };
  const c = cs[cs.length - 1];
  const moves: Move[] = [];
  await Promise.all([...agg.values()].map(async (a) => {
    const me = a.w.address.toLowerCase(), t = await txOf(a.tx);
    // Its own trade: it sent the tx, the tx called it (a bot contract), or it paid for the coins in this tx.
    if (t.from !== me && t.to !== me && !paid.has(`${a.tx}|${a.w.address}`)) return;
    const mint = `bsc:${a.token}`;
    if (a.inn > a.out) moves.push({ wallet: a.w, sig: a.tx, mint, kind: "buy", frac: 0 });
    else if (a.out > a.inn) {
      const left = BigInt(await c.readContract({ address: a.token as `0x${string}`, abi: ERC20_BAL, functionName: "balanceOf", args: [a.w.address as `0x${string}`] }).catch(() => 0n));
      const sold = a.out - a.inn;
      moves.push({ wallet: a.w, sig: a.tx, mint, kind: "sell", frac: Math.min(1, Number(sold) / Number(sold + left || 1n)) });
    }
  }));
  return moves;
}

/**
 * Instant watching: a live connection to BNB Chain pushes the copied wallets' coin transfers the moment their block
 * lands (no waiting for the next check). Polling keeps running underneath as a backup.
 */
const WSS = [process.env.COPY_BSC_WSS, "wss://bsc-rpc.publicnode.com"].filter(Boolean) as string[];
function liveWatch(ws: CopyWallet[], push: (ins: any[], outs: any[], client: any) => void): () => void {
  const stops: (() => void)[] = [];
  try {
    const client = createPublicClient({ chain: bsc, transport: webSocket(WSS[0], { reconnect: { attempts: 3, delay: 500 }, timeout: 6000 }) });
    const addrs = ws.map((w) => w.address as `0x${string}`);
    stops.push(client.watchEvent({ event: TRANSFER, args: { to: addrs }, onLogs: (l: any[]) => push(l, [], client), onError: () => {} }));
    stops.push(client.watchEvent({ event: TRANSFER, args: { from: addrs }, onLogs: (l: any[]) => push([], l, client), onError: () => {} }));
    stops.push(() => { (client.transport as any).getRpcClient?.().then((r: any) => r.close?.()).catch(() => {}); });
  } catch { /* no live connection: polling still runs */ }
  return () => stops.forEach((f) => { try { f(); } catch { /* closed */ } });
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
  const free = k.keys.reduce((a, x) => a + n(x.bnb) * k.bnbUsd + n(x.usd), 0);
  return { total: free + inTrades, free };
}

/** The automatic stop-loss / take profit can be switched off: then you sell yourself (Sell buttons on the page). */
export const slOn = (s: FSettings) => (s as any).copy_sl_on !== false;
export const tpOn = (s: FSettings) => (s as any).copy_tp_on !== false;

/** Switching them on or off also applies to the copy trades already open. */
export async function applyExitSwitches(s: FSettings) {
  const cfg = snipeCfg(s);
  const { data } = await pos().select("id,entry").eq("fut_id", T()).eq("status", "open").eq("venue", "copy");
  await Promise.all(((data || []) as FPos[]).map((p) => pos().update({
    stop: slOn(s) ? n(p.entry) * (1 - cfg.sl / 100) : 0, target: tpOn(s) ? n(p.entry) * (1 + cfg.tp / 100) : 0,
  }).eq("id", p.id)));
}

/** Your own exits on one copy trade: a price, or 0 for none. */
export async function setCopyExits(id: number, stop: number | null, target: number | null): Promise<string> {
  const { data } = await pos().select("*").eq("fut_id", T()).eq("id", id).eq("status", "open").maybeSingle();
  if (!data) throw new Error("That trade isn't open any more.");
  const p = data as FPos;
  const cur = n((await coinInfo(p.coin).catch(() => null))?.price) || n(p.last) || n(p.entry);
  const up: Record<string, number> = {}, notes: string[] = [];
  const f = (x: number) => (x >= 1 ? x.toFixed(4) : x.toPrecision(4));
  if (stop != null) {
    if (stop > 0 && stop >= cur) throw new Error(`The stop-loss must be below the current price ($${f(cur)}).`);
    up.stop = Math.max(0, stop);
    notes.push(stop > 0 ? `stop-loss at $${f(stop)} (${((stop / cur - 1) * 100).toFixed(1)}% from now)` : "no stop-loss");
  }
  if (target != null) {
    if (target > 0 && target <= cur) throw new Error(`The take profit must be above the current price ($${f(cur)}).`);
    up.target = Math.max(0, target);
    notes.push(target > 0 ? `take profit at $${f(target)} (+${((target / cur - 1) * 100).toFixed(1)}% from now)` : "no take profit");
  }
  if (!Object.keys(up).length) throw new Error("Nothing to change.");
  await pos().update(up).eq("id", id);
  const name = p.why?.split(":")[0] || "trade";
  await flog("settings", `${name}: ${notes.join(", ")}.`);
  return `${name}: ${notes.join(", ")}.`;
}

/** Sell part (0–1) or all of one copy trade now, from the page. */
export async function sellCopyNow(s: FSettings, id: number, frac: number): Promise<string> {
  // Stuck "closing" trades (a sell that timed out) can be sold too.
  const { data } = await pos().select("*").eq("fut_id", T()).eq("id", id).in("status", ["open", "closing"]).maybeSingle();
  if (!data) throw new Error("That trade isn't open any more.");
  const p = data as FPos;
  // A rugged coin may have no price at all: never wait more than 3 s for one.
  const price = n(await Promise.race([coinInfo(p.coin).then((x) => x?.price).catch(() => 0), sleep(3000).then(() => 0)])) || undefined;
  const part = Math.min(1, Math.max(0.05, frac));
  return sellCopy(s, { ...p, last: price ?? p.last }, part, part >= 1 ? "Sold by you" : `You sold ${Math.round(part * 100)}%`, price, true);
}

// ---------- Speed and protection ----------

/** Gas price (gwei) for copy trades: higher lands first. BNB Chain's normal is ~0.05–0.1. */
export const gweiOf = (s: FSettings) => Math.min(20, Math.max(0.05, n((s as any).copy_gwei) || 0.3));
/** Max slippage %: how far the price may move against you before the buy is refused (3–15). */
export const slipOf = (s: FSettings) => Math.min(15, Math.max(3, n((s as any).copy_slip) || 12));
/** The swap helpers add 3% to the "tax" they're given: this gives exactly slipOf(). */
const slipTax = (s: FSettings) => slipOf(s) - 3;
export const mevOn = (s: FSettings) => (s as any).copy_mev !== false;
const fastOf = (s: FSettings) => ({ mev: mevOn(s) ? MEV_RPC : null, gwei: gweiOf(s), approveMax: true });
const MEV_RPC = process.env.COPY_MEV_RPC || "https://bscrpc.pancakeswap.finance";
let bnbCache = { at: 0, usd: 0 };
export async function bnbPrice() {
  if (Date.now() - bnbCache.at < 60_000 && bnbCache.usd > 0) return bnbCache.usd;
  const c = await import("@/lib/ai-trader-chains");
  bnbCache = { at: Date.now(), usd: await c.nativeUsd("bsc") };
  return bnbCache.usd;
}

// ---------- Buying and selling ----------

async function copyBuy(s: FSettings, mv: Move, quiet = false): Promise<string> {
  const errs: string[] = [];
  const cfg = snipeCfg(s);
  const token = tokenOf(mv.mint)!;
  const { data: open } = await pos().select("id,coin").eq("fut_id", T()).in("status", ["open", "closing"]);
  if ((open || []).some((p: any) => p.coin === mv.mint)) return "already holding it";
  const coins = new Set((open || []).map((p: any) => p.coin));
  if (coins.size >= s.max_positions) return `holding ${coins.size} of ${s.max_positions} coins`;
  // Speed: the price lookup gets 1.5 s at most. Live buys don't need it (the price comes from what the swap gave).
  const info = await Promise.race([coinInfo(mv.mint).catch(() => null), sleep(1500).then(() => null)]);
  if (s.mode !== "live" && (!info || !(info.price > 0))) return "no price for it yet";
  if (info && info.liq > 0 && info.liq < 50) return `too little liquidity ($${Math.round(info.liq)})`;
  const sym = info?.symbol || token.slice(0, 8);
  const eq = s.mode === "live" ? { total: 0, free: 0 } : await copyEquity(s);
  const base = Math.max(1, n(mv.wallet.usd) || cfg.usd);
  const who = mv.wallet.label || short(mv.wallet.address);
  const link = `https://bscscan.com/tx/${mv.sig}`;
  const row = (usd: number, entry: number, qty: number, tx: string | null, slot: number | null, pay: string | null = null) => pos().insert({
    fut_id: T(), mode: s.mode, venue: "copy", coin: mv.mint, side: "long", lev: 1, margin_usd: usd, notional_usd: usd,
    entry, stop: slOn(s) ? entry * (1 - cfg.sl / 100) : 0, target: tpOn(s) ? entry * (1 + cfg.tp / 100) : 0, liq: null, best: entry, last: entry, size: qty,
    fees_usd: s.mode === "paper" ? usd * 0.01 : 0, why: `${sym}: copied ${who}`, open_tx: tx, risk_usd: slOn(s) ? usd * cfg.sl / 100 : usd,
    equity_at_open: eq.total, copy_from: mv.wallet.address, copy_slot: slot, copy_pay: pay,
  });

  if (s.mode !== "live") {
    const usd = +Math.min(base * (0.88 + Math.random() * 0.24), eq.free).toFixed(2);
    if (usd < 1) return `not enough practice money ($${eq.free.toFixed(2)})`;
    await sb().from("ai_futures_settings").update({ paper_usd: s.paper_usd - usd }).eq("id", T());
    s.paper_usd -= usd;
    const entry = info!.price * 1.01;
    await row(usd, entry, usd / entry, null, null);
    await flog("open", `👥 Bought ${sym} for $${usd.toFixed(2)} (practice): ${who} just bought it. ${link}`);
    return `bought ${sym}`;
  }

  // Live: every wallet you added buys it with its own BNB, at the same time.
  const c = await import("@/lib/ai-trader-chains");
  const bnbUsd = await bnbPrice();
  const fast = fastOf(s);
  const done = await Promise.all(SLOTS.map(async (slot) => {
    const a = await copyKey(slot);
    if (!a) return null;
    const w = { evm: a, sol: null };
    // This wallet's own amount if you set one, else the copied wallet's amount, else the normal buy. ±12% so it's never exactly the same size.
    const want = +((keyUsd(s, slot) ?? base) * (0.88 + Math.random() * 0.24)).toFixed(2);
    // Pay with whatever the wallet holds: USDT / USDC on BNB Chain first, else BNB. Less than the buy size: all of it.
    const [have, sts] = await Promise.all([c.chainBalance("bsc", w).catch(() => 0), c.stableBalances("bsc", w).catch(() => [])]);
    const st = sts.sort((x, y) => y.balance - x.balance)[0] || null;
    const keep = Math.max(COPY_GAS, 320_000 * gweiOf(s) * 1e-9); // only the buy's own gas: the rest is spent (add BNB later to sell)
    const bnbFree = Math.max(0, have - keep) * bnbUsd, stFree = st ? st.balance : 0;
    if (have < keep) { await flog("skip", `Wallet ${slot} skipped ${sym}: it needs ${keep.toFixed(4)} BNB for gas at ${gweiOf(s)} gwei (≈ $${(keep * bnbUsd).toFixed(2)}); it has ${have.toFixed(4)}.`); return null; }
    const useStable = stFree >= want * 0.98 || (bnbFree < want && stFree >= bnbFree);
    const usd = +Math.min(want, useStable ? stFree * 0.995 : bnbFree).toFixed(2);
    if (usd < 0.1) { await flog("skip", `Wallet ${slot} skipped ${sym}: only $${(bnbFree + stFree).toFixed(2)} to buy with (send BNB or USDT on BNB Chain).`); return null; }
    const pay = useStable ? st!.symbol : "BNB";
    let directErr = "";
    try {
      // PancakeSwap straight away (fast, and works on tokens the route service doesn't know yet); else the route service.
      const { directBuy } = await import("@/lib/ai-liq-snipe");
      const usdtPay = useStable && st!.symbol === "USDT";
      const direct = (!useStable || usdtPay) ? await directBuy(a, s, token, usd, usdtPay, slipOf(s)).catch((e) => { directErr = (e as Error).message; return null; }) : null;
      const r = direct || await c.withFastSend(fast, () => (useStable ? c.liveBuyOn("bsc", w, token, usd, slipTax(s), st) : c.liveBuyOn("bsc", w, token, usd / bnbUsd, slipTax(s)))).catch((e) => { throw new Error(directErr ? `${directErr}; route service: ${(e as Error).message}` : (e as Error).message); });
      if (!(r.raw > 0n)) throw new Error("the swap went through but no coins arrived");
      const qty = Number(r.raw) / 10 ** r.decimals;
      await row(usd, usd / qty, qty, r.hash, slot, pay);
      await flog("open", `👥 Wallet ${slot} bought ${sym} for ${pay === "BNB" ? `${(usd / bnbUsd).toFixed(4)} BNB ($${usd.toFixed(2)})` : `$${usd.toFixed(2)} ${pay}`}${usd < want * 0.9 ? " (all it had, minus the buy's gas)" : ""}: ${who} just bought it. ${link}`);
      return slot;
    } catch (e) {
      errs.push((e as Error).message);
      if (!quiet || !WAITABLE.test((e as Error).message)) await flog("error", `Wallet ${slot} couldn't buy ${sym}: ${(e as Error).message.slice(0, 160)}`);
      return null;
    }
  }));
  const ok = done.filter(Boolean);
  if (!ok.length) return (await Promise.all(SLOTS.map((x) => copyKey(x)))).some(Boolean) ? `couldn't buy ${sym}${errs[0] ? `: ${errs[0].slice(0, 160)}` : ""}` : "add a wallet (private key) to buy with";
  return `bought ${sym} (wallet ${ok.join(" + ")})`;
}

/**
 * Sell `frac` (0–1) of a copy trade back into BNB. The sold part is recorded as its own closed trade; the rest stays open.
 * `force` (you pressed Sell): highest slippage, also takes a stuck "closing" trade, and if the coin can't be swapped
 * at all (rugged, honeypot, pool pulled, wallet removed) a full sell still closes the trade (written off).
 */
export async function sellCopy(s: FSettings, p: FPos, frac: number, reason: string, price?: number, force = false): Promise<string> {
  const all = frac >= 0.85; // they sold most of it: sell everything (leftover dust is useless)
  const { data: claimed } = await pos().update({ status: "closing" }).eq("id", p.id).in("status", force ? ["open", "closing"] : ["open"]).select("id");
  if (!claimed?.length) { if (force) throw new Error("That trade isn't open any more."); return ""; }
  const part = all ? 1 : frac;
  const slot = Number((p as any).copy_slot) || 0;
  const name = p.why?.split(":")[0] || p.coin.slice(4, 10);
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
        const st = c.stableBySymbol("bsc", (p as any).copy_pay);
        // PancakeSwap straight away first (works on brand-new tokens); else the route service.
        const { directSell } = await import("@/lib/ai-liq-snipe");
        // Your own sell gets out at almost any price (a dumping coin still sells); stops 30%; the rest the normal slippage.
        const urgent = force || /stop/i.test(reason);
        const slipSell = force ? 49 : /stop/i.test(reason) ? 30 : slipOf(s);
        let directErr = "";
        const d = (!st || st.symbol === "USDT") ? await directSell(a, s, token, raw, !!st, slipSell).catch((e) => { directErr = (e as Error).message; return null; }) : null;
        if (d) { got = d.got; tx = d.hash; }
        else {
          const r = await c.withFastSend(fastOf(s), () => c.liveSellOn("bsc", w, token, raw, force ? 46 : slipTax(s), urgent ? 2000 : 0, st))
            .catch((e) => { throw new Error(directErr ? `${directErr}; route service: ${(e as Error).message}` : (e as Error).message); });
          got = st ? r.receivedNative : r.receivedNative * (await c.nativeUsd("bsc")); // stablecoin sells come back in dollars
          tx = r.hash;
        }
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
    const msg = `${pnl >= 0 ? "✅" : "🔻"} ${slot ? `Wallet ${slot} sold` : "Sold"} ${part >= 1 ? "all" : `${Math.round(part * 100)}%`} of ${name}: ${reason}. ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${cost ? ((got / cost - 1) * 100).toFixed(0) : 0}%)${p.mode === "paper" ? " (practice)" : ""}.`;
    await flog(pnl >= 0 ? "win" : "loss", msg);
    return msg;
  } catch (e) {
    const why = (e as Error).message.slice(0, 200);
    if (force && part >= 1) {
      // You said sell: it can't be swapped (rugged / honeypot / no pool / no gas), so close it anyway.
      const cost = n(p.notional_usd), fees = p.mode === "paper" ? n(p.fees_usd) : 0;
      await pos().update({ status: "closed", exit: 0, pnl_usd: -(cost + fees), reason: `${reason}: couldn't swap (written off), coins left in wallet ${slot || "?"}`, closed_at: new Date().toISOString() }).eq("id", p.id);
      const msg = `🔻 ${name} closed: it couldn't be sold (${why}). Written off at -$${(cost + fees).toFixed(2)}; any coins left stay in wallet ${slot || "?"}.`;
      await flog("loss", msg);
      return msg;
    }
    await pos().update({ status: "open" }).eq("id", p.id);
    await flog("error", `Couldn't sell ${name}: ${why}`);
    if (force) throw new Error(`Couldn't sell ${name}: ${why}. Tap "Sell all" to close it anyway.`);
    return "";
  }
}

/** Moves already acted on (live push and polling can both see the same trade): kept across runs. */
const keyOf = (mv: Move) => `${mv.sig}|${mv.wallet.address}|${mv.mint}`.toLowerCase();
function fresh(s: FSettings, moves: Move[]): Move[] {
  const seen = ((s as any).copy_seen ||= {});
  const recent: string[] = Array.isArray(seen.recent) ? seen.recent : [];
  const out = moves.filter((m) => !recent.includes(keyOf(m)));
  if (out.length) seen.recent = [...recent, ...out.map(keyOf)].slice(-200);
  return out;
}

/** Act on the copied wallets' new trades: buy what they buy (when Copy is on), sell what they sell (always). */
async function act(s: FSettings, all: Move[]): Promise<string[]> {
  const moves = fresh(s, all);
  if (!moves.length) return [];
  await sb().from("ai_futures_settings").update({ copy_seen: (s as any).copy_seen }).eq("id", T());
  const notes: string[] = [];
  // Different coins at the same time; the same coin one after another (never bought twice).
  const byCoin = new Map<string, Move[]>();
  for (const mv of moves) byCoin.set(mv.mint, [...(byCoin.get(mv.mint) || []), mv]);
  await Promise.all([...byCoin.values()].map(async (list) => { for (const mv of list) await one(mv); }));
  return notes;
  async function one(mv: Move) {
    if (mv.kind === "sell") {
      const { data } = await pos().select("*").eq("fut_id", T()).eq("status", "open").eq("coin", mv.mint).eq("copy_from", mv.wallet.address);
      await Promise.all(((data || []) as FPos[]).map((p) => sellCopy(s, p, mv.frac, `${mv.wallet.label || short(mv.wallet.address)} sold ${Math.round(mv.frac * 100)}%`)));
      if (data?.length) notes.push(`sold ${(data[0] as FPos).why?.split(":")[0]}`);
    } else if (s.enabled) {
      const r = await copyBuy(s, mv).catch((e) => `failed: ${(e as Error).message}`);
      if (!/^bought|already holding/.test(r) && WAITABLE.test(r)) {
        // The copied wallet could buy (it's the team's / whitelisted) but nobody else can yet: wait for trading to open.
        addPending(s, mv);
        await flog("skip", `Saw ${mv.wallet.label || short(mv.wallet.address)} buy ${mv.mint.slice(4, 12)}…, but others can't buy it yet (trading not open). Copy tries again every second for 15 minutes and buys the moment it can. https://bscscan.com/tx/${mv.sig}`);
        notes.push(`waiting for ${mv.mint.slice(4, 12)}`);
        return;
      }
      if (/^failed/.test(r)) await flog("error", `Copy buy ${mv.mint.slice(4, 12)}…: ${r}`);
      else if (!/^bought/.test(r)) await flog("skip", `Saw ${mv.wallet.label || short(mv.wallet.address)} buy ${mv.mint.slice(4, 12)}… but skipped: ${r}. https://bscscan.com/tx/${mv.sig}`);
      notes.push(r);
    }
  }
}
const follow = async (s: FSettings) => act(s, await newMoves(s));

/** "Can't buy it yet" (trading closed, pool not there yet…): worth trying again every second. */
const WAITABLE = /TRANSFER_FAILED|refused the test buy|token not found|no route|trading|not live|not enabled|not open|TransferHelper/i;
const WAIT_MS = 15 * 60_000;
type Pending = { mint: string; sig: string; until: number; wallet: CopyWallet };
const pendingOf = (s: FSettings): Pending[] => { const seen = ((s as any).copy_seen ||= {}); return (seen.pending ||= []); };
function addPending(s: FSettings, mv: Move) {
  const list = pendingOf(s);
  if (list.some((p) => p.mint === mv.mint)) return;
  list.push({ mint: mv.mint, sig: mv.sig, until: Date.now() + WAIT_MS, wallet: { address: mv.wallet.address, label: mv.wallet.label, usd: mv.wallet.usd } });
  sb().from("ai_futures_settings").update({ copy_seen: (s as any).copy_seen }).eq("id", T()).then(() => {}, () => {});
}
/** Tokens a copied wallet bought before trading opened: try again (quietly) until it works or 15 minutes pass. */
async function retryPending(s: FSettings): Promise<string[]> {
  const list = pendingOf(s);
  if (!list.length || !s.enabled) return [];
  const notes: string[] = [];
  const keep: Pending[] = [];
  await Promise.all(list.map(async (p) => {
    const name = p.mint.slice(4, 12);
    if (Date.now() > p.until) { await flog("skip", `Stopped waiting for ${name}…: trading didn't open for others within 15 minutes.`); return; }
    const r = await copyBuy(s, { wallet: p.wallet, sig: p.sig, mint: p.mint, kind: "buy", frac: 0 }, true).catch((e) => `failed: ${(e as Error).message}`);
    if (/^bought/.test(r)) { notes.push(r); return; }
    if (/already holding/.test(r)) return;
    if (WAITABLE.test(r)) { keep.push(p); return; }
    await flog("skip", `Stopped waiting for ${name}…: ${r.slice(0, 160)}`);
  }));
  if (keep.length !== list.length) {
    (s as any).copy_seen.pending = keep;
    await sb().from("ai_futures_settings").update({ copy_seen: (s as any).copy_seen }).eq("id", T());
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
    if (n(p.stop) > 0 && price <= n(p.stop)) await sellCopy(s, { ...p, last: price, best }, 1, `Stop-loss (${((price / n(p.entry) - 1) * 100).toFixed(0)}%)`, price);
    else if (n(p.target) > 0 && price >= n(p.target)) await sellCopy(s, { ...p, last: price, best }, 1, `Take profit (+${((price / n(p.entry) - 1) * 100).toFixed(0)}%)`, price);
    else await pos().update({ last: price, best }).eq("id", p.id);
  }));
}

/** One minute of Copy: watch the wallets about every second for ~48 s, stop-losses every ~5 s. */
export async function runCopy(s: FSettings): Promise<string> {
  const t0 = Date.now();
  const ws = copyWallets(s).filter((w) => w.on !== false);
  if (!ws.length) { await stops(s).catch(() => {}); return "Paste a BNB Chain wallet to copy."; }
  const eq = await copyEquity(s).catch(() => ({ total: 0, free: 0 }));
  const today = new Date().toISOString().slice(0, 10);
  if (s.day !== today || s.day_start_usd == null) { await sb().from("ai_futures_settings").update({ day: today, day_start_usd: eq.total, day_peak_usd: eq.total }).eq("id", T()); s.day = today; s.day_start_usd = eq.total; (s as any).day_peak_usd = eq.total; }
  const down = eq.total < n(s.day_start_usd) * (1 - s.daily_loss_pct / 100);
  await trackPeak(s as any, eq.total).catch(() => {});
  const locked = profitLocked(s, eq.total);
  const buying = s.enabled && !down && !locked;
  const until = t0 + 49_000; // the minute's run is capped at 52 s
  const notes: string[] = [];
  let lastStop = 0, lastPoll = 0;
  const run = { ...s, enabled: buying } as FSettings;
  // Live push: acted on the moment a copied wallet's trade lands; polling every second stays on as the backup.
  const queue: { ins: any[]; outs: any[]; client: any }[] = [];
  let wake: (() => void) | null = null;
  const stopLive = liveWatch(ws, (ins, outs, client) => { queue.push({ ins, outs, client }); wake?.(); });
  try {
    while (Date.now() < until) {
      while (queue.length) {
        const q = queue.splice(0);
        const moves = await movesFrom(q.flatMap((x) => x.ins), q.flatMap((x) => x.outs), ws, [q[0].client, bscLogs()]).catch(() => []);
        notes.push(...(await act(run, moves).catch((e) => [`live error: ${(e as Error).message}`])));
      }
      const t = Date.now();
      if (t - lastPoll >= 1000) {
        lastPoll = t;
        notes.push(...(await follow(run).catch((e) => [`watch error: ${(e as Error).message}`])));
        notes.push(...(await retryPending(run).catch(() => [])));
      }
      if (t - lastStop > 5000) { lastStop = t; await stops(run).catch(() => {}); }
      if (!queue.length) await new Promise<void>((r) => { wake = r; setTimeout(r, Math.max(100, 1000 - (Date.now() - lastPoll))); });
      wake = null;
    }
  } finally { stopLive(); }
  const head = !s.enabled ? "Off: sells still follow the wallets." : down ? `Paused buying for today (down past ${s.daily_loss_pct}%); sells still follow.` : locked || `Watching ${ws.length} BNB Chain wallet${ws.length === 1 ? "" : "s"}.`;
  const did = notes.filter((x) => /^(bought|sold)/.test(x));
  return did.length ? `${head} ${did.join(" · ")}` : `${head} Account $${eq.total.toFixed(2)}.`;
}
