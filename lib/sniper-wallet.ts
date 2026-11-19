/**
 * Sniper / Copy wallets: move coins between your own wallets, or swap inside one wallet.
 * Keys stay in the database Vault and are only used here on the server. A transfer goes straight from one of your
 * wallets to another of your wallets. A swap starts and ends in the same wallet (KyberSwap, or the chain's own
 * exchange when Kyber has no route). Nothing is routed through an extra address.
 */
import { createPublicClient, createWalletClient, erc20Abi, fallback, formatUnits, getAddress, http, isAddress, parseUnits, type Address } from "viem";
import { MAX_KEYS, SLOTS, copyKey, isEvmAddr, moveTrades } from "@/lib/ai-copy";
import { logActivity } from "@/lib/activity";
import { flog } from "@/lib/ai-futures";
import { T } from "@/lib/ai-trader-ctx";
import { nativeUsd } from "@/lib/ai-trader-chains";
import { NATIVE, WCHAINS, type WChain } from "@/lib/wallet-chains";
import { balances, build, quote } from "@/lib/wallet-server";
import { supabaseService } from "@/lib/supabase/server";

export const SNIPER_CHAINS = ["bsc", "ethereum", "base", "arbitrum"] as const;
export type SniperChain = (typeof SNIPER_CHAINS)[number];
const isChain = (c: string): c is SniperChain => (SNIPER_CHAINS as readonly string[]).includes(c);

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address", name: "a" }], outputs: [{ type: "uint256", name: "" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8", name: "" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string", name: "" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address", name: "to" }, { type: "uint256", name: "v" }], outputs: [{ type: "bool", name: "" }] },
] as const;

const BSC_RPCS = [process.env.COPY_BSC_RPC, process.env.NEXT_PUBLIC_BSC_RPC, "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org", "https://bsc-dataseed.bnbchain.org"].filter(Boolean) as string[];
const chainOf = (key: string): WChain => {
  if (!isChain(key)) throw new Error("Pick BNB Chain, Ethereum, Base or Arbitrum.");
  return WCHAINS[key];
};
const transport = (c: WChain) => c.key === "bsc"
  ? fallback(BSC_RPCS.map((u) => http(u, { timeout: 8_000, retryCount: 0 })), { retryCount: 1 })
  : http(c.rpc, { timeout: 12_000 });
const pub = (c: WChain): any => createPublicClient({ chain: c.viem, transport: transport(c) });
const wallet = (c: WChain, account: NonNullable<Awaited<ReturnType<typeof copyKey>>>): any => createWalletClient({ account, chain: c.viem, transport: transport(c) });
const coinUsd = (key: SniperChain) => nativeUsd(key === "bsc" ? "bsc" : "ethereum").catch(() => 0);

async function own(slot: number) {
  if (!SLOTS.includes(slot as any)) throw new Error(`Pick a wallet from 1 to ${MAX_KEYS}.`);
  const a = await copyKey(slot);
  if (!a) throw new Error(`Wallet ${slot} doesn't exist.`);
  return a;
}
async function pair(fromSlot: number, toSlot: number) {
  if (fromSlot === toSlot) throw new Error("Pick a different wallet to send to.");
  const [from, to] = await Promise.all([own(fromSlot), own(toSlot)]);
  return { from, to };
}

type Asset = { address: string; quote: string; symbol: string; decimals: number; raw: bigint; native: boolean };

async function readToken(c: WChain, who: Address, addr: string): Promise<Asset> {
  const token = getAddress(addr);
  const pc = pub(c);
  const [raw, decimals, symbol] = await Promise.all([
    pc.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [who] }).then((x) => BigInt(x as bigint)).catch(() => 0n),
    pc.readContract({ address: token, abi: ERC20, functionName: "decimals" }).then(Number).catch(() => 18),
    pc.readContract({ address: token, abi: ERC20, functionName: "symbol" }).then(String).catch(() => "TOKEN"),
  ]);
  return { address: token, quote: token, symbol, decimals, raw, native: false };
}

/** BNB / ETH, USDT, USDC, or a token address, as this wallet actually holds it. */
async function resolve(c: WChain, who: Address, asset: string): Promise<Asset> {
  const name = asset.trim();
  const up = name.toUpperCase();
  if (!name) throw new Error("Pick what to send.");
  if (up === c.native.symbol || up === "NATIVE" || name.toLowerCase() === NATIVE.toLowerCase()) {
    const raw = await pub(c).getBalance({ address: who });
    return { address: NATIVE, quote: NATIVE, symbol: c.native.symbol, decimals: 18, raw, native: true };
  }
  const known = c.tokens.find((t) => t.symbol.toUpperCase() === up || t.address.toLowerCase() === name.toLowerCase());
  if (known && known.address.toLowerCase() !== NATIVE.toLowerCase()) return readToken(c, who, known.address);
  if (!isAddress(name) && !isEvmAddr(name)) throw new Error(`Pick ${c.native.symbol}, USDT, USDC, or a token address.`);
  return readToken(c, who, name);
}

const shown = (raw: bigint, decimals: number) => {
  const n = Number(formatUnits(raw, decimals));
  if (!isFinite(n)) return "0";
  return n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 6 }) : n.toPrecision(6).replace(/\.?0+$/, "");
};

function parseAmount(amount: number | "max", asset: Asset, reserve: bigint): bigint {
  if (amount === "max") {
    const raw = asset.native ? asset.raw - reserve : asset.raw;
    if (raw <= 0n) throw new Error(asset.native ? `Not enough ${asset.symbol} left after the network fee.` : `Wallet holds no ${asset.symbol}.`);
    return raw;
  }
  if (!(Number(amount) > 0) || !isFinite(Number(amount)) || Number(amount) > 1e15) throw new Error("Type an amount, or tap Max.");
  let raw: bigint;
  try { raw = parseUnits(Number(amount).toFixed(Math.min(asset.decimals, 12)).replace(/\.?0+$/, "") || "0", asset.decimals); }
  catch { throw new Error("That amount doesn't fit this token."); }
  if (raw <= 0n) throw new Error("Type an amount greater than zero.");
  if (asset.native) {
    if (raw + reserve > asset.raw) throw new Error(`Wallet has ${shown(asset.raw, 18)} ${asset.symbol}: not enough for that plus the network fee (~${shown(reserve, 18)} ${asset.symbol}).`);
  } else if (raw > asset.raw) throw new Error(`Wallet holds ${shown(asset.raw, asset.decimals)} ${asset.symbol}: less than that.`);
  return raw;
}

async function gasPriceOf(c: WChain) {
  return BigInt(await pub(c).getGasPrice());
}

/** What this wallet holds on the network: its coin, USD stablecoins, open-trade tokens, and any address you add. */
export async function walletHoldings(slot: number, chainKey: string, extra: string[] = []) {
  const a = await own(slot);
  const c = chainOf(chainKey);
  const extras = extra.filter((x) => isAddress(x)).slice(0, 8);
  const forced = new Set(extras.map((x) => getAddress(x as Address).toLowerCase()));
  if (c.key === "bsc") {
    const { data } = await supabaseService().from("ai_futures_positions").select("coin").eq("fut_id", T()).eq("copy_slot", slot).eq("status", "open");
    for (const row of data || []) {
      const m = /^bsc:(0x[0-9a-fA-F]{40})$/.exec(String((row as { coin?: string }).coin || ""));
      if (m && isAddress(m[1])) extras.push(getAddress(m[1]));
    }
  }
  const list = await balances(c, a.address, extras);
  const keep = list.filter((h) => {
    const sym = h.symbol.toUpperCase();
    return h.amount > 0 || sym === c.native.symbol || sym === "USDT" || sym === "USDC" || forced.has(h.address.toLowerCase());
  });
  const usd = await coinUsd(c.key as SniperChain);
  return {
    slot, address: a.address, chain: c.key, coin: c.native.symbol, explorer: c.explorer, coinUsd: usd || null,
    assets: keep.map((h) => ({ address: h.address, symbol: h.symbol, name: h.name, decimals: h.decimals, raw: h.raw, amount: h.amount, valueUsd: h.valueUsd })),
  };
}

export type TransferPreview = {
  chain: SniperChain; coin: string; fromSlot: number; toSlot: number; from: string; to: string;
  symbol: string; native: boolean; amount: string; raw: string; gasNative: string; gasUsd: number | null; explorer: string;
};

/** The confirmation card: amount, asset, both of your wallets, and the estimated network fee. Nothing is sent. */
export async function transferPreview(fromSlot: number, toSlot: number, asset: string, amount: number | "max", chainKey: string): Promise<TransferPreview> {
  const c = chainOf(chainKey);
  const { from, to } = await pair(fromSlot, toSlot);
  const held = await resolve(c, from.address, asset);
  const gasPrice = await gasPriceOf(c);
  let gas = 21_000n;
  let raw = 0n;
  if (held.native) {
    const reserve = gas * gasPrice;
    raw = parseAmount(amount, held, reserve);
  } else {
    raw = parseAmount(amount, held, 0n);
    const est = await pub(c).estimateContractGas({ account: from.address, address: held.address as Address, abi: ERC20, functionName: "transfer", args: [to.address, raw] }).catch((e: Error) => {
      throw new Error(`The token refused the transfer (${(e as { shortMessage?: string }).shortMessage || e.message}).`.slice(0, 180));
    });
    gas = (BigInt(est) * 13n) / 10n;
    const native = await pub(c).getBalance({ address: from.address });
    if (native < gas * gasPrice) throw new Error(`Wallet ${fromSlot} needs about ${shown(gas * gasPrice, 18)} ${c.native.symbol} for the fee; it has ${shown(native, 18)}.`);
  }
  const fee = gas * gasPrice;
  const feeNum = Number(formatUnits(fee, 18));
  const usd = await coinUsd(c.key as SniperChain);
  return {
    chain: c.key as SniperChain, coin: c.native.symbol, fromSlot, toSlot, from: from.address, to: to.address,
    symbol: held.symbol, native: held.native, amount: shown(raw, held.decimals), raw: raw.toString(),
    gasNative: shown(fee, 18), gasUsd: usd ? feeNum * usd : null, explorer: c.explorer,
  };
}

/** A direct transfer to another of your own wallets. The destination slot is checked again here. */
export async function transferSend(fromSlot: number, toSlot: number, asset: string, amount: number | "max", chainKey: string) {
  const preview = await transferPreview(fromSlot, toSlot, asset, amount, chainKey);
  const c = chainOf(preview.chain);
  const { from, to } = await pair(fromSlot, toSlot);
  if (from.address.toLowerCase() !== preview.from.toLowerCase() || to.address.toLowerCase() !== preview.to.toLowerCase()) throw new Error("That wallet changed. Start again.");
  const pc = pub(c);
  const wc = wallet(c, from);
  const gasPrice = await gasPriceOf(c);
  const raw = BigInt(preview.raw);
  let hash: `0x${string}`;
  if (preview.native) {
    hash = await wc.sendTransaction({ account: from, chain: c.viem, to: to.address, value: raw, gas: 21_000n, gasPrice });
  } else {
    const held = await resolve(c, from.address, asset);
    const est = await pc.estimateContractGas({ account: from.address, address: held.address as Address, abi: ERC20, functionName: "transfer", args: [to.address, raw] });
    const limit = (BigInt(est) * 13n) / 10n;
    hash = await wc.writeContract({ account: from, chain: c.viem, address: held.address as Address, abi: ERC20, functionName: "transfer", args: [to.address, raw], gas: limit, gasPrice });
    if (c.key === "bsc" && !["USDT", "USDC"].includes(held.symbol.toUpperCase())) {
      await moveTrades(held.address, fromSlot, toSlot, Number(formatUnits(raw, held.decimals))).catch(() => {});
    }
  }
  const rc = await pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (rc.status !== "success") throw new Error(`The transfer failed on-chain: ${c.explorer}/tx/${hash}`);
  const msg = `Sent ${preview.amount} ${preview.symbol} from wallet ${fromSlot} to wallet ${toSlot} on ${c.name}. ${c.explorer}/tx/${hash}`;
  await flog("settings", msg);
  return msg;
}

const clampSlip = (bps: number) => {
  const n = Math.round(Number(bps));
  if (!Number.isInteger(n) || n < 10 || n > 4_900) throw new Error("Slippage must be between 0.1% and 49%.");
  return n;
};

export type SwapPreview = {
  chain: SniperChain; slot: number; address: string; via: string;
  symbolIn: string; symbolOut: string; tokenIn: string; tokenOut: string;
  amountIn: string; amountOut: string; minOut: string; minOutRaw: string;
  slippageBps: number; impact: number | null; gasUsd: number | null;
};

/** A quote only. The swap is not sent until swapSend, and the tokens come back to this same wallet. */
export async function swapQuote(slot: number, chainKey: string, tokenIn: string, tokenOut: string, amount: number | "max", slippageBps: number): Promise<SwapPreview> {
  const a = await own(slot);
  const c = chainOf(chainKey);
  const slip = clampSlip(slippageBps);
  const inn = await resolve(c, a.address, tokenIn);
  const out = await resolve(c, a.address, tokenOut);
  if (inn.quote.toLowerCase() === out.quote.toLowerCase()) throw new Error("Pick two different assets.");
  const gasPrice = await gasPriceOf(c);
  const reserve = inn.native ? gasPrice * 400_000n : 0n;
  const raw = parseAmount(amount, inn, reserve);
  if (!inn.native) {
    const native = await pub(c).getBalance({ address: a.address });
    if (native < gasPrice * 250_000n) throw new Error(`Keep a little ${c.native.symbol} in this wallet for the swap fee.`);
  }
  const q = await quote(c, inn.quote, out.quote, raw, 0);
  const impact = q.impact;
  if (impact != null && impact >= 30) throw new Error(`This swap would move the price by about ${impact.toFixed(1)}%. Use a smaller amount.`);
  const min = (BigInt(q.amountOut) * BigInt(10_000 - slip)) / 10_000n;
  const outDec = out.decimals;
  return {
    chain: c.key as SniperChain, slot, address: a.address, via: q.kind === "kyber" ? "KyberSwap" : `${c.name} exchange`,
    symbolIn: inn.symbol, symbolOut: out.symbol, tokenIn: inn.quote, tokenOut: out.quote,
    amountIn: shown(raw, inn.decimals), amountOut: shown(BigInt(q.amountOut), outDec), minOut: shown(min, outDec), minOutRaw: min.toString(),
    slippageBps: slip, impact, gasUsd: q.gasUsd,
  };
}

/** Sends the swap from this wallet back to itself. Refuses if the price is worse than the quote you confirmed. */
export async function swapSend(slot: number, chainKey: string, tokenIn: string, tokenOut: string, amount: number | "max", slippageBps: number, minOutRaw: string, confirmImpact: boolean) {
  if (!/^\d+$/.test(String(minOutRaw || ""))) throw new Error("Get a new quote first.");
  const a = await own(slot);
  const c = chainOf(chainKey);
  const slip = clampSlip(slippageBps);
  const inn = await resolve(c, a.address, tokenIn);
  const out = await resolve(c, a.address, tokenOut);
  if (inn.quote.toLowerCase() === out.quote.toLowerCase()) throw new Error("Pick two different assets.");
  const gasPrice = await gasPriceOf(c);
  const raw = parseAmount(amount, inn, inn.native ? gasPrice * 400_000n : 0n);
  const q = await quote(c, inn.quote, out.quote, raw, 0);
  if (q.impact != null && q.impact >= 30) throw new Error(`This swap would move the price by about ${q.impact.toFixed(1)}%. Use a smaller amount.`);
  if (q.impact != null && q.impact >= 10 && !confirmImpact) throw new Error(`This swap moves the price by about ${q.impact.toFixed(1)}%. Confirm it again to send.`);
  const min = (BigInt(q.amountOut) * BigInt(10_000 - slip)) / 10_000n;
  if (min < BigInt(minOutRaw)) throw new Error("The price moved. Get a new quote before sending.");
  const tx = await build(c, q, a.address, slip, true);
  if (tx.kind !== "evm") throw new Error("This swap stays on the wallet's own network.");
  const pc = pub(c);
  const wc = wallet(c, a);
  if (tx.spender) {
    const spender = getAddress(tx.spender);
    const allowance = BigInt(await pc.readContract({ address: inn.address as Address, abi: erc20Abi, functionName: "allowance", args: [a.address, spender] }).catch(() => 0n));
    if (allowance < raw) {
      const approved = await wc.writeContract({ account: a, chain: c.viem, address: inn.address as Address, abi: erc20Abi, functionName: "approve", args: [spender, raw] });
      const ok = await pc.waitForTransactionReceipt({ hash: approved, timeout: 60_000 });
      if (ok.status !== "success") throw new Error("The token approval failed. Nothing was swapped.");
    }
  }
  const hash = await wc.sendTransaction({ account: a, chain: c.viem, to: tx.to, data: tx.data, value: BigInt(tx.value || "0"), gasPrice });
  const rc = await pc.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rc.status !== "success") throw new Error(`The swap failed on-chain: ${c.explorer}/tx/${hash}`);
  const via = q.kind === "kyber" ? "KyberSwap" : `${c.name} exchange`;
  const msg = `Swapped ${shown(raw, inn.decimals)} ${inn.symbol} for at least ${shown(min, out.decimals)} ${out.symbol} in wallet ${slot} (${via}). ${c.explorer}/tx/${hash}`;
  await flog("settings", msg);
  return msg;
}

const ZERO = "0x0000000000000000000000000000000000000000" as const;

async function logWithdraw(slot: number, text: string, hash: string) {
  const owner = T() % 100_000;
  const { data } = await supabaseService().from("ai_trader_settings").select("user_id").eq("id", owner).maybeSingle();
  logActivity((data as { user_id?: string } | null)?.user_id, "withdraw", text, undefined, { chain: "bsc", tx: hash });
  await flog("settings", text);
}

export type WithdrawPreview = {
  chain: "bsc"; coin: string; slot: number; from: string; to: string;
  symbol: string; native: boolean; amount: string; raw: string; gasNative: string; gasUsd: number | null; explorer: string;
};

/** BNB Chain only. Shows the send before anything is broadcast. The destination is the address the admin typed. */
export async function withdrawPreview(slot: number, asset: string, amount: number | "max", toRaw: string): Promise<WithdrawPreview> {
  if (!isAddress(String(toRaw || ""))) throw new Error("Enter a BNB Chain address (0x and 40 letters).");
  const to = getAddress(toRaw);
  if (to === ZERO) throw new Error("That address is empty.");
  const c = chainOf("bsc");
  const from = await own(slot);
  if (to.toLowerCase() === from.address.toLowerCase()) throw new Error("That is this same wallet.");
  const held = await resolve(c, from.address, asset);
  const gasPrice = await gasPriceOf(c);
  let gas = 21_000n, raw = 0n;
  if (held.native) {
    raw = parseAmount(amount, held, gas * gasPrice);
  } else {
    raw = parseAmount(amount, held, 0n);
    const est = await pub(c).estimateContractGas({ account: from.address, address: held.address as Address, abi: ERC20, functionName: "transfer", args: [to, raw] }).catch((e: Error) => {
      throw new Error(`The token refused the transfer (${(e as { shortMessage?: string }).shortMessage || e.message}).`.slice(0, 180));
    });
    gas = (BigInt(est) * 13n) / 10n;
    const native = await pub(c).getBalance({ address: from.address });
    if (native < gas * gasPrice) throw new Error(`This wallet needs about ${shown(gas * gasPrice, 18)} BNB for the fee; it has ${shown(native, 18)}.`);
  }
  const fee = gas * gasPrice;
  const feeNum = Number(formatUnits(fee, 18));
  const usd = await coinUsd("bsc");
  return {
    chain: "bsc", coin: "BNB", slot, from: from.address, to, symbol: held.symbol, native: held.native,
    amount: shown(raw, held.decimals), raw: raw.toString(), gasNative: shown(fee, 18), gasUsd: usd ? feeNum * usd : null, explorer: c.explorer,
  };
}

/** Broadcasts the withdrawal. The key never leaves the server. */
export async function withdrawSend(slot: number, asset: string, amount: number | "max", toRaw: string) {
  const preview = await withdrawPreview(slot, asset, amount, toRaw);
  const c = chainOf("bsc");
  const from = await own(slot);
  if (getAddress(toRaw).toLowerCase() !== preview.to.toLowerCase()) throw new Error("That address changed. Review it again.");
  const pc = pub(c);
  const wc = wallet(c, from);
  const gasPrice = await gasPriceOf(c);
  const raw = BigInt(preview.raw);
  const to = getAddress(preview.to);
  let hash: `0x${string}`;
  if (preview.native) hash = await wc.sendTransaction({ account: from, chain: c.viem, to, value: raw, gas: 21_000n, gasPrice });
  else {
    const held = await resolve(c, from.address, asset);
    const est = await pc.estimateContractGas({ account: from.address, address: held.address as Address, abi: ERC20, functionName: "transfer", args: [to, raw] });
    hash = await wc.writeContract({ account: from, chain: c.viem, address: held.address as Address, abi: ERC20, functionName: "transfer", args: [to, raw], gas: (BigInt(est) * 13n) / 10n, gasPrice });
  }
  const rc = await pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (rc.status !== "success") throw new Error(`The withdrawal failed on-chain: ${c.explorer}/tx/${hash}`);
  const text = `Withdrew ${preview.amount} ${preview.symbol} from sniper wallet ${slot} (${preview.from.slice(0, 6)}…${preview.from.slice(-4)}) to ${preview.to}.`;
  await logWithdraw(slot, `${text} ${c.explorer}/tx/${hash}`, hash);
  return `${text} ${c.explorer}/tx/${hash}`;
}
