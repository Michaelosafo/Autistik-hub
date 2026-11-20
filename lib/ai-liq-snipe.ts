/**
 * ⚡ BSC Sniper (server only). Paste a token's contract address before its liquidity is added. Every new block
 * (~0.45 s) one multicall checks each waiting token for a PancakeSwap pool with liquidity (v2 against WBNB or USDT,
 * v3 at every fee). The moment liquidity is there, every wallet you added buys it at once:
 *
 *  - Direct to the PancakeSwap v2 router (no quote API in the way), path WBNB→token or WBNB→USDT→token, or with
 *    USDT if the wallet holds enough of it. v3-only pools go through the swap aggregator.
 *  - The buy is test-run first (eth_call): if trading isn't open yet, nothing is sent and it tries again next block,
 *    so no gas is burnt on failed buys. It buys in the first block trading works.
 *  - Every selected wallet is quoted and signed first (its own nonce and gas). The signed buys are then broadcast
 *    together, to the private relay and COPY_BSC_RPC at the same time, so they land in the same block or the next one.
 *    One wallet failing does not hold the others back.
 *  - Slippage is yours (auto 20%): the least it accepts is the router's quote minus that.
 *
 * After the buy: its value is read from the pool every ~1.5 s; at your target (e.g. 2x) it sells the share you chose.
 * Sell buttons and your own stop-loss / take profit work like on Copy. Practice mode: pretend buys at the pool price.
 */
import { createPublicClient, encodePacked, encodeFunctionData, fallback, getAddress, getContractAddress, http, keccak256, parseAbi, webSocket } from "viem";
import { bsc } from "viem/chains";
import type { PrivateKeyAccount } from "viem/accounts";
import { supabaseService } from "@/lib/supabase/server";
import { T } from "@/lib/ai-trader-ctx";
import { flog, type FPos, type FSettings } from "@/lib/ai-futures";
import { SLOTS, bnbPrice, copyKey, copyKeys, gweiOf, keyUsd, mevOn, sellCopy } from "@/lib/ai-copy";

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const sb = () => supabaseService();
const pos = () => sb().from("ai_futures_positions");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ROUTER = getAddress("0x10ED43C718714eb63d5aA57B78B54704E256024E");
const V2_FACTORY = getAddress("0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73");
const V3_FACTORY = getAddress("0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865");
const WBNB = getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");
const USDT = getAddress("0x55d398326f99059fF775485246999027B3197955");
const ZERO = "0x0000000000000000000000000000000000000000";
const V3_FEES = [100, 500, 2500, 10000] as const;
const GAS_LIMIT = 700_000n;
const GAS_KEEP = 0.0002; // least BNB left for the buy's own gas
/** Most gas a buy is given (its estimate +30%, capped here), so the buy always fits what's kept back. */
const BUY_GAS = 320_000n;
/**
 * BNB kept back: only the buy's own gas at your gas speed. Everything else is spent on the buy; you add BNB later
 * for the sell.
 */
const gasKeep = (s: FSettings) => Math.max(GAS_KEEP, Number(BUY_GAS) * snipeGwei(s) * 1e-9);
/** Snipe buys never go below Turbo gas (1 gwei), so they sit at the top of the block; Max (3 gwei) still applies. */
const TURBO_GWEI = 1;
const snipeGwei = (s: FSettings) => Math.max(TURBO_GWEI, gweiOf(s));
/** PancakeSwap v2 pair init code hash: a pair's address is worked out locally (CREATE2), no lookup needed. */
const PANCAKE_V2_INIT = "0x00fb7f630766e6a796048ea87d01acd3068e8ff67d078148a3fa3f4a84f69bd5" as const;
const MIN_USD = 0.1;

const ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);
const FACTORY_ABI = parseAbi(["function getPair(address, address) view returns (address)"]);
const PAIR_ABI = parseAbi(["function getReserves() view returns (uint112, uint112, uint32)"]);
const V3F_ABI = parseAbi(["function getPool(address, address, uint24) view returns (address)"]);
const V3P_ABI = parseAbi(["function liquidity() view returns (uint128)"]);
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)",
  "function allowance(address, address) view returns (uint256)", "function approve(address, uint256) returns (bool)",
]);

const RPCS = [process.env.COPY_BSC_RPC, "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org", "https://bsc-mainnet.public.blastapi.io", "https://bsc-dataseed.bnbchain.org"].filter(Boolean) as string[];
let client: any = null;
const pc = () => (client ||= createPublicClient({ chain: bsc, batch: { multicall: true }, transport: fallback(RPCS.map((u) => http(u, { timeout: 5000, retryCount: 0 })), { retryCount: 1 }) }));
// Test-runs of every wallet's buy go out in one batched request (one round trip for all wallets).
let eclient: any = null;
const ec = () => (eclient ||= createPublicClient({ chain: bsc, transport: fallback(RPCS.map((u) => http(u, { timeout: 4000, retryCount: 0, batch: { batchSize: 60, wait: 0 } })), { retryCount: 1 }) }));
const WSS = [process.env.COPY_BSC_WSS, "wss://bsc-rpc.publicnode.com"].filter(Boolean) as string[];
const MEV = process.env.COPY_MEV_RPC || "https://bscrpc.pancakeswap.finance";

/**
 * wallets: which of your wallets (slots 1–10) snipe this token; missing / empty = all of them.
 * fired: wallets that already sent their buy for it (never fire again on their own); first_at: when the first went out.
 */
export type LiqTarget = { token: string; chain?: string; pay?: string; amount?: number; amounts?: Record<string, number>; prio?: string; label?: string; usd?: number; on?: boolean; state?: "waiting" | "done" | "failed"; added?: string; wallets?: number[]; fired?: number[]; first_at?: string };
/** After the first wallet buys, the other picked wallets keep trying every block for this long, then it stops. */
const REST_WINDOW_MS = 90_000; // 1.5 min: never buy later than this after the first wallet got in
// SniperBnbSol: an 0x token on BNB Chain. SniperLobbySol: a Solana mint. Anything else is ignored.
const isMint = (t: string) => /^0x[0-9a-fA-F]{40}$/.test(t);
const isSolMint = (t: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t);
export const liqTargets = (s: FSettings): LiqTarget[] => (Array.isArray((s as any).liq_targets) ? (s as any).liq_targets : []).filter((t: any) => {
  const tok = String(t?.token || "");
  // SniperEth / SniperRobinhood: an 0x token on Ethereum or Robinhood Chain.
  return t?.chain === "solana" ? isSolMint(tok) : (!t?.chain || t.chain === "bsc" || t.chain === "ethereum" || t.chain === "robinhood") && isMint(tok);
});
const sameToken = (a: string, b: string) => (a.startsWith("0x") || b.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b);
const xOf = (s: FSettings) => Math.max(1.05, n((s as any).liq_x) || 2);
const sellPctOf = (s: FSettings) => Math.min(100, Math.max(5, n((s as any).liq_sell_pct) || 100));
const slipOf = (s: FSettings) => Math.min(49, Math.max(3, n((s as any).liq_slip) || 20));
const tpOn = (s: FSettings) => (s as any).liq_tp_on !== false;

type Route = { kind: "v2"; path: `0x${string}`[]; via: "WBNB" | "USDT" } | { kind: "v3" };
/** Where a token can be bought right now (null: no liquidity yet). One multicall for every token. */
async function routes(tokens: `0x${string}`[]): Promise<Map<string, Route>> {
  const c = pc();
  const calls: any[] = [];
  for (const t of tokens) {
    calls.push({ address: V2_FACTORY, abi: FACTORY_ABI, functionName: "getPair", args: [t, WBNB] });
    calls.push({ address: V2_FACTORY, abi: FACTORY_ABI, functionName: "getPair", args: [t, USDT] });
    for (const f of V3_FEES) calls.push({ address: V3_FACTORY, abi: V3F_ABI, functionName: "getPool", args: [t, WBNB, f] });
  }
  const r1 = await c.multicall({ contracts: calls, allowFailure: true });
  const per = 2 + V3_FEES.length;
  // Second round: reserves / liquidity of the pools that exist.
  const look: { t: string; kind: "w" | "u" | "v3"; addr: string }[] = [];
  tokens.forEach((t, i) => {
    const at = (k: number) => String(r1[i * per + k]?.result || ZERO);
    if (at(0) !== ZERO) look.push({ t, kind: "w", addr: at(0) });
    if (at(1) !== ZERO) look.push({ t, kind: "u", addr: at(1) });
    for (let k = 2; k < per; k++) if (at(k) !== ZERO) look.push({ t, kind: "v3", addr: at(k) });
  });
  const out = new Map<string, Route>();
  if (!look.length) return out;
  const r2 = await c.multicall({ contracts: look.map((x) => (x.kind === "v3" ? { address: x.addr, abi: V3P_ABI, functionName: "liquidity" } : { address: x.addr, abi: PAIR_ABI, functionName: "getReserves" })), allowFailure: true });
  look.forEach((x, i) => {
    const v: any = r2[i]?.result;
    const live = x.kind === "v3" ? BigInt(v ?? 0n) > 0n : Array.isArray(v) && BigInt(v[0]) > 0n && BigInt(v[1]) > 0n;
    if (!live) return;
    const key = x.t.toLowerCase(), cur = out.get(key);
    if (x.kind === "w") out.set(key, { kind: "v2", path: [WBNB, x.t as `0x${string}`], via: "WBNB" });
    else if (x.kind === "u" && (!cur || cur.kind === "v3")) out.set(key, { kind: "v2", path: [WBNB, USDT, x.t as `0x${string}`], via: "USDT" });
    else if (x.kind === "v3" && !cur) out.set(key, { kind: "v3" });
  });
  return out;
}

type Pool = { rIn: bigint; rOut: bigint };
/** Turbo quote data: the token's pool (from WBNB or USDT to the token) and the USDT→WBNB pool, read in the same block. */
type Fast = { via: "WBNB" | "USDT"; tok: Pool; uw: Pool | null };
const pairCache = new Map<string, `0x${string}`>();
function pairFor(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  const k = `${t0}|${t1}`.toLowerCase();
  let p = pairCache.get(k);
  if (!p) {
    p = getContractAddress({ opcode: "CREATE2", from: V2_FACTORY, salt: keccak256(encodePacked(["address", "address"], [t0, t1])), bytecodeHash: PANCAKE_V2_INIT });
    pairCache.set(k, p);
  }
  return p;
}
/** PancakeSwap v2 amount out (0.25% fee), worked out here with no RPC call. */
const outOf = (x: bigint, p: Pool) => (x <= 0n || p.rIn <= 0n || p.rOut <= 0n ? 0n : (x * 9975n * p.rOut) / (p.rIn * 10_000n + x * 9975n));
/** Tokens out for `x` USDT (18 decimals) along the turbo route. */
const quoteUsdt = (x: bigint, f: Fast) => (f.via === "USDT" ? outOf(x, f.tok) : f.uw ? outOf(outOf(x, f.uw), f.tok) : 0n);

/**
 * Turbo pool check: ONE multicall per block for every waiting token. Pair addresses are computed locally, so their
 * reserves are read straight away (no getPair round first), together with the USDT/WBNB pool for pricing.
 * getPair is read in the same call only to double-check the computed address; on a mismatch it falls back to routes().
 */
async function fastRoutes(tokens: `0x${string}`[]): Promise<{ found: Map<string, Route>; fast: Map<string, Fast>; bnbUsd: number }> {
  const c = pc();
  const uwPair = pairFor(USDT, WBNB);
  const calls: any[] = [{ address: uwPair, abi: PAIR_ABI, functionName: "getReserves" }];
  for (const t of tokens) {
    calls.push({ address: pairFor(t, WBNB), abi: PAIR_ABI, functionName: "getReserves" });
    calls.push({ address: pairFor(t, USDT), abi: PAIR_ABI, functionName: "getReserves" });
    calls.push({ address: V2_FACTORY, abi: FACTORY_ABI, functionName: "getPair", args: [t, WBNB] });
    calls.push({ address: V2_FACTORY, abi: FACTORY_ABI, functionName: "getPair", args: [t, USDT] });
    for (const f of V3_FEES) calls.push({ address: V3_FACTORY, abi: V3F_ABI, functionName: "getPool", args: [t, WBNB, f] });
  }
  const r = await c.multicall({ contracts: calls, allowFailure: true });
  const res = (i: number): [bigint, bigint] | null => { const v: any = r[i]?.result; return Array.isArray(v) && BigInt(v[0]) > 0n && BigInt(v[1]) > 0n ? [BigInt(v[0]), BigInt(v[1])] : null; };
  // Pool from `base` to `tok`, with the reserves the right way round (token0 is the lower address).
  const pool = (base: string, tok: string, rr: [bigint, bigint]): Pool => (base.toLowerCase() < tok.toLowerCase() ? { rIn: rr[0], rOut: rr[1] } : { rIn: rr[1], rOut: rr[0] });
  const uwR = res(0);
  const uw = uwR ? pool(USDT, WBNB, uwR) : null;
  const bnbUsd = uw ? Number((uw.rIn * 1_000_000n) / uw.rOut) / 1_000_000 : 0;
  const found = new Map<string, Route>(), fast = new Map<string, Fast>();
  const per = 4 + V3_FEES.length, slow: `0x${string}`[] = [], v3: `0x${string}`[] = [];
  tokens.forEach((t, i) => {
    const b = 1 + i * per, key = t.toLowerCase();
    const gw = String(r[b + 2]?.result || ZERO), gu = String(r[b + 3]?.result || ZERO);
    if ((gw !== ZERO && gw.toLowerCase() !== pairFor(t, WBNB).toLowerCase()) || (gu !== ZERO && gu.toLowerCase() !== pairFor(t, USDT).toLowerCase())) { slow.push(t); return; }
    const w = res(b), u = res(b + 1);
    const cands: Fast[] = [];
    if (w && uw) cands.push({ via: "WBNB", tok: pool(WBNB, t, w), uw });
    if (u) cands.push({ via: "USDT", tok: pool(USDT, t, u), uw });
    if (!cands.length && w) { slow.push(t); return; } // BNB pool live but no USDT/WBNB price this block: normal path
    if (cands.length) {
      // The route that gives the most tokens for $100 of USDT.
      const best = cands.sort((x, y) => (quoteUsdt(10n ** 20n, y) > quoteUsdt(10n ** 20n, x) ? 1 : -1))[0];
      fast.set(key, best);
      found.set(key, best.via === "WBNB" ? { kind: "v2", path: [WBNB, t], via: "WBNB" } : { kind: "v2", path: [WBNB, USDT, t], via: "USDT" });
      return;
    }
    for (let k = 4; k < per; k++) if (String(r[b + k]?.result || ZERO) !== ZERO) { v3.push(t); break; }
  });
  // Off the hot path: a v3-only pool (liquidity checked), or a pair address that didn't match.
  if (slow.length || v3.length) {
    const more = await routes([...new Set([...slow, ...v3])]).catch(() => new Map<string, Route>());
    for (const [k, v] of more) if (!found.has(k)) found.set(k, v);
  }
  return { found, fast, bnbUsd };
}

/** A token's symbol and decimals, read once and kept (prefetched while it waits for liquidity). */
const metaCache = new Map<string, Promise<[string, number]>>();
function metaOf(token: `0x${string}`): Promise<[string, number]> {
  const k = token.toLowerCase();
  let p = metaCache.get(k);
  if (!p) {
    p = (async () => {
      const c = pc();
      const [sym, dec] = await Promise.all([
        c.readContract({ address: token, abi: ERC20, functionName: "symbol" }).catch(() => null),
        c.readContract({ address: token, abi: ERC20, functionName: "decimals" }).then(Number).catch(() => null),
      ]);
      if (dec == null) metaCache.delete(k); // not deployed yet: read again next time
      return [sym ? String(sym) : token.slice(0, 8), dec ?? 18] as [string, number];
    })();
    metaCache.set(k, p);
  }
  return p;
}

/** One wallet, ready to fire: nonce read ahead, balances known. */
type Gun = { slot: number; a: PrivateKeyAccount; nonce: number; bnb: number; usdt: number; usdtOk: boolean };
async function loadGuns(): Promise<Gun[]> {
  const c = pc();
  const guns = await Promise.all(SLOTS.map(async (slot) => {
    const a = await copyKey(slot).catch(() => null);
    if (!a) return null;
    const [nonce, wei, usdt, allow] = await Promise.all([
      c.getTransactionCount({ address: a.address, blockTag: "pending" }),
      c.getBalance({ address: a.address }),
      c.readContract({ address: USDT, abi: ERC20, functionName: "balanceOf", args: [a.address] }).catch(() => 0n),
      c.readContract({ address: USDT, abi: ERC20, functionName: "allowance", args: [a.address, ROUTER] }).catch(() => 0n),
    ]);
    return { slot, a, nonce: Number(nonce), bnb: Number(wei) / 1e18, usdt: Number(usdt) / 1e18, usdtOk: BigInt(allow) > 10n ** 30n } as Gun;
  }));
  return guns.filter(Boolean) as Gun[];
}

const padGas = (est: bigint) => { const pad = (est * 13n) / 10n; return pad <= BUY_GAS ? pad : est <= BUY_GAS ? BUY_GAS : (est * 11n) / 10n; };

/** Send one signed transaction to the fast RPC and the private relay together. Same hash everywhere, so the first acceptance wins. */
async function broadcastRaw(raw: `0x${string}`, mev: boolean): Promise<string> {
  const urls = [...new Set([...(mev ? [MEV] : []), ...RPCS])];
  const post = async (url: string) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [raw] }), signal: AbortSignal.timeout(4000) });
    const j = await r.json().catch(() => null);
    if (j?.result) return String(j.result);
    throw new Error(String(j?.error?.message || `HTTP ${r.status}`));
  };
  const results = await Promise.all(urls.map((u) => post(u).then((h) => h, (e: Error) => e)));
  for (const r of results) if (typeof r === "string" && r) return r;
  const messages = results.filter((r): r is Error => r instanceof Error).map((e) => e.message);
  if (messages.some((m) => /already known/i.test(m))) return keccak256(raw);
  const last = messages[0] || "no node accepted it";
  throw new Error(/insufficient funds/i.test(last) ? "not enough BNB for gas (lower the gas speed or add BNB)" : `the transaction couldn't be sent (${last.slice(0, 100)})`);
}

/** Sign here and send: the private relay and COPY_BSC_RPC (when set) at the same time. Returns the tx hash. */
async function fire(g: Gun, s: FSettings, tx: { to: `0x${string}`; data: `0x${string}`; value: bigint; gas?: bigint }): Promise<string> {
  const gasPrice = BigInt(Math.round(gweiOf(s) * 1e9));
  const gas = tx.gas || (await pc().estimateGas({ account: g.a.address, to: tx.to, data: tx.data, value: tx.value }).then(padGas).catch(() => BUY_GAS));
  const raw = await g.a.signTransaction({ chainId: 56, type: "legacy", nonce: g.nonce, gas, gasPrice, to: tx.to, data: tx.data, value: tx.value });
  const hash = await broadcastRaw(raw, mevOn(s));
  g.nonce++;
  return hash;
}
/**
 * Coins that reached the wallet in this transaction, from its own Transfer logs (exact, no waiting). A balance
 * read can come from a node a moment behind and show nothing yet, so it's only the fallback.
 */
async function received(rc: any, token: string, to: string, before: bigint): Promise<bigint> {
  const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const me = to.toLowerCase().slice(2);
  let sum = 0n;
  for (const l of rc.logs || []) {
    if (String(l.address).toLowerCase() !== token.toLowerCase() || l.topics?.[0] !== TOPIC) continue;
    if (String(l.topics?.[2] || "").toLowerCase().endsWith(me)) sum += BigInt(l.data);
  }
  if (sum > 0n) return sum;
  for (let i = 0; i < 6; i++) {
    const now = BigInt(await pc().readContract({ address: token as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [to as `0x${string}`] }).catch(() => before));
    if (now > before) return now - before;
    await sleep(500);
  }
  return 0n;
}
async function receipt(hash: string) {
  const r = await pc().waitForTransactionReceipt({ hash, timeout: 60_000, pollingInterval: 300 });
  if (r.status !== "success") throw new Error("the transaction failed on-chain");
  return r;
}

/** Wallet buys that reverted on-chain, per desk|token|wallet: each may try again a few times. */
const chainFails = new Map<string, { n: number; at: number }>();
/** Snipe one token from every wallet at once. Returns how many wallets bought (0: not tradable yet → try next block). */
async function snipe(s: FSettings, t: LiqTarget, route: Route, allGuns: Gun[], fast?: Fast, fastBnb = 0): Promise<{ bought: number; why: string; sent?: boolean; fired?: number[]; ok?: number[] }> {
  const c = pc();
  // Only the wallets you picked for this token (none picked = all), minus those that already sent their buy.
  const pick = Array.isArray(t.wallets) && t.wallets.length ? new Set(t.wallets.map(Number)) : null;
  const already = new Set((t.fired || []).map(Number));
  // A wallet whose buy just reverted tries again on the next block (~0.4 s): fast, without firing twice into one block.
  const cooling = (g: Gun) => Date.now() - (chainFails.get(`${T()}|${t.token.toLowerCase()}|${g.slot}`)?.at || 0) < 400;
  const left = (pick ? allGuns.filter((g) => pick.has(g.slot)) : allGuns).filter((g) => !already.has(g.slot));
  const guns = left.filter((g) => !cooling(g));
  const fired: number[] = [], ok: number[] = [];
  if (s.mode === "live" && left.length && !guns.length) return { bought: 0, why: "retrying the wallets whose buy reverted" };
  if (s.mode === "live" && !guns.length) return { bought: 0, why: `none of the wallets picked for it (${[...(pick || [])].map((x) => `#${x}`).join(", ")}) exist any more` };
  const token = getAddress(t.token);
  const bnbUsd = fastBnb > 0 ? fastBnb : await bnbPrice();
  const pinned = n((t as any).amount);
  const payKind = String((t as any).pay || "");
  const usdEach = payKind === "usdt" || payKind === "usdc" ? Math.max(MIN_USD, pinned) : payKind === "native" && pinned > 0 ? Math.max(MIN_USD, pinned * bnbUsd) : Math.max(MIN_USD, n(t.usd) || n((s as any).snipe_usd) || 5);
  // Each wallet's $: an amount typed for this token wins, else the wallet's own amount (set on the Sniper), else the normal one.
  // A wallet's own amount for this token (BNB, or USDT / USDC) wins over everything.
  const ownFor = (slot: number) => {
    const v = n(t.amounts?.[String(slot)]);
    if (!(v > 0)) return 0;
    return payKind === "usdt" || payKind === "usdc" ? Math.max(MIN_USD, v) : Math.max(MIN_USD, v * bnbUsd);
  };
  const amtFor = (slot: number) => ownFor(slot) || (pinned > 0 || n(t.usd) > 0 ? usdEach : Math.max(MIN_USD, keyUsd(s, slot) ?? usdEach));
  const slip = slipOf(s);
  const [sym, dec] = await metaOf(token);
  const name = t.label || String(sym);

  if (s.mode !== "live") {
    if (route.kind !== "v2") return { bought: 0, why: "practice mode only prices v2 pools" };
    const amts = await c.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [BigInt(Math.floor((usdEach / bnbUsd) * 1e18)), route.path] }).catch(() => null);
    const out = amts ? Number(amts[amts.length - 1]) / 10 ** dec : 0;
    if (!(out > 0)) return { bought: 0, why: "no price yet" };
    await record(s, t, name, usdEach, out, null, null, "USDT", route);
    await flog("open", `⚡ Sniped ${name} for $${usdEach.toFixed(2)} (practice) the moment liquidity landed (${route.via === "USDT" ? "USDT pool" : "WBNB pool"}).`);
    return { bought: 1, why: "" };
  }

  let notOpen = "", sent = false;
  const short: string[] = [];
  // What each wallet will spend (v2), worked out up front: all the wallets land in the same block, so each one's
  // minimum-coins must allow for the others' buys moving the price first (else only the first one gets through).
  const planOf = (g: Gun) => {
    const amt = amtFor(g.slot);
    // Snipes always spend USDT. BNB is only for gas, never for the buy itself.
    const bnbFree = 0, usdtFree = g.usdtOk ? g.usdt * 0.995 : 0;
    const useUsdt = true;
    const usd = +Math.min(amt, usdtFree).toFixed(2);
    const ok = usd >= MIN_USD && g.bnb >= gasKeep(s);
    return { amt, bnbFree, usdtFree, useUsdt, usd: ok ? usd : 0 };
  };
  const totalUsd = route.kind === "v2" ? guns.reduce((a, g) => a + planOf(g).usd, 0) : 0;
  const gasPrice = BigInt(Math.round(snipeGwei(s) * 1e9));
  type Prep = { g: Gun; usd: number; amt: number; useUsdt: boolean; data: `0x${string}`; value: bigint; gas: bigint; before: bigint };
  const preps: Prep[] = [];
  const v3done = await Promise.all(guns.filter(() => route.kind === "v3").map(async (g) => {
    let mine = false;
    try {
      const ch = await import("@/lib/ai-trader-chains");
      const w = { evm: g.a, sol: null };
      // Snipes spend USDT only, and the v3 path buys with BNB, so a v3-only pool is not sniped.
      const bnb = 0;
      if (bnb * bnbUsd < MIN_USD) { short.push(`wallet ${g.slot}: this token's pool is PancakeSwap v3, and USDT snipes need a v2 pool`); return false; }
      mine = sent = true; fired.push(g.slot);
      const r = await ch.withFastSend({ mev: mevOn(s) ? MEV : null, gwei: gweiOf(s), approveMax: true }, () => ch.liveBuyOn("bsc", w, token, bnb, slip - 3));
      g.nonce = Number(await c.getTransactionCount({ address: g.a.address, blockTag: "pending" }));
      if (!(r.raw > 0n)) throw new Error("no coins arrived");
      await record(s, t, name, bnb * bnbUsd, Number(r.raw) / 10 ** r.decimals, r.hash, g.slot, "BNB", route);
      ok.push(g.slot);
      await flog("open", `⚡ Wallet ${g.slot} sniped ${name} for ${bnb.toFixed(4)} BNB ($${(bnb * bnbUsd).toFixed(2)}) on PancakeSwap v3. https://bscscan.com/tx/${r.hash}`);
      return true;
    } catch (e) {
      if (!mine) { notOpen ||= (e as Error).message.slice(0, 120); return false; }
      await noteBuyFail(g, token, name, e as Error, fired);
      return false;
    }
  }));
  if (route.kind === "v2" && fast) {
    // ⚡ Turbo: quotes worked out locally from this block's reserves; every wallet's test-run (which is also its gas
    // estimate) goes out in one batched round trip; then all the signed buys are broadcast together.
    const ready: { g: Gun; amt: number; usd: number; inWei: bigint }[] = [];
    for (const g of guns) {
      const { amt, usd } = planOf(g);
      if (g.bnb < gasKeep(s)) { short.push(`wallet ${g.slot} needs ${gasKeep(s).toFixed(4)} BNB for gas at ${snipeGwei(s)} gwei (has ${g.bnb.toFixed(4)})`); continue; }
      if (usd < MIN_USD) { short.push(!g.usdtOk && g.usdt >= 0.5 ? `wallet ${g.slot}: USDT not approved for PancakeSwap yet (it approves on its own; needs a little BNB for gas)` : `wallet ${g.slot} has only $${g.usdt.toFixed(2)} USDT (snipes spend USDT; BNB is only for gas)`); continue; }
      ready.push({ g, amt, usd, inWei: BigInt(Math.floor(usd * 1e6)) * 10n ** 12n });
    }
    const total = ready.reduce((a, p) => a + p.inWei, 0n);
    const outAll = quoteUsdt(total, fast);
    const path = fast.via === "USDT" ? [USDT, token] : [USDT, WBNB, token];
    const dl = BigInt(Math.floor(Date.now() / 1000) + 120);
    const trials = [...new Set([slip, Math.min(49, slip + 10), Math.max(slip, 35)])];
    await Promise.all(ready.map(async (p) => {
      // Each wallet's least-accepted amount assumes every other picked wallet's buy lands before it in the same block,
      // so all of them go through together instead of only the first.
      const last = outAll - quoteUsdt(total - p.inWei, fast);
      const datas = trials.map((sl) => ({ sl, d: encodeFunctionData({ abi: ROUTER_ABI, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens", args: [p.inWei, (last * BigInt(Math.round((100 - sl) * 100))) / 10_000n, path, p.g.a.address, dl] }) }));
      const [tries, before] = await Promise.all([
        Promise.all(datas.map((x) => ec().estimateGas({ account: p.g.a.address, to: ROUTER, data: x.d, value: 0n }).then(
          (gas: bigint) => ({ ...x, gas: BigInt(gas), err: "" }),
          (e: any) => ({ ...x, gas: 0n, err: String(e?.shortMessage || e?.message || e).slice(0, 120) }),
        ))),
        c.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [p.g.a.address] }).then((x: bigint) => BigInt(x)).catch(() => 0n),
      ]);
      const hit = tries.find((x) => x.gas > 0n);
      if (!hit) { notOpen = tries.map((x) => x.err).find(Boolean) || "refused"; return; }
      preps.push({ g: p.g, usd: p.usd, amt: p.amt, useUsdt: true, data: hit.d, value: 0n, gas: padGas(hit.gas), before });
    }));
  } else if (route.kind === "v2") {
    await Promise.all(guns.map(async (g) => {
      const { amt, useUsdt, usd } = planOf(g);
      if (useUsdt && g.bnb < gasKeep(s)) { short.push(`wallet ${g.slot} needs ${gasKeep(s).toFixed(4)} BNB for gas at ${gweiOf(s)} gwei (has ${g.bnb.toFixed(4)})`); return; }
      if (usd < MIN_USD) { short.push(!g.usdtOk && g.usdt >= 0.5 ? `wallet ${g.slot}: USDT not approved for PancakeSwap yet (it approves on its own; needs a little BNB for gas)` : `wallet ${g.slot} has only $${g.usdt.toFixed(2)} USDT (snipes spend USDT; BNB is only for gas)`); return; }
      const built = await prepareV2Buy(g, token, route, usd, useUsdt, slip, bnbUsd, Math.max(0, totalUsd - usd)).catch((e: Error) => ({ notOpen: e.message.slice(0, 120) }));
      if ("notOpen" in built) { notOpen = built.notOpen; return; }
      preps.push({ g, usd, amt, useUsdt, ...built });
    }));
  }
  const signed = await Promise.all(preps.map(async (p) => ({
    ...p,
    raw: await p.g.a.signTransaction({ chainId: 56, type: "legacy", nonce: p.g.nonce, gas: p.gas, gasPrice, to: ROUTER, data: p.data, value: p.value }),
  })));
  const sentTx = await Promise.all(signed.map(async (p) => {
    try {
      const hash = await broadcastRaw(p.raw, mevOn(s));
      p.g.nonce++;
      fired.push(p.g.slot);
      sent = true;
      return { ...p, hash };
    } catch (e) {
      await flog("error", `Wallet ${p.g.slot} couldn't send the buy of ${name}: ${(e as Error).message.slice(0, 160)}`);
      return null;
    }
  }));
  const v2done = await Promise.all(sentTx.map(async (p) => {
    if (!p) return false;
    try {
      const rc = await receipt(p.hash);
      const got = Number(await received(rc, token, p.g.a.address, p.before)) / 10 ** dec;
      if (!(got > 0)) throw new Error("the buy went through but no coins arrived");
      await record(s, t, name, p.usd, got, p.hash, p.g.slot, p.useUsdt ? "USDT" : "BNB", route);
      ok.push(p.g.slot);
      const block = rc.blockNumber != null ? ` block ${rc.blockNumber}` : "";
      await flog("open", `⚡ Wallet ${p.g.slot} sniped ${name} for ${p.useUsdt ? `$${p.usd.toFixed(2)} USDT` : `${(p.usd / bnbUsd).toFixed(4)} BNB ($${p.usd.toFixed(2)})`}${p.usd < p.amt * 0.95 ? " (all it had, minus the buy's gas)" : ""}. https://bscscan.com/tx/${p.hash}${block}`);
      approveForSell(p.g, s, token).catch(() => {});
      return true;
    } catch (e) {
      await noteBuyFail(p.g, token, name, e as Error, fired, p.hash);
      return false;
    }
  }));
  if (sentTx.some(Boolean)) {
    const lines = sentTx.filter(Boolean).map((p) => `#${p!.g.slot} ${p!.hash.slice(0, 10)}… ${ok.includes(p!.g.slot) ? "success" : "failed"}`);
    await flog("open", `Buys of ${name} sent together: ${lines.join(" · ")}`);
  }
  const bought = v3done.filter(Boolean).length + v2done.filter(Boolean).length;
  return { bought, sent, fired, ok, why: bought ? "" : notOpen ? `liquidity is in but it can't be bought yet (${notOpen})` : short.length ? `not enough money: ${short.join("; ")}` : "no wallet could buy" };
}

/** A buy that was sent but reverted, or never landed. The wallet keeps trying next block. */
async function noteBuyFail(g: Gun, token: string, name: string, e: Error, fired: number[], hash = "") {
  g.nonce = Number(await pc().getTransactionCount({ address: g.a.address, blockTag: "pending" }).catch(() => g.nonce));
  const key = `${T()}|${token.toLowerCase()}|${g.slot}`, tries = (chainFails.get(key)?.n || 0) + 1;
  const tx = hash ? ` ${hash}` : "";
  if (/failed on-chain|no coins arrived/.test(e.message)) {
    chainFails.set(key, { n: tries, at: Date.now() });
    const i = fired.indexOf(g.slot);
    if (i >= 0) fired.splice(i, 1);
    if (tries === 1 || tries % 5 === 0) await flog("error", `Wallet ${g.slot}'s buy of ${name} failed${tx} (try ${tries}): trying again next block at the new price.`);
  } else await flog("error", `Wallet ${g.slot} couldn't snipe ${name}${tx}: ${e.message.slice(0, 140)}`);
}

/** Quote and test-run one wallet's PancakeSwap buy. Nothing is sent. Slippage steps are tried together; the tightest one that passes is kept. */
async function prepareV2Buy(g: Gun, token: `0x${string}`, route: Extract<Route, { kind: "v2" }>, usd: number, useUsdt: boolean, slip: number, bnbUsd: number, aheadUsd = 0): Promise<{ data: `0x${string}`; value: bigint; slip: number; before: bigint; gas: bigint } | { notOpen: string }> {
  const c = pc();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
  const path = useUsdt ? (route.via === "USDT" ? [USDT, token] : [USDT, WBNB, token]) : route.path;
  const amountIn = useUsdt ? BigInt(Math.floor(usd * 1e6)) * 10n ** 12n : BigInt(Math.floor((usd / bnbUsd) * 1e18));
  const out = (wei: bigint) => (wei > 0n ? c.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [wei, route.path] }).then((a: readonly bigint[]) => BigInt(a[a.length - 1])) : Promise.resolve(0n));
  const wei = (u: number) => BigInt(Math.floor((u / bnbUsd) * 1e18));
  const [amts, all, prior, alone] = await Promise.all([
    c.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [amountIn, path] }),
    aheadUsd > 0 ? out(wei(aheadUsd + usd)).catch(() => 0n) : Promise.resolve(0n),
    aheadUsd > 0 ? out(wei(aheadUsd)).catch(() => 0n) : Promise.resolve(0n),
    aheadUsd > 0 ? out(wei(usd)).catch(() => 0n) : Promise.resolve(0n),
  ]);
  let quoted = BigInt(amts[amts.length - 1]);
  const [A, P, L] = [BigInt(all), BigInt(prior), BigInt(alone)];
  if (aheadUsd > 0 && L > 0n && A > P) quoted = (quoted * (A - P)) / L;
  const value = useUsdt ? 0n : amountIn;
  const trials = [...new Set([slip, Math.min(49, slip + 10), Math.max(slip, 35)])];
  const tried = await Promise.all(trials.map(async (sl) => {
    const minOut = (quoted * BigInt(Math.round((100 - sl) * 100))) / 10_000n;
    const d = useUsdt
      ? encodeFunctionData({ abi: ROUTER_ABI, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens", args: [amountIn, minOut, path, g.a.address, deadline] })
      : encodeFunctionData({ abi: ROUTER_ABI, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args: [minOut, path, g.a.address, deadline] });
    try { await c.call({ account: g.a.address, to: ROUTER, data: d, value, gas: GAS_LIMIT }); return { sl, d }; }
    catch (e) { return { sl, err: String((e as any)?.shortMessage || (e as Error).message).slice(0, 120) }; }
  }));
  const hit = tried.find((x): x is { sl: number; d: `0x${string}` } => "d" in x);
  if (!hit) return { notOpen: tried.map((x) => "err" in x ? x.err : "").find(Boolean) || "refused" };
  const [before, gas] = await Promise.all([
    c.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [g.a.address] }).then((x: bigint) => BigInt(x)).catch(() => 0n),
    c.estimateGas({ account: g.a.address, to: ROUTER, data: hit.d, value }).then(padGas).catch(() => BUY_GAS),
  ]);
  return { data: hit.d, value, slip: hit.sl, before, gas };
}

/** One wallet's buy: prepare, sign, send, and wait. Used when a single wallet buys (Copy). Snipes prepare every wallet first, then send them together. */
async function routerBuy(g: Gun, s: FSettings, token: `0x${string}`, route: Extract<Route, { kind: "v2" }>, usd: number, useUsdt: boolean, slip: number, bnbUsd: number, dec: number, onSend: () => void, aheadUsd = 0): Promise<{ hash: string; got: number; slip: number } | { notOpen: string }> {
  const built = await prepareV2Buy(g, token, route, usd, useUsdt, slip, bnbUsd, aheadUsd);
  if ("notOpen" in built) return built;
  const hash = await fire(g, s, { to: ROUTER, data: built.data, value: built.value, gas: built.gas });
  onSend();
  const rc = await receipt(hash);
  return { hash, got: Number(await received(rc, token, g.a.address, built.before)) / 10 ** dec, slip: built.slip };
}

/**
 * Copy: buy straight through PancakeSwap (fast, works on tokens minutes old that the route service doesn't know yet).
 * null: no PancakeSwap v2 pool, so the caller uses the route service instead.
 */
export async function directBuy(a: PrivateKeyAccount, s: FSettings, tokenIn: string, usd: number, useUsdt: boolean, slip: number): Promise<{ raw: bigint; decimals: number; hash: string; slip: number } | null> {
  const token = getAddress(tokenIn);
  const route = (await routes([token])).get(token.toLowerCase());
  if (!route || route.kind !== "v2") return null;
  const c = pc();
  const [nonce, allow, dec] = await Promise.all([
    c.getTransactionCount({ address: a.address, blockTag: "pending" }),
    useUsdt ? c.readContract({ address: USDT, abi: ERC20, functionName: "allowance", args: [a.address, ROUTER] }).catch(() => 0n) : Promise.resolve(2n ** 255n),
    c.readContract({ address: token, abi: ERC20, functionName: "decimals" }).then(Number).catch(() => 18),
  ]);
  const g: Gun = { slot: 0, a, nonce: Number(nonce), bnb: 0, usdt: 0, usdtOk: BigInt(allow) > 10n ** 30n };
  if (useUsdt && !g.usdtOk) {
    await receipt(await fire(g, { ...s, copy_mev: false } as FSettings, { to: USDT, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, 2n ** 256n - 1n] }), value: 0n }));
  }
  const r = await routerBuy(g, s, token, route, usd, useUsdt, slip, await bnbPrice(), dec, () => {});
  if ("notOpen" in r) throw new Error(`PancakeSwap refused the test buy: ${r.notOpen}`);
  approveForSell(g, s, token).catch(() => {});
  return { raw: BigInt(Math.floor(r.got * 10 ** dec)), decimals: dec, hash: r.hash, slip: r.slip };
}

/** Sell through PancakeSwap v2 straight away, back into USDT or BNB. null: no v2 pool (use the route service). */
export async function directSell(a: PrivateKeyAccount, s: FSettings, tokenIn: string, raw: bigint, toUsdt: boolean, slip: number): Promise<{ hash: string; got: number } | null> {
  const token = getAddress(tokenIn);
  const route = (await routes([token])).get(token.toLowerCase());
  if (!route || route.kind !== "v2") return null;
  const c = pc();
  const SELL_ABI = parseAbi([
    "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
    "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  ]);
  const [nonce, allow] = await Promise.all([
    c.getTransactionCount({ address: a.address, blockTag: "pending" }),
    c.readContract({ address: token, abi: ERC20, functionName: "allowance", args: [a.address, ROUTER] }).catch(() => 0n),
  ]);
  const g: Gun = { slot: 0, a, nonce: Number(nonce), bnb: 0, usdt: 0, usdtOk: true };
  if (BigInt(allow) < raw) await receipt(await fire(g, { ...s, copy_mev: false } as FSettings, { to: token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, 2n ** 256n - 1n] }), value: 0n }));
  // Path out: the pool's own side, then on to what you paid with.
  const viaUsdt = route.via === "USDT";
  const path = toUsdt ? (viaUsdt ? [token, USDT] : [token, WBNB, USDT]) : (viaUsdt ? [token, USDT, WBNB] : [token, WBNB]);
  const amts = await c.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [raw, path] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
  let data: `0x${string}` | null = null, why = "";
  for (const sl of [...new Set([slip, Math.min(49, slip + 10), Math.max(slip, 35)])]) {
    const minOut = (BigInt(amts[amts.length - 1]) * BigInt(Math.round((100 - sl) * 100))) / 10_000n;
    const d = toUsdt
      ? encodeFunctionData({ abi: SELL_ABI, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens", args: [raw, minOut, path, a.address, deadline] })
      : encodeFunctionData({ abi: SELL_ABI, functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens", args: [raw, minOut, path, a.address, deadline] });
    try { await c.call({ account: a.address, to: ROUTER, data: d, gas: GAS_LIMIT }); data = d; break; }
    catch (e) { why = String((e as any)?.shortMessage || (e as Error).message).slice(0, 120); }
  }
  if (!data) throw new Error(`PancakeSwap refused the test sell: ${why}`);
  const before = toUsdt ? BigInt(await c.readContract({ address: USDT, abi: ERC20, functionName: "balanceOf", args: [a.address] })) : BigInt(await c.getBalance({ address: a.address }));
  const hash = await fire(g, s, { to: ROUTER, data, value: 0n });
  const rc = await receipt(hash);
  const after = toUsdt ? BigInt(await c.readContract({ address: USDT, abi: ERC20, functionName: "balanceOf", args: [a.address] })) : BigInt(await c.getBalance({ address: a.address }));
  const gas = toUsdt ? 0n : BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice ?? 0n);
  const got = Number(after - before + gas) / 1e18; // USDT on BNB Chain has 18 decimals
  return { hash, got: toUsdt ? got : got * (await bnbPrice()) };
}

async function approveForSell(g: Gun, s: FSettings, token: `0x${string}`) {
  const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, 2n ** 256n - 1n] });
  await fire(g, { ...s, copy_mev: false } as FSettings, { to: token, data, value: 0n });
}
/** USDT approved once per wallet, so USDT buys need no extra step when the moment comes. */
const approving = new Set<string>();
async function approveUsdt(g: Gun, s: FSettings) {
  if (g.usdtOk || g.usdt < 0.5 || g.bnb < 0.0003) return;
  const key = g.a.address.toLowerCase();
  if (approving.has(key)) return;
  approving.add(key);
  try { await approveUsdtNow(g, s); } finally { approving.delete(key); }
}
async function approveUsdtNow(g: Gun, s: FSettings) {
  const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, 2n ** 256n - 1n] });
  await receipt(await fire(g, { ...s, copy_mev: false } as FSettings, { to: USDT, data, value: 0n }));
  g.usdtOk = true;
  await flog("settings", `Wallet ${g.slot}: USDT approved for PancakeSwap, so it can snipe with USDT instantly.`);
}

async function record(s: FSettings, t: LiqTarget, name: string, usd: number, qty: number, tx: string | null, slot: number | null, pay: string, route: Route) {
  const entry = usd / qty;
  const x = xOf(s);
  await pos().insert({
    fut_id: T(), mode: s.mode, venue: "copy", coin: `bsc:${t.token.toLowerCase()}`, side: "long", lev: 1, margin_usd: usd, notional_usd: usd,
    entry, stop: (s as any).copy_sl_on === true ? entry * (1 - n((s as any).snipe_sl || 50) / 100) : 0, target: tpOn(s) ? entry * x : 0,
    liq: null, best: entry, last: entry, size: qty, fees_usd: s.mode === "paper" ? usd * 0.01 : 0,
    why: `${name}: sniped at launch (${route.kind === "v3" ? "v3" : `v2 ${route.via}`})`, open_tx: tx, risk_usd: usd, equity_at_open: 0,
    copy_from: t.token.toLowerCase(), copy_slot: slot, copy_pay: pay,
  });
  if (s.mode !== "live") {
    await sb().from("ai_futures_settings").update({ paper_usd: n(s.paper_usd) - usd }).eq("id", T());
    s.paper_usd = n(s.paper_usd) - usd;
  }
}

/**
 * A wallet holds a sniped token but there's no open trade for it (the buy went through but its amount couldn't be
 * read): record it now at today's value, so it gets Sell buttons and the auto-sell.
 */
const pickNoted = new Set<string>();
async function pickUp(s: FSettings) {
  if (s.mode !== "live") return;
  const targets = liqTargets(s).filter((t) => (t.state || "waiting") !== "waiting" && (!t.chain || t.chain === "bsc"));
  if (!targets.length) return;
  const c = pc(), bnbUsd = await bnbPrice();
  const { data: openRows } = await pos().select("coin,copy_slot").eq("fut_id", T()).eq("mode", "live").in("status", ["open", "closing"]);
  // Trades you sold / wrote off (rugged, couldn't swap) are never put back on the board.
  const { data: goneRows } = await pos().select("coin,copy_slot").eq("fut_id", T()).eq("mode", "live").eq("status", "closed").ilike("reason", "%written off%");
  const have = new Set([...(openRows || []), ...(goneRows || [])].map((p: any) => `${p.coin}|${p.copy_slot}`));
  const accts = (await Promise.all(SLOTS.map(async (slot) => ({ slot, a: await copyKey(slot).catch(() => null) })))).filter((x) => x.a);
  for (const t of targets) {
    const coin = `bsc:${t.token.toLowerCase()}`, token = getAddress(t.token);
    const todo = accts.filter((x) => !have.has(`${coin}|${x.slot}`) && (!t.wallets?.length || t.wallets.includes(x.slot)));
    if (!todo.length) continue;
    const dec = Number(await c.readContract({ address: token, abi: ERC20, functionName: "decimals" }).catch(() => 18));
    for (const x of todo) {
      const bal = BigInt(await c.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [x.a!.address] }).catch(() => -1n));
      if (bal < 0n) continue; // couldn't read: try next run
      const name = t.label || token.slice(0, 10);
      if (bal === 0n) {
        if (!pickNoted.has(`${coin}|${x.slot}`)) { pickNoted.add(`${coin}|${x.slot}`); if (t.state === "failed") await flog("skip", `Wallet ${x.slot} holds no ${name}: the buy got no tokens (a launch tax can take 100% in the first blocks) or they were sold already.`); }
        continue;
      }
      const [viaBnb, viaUsdt] = await Promise.all([
        c.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [bal, [token, WBNB]] }).catch(() => null),
        c.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [bal, [token, USDT]] }).catch(() => null),
      ]);
      const usd = Math.max(viaBnb ? (Number(viaBnb[1]) / 1e18) * bnbUsd : 0, viaUsdt ? Number(viaUsdt[1]) / 1e18 : 0);
      const qty = Number(bal) / 10 ** dec;
      if (!(usd > 0.05)) { if (!pickNoted.has(`${coin}|${x.slot}`)) { pickNoted.add(`${coin}|${x.slot}`); await flog("skip", `Wallet ${x.slot} holds ${qty.toPrecision(4)} ${name}, but PancakeSwap prices it at under $0.05 (or it can't be sold there).`); } continue; }
      await record(s, t, t.label || token.slice(0, 8), usd, qty, null, x.slot, "BNB", { kind: "v2", path: [WBNB, token], via: "WBNB" });
      await flog("open", `⚡ Wallet ${x.slot} holds ${t.label || token.slice(0, 10)} (worth $${usd.toFixed(2)}) from a snipe whose amount wasn't recorded: added to your trades so you can sell it here.`);
    }
  }
}

/** Value of every open snipe straight from the pool (no price site needed); sells at the target or stop. */
/**
 * SniperLobbySol take profit: each open Solana snipe is priced in USDT through Jupiter (about every 4 s). At your
 * target multiple it sells the share you chose back to USDT. Your own Sell buttons work any time.
 */
async function watchSolExits(s: FSettings) {
  if (s.mode !== "live") return;
  const { data } = await pos().select("*").eq("fut_id", T()).eq("status", "open").eq("venue", "copy").eq("mode", "live").like("coin", "solana:%");
  const open = ((data || []) as FPos[]).filter((p) => n(p.size) > 0 && n(p.notional_usd) > 0);
  if (!open.length) return;
  const { solQuoteToUsdt } = await import("@/lib/sniper-chains");
  await Promise.all(open.map(async (p) => {
    const mint = p.coin.slice(7);
    const usd = await solQuoteToUsdt(mint, n(p.size)).catch(() => null);
    if (usd == null || !(usd > 0)) return;
    const price = usd / n(p.size), mult = usd / n(p.notional_usd), best = Math.max(n(p.best), price);
    if (tpOn(s) && mult >= xOf(s)) {
      const pct = sellPctOf(s) / 100;
      await sellCopy(s, { ...p, last: price, best }, pct, `Take profit at ${mult.toFixed(2)}x`, price);
      if (pct < 0.85) await pos().update({ target: 0 }).eq("id", p.id).eq("status", "open");
    } else await pos().update({ last: price, best }).eq("id", p.id);
  }));
}

async function watchExits(s: FSettings) {
  const { data } = await pos().select("*").eq("fut_id", T()).eq("status", "open").eq("venue", "copy");
  const open = ((data || []) as FPos[]).filter((p) => String(p.coin || "").startsWith("bsc:"));
  if (!open.length) return;
  const c = pc(), bnbUsd = await bnbPrice();
  const decs = new Map<string, number>();
  await Promise.all([...new Set(open.map((p) => p.coin))].map(async (coin) => decs.set(coin, Number(await c.readContract({ address: coin.slice(4) as `0x${string}`, abi: ERC20, functionName: "decimals" }).catch(() => 18)))));
  const calls = open.flatMap((p) => {
    const tok = getAddress(p.coin.slice(4)), raw = BigInt(Math.floor(n(p.size) * 10 ** (decs.get(p.coin) || 18)));
    return [{ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [raw, [tok, WBNB]] }, { address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [raw, [tok, USDT]] }];
  });
  const r = await c.multicall({ contracts: calls, allowFailure: true });
  await Promise.all(open.map(async (p, i) => {
    const viaBnb = r[i * 2]?.result as bigint[] | undefined, viaUsdt = r[i * 2 + 1]?.result as bigint[] | undefined;
    const usd = Math.max(viaBnb ? (Number(viaBnb[1]) / 1e18) * bnbUsd : 0, viaUsdt ? Number(viaUsdt[1]) / 1e18 : 0);
    if (!(usd > 0) || !(n(p.size) > 0)) return;
    const price = usd / n(p.size), best = Math.max(n(p.best) || n(p.entry), price);
    const mult = price / n(p.entry);
    if (n(p.target) > 0 && price >= n(p.target)) {
      const pct = sellPctOf(s) / 100;
      await sellCopy(s, { ...p, last: price, best }, pct, `Take profit at ${mult.toFixed(2)}x`, price);
      // Sold only part: the rest has no target any more (it rides, or you sell it yourself).
      if (pct < 0.85) await pos().update({ target: 0 }).eq("id", p.id).eq("status", "open");
    } else if (n(p.stop) > 0 && price <= n(p.stop)) await sellCopy(s, { ...p, last: price, best }, 1, `Stop-loss (${((mult - 1) * 100).toFixed(0)}%)`, price);
    else await pos().update({ last: price, best }).eq("id", p.id);
  }));
}

/** New blocks pushed live (WebSocket); falls back to asking every 400 ms. */
function blocks(onBlock: () => void): () => void {
  try {
    const ws = createPublicClient({ chain: bsc, transport: webSocket(WSS[0], { reconnect: { attempts: 3, delay: 500 }, timeout: 6000 }) });
    const un = ws.watchBlockNumber({ onBlockNumber: () => onBlock(), onError: () => {}, emitOnBegin: false });
    return () => { try { un(); (ws.transport as any).getRpcClient?.().then((r: any) => r.close?.()).catch(() => {}); } catch { /* closed */ } };
  } catch { return () => {}; }
}

/** One minute of the BSC Sniper. */
export async function runLiqSnipe(s: FSettings): Promise<string> {
  const t0 = Date.now();
  const targets = liqTargets(s);
  // What this run just did (wallets fired, done / failed), kept for 10 s: settings reload in the background, and a
  // reload that started before a buy was saved must never make a wallet buy the same token twice.
  const memo = new Map<string, { fired: number[]; state?: LiqTarget["state"]; first_at?: string; at: number }>();
  const tkey = (tok: string) => (tok.startsWith("0x") ? tok.toLowerCase() : tok);
  const withMemo = (t: LiqTarget) => {
    const m = memo.get(tkey(t.token));
    if (!m || Date.now() - m.at > 10_000) return t;
    t.fired = [...new Set([...(t.fired || []), ...m.fired])].sort((a, b) => a - b);
    if (m.state && m.state !== "waiting") t.state = m.state;
    t.first_at ||= m.first_at;
    return t;
  };
  const waiting = () => liqTargets(s).map(withMemo).filter((t) => t.on !== false && (t.state || "waiting") === "waiting");
  const live = s.mode === "live";
  let guns: Gun[] = [];
  if (live && s.enabled) {
    // Every run, even with nothing waiting: any wallet holding USDT gets it approved for PancakeSwap ahead of time,
    // so the snipe itself is a single transaction the moment liquidity lands.
    guns = await loadGuns().catch(() => []);
    await Promise.all(guns.map((g) => approveUsdt(g, s).catch(() => {})));
  }
  const notes: string[] = [];
  const failing = new Map<string, number>(); // token → last time "can't be bought yet" was logged
  let tick: (() => void) | null = null, lastExit = 0, lastCheck = 0, lastOther = 0, pickedUp = false;
  const stop = blocks(() => tick?.());
  // Marks one token done / failed in what's saved now (you may have added tokens since this run started).
  const mark = async (t: LiqTarget) => {
    memo.set(tkey(t.token), { fired: [...(t.fired || [])], state: t.state, first_at: t.first_at, at: Date.now() });
    const { data } = await sb().from("ai_futures_settings").select("liq_targets").eq("id", T()).maybeSingle();
    const list: LiqTarget[] = Array.isArray(data?.liq_targets) ? data!.liq_targets : [];
    await sb().from("ai_futures_settings").update({ liq_targets: list.map((x) => (sameToken(x.token, t.token) ? { ...x, state: t.state, fired: t.fired, first_at: t.first_at } : x)) }).eq("id", T());
  };
  /** Picked wallets (that still exist) that haven't sent their buy for this token yet. */
  const rest = (t: LiqTarget) => {
    const pick = Array.isArray(t.wallets) && t.wallets.length ? new Set(t.wallets.map(Number)) : null;
    const done = new Set((t.fired || []).map(Number));
    return guns.filter((g) => (!pick || pick.has(g.slot)) && !done.has(g.slot)).map((g) => g.slot);
  };
  const okSlots = new Map<string, Set<number>>(); // token → wallets whose buy went through (this run)
  const solBusy = new Set<string>(); // Solana tokens with an attempt in flight
  // STOP, Pause, Remove (token or wallet) and setting changes take effect within a second, not at the next minute's run.
  let lastFresh = Date.now(), lastGuns = Date.now(), firing = 0;
  // Housekeeping (settings / wallet reload, take-profit checks, picking up held coins) runs in the background, so
  // the block-by-block liquidity check is never held up by it.
  let bgFresh = false, bgExit = false, bgPick = false, lastSolExit = 0, lastV2 = 0;
  const refresh = async () => {
    const { data } = await sb().from("ai_futures_settings").select("enabled,liq_targets,liq_x,liq_sell_pct,liq_tp_on,liq_slip,copy_key_usd,snipe_usd,copy_sl_on").eq("id", T()).maybeSingle();
    if (data) Object.assign(s, data);
    // Wallets ready to fire right away: a token added or START pressed mid-minute, a wallet created or funded since
    // the run began. Reloaded (balances, nonces, new / removed wallets) every 3 s while anything is waiting.
    if (live && s.enabled && waiting().length && (!guns.length || Date.now() - lastGuns >= 3000) && !firing) {
      lastGuns = Date.now();
      const fresh = await loadGuns().catch(() => null);
      // Never swap wallets in while buys are going out, and never step a nonce backwards (a node a moment behind).
      if (fresh && !firing) {
        const old = new Map(guns.map((g) => [g.slot, g]));
        for (const g of fresh) { const o = old.get(g.slot); if (o && o.a.address === g.a.address && o.nonce > g.nonce) g.nonce = o.nonce; }
        guns = fresh;
        // A wallet funded or picked mid-minute: approve its USDT straight away, not at the next run.
        for (const g of guns) if (!g.usdtOk) void approveUsdt(g, s).catch(() => {});
      }
    } else if (guns.length && !firing) {
      const still = await Promise.all(guns.map((g) => copyKey(g.slot).then((a) => a?.address === g.a.address, () => true)));
      guns = guns.filter((_, i) => still[i]);
    }
  };
  try {
    while (Date.now() - t0 < 49_000) {
      if (!bgFresh && Date.now() - lastFresh >= 1000) { lastFresh = Date.now(); bgFresh = true; refresh().catch(() => {}).finally(() => { bgFresh = false; }); }
      let w = s.enabled ? waiting() : [];
      if (live && w.length && guns.length) {
        // A token whose first buy already went out: stop retrying the rest once the window has passed.
        for (const t of w) if (t.first_at && Date.now() - Date.parse(t.first_at) > REST_WINDOW_MS) {
          const left = rest(t);
          t.state = (t.fired || []).length ? "done" : "failed";
          if (left.length) await flog("skip", `${t.label || t.token.slice(0, 10)}: wallet ${left.map((x) => `#${x}`).join(" + ")} still couldn't buy ${REST_WINDOW_MS / 60_000} min after the first buy, so it stopped trying (Arm again to retry them).`);
          await mark(t);
        }
        w = waiting();
      }
      // SniperLobbySol: Solana tokens are tried about every second, in the background (a Solana buy confirms in a few
      // seconds and must never hold up the BNB Chain block check). One attempt per token at a time.
      // Live only: a Solana buy is always a real transaction (there's no practice buy on Solana).
      const others = live ? w.filter((t) => t.chain === "solana" && !solBusy.has(t.token)) : [];
      if (others.length && Date.now() - lastOther >= 1000) {
        lastOther = Date.now();
        const { fireChain } = await import("@/lib/sniper-fire");
        for (const t of others) solBusy.add(t.token);
        void Promise.all(others.map(async (t) => { try {
          const r = await fireChain(s, t).catch((e) => ({ bought: 0, why: (e as Error).message, sent: false as boolean, fired: [] as number[], ok: [] as number[] }));
          if (r.fired?.length || r.bought || r.sent) {
            t.fired = [...new Set([...(t.fired || []), ...(r.fired || [])])].sort((a, b) => a - b);
            t.first_at ||= new Date().toISOString();
            const left = (Array.isArray(t.wallets) && t.wallets.length ? t.wallets : []).filter((x) => !(t.fired || []).includes(x));
            if (!left.length || (t.wallets && t.fired && t.fired.length >= t.wallets.length)) t.state = r.bought ? "done" : t.state;
            if (r.bought) notes.push(`sniped ${t.label || t.token.slice(0, 8)} on ${t.chain}`);
            await mark(t);
          } else if (Date.now() - (failing.get(t.token) || 0) > 60_000) {
            failing.set(t.token, Date.now());
            await flog("skip", `${t.label || t.token.slice(0, 10)} (Solana): ${r.why}. Trying again every second.`);
          }
        } finally { solBusy.delete(t.token); } })).catch(() => {});
      }
      // SniperEth / SniperRobinhood: tried about every second in the background, one attempt per token at a time.
      const v2 = live ? w.filter((t) => (t.chain === "ethereum" || t.chain === "robinhood") && !solBusy.has(t.token.toLowerCase())) : [];
      if (v2.length && Date.now() - lastV2 >= 1000) {
        lastV2 = Date.now();
        const { fireV2 } = await import("@/lib/evm-snipe");
        for (const t of v2) solBusy.add(t.token.toLowerCase());
        void Promise.all(v2.map(async (t) => { try {
          const r = await fireV2(s, t).catch((e) => ({ bought: 0, why: (e as Error).message, sent: false as boolean, fired: [] as number[], ok: [] as number[] }));
          if (r.fired?.length || r.bought || r.sent) {
            t.fired = [...new Set([...(t.fired || []), ...(r.fired || [])])].sort((a, b) => a - b);
            t.first_at ||= new Date().toISOString();
            const left = (Array.isArray(t.wallets) && t.wallets.length ? t.wallets : []).filter((x) => !(t.fired || []).includes(x));
            if (!left.length || !(t.wallets && t.wallets.length)) t.state = r.bought ? "done" : "failed";
            if (r.bought) notes.push(`sniped ${t.label || t.token.slice(0, 8)} on ${t.chain}`);
            await mark(t);
          } else if (Date.now() - (failing.get(t.token) || 0) > 60_000) {
            failing.set(t.token, Date.now());
            await flog("skip", `${t.label || t.token.slice(0, 10)} (${t.chain === "ethereum" ? "Ethereum" : "Robinhood Chain"}): ${r.why}. Trying again every second.`);
          }
        } finally { solBusy.delete(t.token.toLowerCase()); } })).catch(() => {});
      }
      const bscW = w.filter((t) => !t.chain || t.chain === "bsc");
      if (bscW.length && (!live || guns.length)) {
        lastCheck = Date.now();
        for (const t of bscW) void metaOf(getAddress(t.token)); // symbol / decimals ready before liquidity lands
        const { found, fast, bnbUsd: fastBnb } = await fastRoutes(bscW.map((t) => getAddress(t.token))).catch(() => ({ found: new Map<string, Route>(), fast: new Map<string, Fast>(), bnbUsd: 0 }));
        const hits = bscW.filter((t) => found.has(t.token.toLowerCase()));
        if (hits.length) firing++;
        await Promise.all(hits.map(async (t) => {
          const k = t.token.toLowerCase();
          const r: { bought: number; why: string; sent?: boolean; fired?: number[]; ok?: number[] } = await snipe(s, t, found.get(k)!, guns, fast.get(k), fastBnb).catch((e) => ({ bought: 0, why: (e as Error).message, sent: false }));
          const key = t.token.toLowerCase();
          if (r.ok?.length) { const set = okSlots.get(key) || new Set<number>(); r.ok.forEach((x) => set.add(x)); okSlots.set(key, set); }
          if (!live && r.bought) {
            t.state = "done"; notes.push(`sniped ${t.label || t.token.slice(0, 8)}`); await mark(t);
          } else if (r.fired?.length || r.bought || r.sent) {
            // Every wallet that sent its buy never fires at this token again; the others keep trying next block.
            t.fired = [...new Set([...(t.fired || []), ...(r.fired || [])])].sort((a, b) => a - b);
            t.first_at ||= new Date().toISOString();
            if (r.bought) notes.push(`sniped ${t.label || t.token.slice(0, 8)} with wallet ${(r.ok || []).map((x) => `#${x}`).join(" + ")}`);
            const left = rest(t);
            const late = Date.now() - Date.parse(t.first_at) > REST_WINDOW_MS;
            if (!left.length || late) {
              t.state = r.bought || (okSlots.get(key)?.size ?? 0) > 0 ? "done" : "failed";
              if (left.length) await flog("skip", `${t.label || t.token.slice(0, 10)}: wallet ${left.map((x) => `#${x}`).join(" + ")} still couldn't buy ${REST_WINDOW_MS / 60_000} min after the first buy, so it stopped trying (Arm again to retry them).`);
            }
            await mark(t);
          } else if (Date.now() - (failing.get(t.token) || 0) > 60_000) {
            failing.set(t.token, Date.now());
            await flog("skip", `${t.label || t.token.slice(0, 10)}: ${r.why}. Trying again every block.`);
          }
        })).finally(() => { if (hits.length) firing--; });
      }
      if (!bgExit && Date.now() - lastExit > 1500) { lastExit = Date.now(); bgExit = true; Promise.all([watchExits(s).catch(() => {}), Date.now() - lastSolExit > 4000 ? (lastSolExit = Date.now(), Promise.all([watchSolExits(s).catch(() => {}), import("@/lib/evm-snipe").then((m) => m.watchV2Exits(s, (p, frac, why, price) => sellCopy(s, p, frac, why, price))).catch(() => {})])) : null]).finally(() => { bgExit = false; }); }
      if (!pickedUp && !bgPick && Date.now() - t0 > 3000) {
        pickedUp = true; bgPick = true;
        pickUp(s).catch(async (e) => { if (!pickNoted.has("err")) { pickNoted.add("err"); await flog("error", `Checking held snipes failed: ${(e as Error).message.slice(0, 200)}`); } }).finally(() => { bgPick = false; });
      }
      // Wait for the next block (pushed live), or 400 ms at most.
      await new Promise<void>((res) => { tick = res; setTimeout(res, Math.max(50, 400 - (Date.now() - lastCheck))); });
      tick = null;
    }
  } finally { stop(); }
  const wcount = waiting().length;
  const head = !s.enabled ? "Stopped: not sniping (open snipes still sell at their target)." : !targets.length ? "Paste a token address to snipe." : live && !guns.length && wcount ? "Add a wallet to snipe with." : wcount ? `Waiting for liquidity on ${wcount} token${wcount === 1 ? "" : "s"}, checking every block.` : "Nothing waiting.";
  return notes.length ? `${head} ${notes.join(" · ")}` : head;
}

/** Live: your wallets' money; practice: the pretend balance. */
export async function liqEquity(s: FSettings) {
  const { data } = await pos().select("*").eq("fut_id", T()).eq("mode", s.mode).in("status", ["open", "closing"]);
  const inTrades = ((data || []) as FPos[]).reduce((a, p) => a + n(p.notional_usd) * (n(p.last) || n(p.entry)) / n(p.entry), 0);
  if (s.mode !== "live") return { total: n(s.paper_usd) + inTrades, free: n(s.paper_usd) };
  const k = await copyKeys();
  const free = k.keys.reduce((a, x) => a + n(x.bnb) * k.bnbUsd + n((x as any).usd), 0);
  return { total: free + inTrades, free };
}
