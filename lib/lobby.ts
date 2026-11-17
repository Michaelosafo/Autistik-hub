/**
 * 🎯 Lobby (server only): paste a BNB Chain token, and the Lobby wallet buys it the moment liquidity lands on
 * PancakeSwap, then sells everything at the X you picked (2x, 3x, 5x…) or your stop-loss.
 *
 * Speed, in order of what matters most:
 *   1. It watches the pool itself, several times a second, instead of waiting for a chart site to list the coin.
 *   2. The buy is built and signed here with a fixed gas limit and a cached nonce (no extra round trips), then sent
 *      to several BNB Chain endpoints at once (incl. 48 Club, which many block builders take from).
 *   3. It pays a higher gas price (Speed: Fast / Faster / Fastest) so builders put it ahead of slower buys.
 *   4. Auto slippage: from the pool's size and your buy it works out how far the price will move from your own buy
 *      plus other snipers in the same block, and sets the lowest slippage that should still go through, never above
 *      your max. Too low and the buy fails behind other snipers; too high and you overpay.
 * No bot can promise to be first: other snipers bid for the same block. This gets in as early as a server can.
 *
 * Safety: you can set a minimum liquidity (skip "bait" pools with a few dollars in them). Right after buying it checks
 * the token on honeypot.is; if it can't be sold or the sell tax is over your limit, it tries to get out at once.
 *
 * The wallet is the Lobby's own (key kept in Supabase Vault, like the other AI desks). You fund it from your
 * connected wallet and withdraw back to it from the Lobby page.
 */
import { createPublicClient, encodeFunctionData, erc20Abi, fallback, formatEther, getAddress, http, keccak256, parseAbi, parseEther, parseGwei, type PrivateKeyAccount } from "viem";
import { bsc } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { supabaseService } from "@/lib/supabase/server";

export const LOBBY_DESK = 700000;
const ROUTER = getAddress("0x10ED43C718714eb63d5aA57B78B54704E256024E");
const FACTORY = getAddress("0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73");
const WBNB = getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");
const USDT = getAddress("0x55d398326f99059fF775485246999027B3197955");
const ZERO = "0x0000000000000000000000000000000000000000";
/** Left in the wallet for selling and approving. */
export const GAS_KEEP_BNB = 0.006;
const BUY_GAS = 600_000n, SELL_GAS = 700_000n, APPROVE_GAS = 80_000n;
/** Gas price per Speed (gwei), never below the network's price. */
export const SPEEDS = { fast: 1, faster: 3, fastest: 10 } as const;
export type Speed = keyof typeof SPEEDS;

const uniq = (a: (string | undefined)[]) => [...new Set(a.map((x) => (x || "").trim()).filter(Boolean))];
/** Reads: your own fast node first (LOBBY_RPC) if set; public ones are rate limited. */
const READ_RPCS = uniq([process.env.LOBBY_RPC, process.env.NEXT_PUBLIC_BSC_RPC, "https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed1.defibit.io", "https://bsc.publicnode.com"]);
/** Sends: every one of these at once; the first to reach a builder wins. */
const SEND_RPCS = uniq([process.env.LOBBY_RPC, process.env.LOBBY_SEND_RPC, "https://rpc-bsc.48.club", "https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed1.defibit.io", "https://bsc-dataseed1.ninicoin.io", "https://bsc.publicnode.com"]);
const pc = createPublicClient({ chain: bsc, transport: fallback(READ_RPCS.map((u) => http(u, { timeout: 4000 }))), batch: { multicall: true } }) as any;

const sb = () => supabaseService();
const t = () => sb().from("lobby_snipes");
const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const PAIR = parseAbi(["function getReserves() view returns (uint112,uint112,uint32)", "function token0() view returns (address)"]);
const FACT = parseAbi(["function getPair(address,address) view returns (address)"]);
const RT = parseAbi([
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
]);

export type Snipe = {
  id: number; trader_id: number; token: string; symbol: string | null; name: string | null; decimals: number;
  buy_bnb: number; take_x: number; stop_pct: number | null; max_slip: number; speed: Speed; min_liq_bnb: number; max_sell_tax: number;
  status: "watching" | "buying" | "holding" | "selling" | "sold" | "failed" | "cancelled";
  pool: string | null; quote: "WBNB" | "USDT" | null; attempts: number; sell_fails: number; simulate: boolean;
  liq_block: number | null; buy_block: number | null; slip_used: number | null; gas_gwei: number | null;
  tokens_raw: string | null; spent_bnb: number | null; out_bnb: number | null;
  buy_tax: number | null; sell_tax: number | null; honeypot: boolean | null;
  last_x: number | null; peak_x: number | null; buy_tx: string | null; sell_tx: string | null;
  note: string | null; log: { at: string; m: string }[]; created_at: string; bought_at: string | null; sold_at: string | null;
};
const norm = (r: any): Snipe => {
  for (const k of ["buy_bnb", "take_x", "max_slip", "min_liq_bnb", "max_sell_tax"]) r[k] = n(r[k]);
  for (const k of ["stop_pct", "slip_used", "gas_gwei", "spent_bnb", "out_bnb", "buy_tax", "sell_tax", "last_x", "peak_x", "liq_block", "buy_block"]) r[k] = r[k] == null ? null : n(r[k]);
  r.log = Array.isArray(r.log) ? r.log : [];
  return r as Snipe;
};

async function upd(s: Snipe, patch: Partial<Snipe>, msg?: string) {
  if (msg) { s.log = [...s.log, { at: new Date().toISOString(), m: msg }].slice(-40); (patch as any).log = s.log; (patch as any).note = msg; }
  Object.assign(s, patch);
  await t().update({ ...patch, updated_at: new Date().toISOString() }).eq("id", s.id);
}
/** Moves a snipe from one status to the next only if nobody else did first (no double buys or sells). */
async function claim(s: Snipe, from: Snipe["status"], to: Snipe["status"]): Promise<boolean> {
  const { data } = await t().update({ status: to, updated_at: new Date().toISOString() }).eq("id", s.id).eq("status", from).select("id");
  if (data?.length) { s.status = to; return true; }
  return false;
}

// ---------------------------------------------------------------- Wallet (key in Supabase Vault)

const keyCache = new Map<number, PrivateKeyAccount>();
export async function lobbyAccount(trader: number): Promise<PrivateKeyAccount | null> {
  const c = keyCache.get(trader);
  if (c) return c;
  const { data } = await sb().rpc("ai_futures_key_get", { p_id: LOBBY_DESK + trader });
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data)) return null;
  const a = privateKeyToAccount(data as `0x${string}`);
  keyCache.set(trader, a);
  return a;
}
export async function createLobbyWallet(trader: number): Promise<string> {
  if (await lobbyAccount(trader)) throw new Error("The Lobby wallet already exists.");
  const key = generatePrivateKey();
  const { error } = await sb().rpc("ai_futures_key_set", { p_id: LOBBY_DESK + trader, p_key: key });
  if (error) throw new Error(error.message);
  return privateKeyToAccount(key).address;
}
export async function revealLobbyKey(trader: number): Promise<string> {
  const { data } = await sb().rpc("ai_futures_key_get", { p_id: LOBBY_DESK + trader });
  if (typeof data !== "string") throw new Error("There's no Lobby wallet yet.");
  return data;
}

// ---------------------------------------------------------------- Sending fast

/** Nonce kept in memory between sends so nothing waits on the network to ask for it. */
const nonces = new Map<string, number>();
async function nextNonce(a: PrivateKeyAccount, fresh = false) {
  if (fresh || !nonces.has(a.address)) nonces.set(a.address, Number(await pc.getTransactionCount({ address: a.address, blockTag: "pending" })));
  const v = nonces.get(a.address)!;
  nonces.set(a.address, v + 1);
  return v;
}
async function gasPrice(speed: Speed): Promise<bigint> {
  const net: bigint = await pc.getGasPrice().catch(() => parseGwei("0.1"));
  const want = parseGwei(String(SPEEDS[speed] ?? 3));
  return want > net * 2n ? want : net * 2n;
}
/** Signs here and sends to every endpoint at once; returns the hash as soon as one accepts it. */
async function blast(a: PrivateKeyAccount, tx: { to: `0x${string}`; data: `0x${string}`; value?: bigint; gas: bigint; gasPrice: bigint }): Promise<`0x${string}`> {
  let nonce = await nextNonce(a);
  for (let round = 0; round < 2; round++) {
    const raw = await a.signTransaction({ chainId: 56, type: "legacy", to: tx.to, data: tx.data, value: tx.value ?? 0n, gas: tx.gas, gasPrice: tx.gasPrice, nonce });
    const hash = keccak256(raw);
    const results = await Promise.allSettled(SEND_RPCS.map((u) => fetch(u, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [raw] }),
    }).then((r) => r.json())));
    const ok = results.some((r) => r.status === "fulfilled" && (r.value?.result || /already known|known transaction/i.test(String(r.value?.error?.message))));
    if (ok) return hash;
    const err = results.map((r) => (r.status === "fulfilled" ? String(r.value?.error?.message || "") : "")).find(Boolean) || "no endpoint answered";
    if (round === 0 && /nonce/i.test(err)) { nonce = await nextNonce(a, true); continue; }
    nonces.delete(a.address);
    throw new Error(`Couldn't send: ${err}`);
  }
  throw new Error("Couldn't send.");
}
async function receipt(hash: `0x${string}`, ms = 40_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await pc.getTransactionReceipt({ hash }).catch(() => null);
    if (r) return r;
    await sleep(250);
  }
  throw new Error("Still not in a block after 40s.");
}

// ---------------------------------------------------------------- Pools

const pairCache = new Map<string, `0x${string}`>();
async function pairOf(token: `0x${string}`, quote: `0x${string}`) {
  const k = `${token}:${quote}`;
  if (pairCache.has(k)) return pairCache.get(k)!;
  const p = (await pc.readContract({ address: FACTORY, abi: FACT, functionName: "getPair", args: [token, quote] })) as `0x${string}`;
  if (p && p !== ZERO) pairCache.set(k, p);
  return p && p !== ZERO ? p : null;
}
async function reserves(pair: `0x${string}`, token: `0x${string}`) {
  const [[r0, r1], t0] = await Promise.all([
    pc.readContract({ address: pair, abi: PAIR, functionName: "getReserves" }) as Promise<[bigint, bigint, number]>,
    pc.readContract({ address: pair, abi: PAIR, functionName: "token0" }) as Promise<`0x${string}`>,
  ]);
  return getAddress(t0) === getAddress(token) ? { tok: r0, q: r1 } : { tok: r1, q: r0 };
}
/** USDT per BNB, from PancakeSwap's own WBNB/USDT pool (cached a minute). */
let bnbPx: { at: number; v: number } | null = null;
async function usdtPerBnb() {
  if (bnbPx && Date.now() - bnbPx.at < 60_000) return bnbPx.v;
  const p = await pairOf(WBNB, USDT);
  const r = await reserves(p!, WBNB);
  bnbPx = { at: Date.now(), v: Number(r.q) / Number(r.tok) };
  return bnbPx.v;
}
const outOf = (inp: bigint, rin: bigint, rout: bigint) => (inp * 9975n * rout) / (rin * 10000n + inp * 9975n);

type Pool = { pair: `0x${string}`; quote: "WBNB" | "USDT"; path: `0x${string}`[]; liqBnb: number; expected: bigint; impact: number };
/** The token's pool with the most liquidity (WBNB first, then USDT), or null while there's none. */
async function findPool(token: `0x${string}`, buyWei: bigint): Promise<Pool | null> {
  const [pw, pu] = await Promise.all([pairOf(token, WBNB), pairOf(token, USDT)]);
  const out: Pool[] = [];
  if (pw) {
    const r = await reserves(pw, token);
    if (r.q > 0n && r.tok > 0n) out.push({ pair: pw, quote: "WBNB", path: [WBNB, token], liqBnb: Number(formatEther(r.q)), expected: outOf(buyWei, r.q, r.tok), impact: Number(buyWei) / Number(r.q + buyWei) });
  }
  if (pu) {
    const r = await reserves(pu, token);
    if (r.q > 0n && r.tok > 0n) {
      const px = await usdtPerBnb();
      const bp = await pairOf(WBNB, USDT);
      const br = await reserves(bp!, WBNB);
      const usdtIn = outOf(buyWei, br.tok, br.q);
      out.push({ pair: pu, quote: "USDT", path: [WBNB, USDT, token], liqBnb: Number(formatEther(r.q)) / px, expected: outOf(usdtIn, r.q, r.tok), impact: Number(usdtIn) / Number(r.q + usdtIn) });
    }
  }
  return out.sort((a, b) => b.liqBnb - a.liqBnb)[0] || null;
}

/**
 * Auto slippage: room for our own price move, the snipers likely to land in the same block (they scale with how
 * thin the pool is) and a typical launch buy tax. The lowest that should still go through, capped at your max.
 */
export function autoSlip(impact: number, maxSlip: number) {
  const own = impact * 100;
  const crowd = Math.min(20, own * 1.5 + 4);
  const want = Math.ceil(own + crowd + 4);
  return Math.max(3, Math.min(maxSlip, want));
}

// ---------------------------------------------------------------- Status

export async function lobbyStatus(trader: number) {
  const a = await lobbyAccount(trader);
  const [bal, px, { data }] = await Promise.all([
    a ? pc.getBalance({ address: a.address }).catch(() => null) : null,
    usdtPerBnb().catch(() => 0),
    t().select("*").eq("trader_id", trader).order("id", { ascending: false }).limit(40),
  ]);
  return { address: a?.address ?? null, bnb: bal == null ? null : Number(formatEther(bal)), bnbUsd: px, snipes: (data || []).map(norm), speeds: SPEEDS, gasKeep: GAS_KEEP_BNB };
}

// ---------------------------------------------------------------- Add / cancel / sell / withdraw

export type NewSnipe = { token: string; buy_bnb: number; take_x: number; stop_pct?: number | null; max_slip?: number; speed?: Speed; min_liq_bnb?: number; max_sell_tax?: number };
export async function addSnipe(trader: number, b: NewSnipe): Promise<string> {
  const a = await lobbyAccount(trader);
  if (!a) throw new Error("Create the Lobby wallet first.");
  const raw = String(b.token || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error("Paste a BNB Chain token address (0x… with 42 characters).");
  const token = getAddress(raw);
  if ([WBNB, USDT].includes(token)) throw new Error("That's WBNB / USDT, not a new project.");
  const code = await pc.getCode({ address: token }).catch(() => null);
  if (!code || code === "0x") throw new Error("There's no token contract at that address on BNB Chain yet. Check it's the BNB Chain address, not another chain's.");
  const [symbol, name, decimals] = await Promise.all([
    pc.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
    pc.readContract({ address: token, abi: erc20Abi, functionName: "name" }).catch(() => null),
    pc.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
  ]);
  const buy = Math.min(100, Math.max(0.001, n(b.buy_bnb)));
  const take = Math.min(1000, Math.max(1.1, n(b.take_x) || 2));
  const speed: Speed = (["fast", "faster", "fastest"] as const).includes(b.speed as Speed) ? (b.speed as Speed) : "faster";
  const bal = Number(formatEther(await pc.getBalance({ address: a.address })));
  const { data: busy } = await t().select("buy_bnb").eq("trader_id", trader).eq("status", "watching");
  const reserved = (busy || []).reduce((s: number, r: any) => s + n(r.buy_bnb), 0);
  if (bal < reserved + buy + GAS_KEEP_BNB) throw new Error(`The Lobby wallet has ${bal.toFixed(4)} BNB${reserved ? ` (${reserved} BNB already waiting on other snipes)` : ""}. This buy needs ${buy} BNB plus about ${GAS_KEEP_BNB} BNB for gas. Add funds first.`);
  const { data: dup } = await t().select("id").eq("trader_id", trader).eq("token", token).in("status", ["watching", "buying", "holding", "selling"]).limit(1);
  if (dup?.length) throw new Error("You're already sniping or holding this token.");
  const live = await findPool(token, parseEther(String(buy))).catch(() => null);
  const row = {
    trader_id: trader, token, symbol: symbol ? String(symbol).slice(0, 24) : null, name: name ? String(name).slice(0, 60) : null, decimals: Number(decimals) || 18,
    buy_bnb: buy, take_x: take, stop_pct: b.stop_pct ? Math.min(95, Math.max(5, n(b.stop_pct))) : null,
    max_slip: Math.min(49, Math.max(1, n(b.max_slip) || 25)), speed, min_liq_bnb: Math.max(0, n(b.min_liq_bnb ?? 0.5)),
    max_sell_tax: Math.min(99, Math.max(0, n(b.max_sell_tax ?? 30))), status: "watching",
    note: live ? "Liquidity is already there: buying now." : "Watching for liquidity…",
    log: [{ at: new Date().toISOString(), m: `Sniping ${symbol || short(token)}: ${buy} BNB, sell at ${take}x${b.stop_pct ? `, stop -${b.stop_pct}%` : ""}, speed ${speed}.` }],
  };
  const { error } = await t().insert(row);
  if (error) throw new Error(error.message);
  return live ? `${symbol || "Token"} already has liquidity, so it buys right now.` : `Watching ${symbol || short(token)}. It buys the moment liquidity is added.`;
}

async function mineSnipe(trader: number, id: number) {
  const { data } = await t().select("*").eq("id", id).eq("trader_id", trader).maybeSingle();
  if (!data) throw new Error("Not found.");
  return norm(data);
}
export async function cancelSnipe(trader: number, id: number) {
  const s = await mineSnipe(trader, id);
  if (!(await claim(s, "watching", "cancelled"))) throw new Error(s.status === "holding" ? "It already bought. Use Sell now." : "It's not waiting any more.");
  await upd(s, {}, "Cancelled.");
}
export async function setTarget(trader: number, id: number, take_x: number, stop_pct: number | null) {
  const s = await mineSnipe(trader, id);
  if (!["watching", "holding"].includes(s.status)) throw new Error("Only for snipes that are waiting or holding.");
  await upd(s, { take_x: Math.min(1000, Math.max(1.05, n(take_x))), stop_pct: stop_pct ? Math.min(95, Math.max(5, n(stop_pct))) : null }, `Now sells at ${take_x}x${stop_pct ? `, stop -${stop_pct}%` : ""}.`);
}
export async function sellNow(trader: number, id: number) {
  const s = await mineSnipe(trader, id);
  const a = await lobbyAccount(trader);
  if (!a) throw new Error("No Lobby wallet.");
  return sell(a, s, "You pressed Sell now");
}
export async function withdrawBnb(trader: number, to: string, amount: number | "max") {
  const a = await lobbyAccount(trader);
  if (!a) throw new Error("No Lobby wallet.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error("Connect your wallet (or paste a 0x address) to withdraw to.");
  const { data: busy } = await t().select("id").eq("trader_id", trader).in("status", ["buying", "selling"]).limit(1);
  if (busy?.length) throw new Error("A buy or sell is going through right now. Try again in a few seconds.");
  const bal: bigint = await pc.getBalance({ address: a.address });
  const gp: bigint = await pc.getGasPrice();
  const fee = gp * 21_000n * 2n;
  const value = amount === "max" ? bal - fee : parseEther(String(amount));
  if (value <= 0n || value + fee > bal) throw new Error(`Not enough: the wallet has ${formatEther(bal)} BNB.`);
  const hash = await blast(a, { to: getAddress(to), data: "0x", value, gas: 21_000n, gasPrice: gp });
  const r = await receipt(hash);
  if (r.status !== "success") throw new Error("The withdrawal failed.");
  return `Sent ${Number(formatEther(value)).toFixed(5)} BNB to ${short(to)}.`;
}

// ---------------------------------------------------------------- The engine

async function tryBuy(a: PrivateKeyAccount, s: Snipe) {
  const token = getAddress(s.token);
  const wei = parseEther(String(s.buy_bnb));
  const pool = await findPool(token, wei);
  if (!pool) return;
  if (pool.liqBnb < s.min_liq_bnb) {
    if (!s.note?.startsWith("Liquidity is only")) await upd(s, {}, `Liquidity is only ${pool.liqBnb.toFixed(3)} BNB (your minimum is ${s.min_liq_bnb}). Waiting for more.`);
    return;
  }
  const slip = autoSlip(pool.impact, s.max_slip);
  const minOut = (pool.expected * BigInt(10000 - Math.round(slip * 100))) / 10000n;
  const data = encodeFunctionData({ abi: RT, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args: [minOut, pool.path, a.address, BigInt(Math.floor(Date.now() / 1000) + 90)] });
  // After a failed try (trading not opened yet), test it first so gas isn't wasted every block.
  if (s.simulate) {
    const ok = await pc.call({ account: a.address, to: ROUTER, data, value: wei, gas: BUY_GAS }).then(() => true, () => false);
    if (!ok) return;
  }
  if (!(await claim(s, "watching", "buying"))) return;
  const liqBlock = Number(await pc.getBlockNumber().catch(() => 0n));
  const gp = await gasPrice(s.speed);
  const before = (await pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a.address] }).catch(() => 0n)) as bigint;
  let hash: `0x${string}`;
  try { hash = await blast(a, { to: ROUTER, data, value: wei, gas: BUY_GAS, gasPrice: gp }); }
  catch (e) { await upd(s, { status: "watching" }, `Buy not sent: ${(e as Error).message}`); return; }
  await upd(s, { buy_tx: hash, slip_used: slip, gas_gwei: Number(gp) / 1e9, pool: pool.pair, quote: pool.quote, liq_block: s.liq_block ?? liqBlock },
    `Liquidity found (${pool.liqBnb.toFixed(2)} BNB in the ${pool.quote} pool). Buy sent at ${(Number(gp) / 1e9).toFixed(1)} gwei, ${slip}% slippage.`);
  const r = await receipt(hash).catch(() => null);
  if (!r || r.status !== "success") {
    const tries = s.attempts + 1;
    if (tries >= 6) { await upd(s, { status: "failed", attempts: tries }, `Buy failed ${tries} times (trading may be closed, the token may block buys, or the price moved past ${s.max_slip}%). Stopped. Your BNB is still in the wallet.`); return; }
    await upd(s, { status: "watching", attempts: tries, simulate: true }, `Buy didn't go through (try ${tries} of 6): trading may not be open yet or the price ran past your slippage. Watching every block, and it tests the buy first now.`);
    return;
  }
  const after = (await pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a.address] })) as bigint;
  const got = after - before;
  const fee = BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice ?? gp);
  const blocks = s.liq_block ? Number(r.blockNumber) - s.liq_block : null;
  await upd(s, { status: "holding", tokens_raw: got.toString(), spent_bnb: s.buy_bnb + Number(formatEther(fee)), buy_block: Number(r.blockNumber), bought_at: new Date().toISOString(), last_x: 1, peak_x: 1 },
    `✅ Bought ${(Number(got) / 10 ** s.decimals).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${s.symbol || "tokens"}${blocks != null ? ` (${blocks <= 0 ? "same block as" : `${blocks} block${blocks === 1 ? "" : "s"} after`} the liquidity was seen)` : ""}. Selling at ${s.take_x}x.`);
  // Approve now so the sell is one transaction when the time comes.
  try { await blast(a, { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, 2n ** 256n - 1n] }), gas: APPROVE_GAS, gasPrice: await gasPrice("fast") }); } catch { /* the sell approves if this didn't */ }
  // Can it be sold, and at what tax?
  const { simulateHoneypot } = await import("@/lib/honeypot-sim");
  const hp = await simulateHoneypot("bsc", token).catch(() => null);
  if (hp) {
    await upd(s, { honeypot: hp.honeypot, buy_tax: hp.buyTax, sell_tax: hp.sellTax });
    if (hp.honeypot || (hp.sellTax ?? 0) > s.max_sell_tax) await sell(a, s, hp.honeypot ? `⚠️ honeypot.is says it can't be sold${hp.reason ? ` (${hp.reason})` : ""}: getting out` : `⚠️ Sell tax is ${hp.sellTax}% (your limit is ${s.max_sell_tax}%): getting out`);
  }
}

/** What the tokens would sell for now, in BNB, and the X against what was spent. */
async function valueNow(s: Snipe) {
  const amt = BigInt(s.tokens_raw || "0");
  if (amt <= 0n) return null;
  const token = getAddress(s.token);
  const path = s.quote === "USDT" ? [token, USDT, WBNB] : [token, WBNB];
  const outs = (await pc.readContract({ address: ROUTER, abi: RT, functionName: "getAmountsOut", args: [amt, path] })) as bigint[];
  const gross = outs[outs.length - 1];
  const net = Number(formatEther(gross)) * (1 - (s.sell_tax ?? 0) / 100);
  return { gross, path, x: net / s.buy_bnb };
}

const lastSave = new Map<number, number>();
async function checkExit(a: PrivateKeyAccount, s: Snipe) {
  const v = await valueNow(s).catch(() => null);
  if (!v) return;
  const peak = Math.max(s.peak_x ?? 1, v.x);
  if (Date.now() - (lastSave.get(s.id) || 0) > 4000) { lastSave.set(s.id, Date.now()); await upd(s, { last_x: v.x, peak_x: peak }); }
  else { s.last_x = v.x; s.peak_x = peak; }
  if (v.x >= s.take_x) return sell(a, s, `🎯 Hit ${v.x.toFixed(2)}x (target ${s.take_x}x)`);
  if (s.stop_pct && v.x <= 1 - s.stop_pct / 100) return sell(a, s, `🛑 Stop-loss: down to ${v.x.toFixed(2)}x`);
}

async function sell(a: PrivateKeyAccount, s: Snipe, why: string): Promise<string> {
  if (!(await claim(s, "holding", "selling"))) return "It's not holding this token.";
  try {
    const token = getAddress(s.token);
    const amt = (await pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a.address] })) as bigint;
    const mine = BigInt(s.tokens_raw || "0");
    const qty = mine > 0n && mine < amt ? mine : amt;
    if (qty <= 0n) { await upd(s, { status: "sold", sold_at: new Date().toISOString(), out_bnb: 0 }, "No tokens left in the wallet."); return "Nothing to sell."; }
    const allow = (await pc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [a.address, ROUTER] })) as bigint;
    if (allow < qty) {
      const h = await blast(a, { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, 2n ** 256n - 1n] }), gas: APPROVE_GAS, gasPrice: await gasPrice(s.speed) });
      await receipt(h);
    }
    const path = s.quote === "USDT" ? [token, USDT, WBNB] : [token, WBNB];
    const outs = (await pc.readContract({ address: ROUTER, abi: RT, functionName: "getAmountsOut", args: [qty, path] })) as bigint[];
    const slip = Math.min(49, Math.max(5, (s.sell_tax ?? 0) + 8 + s.sell_fails * 10));
    const minOut = (outs[outs.length - 1] * BigInt(100 - Math.round(slip))) / 100n;
    const bal0: bigint = await pc.getBalance({ address: a.address });
    const gp = await gasPrice(s.speed);
    const hash = await blast(a, { to: ROUTER, gas: SELL_GAS, gasPrice: gp, data: encodeFunctionData({ abi: RT, functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens", args: [qty, minOut, path, a.address, BigInt(Math.floor(Date.now() / 1000) + 90)] }) });
    await upd(s, { sell_tx: hash }, `${why}. Selling…`);
    const r = await receipt(hash);
    if (r.status !== "success") throw new Error("the sell reverted on-chain");
    const fee = BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice ?? gp);
    const bal1: bigint = await pc.getBalance({ address: a.address });
    const out = Number(formatEther(bal1 - bal0 + fee));
    const x = out / s.buy_bnb;
    await upd(s, { status: "sold", out_bnb: out, last_x: x, sold_at: new Date().toISOString() }, `💰 Sold for ${out.toFixed(4)} BNB (${x.toFixed(2)}x, ${out - s.buy_bnb >= 0 ? "+" : ""}${(out - s.buy_bnb).toFixed(4)} BNB).`);
    return `Sold for ${out.toFixed(4)} BNB (${x.toFixed(2)}x).`;
  } catch (e) {
    const fails = s.sell_fails + 1;
    await upd(s, { status: "holding", sell_fails: fails }, `Sell failed (${(e as Error).message}). ${fails < 4 ? "Trying again with more slippage." : "Still holding: the token may block sells."}`);
    return `Sell failed: ${(e as Error).message}`;
  }
}

// ---------------------------------------------------------------- The watch loop

/** One watcher per trader at a time (the page and the minute job both start it). */
async function lease(trader: number, ms: number): Promise<boolean> {
  await sb().from("lobby_runners").upsert({ trader_id: trader, until: null }, { onConflict: "trader_id", ignoreDuplicates: true });
  const now = new Date().toISOString();
  const { data } = await sb().from("lobby_runners").update({ until: new Date(Date.now() + ms + 3000).toISOString() }).eq("trader_id", trader).or(`until.is.null,until.lt."${now}"`).select("trader_id");
  return !!data?.length;
}
const release = (trader: number) => sb().from("lobby_runners").update({ until: null }).eq("trader_id", trader);

/** Watches every waiting and holding snipe of this trader for up to `ms`. */
export async function runLobby(trader: number, ms = 52_000): Promise<string> {
  const a = await lobbyAccount(trader);
  if (!a) return "no wallet";
  if (!(await lease(trader, ms))) return "already watching";
  const end = Date.now() + ms;
  let list: Snipe[] = [], loaded = 0, rounds = 0;
  try {
    nonces.delete(a.address);
    while (Date.now() < end) {
      if (Date.now() - loaded > 2500) {
        const { data } = await t().select("*").eq("trader_id", trader).in("status", ["watching", "holding"]);
        list = (data || []).map(norm); loaded = Date.now();
        if (!list.length) break;
      }
      const watching = list.filter((s) => s.status === "watching");
      await Promise.all(list.map((s) => (s.status === "watching" ? tryBuy(a, s) : s.status === "holding" ? checkExit(a, s) : null)?.catch(() => null)));
      rounds++;
      await sleep(watching.length ? 250 : 1000);
    }
  } finally { await release(trader); }
  return `${rounds} checks`;
}

/** Every trader with something waiting or held (for the minute job). */
export async function activeTraders(): Promise<number[]> {
  const { data } = await t().select("trader_id").in("status", ["watching", "holding"]);
  return [...new Set((data || []).map((r: any) => Number(r.trader_id)))];
}
