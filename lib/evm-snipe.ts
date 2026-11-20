/**
 * ⚡ SniperEth / SniperRobinhood (server only): the BNB Chain sniper's turbo flow on Uniswap V2 chains.
 *
 *  - Your sniper wallets' EVM keys (same address on every EVM chain). Each picked wallet buys with the chain's dollar
 *    coin (USDT on Ethereum, USDG on Robinhood Chain); ETH only pays gas.
 *  - The dollar coin is approved for the router ahead of time (while the token waits), so the snipe is one transaction.
 *  - Pool check: the token's pair against WETH and against the dollar coin (addresses remembered once found).
 *  - The moment there's liquidity: quotes worked out locally from the reserves; each wallet's least-accepted amount
 *    assumes every other picked wallet buys first in the same block; every wallet's test-run (which is also its gas
 *    estimate) goes out in one batched request; then all the signed buys are broadcast together.
 *  - Ethereum: EIP-1559 with a Turbo tip, sent to public nodes and Flashbots Protect (fast) at once.
 *    Robinhood Chain: the network gas price +50%.
 *  - Take profit: priced through the router every few seconds; sells (and your Sell buttons) go back to the dollar coin.
 */
import { createPublicClient, encodeFunctionData, fallback, getAddress, http, keccak256, parseAbi, parseGwei } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { copyKey, SLOTS } from "@/lib/ai-copy";
import { flog, type FPos, type FSettings } from "@/lib/ai-futures";
import { T } from "@/lib/ai-trader-ctx";
import { supabaseService } from "@/lib/supabase/server";
import { CHAINS, viemChain } from "@/lib/launchpad";

export type V2Chain = "ethereum" | "robinhood";
export const V2_CHAINS: readonly V2Chain[] = ["ethereum", "robinhood"];
export const isV2Chain = (c: unknown): c is V2Chain => c === "ethereum" || c === "robinhood";

type Cfg = { key: V2Chain; name: string; chainId: number; rpcs: string[]; send: string[]; router: `0x${string}`; usd: `0x${string}`; sym: string; dec: number; explorer: string; eip1559: boolean; gasKeep: number; wait: number };
const list = (...u: (string | undefined)[]) => [...new Set(u.filter(Boolean) as string[])];
const CFG: Record<V2Chain, Cfg> = {
  ethereum: {
    key: "ethereum", name: "Ethereum", chainId: 1,
    rpcs: list(process.env.SNIPER_ETH_RPC, CHAINS.ethereum.rpc, "https://eth.drpc.org", "https://eth.llamarpc.com"),
    send: list(process.env.SNIPER_ETH_RPC, CHAINS.ethereum.rpc, "https://eth.drpc.org", "https://rpc.flashbots.net/fast"),
    router: getAddress(CHAINS.ethereum.router as string), usd: getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"), sym: "USDT", dec: 6,
    explorer: "https://etherscan.io", eip1559: true, gasKeep: 0.003, wait: 90_000,
  },
  robinhood: {
    key: "robinhood", name: "Robinhood Chain", chainId: CHAINS.robinhood.chainId,
    rpcs: list(process.env.ROBINHOOD_RPC, CHAINS.robinhood.rpc),
    send: list(process.env.ROBINHOOD_RPC, CHAINS.robinhood.rpc),
    router: getAddress(CHAINS.robinhood.router as string), usd: getAddress((CHAINS.robinhood as any).stablecoin || "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"), sym: "USDG", dec: 6,
    explorer: CHAINS.robinhood.explorer, eip1559: false, gasKeep: 0.0003, wait: 30_000,
  },
};
export const v2Meta = (k: V2Chain) => ({ name: CFG[k].name, sym: CFG[k].sym, explorer: CFG[k].explorer, gasKeep: CFG[k].gasKeep });

const ROUTER_ABI = parseAbi([
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);
const FACTORY_ABI = parseAbi(["function getPair(address, address) view returns (address)"]);
const PAIR_ABI = parseAbi(["function getReserves() view returns (uint112, uint112, uint32)"]);
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)",
  "function allowance(address, address) view returns (uint256)", "function approve(address, uint256) returns (bool)",
]);
const ZERO = "0x0000000000000000000000000000000000000000";
const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BUY_GAS = 400_000n;
const MIN_USD = 0.5;
const TURBO_TIP = parseGwei("3"); // Ethereum priority tip for snipes
const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const sb = () => supabaseService();
const pos = () => sb().from("ai_futures_positions");

// Reads go out as JSON-RPC batches (no multicall contract needed on either chain).
const clients = new Map<V2Chain, any>();
const pc = (k: V2Chain) => {
  let c = clients.get(k);
  if (!c) {
    const cfg = CFG[k];
    c = createPublicClient({ chain: viemChain(CHAINS[k]), transport: fallback(cfg.rpcs.map((u) => http(u, { timeout: 6000, retryCount: 0, batch: { batchSize: 60, wait: 0 } })), { retryCount: 1 }) });
    clients.set(k, c);
  }
  return c;
};
const meta = new Map<V2Chain, Promise<{ factory: `0x${string}`; weth: `0x${string}` }>>();
const routerMeta = (k: V2Chain) => {
  let m = meta.get(k);
  if (!m) {
    m = Promise.all([
      pc(k).readContract({ address: CFG[k].router, abi: ROUTER_ABI, functionName: "factory" }),
      pc(k).readContract({ address: CFG[k].router, abi: ROUTER_ABI, functionName: "WETH" }),
    ]).then(([f, w]: any) => ({ factory: getAddress(f), weth: getAddress(w) }));
    m.catch(() => meta.delete(k));
    meta.set(k, m);
  }
  return m;
};

// ------------------------------------------------------------------ pools and local quotes

type Pool = { rIn: bigint; rOut: bigint };
type Route = { via: "WETH" | "USD"; tok: Pool; uw: Pool | null; path: `0x${string}`[] };
const pairs = new Map<string, `0x${string}`>();
const outOf = (x: bigint, p: Pool) => (x <= 0n || p.rIn <= 0n || p.rOut <= 0n ? 0n : (x * 997n * p.rOut) / (p.rIn * 1000n + x * 997n));
const quote = (x: bigint, r: Route) => (r.via === "USD" ? outOf(x, r.tok) : r.uw ? outOf(outOf(x, r.uw), r.tok) : 0n);

async function pairOf(k: V2Chain, a: `0x${string}`, b: `0x${string}`): Promise<`0x${string}` | null> {
  const key = `${k}|${[a.toLowerCase(), b.toLowerCase()].sort().join("|")}`;
  const hit = pairs.get(key);
  if (hit) return hit;
  const { factory } = await routerMeta(k);
  const p = String(await pc(k).readContract({ address: factory, abi: FACTORY_ABI, functionName: "getPair", args: [a, b] }).catch(() => ZERO));
  if (p === ZERO) return null;
  pairs.set(key, getAddress(p));
  return getAddress(p);
}
async function poolFrom(k: V2Chain, pair: `0x${string}` | null, base: string, tok: string): Promise<Pool | null> {
  if (!pair) return null;
  const v: any = await pc(k).readContract({ address: pair, abi: PAIR_ABI, functionName: "getReserves" }).catch(() => null);
  if (!Array.isArray(v) || !(BigInt(v[0]) > 0n && BigInt(v[1]) > 0n)) return null;
  return base.toLowerCase() < tok.toLowerCase() ? { rIn: BigInt(v[0]), rOut: BigInt(v[1]) } : { rIn: BigInt(v[1]), rOut: BigInt(v[0]) };
}
/** The best live route from the dollar coin to the token (direct pool, or through WETH), or null: no liquidity yet. */
async function routeOf(k: V2Chain, token: `0x${string}`): Promise<Route | null> {
  const cfg = CFG[k];
  const { weth } = await routerMeta(k);
  const [pw, pu, puw] = await Promise.all([pairOf(k, token, weth), pairOf(k, token, cfg.usd), pairOf(k, cfg.usd, weth)]);
  const [w, u, uw] = await Promise.all([poolFrom(k, pw, weth, token), poolFrom(k, pu, cfg.usd, token), poolFrom(k, puw, cfg.usd, weth)]);
  const c: Route[] = [];
  if (w && uw) c.push({ via: "WETH", tok: w, uw, path: [cfg.usd, weth, token] });
  if (u) c.push({ via: "USD", tok: u, uw, path: [cfg.usd, token] });
  if (!c.length) return null;
  const ref = 100n * 10n ** BigInt(cfg.dec);
  return c.sort((a, b) => (quote(ref, b) > quote(ref, a) ? 1 : -1))[0];
}

// ------------------------------------------------------------------ wallets ("guns")

type Gun = { slot: number; a: PrivateKeyAccount; nonce: number; eth: number; usd: number; allow: bigint };
const gunCache = new Map<string, { at: number; guns: Gun[] }>();
async function loadGuns(k: V2Chain, slots: number[], fresh = false): Promise<Gun[]> {
  const key = `${T()}|${k}|${slots.join(",")}`;
  const hit = gunCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 3000) return hit.guns;
  const c = pc(k), cfg = CFG[k];
  const guns = (await Promise.all(slots.map(async (slot) => {
    const a = await copyKey(slot).catch(() => null);
    if (!a) return null;
    const [nonce, wei, usd, allow] = await Promise.all([
      c.getTransactionCount({ address: a.address, blockTag: "pending" }),
      c.getBalance({ address: a.address }),
      c.readContract({ address: cfg.usd, abi: ERC20, functionName: "balanceOf", args: [a.address] }).catch(() => 0n),
      c.readContract({ address: cfg.usd, abi: ERC20, functionName: "allowance", args: [a.address, cfg.router] }).catch(() => 0n),
    ]);
    // Never step a nonce back (a node a moment behind right after a buy).
    const prev = hit?.guns.find((g) => g.slot === slot && g.a.address === a.address);
    return { slot, a, nonce: Math.max(Number(nonce), prev?.nonce || 0), eth: Number(wei) / 1e18, usd: Number(usd) / 10 ** cfg.dec, allow: BigInt(allow) } as Gun;
  }))).filter(Boolean) as Gun[];
  gunCache.set(key, { at: Date.now(), guns });
  return guns;
}

async function fees(k: V2Chain): Promise<{ type: "eip1559"; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | { type: "legacy"; gasPrice: bigint }> {
  const c = pc(k);
  if (CFG[k].eip1559) {
    const b = await c.getBlock({ blockTag: "latest" });
    const base = BigInt(b.baseFeePerGas ?? parseGwei("10"));
    return { type: "eip1559", maxPriorityFeePerGas: TURBO_TIP, maxFeePerGas: base * 2n + TURBO_TIP };
  }
  const gp = BigInt(await c.getGasPrice());
  return { type: "legacy", gasPrice: (gp * 15n) / 10n };
}
const feeWei = (f: Awaited<ReturnType<typeof fees>>, gas: bigint) => gas * (f.type === "eip1559" ? f.maxFeePerGas : f.gasPrice);

/** Send one signed transaction to every node at once (and Flashbots Protect on Ethereum). Same hash everywhere. */
async function broadcast(k: V2Chain, raw: `0x${string}`): Promise<string> {
  const post = async (url: string) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [raw] }), signal: AbortSignal.timeout(5000) });
    const j = await r.json().catch(() => null);
    if (j?.result) return String(j.result);
    throw new Error(String(j?.error?.message || `HTTP ${r.status}`));
  };
  const res = await Promise.all(CFG[k].send.map((u) => post(u).then((h) => h, (e: Error) => e)));
  for (const r of res) if (typeof r === "string" && r) return r;
  const msgs = res.filter((r): r is Error => r instanceof Error).map((e) => e.message);
  if (msgs.some((m) => /already known|nonce too low.*known/i.test(m))) return keccak256(raw);
  throw new Error(/insufficient funds/i.test(msgs[0] || "") ? "not enough ETH for gas" : `couldn't send (${(msgs[0] || "no node accepted it").slice(0, 100)})`);
}
async function sendTx(k: V2Chain, g: Gun, to: `0x${string}`, data: `0x${string}`, gas: bigint): Promise<string> {
  const f = await fees(k);
  const raw = await g.a.signTransaction({ chainId: CFG[k].chainId, nonce: g.nonce, gas, to, data, value: 0n, ...(f as any) });
  const hash = await broadcast(k, raw);
  g.nonce++;
  return hash;
}

/** Approve the dollar coin for the router once per wallet, ahead of time (Ethereum USDT: cleared to 0 first if set). */
const approving = new Set<string>();
export async function approveUsd(k: V2Chain, g: Gun): Promise<void> {
  const cfg = CFG[k], key = `${k}|${g.a.address}`;
  if (g.allow > 10n ** 30n || g.usd < MIN_USD || g.eth < cfg.gasKeep / 3 || approving.has(key)) return;
  approving.add(key);
  try {
    const c = pc(k);
    const ap = (v: bigint) => encodeFunctionData({ abi: ERC20, functionName: "approve", args: [cfg.router, v] });
    if (g.allow > 0n) await c.waitForTransactionReceipt({ hash: await sendTx(k, g, cfg.usd, ap(0n), 80_000n), timeout: cfg.wait });
    const r = await c.waitForTransactionReceipt({ hash: await sendTx(k, g, cfg.usd, ap(2n ** 256n - 1n), 80_000n), timeout: cfg.wait });
    if (r.status === "success") {
      g.allow = 2n ** 256n - 1n;
      await flog("settings", `Wallet ${g.slot}: ${cfg.sym} approved on ${cfg.name}, so it can snipe instantly.`);
    }
  } catch (e) {
    await flog("error", `Wallet ${g.slot} couldn't approve ${cfg.sym} on ${cfg.name}: ${(e as Error).message.slice(0, 120)}`);
  } finally { approving.delete(key); }
}

// ------------------------------------------------------------------ the snipe

type Fire = { bought: number; why: string; sent?: boolean; fired?: number[]; ok?: number[] };

/** One attempt at a SniperEth / SniperRobinhood token: every picked wallet buys together the moment there's liquidity. */
export async function fireV2(s: FSettings, t: any): Promise<Fire> {
  const k = t.chain as V2Chain, cfg = CFG[k];
  if (!isV2Chain(k)) return { bought: 0, why: "not an Ethereum / Robinhood token" };
  const token = getAddress(String(t.token));
  const picked: number[] = Array.isArray(t.wallets) && t.wallets.length ? t.wallets.map(Number) : [...SLOTS];
  const done = new Set((t.fired || []).map(Number));
  const slots = picked.filter((x) => !done.has(x));
  if (!slots.length) return { bought: 0, why: "every picked wallet already bought" };
  const [guns, route] = await Promise.all([loadGuns(k, slots), routeOf(k, token).catch(() => null)]);
  if (!guns.length) return { bought: 0, why: "none of the picked wallets exist any more" };
  // While waiting: get the dollar coin approved now, so the snipe is a single transaction.
  for (const g of guns) if (g.allow < 10n ** 30n) void approveUsd(k, g);
  if (!route) return { bought: 0, why: `no ${cfg.name} liquidity yet` };

  const amtOf = (slot: number) => { const own = n(t.amounts?.[String(slot)]); return own > 0 ? own : n(t.amount) > 0 ? n(t.amount) : n((s as any).snipe_usd) || 5; };
  const f = await fees(k);
  const gasNeed = Number(feeWei(f, BUY_GAS)) / 1e18;
  const short: string[] = [];
  const ready: { g: Gun; usd: number; inRaw: bigint }[] = [];
  for (const g of guns) {
    const usd = Math.min(amtOf(g.slot), g.usd * 0.999);
    if (g.allow < 10n ** 30n) { short.push(`#${g.slot}: ${cfg.sym} not approved yet (approving now)`); continue; }
    if (g.eth < gasNeed) { short.push(`#${g.slot}: needs ${gasNeed.toFixed(5)} ETH for gas (has ${g.eth.toFixed(5)})`); continue; }
    if (usd < MIN_USD) { short.push(`#${g.slot}: only ${g.usd.toFixed(2)} ${cfg.sym}`); continue; }
    ready.push({ g, usd, inRaw: BigInt(Math.floor(usd * 10 ** cfg.dec)) });
  }
  if (!ready.length) return { bought: 0, why: short.join("; ") || "no wallet can buy" };

  const c = pc(k), slipPct = Math.min(49, Math.max(3, n((s as any).liq_slip) || 20));
  const total = ready.reduce((a, p) => a + p.inRaw, 0n), outAll = quote(total, route);
  const dl = BigInt(Math.floor(Date.now() / 1000) + 300);
  const trials = [...new Set([slipPct, Math.min(49, slipPct + 10), Math.max(slipPct, 35)])];
  let notOpen = "";
  const preps = (await Promise.all(ready.map(async (p) => {
    // As if every other picked wallet's buy lands first in the same block, so they all get through together.
    const last = outAll - quote(total - p.inRaw, route);
    const datas = trials.map((sl) => encodeFunctionData({ abi: ROUTER_ABI, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens", args: [p.inRaw, (last * BigInt(Math.round((100 - sl) * 100))) / 10_000n, route.path, p.g.a.address, dl] }));
    const [tries, before] = await Promise.all([
      Promise.all(datas.map((d) => c.estimateGas({ account: p.g.a.address, to: cfg.router, data: d, value: 0n }).then((gas: bigint) => ({ d, gas: BigInt(gas), err: "" }), (e: any) => ({ d, gas: 0n, err: String(e?.shortMessage || e?.message || e).slice(0, 120) })))),
      c.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [p.g.a.address] }).then((x: bigint) => BigInt(x)).catch(() => 0n),
    ]);
    const hit = tries.find((x) => x.gas > 0n);
    if (!hit) { notOpen = tries.map((x) => x.err).find(Boolean) || "refused"; return null; }
    const gas = (hit.gas * 13n) / 10n;
    return { ...p, data: hit.d, gas: gas < BUY_GAS ? gas : hit.gas + 50_000n, before };
  }))).filter(Boolean) as { g: Gun; usd: number; inRaw: bigint; data: `0x${string}`; gas: bigint; before: bigint }[];
  if (!preps.length) return { bought: 0, why: notOpen ? `liquidity is in but it can't be bought yet (${notOpen})` : short.join("; ") };

  // Sign every buy first, then send them all at the same moment.
  const signed = await Promise.all(preps.map(async (p) => ({ ...p, raw: await p.g.a.signTransaction({ chainId: cfg.chainId, nonce: p.g.nonce, gas: p.gas, to: cfg.router, data: p.data, value: 0n, ...(f as any) }) })));
  const sent = await Promise.all(signed.map(async (p) => {
    try { const hash = await broadcast(k, p.raw); p.g.nonce++; return { ...p, hash }; }
    catch (e) { await flog("error", `Wallet ${p.g.slot} couldn't send the ${cfg.name} buy: ${(e as Error).message.slice(0, 140)}`); return null; }
  }));
  const fired = sent.filter(Boolean).map((p) => p!.g.slot);
  const [sym, dec] = await Promise.all([
    c.readContract({ address: token, abi: ERC20, functionName: "symbol" }).then(String).catch(() => token.slice(0, 8)),
    c.readContract({ address: token, abi: ERC20, functionName: "decimals" }).then(Number).catch(() => 18),
  ]);
  const name = t.label || sym;
  const ok: number[] = [];
  await Promise.all(sent.map(async (p) => {
    if (!p) return;
    try {
      const rc = await c.waitForTransactionReceipt({ hash: p.hash, timeout: cfg.wait, pollingInterval: 500 });
      if (rc.status !== "success") throw new Error("the buy failed on-chain");
      let got = 0n;
      const me = p.g.a.address.toLowerCase().slice(2);
      for (const l of rc.logs || []) if (String(l.address).toLowerCase() === token.toLowerCase() && l.topics?.[0] === TOPIC && String(l.topics?.[2] || "").toLowerCase().endsWith(me)) got += BigInt(l.data);
      if (got <= 0n) {
        const now = BigInt(await c.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [p.g.a.address] }).catch(() => p.before));
        got = now > p.before ? now - p.before : 0n;
      }
      const qty = Number(got) / 10 ** dec;
      if (!(qty > 0)) throw new Error("the buy went through but no coins arrived");
      await recordV2(s, t, k, token, name, p.usd, qty, p.hash, p.g.slot);
      ok.push(p.g.slot);
      await flog("open", `⚡ Wallet ${p.g.slot} sniped ${name} on ${cfg.name} for ${p.usd.toFixed(2)} ${cfg.sym}. ${cfg.explorer}/tx/${p.hash}${rc.blockNumber != null ? ` block ${rc.blockNumber}` : ""}`);
      void approveToken(k, p.g, token);
    } catch (e) {
      await flog("error", `Wallet ${p.g.slot}'s ${cfg.name} buy of ${name} failed: ${(e as Error).message.slice(0, 140)}. ${cfg.explorer}/tx/${p.hash}`);
    }
  }));
  if (fired.length) await flog("open", `Buys of ${name} on ${cfg.name} sent together: ${sent.filter(Boolean).map((p) => `#${p!.g.slot} ${ok.includes(p!.g.slot) ? "success" : "failed"}`).join(" · ")}`);
  gunCache.clear();
  return { bought: ok.length, sent: fired.length > 0, fired, ok, why: ok.length ? "" : short.join("; ") || "no wallet could buy" };
}

/** The bought token approved for the router right after the buy, so selling is one transaction. */
async function approveToken(k: V2Chain, g: Gun, token: `0x${string}`) {
  try { await sendTx(k, g, token, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [CFG[k].router, 2n ** 256n - 1n] }), 90_000n); } catch { /* the sell approves again if needed */ }
}

async function recordV2(s: FSettings, t: any, k: V2Chain, token: string, name: string, usd: number, qty: number, tx: string, slot: number) {
  const entry = usd / qty;
  const x = Math.max(1.05, n((s as any).liq_x) || 2), tp = (s as any).liq_tp_on !== false;
  await pos().insert({
    fut_id: T(), mode: "live", venue: "copy", coin: `${k}:${token.toLowerCase()}`, side: "long", lev: 1, margin_usd: usd, notional_usd: usd,
    entry, stop: 0, target: tp ? entry * x : 0, liq: null, best: entry, last: entry, size: qty, fees_usd: 0,
    why: `${name}: sniped at launch on ${CFG[k].name}`, open_tx: tx, risk_usd: usd, equity_at_open: 0,
    copy_from: token.toLowerCase(), copy_slot: slot, copy_pay: CFG[k].sym,
  });
}

// ------------------------------------------------------------------ readiness, balances, detect

/** For the page: each wallet's dollar coin and ETH on this chain, and whether it can pay. Amounts are $. */
export async function v2Ready(k: V2Chain, slots: number[], amount: number, amounts: Record<string, number>) {
  const cfg = CFG[k], c = pc(k);
  const gasNeed = cfg.gasKeep;
  const wallets = await Promise.all(slots.map(async (slot) => {
    const need = n(amounts[String(slot)]) > 0 ? n(amounts[String(slot)]) : n(amount);
    const a = await copyKey(slot).catch(() => null);
    if (!a) return { slot, address: null, balance: null, unit: cfg.sym, need, ok: false, reason: "No wallet" };
    try {
      const [wei, raw] = await Promise.all([c.getBalance({ address: a.address }), c.readContract({ address: cfg.usd, abi: ERC20, functionName: "balanceOf", args: [a.address] })]);
      const bal = Number(raw) / 10 ** cfg.dec, gas = Number(wei) / 1e18;
      const ok = need > 0 && bal + 1e-9 >= need && gas >= gasNeed;
      return { slot, address: a.address, balance: bal, gas, gasNeed, unit: cfg.sym, need, ok, reason: ok ? "Ready" : !(need > 0) ? "No amount set" : bal + 1e-9 < need ? `Needs ${need.toFixed(2)} ${cfg.sym}` : `Needs ${gasNeed} ETH for gas` };
    } catch (e) {
      return { slot, address: a.address, balance: null, unit: cfg.sym, need, ok: false, reason: (e as Error).message.slice(0, 80) };
    }
  }));
  return { chain: k, unit: cfg.sym, price: 1, extra: 0, wallets };
}

/** For a wallet card: the dollar coin and ETH on this chain. */
export async function v2Balances(k: V2Chain, slot: number) {
  const cfg = CFG[k], c = pc(k);
  const a = await copyKey(slot);
  if (!a) throw new Error("No wallet in that slot.");
  const [wei, raw] = await Promise.all([c.getBalance({ address: a.address }), c.readContract({ address: cfg.usd, abi: ERC20, functionName: "balanceOf", args: [a.address] }).catch(() => 0n)]);
  return { address: a.address, usd: Number(raw) / 10 ** cfg.dec, sym: cfg.sym, eth: Number(wei) / 1e18, gasNeed: cfg.gasKeep, explorer: cfg.explorer };
}

/** For the token box: is it a contract on this chain, and does it have a pool yet. */
export async function v2Detect(k: V2Chain, raw: string) {
  const a = raw.trim().match(/0x[0-9a-fA-F]{40}/)?.[0] || "";
  if (!a) return { kind: "unknown", normalized: raw.trim(), hits: [], suggested: null };
  const token = getAddress(a), cfg = CFG[k];
  const [code, route] = await Promise.all([pc(k).getBytecode({ address: token }).catch(() => null), routeOf(k, token).catch(() => null)]);
  const hasCode = !!code && code !== "0x";
  if (!hasCode && !route) return { kind: "evm", normalized: token, hits: [], suggested: null };
  return { kind: "evm", normalized: token, hits: [{ id: k, name: cfg.name, symbol: "ETH", hasCode, hasPool: !!route, liquidityUsd: 0 }], suggested: k };
}

// ------------------------------------------------------------------ take profit and selling

/** What `size` coins sell for in the dollar coin right now (router quote), in $. */
async function valueOf(k: V2Chain, token: `0x${string}`, size: number): Promise<number> {
  const cfg = CFG[k], c = pc(k);
  const [dec, route] = await Promise.all([c.readContract({ address: token, abi: ERC20, functionName: "decimals" }).then(Number).catch(() => 18), routeOf(k, token)]);
  if (!route) return 0;
  const raw = BigInt(Math.floor(size * 10 ** dec));
  const path = [...route.path].reverse();
  const a = await c.readContract({ address: cfg.router, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [raw, path] }).catch(() => null);
  return a ? Number(a[a.length - 1]) / 10 ** cfg.dec : 0;
}

/** Take profit for open SniperEth / SniperRobinhood snipes (priced every few seconds). */
export async function watchV2Exits(s: FSettings, sell: (p: FPos, frac: number, why: string, price: number) => Promise<unknown>) {
  if (s.mode !== "live") return;
  const { data } = await pos().select("*").eq("fut_id", T()).eq("status", "open").eq("venue", "copy").eq("mode", "live");
  const open = ((data || []) as FPos[]).filter((p) => /^(ethereum|robinhood):0x/i.test(String(p.coin || "")) && n(p.size) > 0 && n(p.notional_usd) > 0);
  const x = Math.max(1.05, n((s as any).liq_x) || 2), pct = Math.min(100, Math.max(5, n((s as any).liq_sell_pct) || 100)) / 100, tp = (s as any).liq_tp_on !== false;
  await Promise.all(open.map(async (p) => {
    const [k, tok] = p.coin.split(":") as [V2Chain, string];
    if (!isV2Chain(k)) return;
    const usd = await valueOf(k, getAddress(tok), n(p.size)).catch(() => 0);
    if (!(usd > 0)) return;
    const price = usd / n(p.size), mult = usd / n(p.notional_usd), best = Math.max(n(p.best), price);
    if (tp && mult >= x) {
      await sell({ ...p, last: price, best } as FPos, pct, `Take profit at ${mult.toFixed(2)}x`, price);
      if (pct < 0.85) await pos().update({ target: 0 }).eq("id", p.id).eq("status", "open");
    } else await pos().update({ last: price, best }).eq("id", p.id);
  }));
}

/** Sell a SniperEth / SniperRobinhood snipe back to the dollar coin from wallet `slot`. null size = all it holds. */
export async function sellV2(k: V2Chain, slot: number, tokenIn: string, size: number | null, slipPct: number): Promise<{ got: number; hash: string }> {
  const cfg = CFG[k], c = pc(k), token = getAddress(tokenIn);
  const [g] = await loadGuns(k, [slot], true);
  if (!g) throw new Error(`wallet ${slot} was removed, so this has to be sold from that wallet yourself`);
  const [dec, held, allow, route] = await Promise.all([
    c.readContract({ address: token, abi: ERC20, functionName: "decimals" }).then(Number).catch(() => 18),
    c.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [g.a.address] }).then((x: bigint) => BigInt(x)),
    c.readContract({ address: token, abi: ERC20, functionName: "allowance", args: [g.a.address, cfg.router] }).then((x: bigint) => BigInt(x)).catch(() => 0n),
    routeOf(k, token),
  ]);
  const want = size == null ? held : BigInt(Math.floor(size * 10 ** dec));
  const raw = want > 0n && want < held ? want : held;
  if (raw <= 0n) return { got: 0, hash: "" };
  if (!route) throw new Error(`no ${cfg.name} pool to sell into`);
  if (allow < raw) await c.waitForTransactionReceipt({ hash: await sendTx(k, g, token, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [cfg.router, 2n ** 256n - 1n] }), 90_000n), timeout: cfg.wait });
  const path = [...route.path].reverse();
  const amts = await c.readContract({ address: cfg.router, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [raw, path] });
  const dl = BigInt(Math.floor(Date.now() / 1000) + 300);
  let data: `0x${string}` | null = null, gas = 0n, why = "";
  for (const sl of [...new Set([slipPct, Math.min(49, slipPct + 10), 49])]) {
    const d = encodeFunctionData({ abi: ROUTER_ABI, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens", args: [raw, (BigInt(amts[amts.length - 1]) * BigInt(Math.round((100 - sl) * 100))) / 10_000n, path, g.a.address, dl] });
    try { gas = BigInt(await c.estimateGas({ account: g.a.address, to: cfg.router, data: d, value: 0n })); data = d; break; }
    catch (e) { why = String((e as any)?.shortMessage || (e as Error).message).slice(0, 120); }
  }
  if (!data) throw new Error(`the router refused the test sell: ${why}`);
  const before = BigInt(await c.readContract({ address: cfg.usd, abi: ERC20, functionName: "balanceOf", args: [g.a.address] }));
  const hash = await sendTx(k, g, cfg.router, data, (gas * 13n) / 10n);
  const rc = await c.waitForTransactionReceipt({ hash, timeout: cfg.wait });
  if (rc.status !== "success") throw new Error("the sell failed on-chain");
  const after = BigInt(await c.readContract({ address: cfg.usd, abi: ERC20, functionName: "balanceOf", args: [g.a.address] }));
  return { got: Number(after > before ? after - before : 0n) / 10 ** cfg.dec, hash };
}
