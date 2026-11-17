/**
 * ⚡ BSC Sniper (server only). Paste a token's contract address before its liquidity is added. Every new block
 * (~0.45 s) one multicall checks each waiting token for a PancakeSwap pool with liquidity (v2 against WBNB or USDT,
 * v3 at every fee). The moment liquidity is there, every wallet you added buys it at once:
 *
 *  - Direct to the PancakeSwap v2 router (no quote API in the way), path WBNB→token or WBNB→USDT→token, or with
 *    USDT if the wallet holds enough of it. v3-only pools go through the swap aggregator.
 *  - The buy is test-run first (eth_call): if trading isn't open yet, nothing is sent and it tries again next block,
 *    so no gas is burnt on failed buys. It buys in the first block trading works.
 *  - Signed here with a nonce read ahead of time, at your gas speed, and sent through PancakeSwap MEV Guard (private:
 *    sandwich bots never see it). If the relay refuses, it's sent the normal way.
 *  - Slippage is yours (auto 20%): the least it accepts is the router's quote minus that.
 *
 * After the buy: its value is read from the pool every ~1.5 s; at your target (e.g. 2x) it sells the share you chose.
 * Sell buttons and your own stop-loss / take profit work like on Copy. Practice mode: pretend buys at the pool price.
 */
import { createPublicClient, encodeFunctionData, fallback, getAddress, http, parseAbi, webSocket } from "viem";
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
const gasKeep = (s: FSettings) => Math.max(GAS_KEEP, Number(BUY_GAS) * gweiOf(s) * 1e-9);
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
const WSS = [process.env.COPY_BSC_WSS, "wss://bsc-rpc.publicnode.com"].filter(Boolean) as string[];
const MEV = process.env.COPY_MEV_RPC || "https://bscrpc.pancakeswap.finance";

/** wallets: which of your wallets (slots 1–10) snipe this token; missing / empty = all of them. */
export type LiqTarget = { token: string; label?: string; usd?: number; on?: boolean; state?: "waiting" | "done" | "failed"; added?: string; wallets?: number[] };
export const liqTargets = (s: FSettings): LiqTarget[] => (Array.isArray((s as any).liq_targets) ? (s as any).liq_targets : []).filter((t: any) => /^0x[0-9a-fA-F]{40}$/.test(String(t?.token || "")));
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

/** Sign here and send: the MEV-protected relay first (private), else the normal way. Returns the tx hash. */
async function fire(g: Gun, s: FSettings, tx: { to: `0x${string}`; data: `0x${string}`; value: bigint; gas?: bigint }): Promise<string> {
  const gasPrice = BigInt(Math.round(gweiOf(s) * 1e9));
  // The network wants gas limit × gas price + value in the wallet, so the limit is the real estimate (+30%), not a guess.
  const gas = tx.gas || (await pc().estimateGas({ account: g.a.address, to: tx.to, data: tx.data, value: tx.value })
    .then((x: bigint) => { const pad = (x * 13n) / 10n; return pad <= BUY_GAS ? pad : x <= BUY_GAS ? BUY_GAS : (x * 11n) / 10n; }).catch(() => BUY_GAS));
  const raw = await g.a.signTransaction({ chainId: 56, type: "legacy", nonce: g.nonce, gas, gasPrice, to: tx.to, data: tx.data, value: tx.value });
  const post = async (url: string) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [raw] }), signal: AbortSignal.timeout(4000) });
    const j = await r.json().catch(() => null);
    if (j?.result) return String(j.result);
    throw new Error(String(j?.error?.message || `HTTP ${r.status}`));
  };
  let hash = "", last = "";
  if (mevOn(s)) hash = await post(MEV).catch((e) => { last = (e as Error).message; return ""; });
  if (!hash) {
    for (const u of RPCS) { hash = await post(u).catch((e) => { last = (e as Error).message; return /already known/i.test(last) ? "known" : ""; }); if (hash) break; }
    if (hash === "known" || !hash) throw new Error(/insufficient funds/i.test(last) ? `not enough BNB for gas at ${gweiOf(s)} gwei (lower the gas speed or add BNB)` : `the transaction couldn't be sent (${last.slice(0, 100)})`);
  }
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

/** Snipe one token from every wallet at once. Returns how many wallets bought (0: not tradable yet → try next block). */
async function snipe(s: FSettings, t: LiqTarget, route: Route, allGuns: Gun[]): Promise<{ bought: number; why: string; sent?: boolean }> {
  const c = pc();
  // Only the wallets you picked for this token (none picked = all).
  const pick = Array.isArray(t.wallets) && t.wallets.length ? new Set(t.wallets.map(Number)) : null;
  const guns = pick ? allGuns.filter((g) => pick.has(g.slot)) : allGuns;
  if (s.mode === "live" && !guns.length) return { bought: 0, why: `none of the wallets picked for it (${[...(pick || [])].map((x) => `#${x}`).join(", ")}) exist any more` };
  const token = getAddress(t.token);
  const bnbUsd = await bnbPrice();
  const usdEach = Math.max(MIN_USD, n(t.usd) || n((s as any).snipe_usd) || 5);
  // Each wallet's $: an amount typed for this token wins, else the wallet's own amount (set on the Sniper), else the normal one.
  const amtFor = (slot: number) => (n(t.usd) > 0 ? usdEach : Math.max(MIN_USD, keyUsd(s, slot) ?? usdEach));
  const slip = slipOf(s);
  const [sym, dec] = await Promise.all([
    c.readContract({ address: token, abi: ERC20, functionName: "symbol" }).catch(() => token.slice(0, 8)),
    c.readContract({ address: token, abi: ERC20, functionName: "decimals" }).then(Number).catch(() => 18),
  ]);
  const name = t.label || String(sym);

  if (s.mode !== "live") {
    if (route.kind !== "v2") return { bought: 0, why: "practice mode only prices v2 pools" };
    const amts = await c.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [BigInt(Math.floor((usdEach / bnbUsd) * 1e18)), route.path] }).catch(() => null);
    const out = amts ? Number(amts[amts.length - 1]) / 10 ** dec : 0;
    if (!(out > 0)) return { bought: 0, why: "no price yet" };
    await record(s, t, name, usdEach, out, null, null, "BNB", route);
    await flog("open", `⚡ Sniped ${name} for $${usdEach.toFixed(2)} (practice) the moment liquidity landed (${route.via === "USDT" ? "USDT pool" : "WBNB pool"}).`);
    return { bought: 1, why: "" };
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
  let notOpen = "", sent = false;
  const short: string[] = [];
  const done = await Promise.all(guns.map(async (g) => {
    let mine = false;
    try {
      if (route.kind === "v3") {
        // v3-only pool: through the swap aggregator, with the same fast and private sending.
        const ch = await import("@/lib/ai-trader-chains");
        const w = { evm: g.a, sol: null };
        const bnb = Math.min(amtFor(g.slot) / bnbUsd, g.bnb - gasKeep(s));
        if (bnb * bnbUsd < MIN_USD) { short.push(`wallet ${g.slot} has only ${g.bnb.toFixed(4)} BNB`); return false; }
        mine = sent = true;
        const r = await ch.withFastSend({ mev: mevOn(s) ? MEV : null, gwei: gweiOf(s), approveMax: true }, () => ch.liveBuyOn("bsc", w, token, bnb, slip - 3));
        g.nonce = Number(await c.getTransactionCount({ address: g.a.address, blockTag: "pending" }));
        if (!(r.raw > 0n)) throw new Error("no coins arrived");
        await record(s, t, name, bnb * bnbUsd, Number(r.raw) / 10 ** r.decimals, r.hash, g.slot, "BNB", route);
        await flog("open", `⚡ Wallet ${g.slot} sniped ${name} for ${bnb.toFixed(4)} BNB ($${(bnb * bnbUsd).toFixed(2)}) on PancakeSwap v3. https://bscscan.com/tx/${r.hash}`);
        return true;
      }
      // v2: straight to the router. Pay with USDT if the wallet holds enough (and it's approved), else BNB.
      const amt = amtFor(g.slot); // the token's typed amount, else this wallet's own, else the normal one
      // Buy as much as the wallet allows, up to the amount, leaving only the buy's gas: the full amount in USDT if it
      // has it, else whichever of USDT / spare BNB is bigger (a smaller buy beats no buy).
      const bnbFree = Math.max(0, g.bnb - gasKeep(s)) * bnbUsd, usdtFree = g.usdtOk ? g.usdt * 0.995 : 0;
      const useUsdt = usdtFree >= amt * 0.98 || (bnbFree < amt && usdtFree > bnbFree);
      let usd = Math.min(amt, useUsdt ? usdtFree : bnbFree);
      if (useUsdt && g.bnb < gasKeep(s)) { short.push(`wallet ${g.slot} needs ${gasKeep(s).toFixed(4)} BNB for gas at ${gweiOf(s)} gwei (has ${g.bnb.toFixed(4)})`); return false; }
      if (usd < MIN_USD) { short.push(`wallet ${g.slot} has only ${g.bnb.toFixed(4)} BNB${g.usdt ? ` + $${g.usdt.toFixed(2)} USDT` : ""} (keeps ${gasKeep(s).toFixed(4)} BNB for gas at ${gweiOf(s)} gwei)`); return false; }
      usd = +usd.toFixed(2);
      const r = await routerBuy(g, s, token, route as Extract<Route, { kind: "v2" }>, usd, useUsdt, slip, bnbUsd, dec, () => { mine = sent = true; });
      if ("notOpen" in r) { notOpen = r.notOpen; return false; }
      const { hash, got } = r;
      if (!(got > 0)) throw new Error("the buy went through but no coins arrived");
      await record(s, t, name, usd, got, hash, g.slot, useUsdt ? "USDT" : "BNB", route);
      await flog("open", `⚡ Wallet ${g.slot} sniped ${name} for ${useUsdt ? `$${usd.toFixed(2)} USDT` : `${(usd / bnbUsd).toFixed(4)} BNB ($${usd.toFixed(2)})`} the moment it could be bought${usd < amt * 0.95 ? ` (all it had, minus the buy's gas)` : ""}. https://bscscan.com/tx/${hash}`);
      // Ready to sell fast later: approve the router for this coin now (in the background).
      approveForSell(g, s, token).catch(() => {});
      return true;
    } catch (e) {
      if (!mine) { notOpen ||= (e as Error).message.slice(0, 120); return false; }
      await flog("error", `Wallet ${g.slot} couldn't snipe ${name}: ${(e as Error).message.slice(0, 160)}`);
      g.nonce = Number(await c.getTransactionCount({ address: g.a.address, blockTag: "pending" }).catch(() => g.nonce));
      return false;
    }
  }));
  const bought = done.filter(Boolean).length;
  return { bought, sent, why: bought ? "" : notOpen ? `liquidity is in but it can't be bought yet (${notOpen})` : short.length ? `not enough money: ${short.join("; ")}` : "no wallet could buy" };
}

/**
 * Buy through the PancakeSwap v2 router: quote, test-run, sign, send (MEV Guard), wait. If the test-run fails, the
 * slippage steps up (yours → +10 → 35%, never past 49) in case it's a buy tax; nothing is sent until a test passes.
 */
async function routerBuy(g: Gun, s: FSettings, token: `0x${string}`, route: Extract<Route, { kind: "v2" }>, usd: number, useUsdt: boolean, slip: number, bnbUsd: number, dec: number, onSend: () => void): Promise<{ hash: string; got: number; slip: number } | { notOpen: string }> {
  const c = pc();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
  const path = useUsdt ? (route.via === "USDT" ? [USDT, token] : [USDT, WBNB, token]) : route.path;
  const amountIn = useUsdt ? BigInt(Math.floor(usd * 1e6)) * 10n ** 12n : BigInt(Math.floor((usd / bnbUsd) * 1e18));
  const amts = await c.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [amountIn, path] });
  const quoted = BigInt(amts[amts.length - 1]);
  const value = useUsdt ? 0n : amountIn;
  let data: `0x${string}` | null = null, used = slip, why = "";
  for (const sl of [...new Set([slip, Math.min(49, slip + 10), Math.max(slip, 35)])]) {
    const minOut = (quoted * BigInt(Math.round((100 - sl) * 100))) / 10_000n;
    const d = useUsdt
      ? encodeFunctionData({ abi: ROUTER_ABI, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens", args: [amountIn, minOut, path, g.a.address, deadline] })
      : encodeFunctionData({ abi: ROUTER_ABI, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args: [minOut, path, g.a.address, deadline] });
    // Test-run: trading not open yet, max-wallet limits, a tax bigger than the slippage… nothing is sent.
    try { await c.call({ account: g.a.address, to: ROUTER, data: d, value, gas: GAS_LIMIT }); data = d; used = sl; break; } // eslint-disable-line
    catch (e) {
      why = String((e as any)?.shortMessage || (e as Error).message).slice(0, 120);
      if (!/INSUFFICIENT_OUTPUT_AMOUNT|TransferHelper|reverted/i.test(why)) break; // not a slippage problem: stepping up won't help
    }
  }
  if (!data) return { notOpen: why };
  const before = BigInt(await c.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [g.a.address] }).catch(() => 0n));
  const hash = await fire(g, s, { to: ROUTER, data, value }); // throws if no node took it: nothing went out
  onSend(); // from here a buy is on its way: never fire at this token again on its own
  const rc = await receipt(hash);
  return { hash, got: Number(await received(rc, token, g.a.address, before)) / 10 ** dec, slip: used };
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
async function approveUsdt(g: Gun, s: FSettings) {
  if (g.usdtOk || g.usdt < 0.5 || g.bnb < 0.0003) return;
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
  const targets = liqTargets(s).filter((t) => (t.state || "waiting") !== "waiting");
  if (!targets.length) return;
  const c = pc(), bnbUsd = await bnbPrice();
  const { data: openRows } = await pos().select("coin,copy_slot").eq("fut_id", T()).eq("mode", "live").in("status", ["open", "closing"]);
  const have = new Set((openRows || []).map((p: any) => `${p.coin}|${p.copy_slot}`));
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
async function watchExits(s: FSettings) {
  const { data } = await pos().select("*").eq("fut_id", T()).eq("status", "open").eq("venue", "copy");
  const open = (data || []) as FPos[];
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
  const waiting = () => liqTargets(s).filter((t) => t.on !== false && (t.state || "waiting") === "waiting");
  const live = s.mode === "live";
  let guns: Gun[] = [];
  if (live && s.enabled && waiting().length) {
    guns = await loadGuns();
    // Pre-approve USDT so a USDT snipe is one transaction when the moment comes.
    await Promise.all(guns.map((g) => approveUsdt(g, s).catch(() => {})));
  }
  const notes: string[] = [];
  const failing = new Map<string, number>(); // token → last time "can't be bought yet" was logged
  let tick: (() => void) | null = null, lastExit = 0, lastCheck = 0, pickedUp = false;
  const stop = blocks(() => tick?.());
  // Marks one token done / failed in what's saved now (you may have added tokens since this run started).
  const mark = async (token: string, state: "done" | "failed") => {
    const { data } = await sb().from("ai_futures_settings").select("liq_targets").eq("id", T()).maybeSingle();
    const list: LiqTarget[] = Array.isArray(data?.liq_targets) ? data!.liq_targets : [];
    await sb().from("ai_futures_settings").update({ liq_targets: list.map((x) => (x.token.toLowerCase() === token.toLowerCase() ? { ...x, state } : x)) }).eq("id", T());
  };
  try {
    while (Date.now() - t0 < 49_000) {
      const w = s.enabled ? waiting() : [];
      if (w.length && (!live || guns.length)) {
        lastCheck = Date.now();
        const found = await routes(w.map((t) => getAddress(t.token))).catch(() => new Map<string, Route>());
        await Promise.all(w.filter((t) => found.has(t.token.toLowerCase())).map(async (t) => {
          const r = await snipe(s, t, found.get(t.token.toLowerCase())!, guns).catch((e) => ({ bought: 0, why: (e as Error).message, sent: false }));
          if (r.bought || r.sent) {
            // Bought (or a buy was sent and errored): never fire at this token again on its own.
            t.state = r.bought ? "done" : "failed";
            if (r.bought) notes.push(`sniped ${t.label || t.token.slice(0, 8)}`);
            await mark(t.token, t.state);
          } else if (Date.now() - (failing.get(t.token) || 0) > 60_000) {
            failing.set(t.token, Date.now());
            await flog("skip", `${t.label || t.token.slice(0, 10)}: ${r.why}. Trying again every block.`);
          }
        }));
      }
      if (Date.now() - lastExit > 1500) { lastExit = Date.now(); await watchExits(s).catch(() => {}); }
      if (!pickedUp && Date.now() - t0 > 3000) {
        pickedUp = true;
        await pickUp(s).catch(async (e) => { if (!pickNoted.has("err")) { pickNoted.add("err"); await flog("error", `Checking held snipes failed: ${(e as Error).message.slice(0, 200)}`); } });
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
