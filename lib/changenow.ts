/**
 * ChangeNOW (exchange API v2): deposit-address swaps. You send coins to the address it gives you; it pays out from
 * its own wallet to the address you chose. Used by Signal's private (XMR) route. Needs CHANGENOW_API_KEY in Vercel.
 */
const BASE = "https://api.changenow.io/v2";

export type Coin = { key: string; ticker: string; network: string; label: string; kind: "evm" | "sol" | "trx" | "btc" | "xmr" };
export const COINS: Coin[] = [
  { key: "usdt-bsc", ticker: "usdt", network: "bsc", label: "USDT · BNB Chain", kind: "evm" },
  { key: "usdt-trx", ticker: "usdt", network: "trx", label: "USDT · Tron", kind: "trx" },
  { key: "usdt-eth", ticker: "usdt", network: "eth", label: "USDT · Ethereum", kind: "evm" },
  { key: "usdt-sol", ticker: "usdt", network: "sol", label: "USDT · Solana", kind: "sol" },
  { key: "usdc-eth", ticker: "usdc", network: "eth", label: "USDC · Ethereum", kind: "evm" },
  { key: "usdc-sol", ticker: "usdc", network: "sol", label: "USDC · Solana", kind: "sol" },
  { key: "bnb-bsc", ticker: "bnb", network: "bsc", label: "BNB · BNB Chain", kind: "evm" },
  { key: "eth-eth", ticker: "eth", network: "eth", label: "ETH · Ethereum", kind: "evm" },
  { key: "sol-sol", ticker: "sol", network: "sol", label: "SOL · Solana", kind: "sol" },
  { key: "trx-trx", ticker: "trx", network: "trx", label: "TRX · Tron", kind: "trx" },
  { key: "btc-btc", ticker: "btc", network: "btc", label: "BTC · Bitcoin", kind: "btc" },
];
export const XMR: Coin = { key: "xmr-xmr", ticker: "xmr", network: "xmr", label: "XMR · Monero", kind: "xmr" };
export const coinBy = (k: string) => (k === XMR.key ? XMR : COINS.find((c) => c.key === k) || null);

const RX: Record<Coin["kind"], RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  trx: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  btc: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  xmr: /^[48][1-9A-HJ-NP-Za-km-z]{94}([1-9A-HJ-NP-Za-km-z]{11})?$/,
};
export const okAddress = (c: Coin, a: string) => RX[c.kind].test(a);

export const cnReady = () => !!process.env.CHANGENOW_API_KEY;

async function cn(path: string, init?: { method?: string; body?: object; query?: Record<string, string> }) {
  const key = process.env.CHANGENOW_API_KEY;
  if (!key) throw new Error("Add CHANGENOW_API_KEY in Vercel to use the private route.");
  const qs = init?.query ? "?" + new URLSearchParams(init.query).toString() : "";
  const r = await fetch(BASE + path + qs, {
    method: init?.method || "GET",
    headers: { "x-changenow-api-key": key, ...(init?.body ? { "content-type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(d?.message || d?.error || `ChangeNOW error ${r.status}`).slice(0, 200));
  return d;
}

const pair = (from: Coin, to: Coin) => ({ fromCurrency: from.ticker, toCurrency: to.ticker, fromNetwork: from.network, toNetwork: to.network, flow: "standard" });

/** What you'd get for this amount, and the smallest amount ChangeNOW takes for the pair. */
export async function cnQuote(from: Coin, to: Coin, fromAmount: string) {
  const p = pair(from, to);
  const [min, est] = await Promise.all([
    cn("/exchange/min-amount", { query: p }).catch(() => null),
    cn("/exchange/estimated-amount", { query: { ...p, fromAmount, type: "direct" } }),
  ]);
  return { toAmount: Number(est?.toAmount) || 0, minAmount: Number(min?.minAmount) || 0, warning: est?.warningMessage || null };
}

/** Opens the swap: returns the deposit address to send to. */
export async function cnCreate(from: Coin, to: Coin, fromAmount: string, address: string, refundAddress?: string) {
  const d = await cn("/exchange", {
    method: "POST",
    body: { ...pair(from, to), fromAmount, toAmount: "", address, extraId: "", refundAddress: refundAddress || "", refundExtraId: "", type: "direct" },
  });
  if (!d?.id || !d?.payinAddress) throw new Error("ChangeNOW didn't give a deposit address. Try again.");
  return { id: String(d.id), payinAddress: String(d.payinAddress), payinExtraId: d.payinExtraId ? String(d.payinExtraId) : null, fromAmount: Number(d.fromAmount) || Number(fromAmount), toAmount: Number(d.toAmount) || 0 };
}

/** new → waiting → confirming → exchanging → sending → finished (or failed / refunded / verifying). */
export async function cnStatus(id: string) {
  const d = await cn("/exchange/by-id", { query: { id } });
  return {
    status: String(d?.status || "new"),
    payinHash: d?.payinHash || null, payoutHash: d?.payoutHash || null,
    amountFrom: Number(d?.amountFrom ?? d?.expectedAmountFrom) || null, amountTo: Number(d?.amountTo ?? d?.expectedAmountTo) || null,
  };
}
