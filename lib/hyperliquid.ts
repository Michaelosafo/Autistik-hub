/**
 * Hyperliquid futures, server only: market data (free, public) and signed trading for one wallet.
 *
 * Trading actions ("L1 actions") are signed the way Hyperliquid's own SDK does it: the action is MessagePack-encoded
 * (key order matters), followed by the nonce (8 bytes) and a 0x00 byte (no vault), hashed with Keccak-256 into a
 * connectionId, and signed as an EIP-712 "Agent" message { source: "a", connectionId } in the "Exchange" domain with
 * chain id 1337. No API key: the wallet's own signature is the login.
 */
import { keccak256, type PrivateKeyAccount } from "viem";

const INFO = "https://api.hyperliquid.xyz/info";
const EXCHANGE = "https://api.hyperliquid.xyz/exchange";

export async function hlInfo<T = any>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch(INFO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Hyperliquid ${r.status}`);
  return r.json();
}

export type HlAsset = { index: number; name: string; szDecimals: number; maxLev: number; mark: number; funding: number; oi: number; dayVol: number };
/** Every perp: index (used in orders), size decimals, max leverage, mark price, hourly funding, open interest. */
export async function hlMarket(): Promise<Map<string, HlAsset>> {
  const j = await hlInfo<any[]>({ type: "metaAndAssetCtxs" });
  const uni: any[] = j?.[0]?.universe || [], ctx: any[] = j?.[1] || [];
  const out = new Map<string, HlAsset>();
  uni.forEach((u, i) => {
    const c = ctx[i] || {};
    if (u?.isDelisted) return;
    out.set(String(u.name), { index: i, name: String(u.name), szDecimals: Number(u.szDecimals) || 0, maxLev: Number(u.maxLeverage) || 1, mark: Number(c.markPx) || 0, funding: Number(c.funding) || 0, oi: Number(c.openInterest) || 0, dayVol: Number(c.dayNtlVlm) || 0 });
  });
  return out;
}

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export async function hlCandles(coin: string, interval: "1m" | "5m" | "15m" | "1h" | "4h", n: number): Promise<Candle[]> {
  const ms = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "1h": 3600e3, "4h": 14400e3 }[interval];
  const end = Date.now();
  const j = await hlInfo<any[]>({ type: "candleSnapshot", req: { coin, interval, startTime: end - ms * (n + 1), endTime: end } });
  return (Array.isArray(j) ? j : []).map((k) => ({ t: Number(k.t), o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c), v: Number(k.v) }));
}

/**
 * Forex on Hyperliquid: currency perps on trade.xyz, a builder-deployed (HIP-3) exchange inside Hyperliquid. Same
 * account and wallet, but its own margin balance ("dex" xyz). Names look like "xyz:EUR"; order ids are
 * 100000 + the exchange's number × 10000 + the market's place in its list.
 */
export const FX_DEX = "xyz";
const FX_NAMES = new Set(["EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "KRW", "CNH", "MXN", "INR", "SGD", "HKD", "BRL", "TRY", "ZAR", "DXY"]);
let fxDexIdx: { at: number; idx: number } | null = null;
async function fxDexIndex(): Promise<number> {
  if (fxDexIdx && Date.now() - fxDexIdx.at < 3600e3) return fxDexIdx.idx;
  const j = await hlInfo<any[]>({ type: "perpDexs" });
  const idx = (Array.isArray(j) ? j : []).findIndex((d) => d && String(d.name) === FX_DEX);
  if (idx < 1) throw new Error("Hyperliquid's forex exchange (trade.xyz) isn't listed right now.");
  fxDexIdx = { at: Date.now(), idx };
  return idx;
}
/** The currency markets on trade.xyz (USDC margin only), keyed "xyz:EUR". Empty if it can't be read. */
export async function hlFxMarket(): Promise<Map<string, HlAsset>> {
  const out = new Map<string, HlAsset>();
  const [idx, j] = await Promise.all([fxDexIndex(), hlInfo<any[]>({ type: "metaAndAssetCtxs", dex: FX_DEX })]);
  const meta = j?.[0] || {}, uni: any[] = meta.universe || [], ctx: any[] = j?.[1] || [];
  // Margin has to be USDC (token 0), the money the account is funded with from Solana.
  if (meta.collateralToken != null && Number(meta.collateralToken) !== 0) return out;
  uni.forEach((u, i) => {
    const c = ctx[i] || {}, name = String(u?.name || "");
    if (u?.isDelisted || !FX_NAMES.has(name.replace(/^[^:]+:/, ""))) return;
    out.set(name, { index: 100000 + idx * 10000 + i, name, szDecimals: Number(u.szDecimals) || 0, maxLev: Number(u.maxLeverage) || 1, mark: Number(c.markPx) || 0, funding: Number(c.funding) || 0, oi: Number(c.openInterest) || 0, dayVol: Number(c.dayNtlVlm) || 0 });
  });
  return out;
}

/** The wallet's Hyperliquid account: total value, money free to trade, and open positions by coin. dex: "xyz" for forex. */
export async function hlAccount(user: string, dex = "") {
  const j = await hlInfo<any>(dex ? { type: "clearinghouseState", user, dex } : { type: "clearinghouseState", user });
  const positions = new Map<string, { size: number; entry: number; liq: number | null; upnl: number }>();
  for (const p of j?.assetPositions || []) {
    const q = p?.position;
    if (!q) continue;
    positions.set(String(q.coin), { size: Number(q.szi) || 0, entry: Number(q.entryPx) || 0, liq: q.liquidationPx != null ? Number(q.liquidationPx) : null, upnl: Number(q.unrealizedPnl) || 0 });
  }
  return { value: Number(j?.marginSummary?.accountValue) || 0, free: Number(j?.withdrawable) || 0, positions };
}

// ---------------------------------------------------------------- MessagePack (only what actions use)

function packInto(out: number[], v: unknown) {
  const u8 = (n: number) => out.push(n & 0xff);
  const be = (n: number | bigint, bytes: number) => { let x = BigInt(n); const a: number[] = []; for (let i = 0; i < bytes; i++) { a.unshift(Number(x & 0xffn)); x >>= 8n; } out.push(...a); };
  if (v === null || v === undefined) return u8(0xc0);
  if (v === false) return u8(0xc2);
  if (v === true) return u8(0xc3);
  if (typeof v === "number" || typeof v === "bigint") {
    const n = typeof v === "bigint" ? v : BigInt(v);
    if (typeof v === "number" && !Number.isInteger(v)) throw new Error("msgpack: floats aren't used in actions");
    if (n >= 0n) {
      if (n < 128n) return u8(Number(n));
      if (n < 256n) { u8(0xcc); return be(n, 1); }
      if (n < 65536n) { u8(0xcd); return be(n, 2); }
      if (n < 4294967296n) { u8(0xce); return be(n, 4); }
      u8(0xcf); return be(n, 8);
    }
    if (n >= -32n) return u8(Number(n) & 0xff);
    if (n >= -128n) { u8(0xd0); return be(BigInt.asUintN(8, n), 1); }
    if (n >= -32768n) { u8(0xd1); return be(BigInt.asUintN(16, n), 2); }
    if (n >= -2147483648n) { u8(0xd2); return be(BigInt.asUintN(32, n), 4); }
    u8(0xd3); return be(BigInt.asUintN(64, n), 8);
  }
  if (typeof v === "string") {
    const b = new TextEncoder().encode(v);
    if (b.length < 32) u8(0xa0 | b.length);
    else if (b.length < 256) { u8(0xd9); be(b.length, 1); }
    else if (b.length < 65536) { u8(0xda); be(b.length, 2); }
    else { u8(0xdb); be(b.length, 4); }
    out.push(...b); return;
  }
  if (Array.isArray(v)) {
    if (v.length < 16) u8(0x90 | v.length); else if (v.length < 65536) { u8(0xdc); be(v.length, 2); } else { u8(0xdd); be(v.length, 4); }
    for (const x of v) packInto(out, x);
    return;
  }
  if (typeof v === "object") {
    const e = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (e.length < 16) u8(0x80 | e.length); else if (e.length < 65536) { u8(0xde); be(e.length, 2); } else { u8(0xdf); be(e.length, 4); }
    for (const [k, x] of e) { packInto(out, k); packInto(out, x); }
    return;
  }
  throw new Error("msgpack: unsupported value");
}
export const msgpack = (v: unknown) => { const out: number[] = []; packInto(out, v); return Uint8Array.from(out); };

// ---------------------------------------------------------------- Numbers the way Hyperliquid wants them

/** Hyperliquid's number text: up to 8 decimals, no trailing zeros, never "-0". */
const wire = (x: number) => { let s = x.toFixed(8).replace(/\.?0+$/, ""); if (s === "-0" || s === "") s = "0"; return s; };
/** A price: at most 5 significant figures and at most (6 - size decimals) decimals. */
export function hlPrice(px: number, szDecimals: number) {
  const sig = Number(px.toPrecision(5));
  const dec = Math.max(0, 6 - szDecimals);
  return wire(Number(sig.toFixed(dec)));
}
/** A size, rounded down to the coin's size decimals. */
export function hlSize(sz: number, szDecimals: number) {
  const f = 10 ** szDecimals;
  return wire(Math.floor(sz * f + 1e-9) / f);
}

// ---------------------------------------------------------------- Signed actions

async function signL1(account: PrivateKeyAccount, action: Record<string, unknown>, nonce: number) {
  const body = msgpack(action);
  const data = new Uint8Array(body.length + 9);
  data.set(body, 0);
  new DataView(data.buffer).setBigUint64(body.length, BigInt(nonce), false);
  data[body.length + 8] = 0; // no vault address
  const connectionId = keccak256(data);
  const sig = await account.signTypedData({
    domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
    types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
    primaryType: "Agent",
    message: { source: "a", connectionId },
  });
  return { r: sig.slice(0, 66), s: `0x${sig.slice(66, 130)}`, v: parseInt(sig.slice(130, 132), 16) };
}

let lastNonce = 0;
async function exchange(account: PrivateKeyAccount, action: Record<string, unknown>) {
  const nonce = Math.max(Date.now(), lastNonce + 1);
  lastNonce = nonce;
  const signature = await signL1(account, action, nonce);
  const r = await fetch(EXCHANGE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, nonce, signature, vaultAddress: null }), cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.status !== "ok") throw new Error(`Hyperliquid: ${typeof j?.response === "string" ? j.response : JSON.stringify(j).slice(0, 200)}`);
  return j.response;
}

/** Isolated margin at this leverage for the coin (set before opening). */
export async function hlSetLeverage(account: PrivateKeyAccount, asset: number, leverage: number) {
  return exchange(account, { type: "updateLeverage", asset, isCross: false, leverage: Math.max(1, Math.floor(leverage)) });
}

type OrderOut = { filled?: { totalSz: string; avgPx: string; oid: number }; resting?: { oid: number }; error?: string };
function firstStatus(res: any): OrderOut {
  const st = res?.data?.statuses?.[0];
  if (!st) throw new Error("Hyperliquid gave no order status.");
  if (typeof st === "object" && st.error) throw new Error(`Hyperliquid: ${st.error}`);
  return st;
}

/**
 * Market order: an immediate-or-cancel limit order a few percent past the mark price, so it fills at once at the best
 * prices available (never worse than the limit). reduceOnly closes without ever opening the other way.
 */
export async function hlMarketOrder(account: PrivateKeyAccount, a: HlAsset, isBuy: boolean, size: number, reduceOnly: boolean, slip = 0.03) {
  const px = a.mark * (isBuy ? 1 + slip : 1 - slip);
  const st = firstStatus(await exchange(account, {
    type: "order",
    orders: [{ a: a.index, b: isBuy, p: hlPrice(px, a.szDecimals), s: hlSize(size, a.szDecimals), r: reduceOnly, t: { limit: { tif: "Ioc" } } }],
    grouping: "na",
  }));
  if (!st.filled) throw new Error("The order didn't fill (no buyers / sellers close enough). Nothing was opened.");
  return { size: Number(st.filled.totalSz), avgPx: Number(st.filled.avgPx), oid: st.filled.oid };
}

/** A stop-loss resting on Hyperliquid itself: closes the position at market if the price reaches it, even if this site is down. */
export async function hlStopLoss(account: PrivateKeyAccount, a: HlAsset, closeIsBuy: boolean, size: number, triggerPx: number) {
  const limit = triggerPx * (closeIsBuy ? 1.1 : 0.9);
  const st = firstStatus(await exchange(account, {
    type: "order",
    orders: [{ a: a.index, b: closeIsBuy, p: hlPrice(limit, a.szDecimals), s: hlSize(size, a.szDecimals), r: true, t: { trigger: { isMarket: true, triggerPx: hlPrice(triggerPx, a.szDecimals), tpsl: "sl" } } }],
    grouping: "na",
  }));
  return st.resting?.oid ?? null;
}

export async function hlCancel(account: PrivateKeyAccount, asset: number, oid: number) {
  return exchange(account, { type: "cancel", cancels: [{ a: asset, o: oid }] }).catch(() => null);
}

// ---------------------------------------------------------------- Moving money out (user-signed actions)
// Money actions are signed differently from trades: EIP-712 in the "HyperliquidSignTransaction" domain, with the
// chain id the signature is made "on" (Arbitrum, 0xa4b1), and posted as-is to /exchange.

const SIG_CHAIN = 42161;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
async function postUserAction(account: PrivateKeyAccount, primaryType: string, fields: { name: string; type: string }[], action: Record<string, any>, nonce: number) {
  const message: Record<string, unknown> = {};
  for (const f of fields) message[f.name] = f.type.startsWith("uint") ? BigInt(action[f.name]) : action[f.name];
  const sig = await account.signTypedData({
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId: SIG_CHAIN, verifyingContract: ZERO_ADDR },
    types: { [primaryType]: fields } as any,
    primaryType,
    message,
  } as any);
  const signature = { r: sig.slice(0, 66), s: `0x${sig.slice(66, 130)}`, v: parseInt(sig.slice(130, 132), 16) };
  const r = await fetch(EXCHANGE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, nonce, signature }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.status !== "ok") throw new Error(`Hyperliquid: ${typeof j?.response === "string" ? j.response : JSON.stringify(j).slice(0, 200)}`);
  return j;
}
const usdStr = (usd: number) => String(Math.floor(usd * 100) / 100);

/** Withdraw USDC from the Hyperliquid account to any Arbitrum address (Hyperliquid's $1 fee; arrives in ~5 minutes). */
export async function hlWithdraw(account: PrivateKeyAccount, destination: string, usd: number) {
  const time = Date.now();
  const action = { type: "withdraw3", hyperliquidChain: "Mainnet", signatureChainId: "0xa4b1", destination, amount: usdStr(usd), time };
  return postUserAction(account, "HyperliquidTransaction:Withdraw", [
    { name: "hyperliquidChain", type: "string" }, { name: "destination", type: "string" }, { name: "amount", type: "string" }, { name: "time", type: "uint64" },
  ], action, time);
}

/** Send trading USDC to another Hyperliquid account (instant, free). */
export async function hlUsdSend(account: PrivateKeyAccount, destination: string, usd: number) {
  const time = Date.now();
  const action = { type: "usdSend", hyperliquidChain: "Mainnet", signatureChainId: "0xa4b1", destination, amount: usdStr(usd), time };
  return postUserAction(account, "HyperliquidTransaction:UsdSend", [
    { name: "hyperliquidChain", type: "string" }, { name: "destination", type: "string" }, { name: "amount", type: "string" }, { name: "time", type: "uint64" },
  ], action, time);
}

/** Move trading USDC between the main account ("") and a builder exchange's account (e.g. "xyz" for forex). Instant, free. */
export async function hlDexTransfer(account: PrivateKeyAccount, fromDex: string, toDex: string, usd: number) {
  const nonce = Date.now();
  const action = { type: "sendAsset", hyperliquidChain: "Mainnet", signatureChainId: "0xa4b1", destination: account.address.toLowerCase(), sourceDex: fromDex, destinationDex: toDex, token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054", amount: usdStr(usd), fromSubAccount: "", nonce };
  return postUserAction(account, "HyperliquidTransaction:SendAsset", [
    { name: "hyperliquidChain", type: "string" }, { name: "destination", type: "string" }, { name: "sourceDex", type: "string" }, { name: "destinationDex", type: "string" },
    { name: "token", type: "string" }, { name: "amount", type: "string" }, { name: "fromSubAccount", type: "string" }, { name: "nonce", type: "uint64" },
  ], action, nonce);
}

/** A Relay step that is a Hyperliquid transfer (sendAsset to Relay's depository): signed and posted like Relay's own SDK. */
export async function hlRelayStep(account: PrivateKeyAccount, d: any) {
  const types: Record<string, { name: string; type: string }[]> = { ...(d?.eip712Types || {}) };
  delete types.EIP712Domain;
  const primaryType = String(d?.eip712PrimaryType || "");
  const fields = types[primaryType];
  if (!d?.action?.type || !fields) throw new Error("Relay sent a Hyperliquid step this can't read.");
  const action = { ...d.action.parameters, type: d.action.type, signatureChainId: "0xa4b1" };
  return postUserAction(account, primaryType, fields, action, Number(action.nonce ?? action.time));
}
