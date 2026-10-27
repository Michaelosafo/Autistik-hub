/**
 * AUTISTIK Wallet, server side: prices and swap routes, safety checks, balances and Solana transactions.
 * The server never holds keys or money. It builds a swap for the member's own wallet to approve, and always sends the
 * tokens back to that same wallet. Server only.
 */
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http, isAddress, parseAbi } from "viem";
import { address as solAddress, appendTransactionMessageInstructions, compileTransaction, createNoopSigner, createTransactionMessage,
  getBase64EncodedWireTransaction, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction } from "@solana-program/token";
import { getTransferSolInstruction } from "@solana-program/system";
import { AddressLookupTableAccount, Connection, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { FEE_BPS, KYBER_ROUTER, NATIVE, SOL_USDC, WSOL, isNative, type WChain, type WToken } from "@/lib/wallet-chains";
import { solFeeWallet } from "@/lib/launchpad";

const TREASURY = (() => {
  const a = process.env.NEXT_PUBLIC_TREASURY_WALLET || "0x531A5ccB712B2bB997Ce0dF018707948c49Da5ba";
  return isAddress(a) ? getAddress(a) : null;
})();
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** The AUTISTIK marketing wallet on Solana (NEXT_PUBLIC_SOLANA_FEE_WALLET). Without it, Solana swaps are free (no fee). */
const SOL_TREASURY = solFeeWallet();
const KYBER = "https://aggregator-api.kyberswap.com";
const KYBER_HEADERS = { "x-client-id": "autistik-hub", "content-type": "application/json" };
const JUP = process.env.JUPITER_API || "https://lite-api.jup.ag";
const SOL_RPC = process.env.WALLET_SOLANA_RPC || process.env.ANALYTICS_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PQFkJxXRDEAzSPc";

const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
async function getJson(url: string, init?: RequestInit & { timeout?: number }): Promise<any> {
  const r = await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(init?.timeout ?? 10_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(j?.message || j?.error || `HTTP ${r.status}`), { status: r.status, body: j });
  return j;
}
// Typed loosely: the chain object comes from a table, which viem's strict types can't follow.
const client = (c: WChain): any => createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 10_000 }) });

async function solRpc(method: string, params: unknown[]) {
  const j = await getJson(SOL_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (j?.error) throw Object.assign(new Error(j.error.message || "Solana node error"), { rpc: j.error });
  return j.result;
}

// ---------------------------------------------------------------- Tokens and safety

export type TokenInfo = WToken & { priceUsd: number | null; risk: Risk };
export type Risk = { level: "ok" | "warn" | "danger" | "unknown"; notes: string[]; buyTax: number; sellTax: number; honeypot: boolean };

/** GoPlus safety check: honeypots, taxes and owner powers. Unknown (not failed) when GoPlus has nothing. */
export async function riskOf(c: WChain, token: string): Promise<Risk> {
  const none: Risk = { level: "unknown", notes: [], buyTax: 0, sellTax: 0, honeypot: false };
  if (isNative(c, token) || [...c.tokens].some((t) => t.address.toLowerCase() === token.toLowerCase() && t.symbol !== "AUTISTIK")) return { ...none, level: "ok" };
  try {
    const path = c.kind === "solana" ? "solana/token_security" : `token_security/${c.chainId}`;
    const j = await getJson(`https://api.gopluslabs.io/api/v1/${path}?contract_addresses=${token}`, { timeout: 8000, next: { revalidate: 300 } } as any);
    const r = j?.result?.[c.kind === "solana" ? token : token.toLowerCase()];
    if (!r) return none;
    const notes: string[] = [];
    let level: Risk["level"] = "ok";
    const bad = (t: string) => { notes.push(t); level = "danger"; };
    const warn = (t: string) => { notes.push(t); if (level === "ok") level = "warn"; };
    if (c.kind === "solana") {
      if (r.mintable?.status === "1") warn("The creator can still print more of this token.");
      if (r.freezable?.status === "1") bad("The creator can freeze your tokens so you can't sell.");
      if (r.balance_mutable_authority?.status === "1") bad("The creator can change your balance.");
      if (r.non_transferable === "1") bad("This token can't be transferred or sold.");
      const fee = num(r.transfer_fee?.current_fee_rate?.fee_rate_bps) / 100;
      if (fee >= 10) bad(`Transfer tax ${fee}%.`); else if (fee > 0) warn(`Transfer tax ${fee}%.`);
      return { level, notes, buyTax: fee, sellTax: fee, honeypot: false };
    }
    const buyTax = num(r.buy_tax) * 100, sellTax = num(r.sell_tax) * 100;
    const honeypot = r.is_honeypot === "1" || r.cannot_sell_all === "1" || sellTax >= 50;
    if (honeypot) bad("Honeypot: you may not be able to sell this token.");
    if (sellTax >= 15 || buyTax >= 15) bad(`Very high tax: ${buyTax.toFixed(0)}% buy / ${sellTax.toFixed(0)}% sell.`);
    else if (sellTax > 0 || buyTax > 0) warn(`Tax: ${buyTax.toFixed(0)}% buy / ${sellTax.toFixed(0)}% sell (slippage is raised to cover it).`);
    if (r.owner_change_balance === "1") bad("The owner can change wallet balances.");
    if (r.transfer_pausable === "1") warn("The owner can pause trading.");
    if (r.is_blacklisted === "1") warn("The owner can block wallets from selling.");
    if (r.is_mintable === "1") warn("The owner can print more tokens.");
    if (r.is_open_source === "0") warn("The contract code isn't public.");
    return { level, notes, buyTax, sellTax, honeypot };
  } catch { return none; }
}

const DEX_CHAIN: Record<string, string> = { bsc: "bsc", base: "base", ethereum: "ethereum", arbitrum: "arbitrum", solana: "solana" };

/** Prices and logos from DexScreener (EVM), up to 30 tokens per call. Keys are lower-case addresses. */
async function dexPrices(c: WChain, tokens: string[]): Promise<Record<string, { price: number; logo: string | null; liq: number }>> {
  const out: Record<string, { price: number; logo: string | null; liq: number }> = {};
  for (let i = 0; i < tokens.length; i += 30) {
    try {
      const pairs: any[] = await getJson(`https://api.dexscreener.com/tokens/v1/${DEX_CHAIN[c.key]}/${tokens.slice(i, i + 30).join(",")}`, { timeout: 8000, next: { revalidate: 60 } } as any);
      for (const p of pairs || []) {
        const k = String(p?.baseToken?.address || "").toLowerCase();
        const liq = num(p?.liquidity?.usd);
        if (!out[k] || liq > out[k].liq) out[k] = { price: num(p?.priceUsd), logo: p?.info?.imageUrl || out[k]?.logo || null, liq };
      }
    } catch { /* prices are a nice-to-have */ }
  }
  return out;
}

/** Name, symbol, decimals, price and safety for any token address. */
export async function tokenInfo(c: WChain, token: string): Promise<TokenInfo | null> {
  if (isNative(c, token)) return { ...c.native, priceUsd: await nativePrice(c), risk: { level: "ok", notes: [], buyTax: 0, sellTax: 0, honeypot: false } };
  if (c.kind === "solana") {
    const [meta, risk] = await Promise.all([jupTokens([token]).then((m) => m[token]), riskOf(c, token)]);
    if (!meta) return null;
    return { address: token, symbol: meta.symbol, name: meta.name, decimals: meta.decimals, logo: meta.icon, priceUsd: meta.usdPrice, risk };
  }
  const addr = getAddress(token);
  const pc = client(c);
  const read = (functionName: "name" | "symbol" | "decimals") => ({ address: addr, abi: erc20Abi, functionName } as const);
  const [res, prices, risk] = await Promise.all([
    pc.multicall({ contracts: [read("name"), read("symbol"), read("decimals")], allowFailure: true }),
    dexPrices(c, [addr]), riskOf(c, addr),
  ]);
  if (res[2].status !== "success") return null;
  const p = prices[addr.toLowerCase()];
  return { address: addr, name: String(res[0].result ?? "Token"), symbol: String(res[1].result ?? "?"), decimals: Number(res[2].result), logo: p?.logo ?? null, priceUsd: p?.price ?? null, risk };
}

async function nativePrice(c: WChain): Promise<number | null> {
  if (c.kind === "solana") return (await jupTokens([WSOL]))[WSOL]?.usdPrice ?? null;
  return c.wrapped ? (await dexPrices(c, [c.wrapped]))[c.wrapped.toLowerCase()]?.price ?? null : null;
}

type JupToken = { symbol: string; name: string; decimals: number; icon: string | null; usdPrice: number | null; verified: boolean; program: string };
async function jupTokens(mints: string[]): Promise<Record<string, JupToken>> {
  const out: Record<string, JupToken> = {};
  for (let i = 0; i < mints.length; i += 100) {
    try {
      const list: any[] = await getJson(`${JUP}/tokens/v2/search?query=${mints.slice(i, i + 100).join(",")}`, { timeout: 8000, next: { revalidate: 120 } } as any);
      for (const t of list || []) out[t.id] = { symbol: t.symbol, name: t.name, decimals: num(t.decimals), icon: t.icon || null, usdPrice: t.usdPrice ?? null, verified: !!t.isVerified, program: t.tokenProgram || "" };
    } catch { /* keep what we have */ }
  }
  return out;
}

// ---------------------------------------------------------------- Market data for the trade screen

export type Market = {
  pair: string | null; dex: string | null; priceUsd: number | null; priceNative: number | null; change24: number | null; change1h: number | null;
  volume24: number | null; liquidity: number | null; mcap: number | null; buys24: number | null; sells24: number | null; logo: string | null;
};

/** The token's busiest pool on DexScreener: price, 24h change, volume and the pool address for the chart. */
export async function market(c: WChain, token: string): Promise<Market> {
  const addr = isNative(c, token) ? (c.kind === "solana" ? WSOL : c.wrapped || token) : token;
  const empty: Market = { pair: null, dex: null, priceUsd: null, priceNative: null, change24: null, change1h: null, volume24: null, liquidity: null, mcap: null, buys24: null, sells24: null, logo: null };
  try {
    const pairs: any[] = await getJson(`https://api.dexscreener.com/token-pairs/v1/${DEX_CHAIN[c.key]}/${addr}`, { timeout: 8000, next: { revalidate: 30 } } as any);
    const mine = (pairs || []).filter((p) => String(p?.baseToken?.address || "").toLowerCase() === addr.toLowerCase());
    const p = (mine.length ? mine : pairs || []).sort((a, b) => num(b?.liquidity?.usd) - num(a?.liquidity?.usd))[0];
    if (!p) return empty;
    const n = (v: unknown) => (v == null || !isFinite(Number(v)) ? null : Number(v));
    return { pair: p.pairAddress, dex: p.dexId, priceUsd: n(p.priceUsd), priceNative: n(p.priceNative), change24: n(p.priceChange?.h24), change1h: n(p.priceChange?.h1),
      volume24: n(p.volume?.h24), liquidity: n(p.liquidity?.usd), mcap: n(p.marketCap ?? p.fdv), buys24: n(p.txns?.h24?.buys), sells24: n(p.txns?.h24?.sells), logo: p.info?.imageUrl || null };
  } catch { return empty; }
}

// ---------------------------------------------------------------- Balances

export type Holding = WToken & { raw: string; amount: number; priceUsd: number | null; valueUsd: number | null };

/** What a wallet holds. EVM: the chain's coin, the starter tokens and any the member added. Solana: everything. */
export async function balances(c: WChain, owner: string, extra: string[]): Promise<Holding[]> {
  if (c.kind === "solana") return solBalances(c, owner);
  const pc = client(c);
  const known = new Map<string, WToken>(c.tokens.map((t) => [t.address.toLowerCase(), t]));
  const added = [...new Set(extra.filter((a) => isAddress(a)).map((a) => getAddress(a)))].filter((a) => !known.has(a.toLowerCase())).slice(0, 25);
  if (added.length) {
    const meta = await pc.multicall({ allowFailure: true, contracts: added.flatMap((a) => [
      { address: a, abi: erc20Abi, functionName: "symbol" } as const, { address: a, abi: erc20Abi, functionName: "decimals" } as const, { address: a, abi: erc20Abi, functionName: "name" } as const]) });
    added.forEach((a, i) => { if (meta[i * 3 + 1].status === "success") known.set(a.toLowerCase(), { address: a, symbol: String(meta[i * 3].result ?? "?"), decimals: Number(meta[i * 3 + 1].result), name: String(meta[i * 3 + 2].result ?? "") }); });
  }
  const tokens = [...known.values()];
  const who = getAddress(owner);
  const [native, bals, decs, prices, np] = await Promise.all([
    pc.getBalance({ address: who }),
    pc.multicall({ allowFailure: true, contracts: tokens.map((t) => ({ address: t.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [who] } as const)) }),
    // Decimals from the token itself, so a wrong number in the starter list can never show a wrong balance.
    pc.multicall({ allowFailure: true, contracts: tokens.map((t) => ({ address: t.address as `0x${string}`, abi: erc20Abi, functionName: "decimals" } as const)) }),
    dexPrices(c, tokens.map((t) => t.address)),
    nativePrice(c),
  ]);
  const row = (t: WToken, raw: bigint, price: number | null, logo?: string | null): Holding => {
    const amount = Number(raw) / 10 ** t.decimals;
    return { ...t, logo: logo ?? t.logo ?? null, raw: raw.toString(), amount, priceUsd: price, valueUsd: price != null ? amount * price : null };
  };
  const list = [row(c.native, native, np)];
  tokens.forEach((t, i) => {
    const raw = bals[i].status === "success" ? (bals[i].result as bigint) : 0n;
    const p = prices[t.address.toLowerCase()];
    const decimals = decs[i].status === "success" ? Number(decs[i].result) : t.decimals;
    list.push(row({ ...t, decimals }, raw, p?.price ?? null, p?.logo));
  });
  return list;
}

async function solBalances(c: WChain, owner: string): Promise<Holding[]> {
  const bal: Record<string, { amount: string; uiAmount: number }> = await getJson(`${JUP}/ultra/v1/balances/${owner}`, { timeout: 10_000 });
  const mints = Object.keys(bal || {}).filter((m) => m !== "SOL" && num(bal[m].uiAmount) > 0).slice(0, 99);
  const meta = await jupTokens([WSOL, ...mints, ...c.tokens.map((t) => t.address)]);
  const out: Holding[] = [];
  const sol = bal?.SOL;
  const sp = meta[WSOL]?.usdPrice ?? null;
  out.push({ ...c.native, logo: meta[WSOL]?.icon, raw: sol?.amount || "0", amount: num(sol?.uiAmount), priceUsd: sp, valueUsd: sp != null ? num(sol?.uiAmount) * sp : null });
  const seen = new Set<string>();
  for (const m of [...c.tokens.map((t) => t.address), ...mints]) {
    if (seen.has(m)) continue; seen.add(m);
    const t = meta[m]; const b = bal?.[m];
    const starter = c.tokens.find((x) => x.address === m);
    if (!t && !starter) continue;
    const amount = num(b?.uiAmount), price = t?.usdPrice ?? null;
    out.push({ address: m, symbol: t?.symbol || starter!.symbol, name: t?.name || starter!.name, decimals: t?.decimals ?? starter!.decimals, logo: t?.icon,
      raw: b?.amount || "0", amount, priceUsd: price, valueUsd: price != null ? amount * price : null });
  }
  return out;
}

// ---------------------------------------------------------------- Quotes

export type Quote = {
  kind: "kyber" | "v2" | "jupiter"; chain: string; tokenIn: string; tokenOut: string; amountIn: string; amountOut: string;
  inUsd: number | null; outUsd: number | null; impact: number | null; feeBps: number; gasUsd: number | null;
  /** Handed back to /build unchanged. */
  route: any;
};

/** EVM fee side: take it in the coin or a stablecoin, never in a random token that might be hard to sell. */
const feeSide = (c: WChain, tokenIn: string) => (isNative(c, tokenIn) || c.tokens.some((t) => t.address.toLowerCase() === tokenIn.toLowerCase() && /USD/.test(t.symbol)) ? "currency_in" : "currency_out");

export async function quote(c: WChain, tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Quote> {
  if (c.kind === "solana") return jupQuote(c, tokenIn, tokenOut, amountIn);
  try { return await kyberQuote(c, tokenIn, tokenOut, amountIn); }
  catch (e) {
    // Brand-new tokens (like ones launched on AUTISTIK minutes ago) may not be in the aggregator yet: use the DEX directly.
    const v2 = await v2Quote(c, tokenIn, tokenOut, amountIn).catch(() => null);
    if (v2) return v2;
    throw e;
  }
}

async function kyberQuote(c: WChain, tokenIn: string, tokenOut: string, amountIn: bigint, withFee = true): Promise<Quote> {
  const q = new URLSearchParams({ tokenIn, tokenOut, amountIn: amountIn.toString(), gasInclude: "true", source: "autistik-hub" });
  if (TREASURY && withFee && FEE_BPS > 0) q.set("feeAmount", String(FEE_BPS)), q.set("isInBps", "true"), q.set("chargeFeeBy", feeSide(c, tokenIn)), q.set("feeReceiver", TREASURY);
  const j = await getJson(`${KYBER}/${c.kyber}/api/v1/routes?${q}`, { headers: KYBER_HEADERS });
  const s = j?.data?.routeSummary;
  if (!s || j.code !== 0) throw new Error(j?.message || "No route found for this pair.");
  const inUsd = num(s.amountInUsd) || null, outUsd = num(s.amountOutUsd) || null;
  return { kind: "kyber", chain: c.key, tokenIn, tokenOut, amountIn: String(s.amountIn), amountOut: String(s.amountOut), inUsd, outUsd,
    impact: inUsd && outUsd ? Math.max(0, ((inUsd - outUsd) / inUsd) * 100) : null, feeBps: TREASURY && withFee && FEE_BPS > 0 ? FEE_BPS : 0, gasUsd: num(s.gasUsd) || null, route: s };
}

const V2_ABI = parseAbi([
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)",
]);

/** Direct DEX swap between the chain's coin and a token. No AUTISTIK fee: tokens launched here already pay one. */
async function v2Quote(c: WChain, tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Quote | null> {
  if (!c.v2Router || !c.wrapped) return null;
  const buy = isNative(c, tokenIn);
  if (!buy && !isNative(c, tokenOut)) return null;
  const path = buy ? [c.wrapped, getAddress(tokenOut)] : [getAddress(tokenIn), c.wrapped];
  const amounts = await client(c).readContract({ address: c.v2Router, abi: V2_ABI, functionName: "getAmountsOut", args: [amountIn, path] });
  const out = amounts[amounts.length - 1];
  if (!out) return null;
  return { kind: "v2", chain: c.key, tokenIn, tokenOut, amountIn: amountIn.toString(), amountOut: out.toString(), inUsd: null, outUsd: null, impact: null, feeBps: 0, gasUsd: null, route: { path } };
}

/** The treasury's token account for the fee, only for SOL and USDC and only if it already exists. */
async function solFeeAccount(tokenIn: string, tokenOut: string): Promise<string | null> {
  if (!SOL_TREASURY) return null;
  const mint = [tokenOut, tokenIn].find((m) => m === WSOL || m === SOL_USDC);
  if (!mint) return null;
  const [ata] = await findAssociatedTokenPda({ owner: solAddress(SOL_TREASURY), mint: solAddress(mint), tokenProgram: solAddress("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
  try {
    const info = await solRpc("getAccountInfo", [ata, { encoding: "base64" }]);
    return info?.value ? String(ata) : null;
  } catch { return null; }
}

/** The 0.5% fee in SOL: taken from the SOL paid in (buys) or the SOL received (sells). */
const solFeeOf = (lamports: bigint) => (lamports * BigInt(FEE_BPS)) / 10_000n;

/**
 * Jupiter quote. Whenever SOL is on one side, the 0.5% fee is a plain SOL transfer to the marketing wallet in the same
 * transaction (no token accounts needed): on a buy it comes off the SOL paid in, on a sell off the SOL received.
 * Other pairs (USDC and a token) pay Jupiter's platform fee into the marketing wallet's USDC account, if it has one.
 */
async function jupQuote(c: WChain, tokenIn: string, tokenOut: string, amountIn: bigint, withFee = true): Promise<Quote> {
  const solSide = withFee && FEE_BPS > 0 && SOL_TREASURY ? (tokenIn === WSOL ? "in" : tokenOut === WSOL ? "out" : null) : null;
  const feeAccount = withFee && FEE_BPS > 0 && !solSide ? await solFeeAccount(tokenIn, tokenOut) : null;
  const feeIn = solSide === "in" ? solFeeOf(amountIn) : 0n;
  // Room in the transaction for the fee transfer.
  const q = new URLSearchParams({ inputMint: tokenIn, outputMint: tokenOut, amount: (amountIn - feeIn).toString(), slippageBps: "100", restrictIntermediateTokens: "true", maxAccounts: "54" });
  if (feeAccount) q.set("platformFeeBps", String(FEE_BPS));
  const j = await getJson(`${JUP}/swap/v1/quote?${q}`);
  if (!j?.outAmount) throw new Error(j?.error || "No route found for this pair.");
  const feeOut = solSide === "out" ? solFeeOf(BigInt(j.outAmount)) : 0n;
  const inUsd = num(j.swapUsdValue) || null;
  return { kind: "jupiter", chain: c.key, tokenIn, tokenOut, amountIn: (BigInt(j.inAmount) + feeIn).toString(), amountOut: (BigInt(j.outAmount) - feeOut).toString(), inUsd, outUsd: null,
    impact: num(j.priceImpactPct) * 100, feeBps: solSide || feeAccount ? FEE_BPS : 0, gasUsd: null, route: { quote: j, feeAccount, solSide } };
}

const ix = (i: any) => new TransactionInstruction({
  programId: new PublicKey(i.programId),
  keys: (i.accounts || []).map((a: any) => ({ pubkey: new PublicKey(a.pubkey), isSigner: !!a.isSigner, isWritable: !!a.isWritable })),
  data: Buffer.from(i.data || "", "base64"),
});

/** A Jupiter swap with the SOL fee transfer added (before the swap on a buy, after it on a sell). */
async function jupSwapWithSolFee(q: Quote, from: string, slippageBps: number): Promise<SolTx> {
  const quote = q.route.quote, side = q.route.solSide as "in" | "out";
  // Everything is worked out again from Jupiter's quote: the browser can't change the fee or where it goes.
  if (quote.inputMint !== q.tokenIn || quote.outputMint !== q.tokenOut || (side === "in" ? q.tokenIn : q.tokenOut) !== WSOL) throw new Error("Prices changed. Please get a new quote.");
  const inAmt = BigInt(quote.inAmount), outAmt = BigInt(quote.outAmount);
  const fee = side === "in" ? solFeeOf(BigInt(q.amountIn)) : solFeeOf(outAmt);
  if (side === "in" && inAmt + fee !== BigInt(q.amountIn)) throw new Error("Prices changed. Please get a new quote.");
  if (fee <= 0n) throw new Error("That amount is too small to swap.");
  const j = await getJson(`${JUP}/swap/v1/swap-instructions`, { method: "POST", headers: { "content-type": "application/json" }, timeout: 15_000, body: JSON.stringify({
    quoteResponse: { ...quote, slippageBps }, userPublicKey: from, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, dynamicSlippage: false,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" } },
  }) });
  if (!j?.swapInstruction) throw new Error(j?.error || "Couldn't build the swap. Try again.");
  const user = new PublicKey(from);
  const feeIx = SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(SOL_TREASURY!), lamports: fee });
  const ixs = [
    ...(j.computeBudgetInstructions || []).map(ix),
    ...(side === "in" ? [feeIx] : []),
    ...(j.setupInstructions || []).map(ix),
    ...(j.tokenLedgerInstruction ? [ix(j.tokenLedgerInstruction)] : []),
    ix(j.swapInstruction),
    ...(j.cleanupInstruction ? [ix(j.cleanupInstruction)] : []),
    ...(j.otherInstructions || []).map(ix),
    ...(side === "out" ? [feeIx] : []),
  ];
  const conn = new Connection(SOL_RPC, "confirmed");
  const luts = (await Promise.all((j.addressLookupTableAddresses || []).map((a: string) => conn.getAddressLookupTable(new PublicKey(a)).then((r) => r.value))))
    .filter(Boolean) as AddressLookupTableAccount[];
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts));
  let wire: Uint8Array;
  try { wire = tx.serialize(); } catch { throw new Error("This route is too big for one transaction. Try a smaller amount."); }
  return { kind: "solana", tx: Buffer.from(wire).toString("base64") };
}

// ---------------------------------------------------------------- Building the transaction

export type EvmTx = { kind: "evm"; to: `0x${string}`; data: `0x${string}`; value: string; spender: `0x${string}` | null };
export type SolTx = { kind: "solana"; tx: string };

/** Turns a quote into a transaction for the member's own wallet. The tokens always go back to that same wallet. */
export async function build(c: WChain, q: Quote, from: string, slippageBps: number): Promise<EvmTx | SolTx> {
  if (q.kind === "jupiter") {
    if (!SOL_RE.test(from)) throw new Error("That isn't a Solana wallet address.");
    if (q.route?.solSide) {
      if (!SOL_TREASURY || !q.feeBps) throw new Error("Prices changed. Please get a new quote.");
      return jupSwapWithSolFee(q, from, slippageBps);
    }
    // The fee account is worked out again here, never taken from the browser.
    // A quote that should carry the fee must carry it (a quote from the browser can't drop it).
    if (FEE_BPS > 0 && SOL_TREASURY && (q.tokenIn === WSOL || q.tokenOut === WSOL)) throw new Error("Prices changed. Please get a new quote.");
    const feeAccount = q.feeBps ? await solFeeAccount(q.tokenIn, q.tokenOut) : null;
    if (q.feeBps && !feeAccount) throw new Error("Prices changed. Please get a new quote.");
    const quoteResponse = { ...q.route.quote, slippageBps };
    const j = await getJson(`${JUP}/swap/v1/swap`, { method: "POST", headers: { "content-type": "application/json" }, timeout: 15_000, body: JSON.stringify({
      quoteResponse, userPublicKey: from, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, dynamicSlippage: false,
      ...(feeAccount ? { feeAccount } : {}),
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" } },
    }) });
    if (!j?.swapTransaction) throw new Error(j?.error || "Couldn't build the swap. Try again.");
    return { kind: "solana", tx: j.swapTransaction };
  }
  const who = getAddress(from);
  if (q.kind === "v2") {
    if (!c.v2Router) throw new Error("This chain has no direct DEX route.");
    const path = (q.route?.path || []).map((a: string) => getAddress(a));
    const okPath = path.length === 2 && (isNative(c, q.tokenIn) ? path[0] === getAddress(c.wrapped!) && path[1] === getAddress(q.tokenOut) : path[0] === getAddress(q.tokenIn) && path[1] === getAddress(c.wrapped!));
    if (!okPath) throw new Error("That route doesn't match the swap. Get a new quote.");
    const minOut = (BigInt(q.amountOut) * BigInt(10_000 - slippageBps)) / 10_000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    const buy = isNative(c, q.tokenIn);
    const data = buy
      ? encodeFunctionData({ abi: V2_ABI, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args: [minOut, path, who, deadline] })
      : encodeFunctionData({ abi: V2_ABI, functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens", args: [BigInt(q.amountIn), minOut, path, who, deadline] });
    return { kind: "evm", to: c.v2Router, data, value: buy ? q.amountIn : "0", spender: buy ? null : c.v2Router };
  }
  // KyberSwap: the fee must still be ours (a quote from the browser can't redirect it).
  const fee = q.route?.extraFee;
  if (TREASURY && FEE_BPS > 0 && (!fee || Number(fee.feeAmount) !== FEE_BPS || String(fee.feeReceiver).toLowerCase() !== TREASURY.toLowerCase())) throw new Error("Prices changed. Please get a new quote.");
  const j = await getJson(`${KYBER}/${c.kyber}/api/v1/route/build`, { method: "POST", headers: KYBER_HEADERS, timeout: 15_000, body: JSON.stringify({
    routeSummary: q.route, sender: who, recipient: who, slippageTolerance: slippageBps, source: "autistik-hub", enableGasEstimation: false,
  }) });
  const d = j?.data;
  if (j?.code !== 0 || !d?.data) throw new Error(j?.message || "Couldn't build the swap. Try again.");
  if (getAddress(d.routerAddress) !== getAddress(KYBER_ROUTER)) throw new Error("Unexpected swap contract. Swap stopped for your safety.");
  return { kind: "evm", to: KYBER_ROUTER, data: d.data, value: String(d.transactionValue || "0"), spender: isNative(c, q.tokenIn) ? null : KYBER_ROUTER };
}

// ---------------------------------------------------------------- Solana: send coins and broadcast signed transactions

/** A Solana transfer (SOL or any token) for the member to sign. Creates the receiver's token account if needed. */
export async function solTransfer(from: string, to: string, mint: string, raw: bigint, decimals: number): Promise<SolTx> {
  if (!SOL_RE.test(from) || !SOL_RE.test(to)) throw new Error("That isn't a Solana address.");
  const owner = solAddress(from), dest = solAddress(to);
  // Only a placeholder for the fee payer: the member signs in their own wallet.
  const signer = createNoopSigner(owner);
  const { value: bh } = await solRpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  let ixs: any[];
  if (mint === WSOL) ixs = [getTransferSolInstruction({ source: signer, destination: dest, amount: raw })];
  else {
    const info = await solRpc("getAccountInfo", [mint, { encoding: "base64" }]);
    const program = solAddress(info?.value?.owner === TOKEN_2022 ? TOKEN_2022 : "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const m = solAddress(mint);
    const [src] = await findAssociatedTokenPda({ owner, mint: m, tokenProgram: program });
    const [dst] = await findAssociatedTokenPda({ owner: dest, mint: m, tokenProgram: program });
    ixs = [
      getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata: dst, owner: dest, mint: m, tokenProgram: program }, { programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS }),
      getTransferCheckedInstruction({ source: src, mint: m, destination: dst, authority: signer, amount: raw, decimals }, { programAddress: program }),
    ];
  }
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(owner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  return { kind: "solana", tx: getBase64EncodedWireTransaction(compileTransaction(msg as any)) };
}

/** Sends a transaction the member already signed in their own wallet. */
export async function solBroadcast(signedBase64: string): Promise<string> {
  try {
    return await solRpc("sendTransaction", [signedBase64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }]);
  } catch (e: any) {
    throw new Error(solReason(e));
  }
}

/** Turns Solana's "simulation failed" into the actual reason, in plain words (the full logs go to the server log). */
function solReason(e: any): string {
  const data = e?.rpc?.data || {};
  const logs: string[] = Array.isArray(data.logs) ? data.logs.map(String) : [];
  const all = [String(e?.message || ""), JSON.stringify(data.err ?? ""), ...logs].join("\n");
  console.error("solana send failed:", String(e?.message || "").slice(0, 200), JSON.stringify(data.err ?? null), "\n" + logs.slice(-14).join("\n").slice(0, 2500));
  if (/Blockhash not found|BlockhashNotFound|block height exceeded/i.test(all)) return "That took too long to approve, so Solana expired it. Tap the button again and approve within a minute.";
  if (/insufficient lamports|InsufficientFundsForRent|insufficient funds for (rent|fee)|AccountNotFound/i.test(all)) return "Not enough SOL in this wallet. Add a little more SOL (the pool needs your liquidity plus about 0.2 SOL in fees) and try again.";
  if (/insufficient funds|custom program error: 0x1\b/i.test(all)) return "Not enough tokens or SOL in this wallet for that amount. Check the balances and try again.";
  if (/already in use|AccountAlreadyInitialized|already initialized/i.test(all)) return "That pool already exists. Open the token's page to add liquidity to it instead.";
  if (/signature verification|SignatureFailure|missing signature/i.test(all)) return "The wallet changed the transaction while signing. Try again, or use another wallet app.";
  const last = [...logs].reverse().find((l) => /Error|failed|error/i.test(l));
  return `Solana rejected it: ${(last || String(e?.message || "simulation failed")).replace(/^Program log: /, "").slice(0, 140)}`;
}
export async function solStatus(sig: string): Promise<"pending" | "done" | "failed"> {
  const r = await solRpc("getSignatureStatuses", [[sig], { searchTransactionHistory: false }]);
  const s = r?.value?.[0];
  if (!s) return "pending";
  if (s.err) return "failed";
  return s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "done" : "pending";
}

export const feeConfigured = { evm: !!TREASURY, solana: !!SOL_TREASURY };
export { NATIVE };

// ---------------------------------------------------------------- For the order keeper

/** A route with no aggregator fee (the order contract takes its own), paying out to `recipient`. */
export async function kyberRoute(c: WChain, tokenIn: string, tokenOut: string, amountIn: bigint, sender: string, recipient: string, slippageBps: number) {
  const q = await kyberQuote(c, tokenIn, tokenOut, amountIn, false);
  const j = await getJson(`${KYBER}/${c.kyber}/api/v1/route/build`, { method: "POST", headers: KYBER_HEADERS, timeout: 15_000, body: JSON.stringify({
    routeSummary: q.route, sender, recipient, slippageTolerance: slippageBps, source: "autistik-hub", enableGasEstimation: false,
  }) });
  const d = j?.data;
  if (j?.code !== 0 || !d?.data) throw new Error(j?.message || "No route.");
  if (getAddress(d.routerAddress) !== getAddress(KYBER_ROUTER)) throw new Error("Unexpected router.");
  return { amountOut: BigInt(q.amountOut), data: d.data as `0x${string}` };
}
/** Expected output of a direct V2 swap along `path`. */
export async function v2AmountOut(c: WChain, amountIn: bigint, path: string[]): Promise<bigint> {
  const a = await client(c).readContract({ address: c.v2Router!, abi: V2_ABI, functionName: "getAmountsOut", args: [amountIn, path.map((x) => getAddress(x))] });
  return a[a.length - 1];
}
export { client as walletChainClient };
