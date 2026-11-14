/**
 * Live trading on each chain for the AI trader (server only). Each trader has one EVM wallet (the same address on
 * BNB Chain, Ethereum and Robinhood Chain) and, if they create one, a Solana wallet. Every chain buys with its own
 * coin, so the wallet needs that coin on that chain: BNB on BNB Chain, ETH on Ethereum, ETH on Robinhood Chain and
 * SOL on Solana. Nothing is bridged.
 *
 * Swaps: BNB Chain and Ethereum through KyberSwap (the route the Wallet already uses, fee-free for the trader's own
 * wallet), Robinhood Chain through LI.FI, Elysium (Kinetiq's Hyperliquid L2, gas in HYPE) through Relay with LI.FI as
 * the fallback, Solana through Jupiter. Moving money between the trader's wallets on different chains goes through
 * Relay (relayBridge), which needs RELAY_API_KEY. Each buy reports exactly how many tokens arrived
 * and each sell exactly how much of the chain's coin came back.
 */
import { createPublicClient, createWalletClient, defineChain, erc20Abi, getAddress, http, parseUnits, type PrivateKeyAccount } from "viem";
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { WCHAINS, WSOL } from "@/lib/wallet-chains";
import { build, market, quote, walletChainClient, type EvmTx } from "@/lib/wallet-server";

export const LIVE_CHAINS = ["bsc", "ethereum", "robinhood", "elysium", "solana"] as const;
export type LiveChain = (typeof LIVE_CHAINS)[number];
export const isLiveChain = (c: string): c is LiveChain => (LIVE_CHAINS as readonly string[]).includes(c);
export const NATIVE: Record<LiveChain, string> = { bsc: "BNB", ethereum: "ETH", robinhood: "ETH", elysium: "HYPE", solana: "SOL" };
/** Always left in each wallet for fees. */
export const GAS_KEEP: Record<LiveChain, number> = { bsc: 0.003, ethereum: 0.004, robinhood: 0.0005, elysium: 0.02, solana: 0.01 };
const SLIP_BPS = 300; // 3% plus the coin's tax
const ZERO = "0x0000000000000000000000000000000000000000";

const RH_RPC = process.env.ROBINHOOD_RPC || "https://rpc.mainnet.chain.robinhood.com";
const ROBINHOOD = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RH_RPC] } } });
const EL_RPC = process.env.ELYSIUM_RPC || "https://rpc.elysium.kinetiq.xyz";
const ELYSIUM = defineChain({ id: 99901, name: "Elysium", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: [EL_RPC] } } });
const JUP = process.env.JUPITER_API || "https://lite-api.jup.ag";
/** Chain ids as Relay knows them (Solana has its own Relay id). */
export const RELAY_ID: Record<LiveChain, number> = { bsc: 56, ethereum: 1, robinhood: 4663, elysium: 99901, solana: 792703809 };
const SOL_NATIVE_RELAY = "11111111111111111111111111111111";
type EvmKey = Exclude<LiveChain, "solana">;
const solConn = () => new Connection(WCHAINS.solana.rpc, "confirmed");

const evmChain = (chain: "bsc" | "ethereum") => WCHAINS[chain];
const custom = (chain: EvmKey) => (chain === "robinhood" ? { c: ROBINHOOD, rpc: RH_RPC } : chain === "elysium" ? { c: ELYSIUM, rpc: EL_RPC } : null);
function pub(chain: EvmKey): any {
  const x = custom(chain);
  return x ? createPublicClient({ chain: x.c, transport: http(x.rpc, { timeout: 20_000 }) }) : walletChainClient(evmChain(chain as "bsc" | "ethereum"));
}
function wallet(chain: EvmKey, account: PrivateKeyAccount): any {
  const x = custom(chain);
  if (x) return createWalletClient({ account, chain: x.c, transport: http(x.rpc, { timeout: 20_000 }) });
  const c = evmChain(chain as "bsc" | "ethereum");
  return createWalletClient({ account, chain: c.viem, transport: http(c.rpc, { timeout: 20_000 }) });
}
const evmKeyOfId = (id: number): EvmKey | null => (Object.entries(RELAY_ID).find(([k, v]) => v === id && k !== "solana")?.[0] as EvmKey) || null;

/** Dollar price of each chain's coin (ETH for Ethereum and Robinhood Chain). */
export async function nativeUsd(chain: LiveChain): Promise<number> {
  if (chain === "elysium") return hypeUsd();
  const c = chain === "bsc" ? WCHAINS.bsc : chain === "solana" ? WCHAINS.solana : WCHAINS.ethereum;
  const m = await market(c, c.native.address);
  if (!m.priceUsd) throw new Error(`No ${NATIVE[chain]} price right now.`);
  return m.priceUsd;
}

/** HYPE in dollars (CoinGecko, then DexScreener's busiest HYPE pair as a fallback). */
let hypeCache: { at: number; usd: number } | null = null;
async function hypeUsd(): Promise<number> {
  if (hypeCache && Date.now() - hypeCache.at < 60_000) return hypeCache.usd;
  let usd = Number((await fetch("https://api.coingecko.com/api/v3/simple/price?ids=hyperliquid&vs_currencies=usd", { cache: "no-store", signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null))?.hyperliquid?.usd) || 0;
  if (!usd) {
    const j = await fetch("https://api.dexscreener.com/latest/dex/search?q=WHYPE%20USDC", { cache: "no-store", signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null);
    const p = ((j?.pairs || []) as any[]).filter((x) => /^W?HYPE$/i.test(String(x?.baseToken?.symbol))).sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
    usd = Number(p?.priceUsd) || 0;
  }
  if (!usd) throw new Error("No HYPE price right now.");
  hypeCache = { at: Date.now(), usd };
  return usd;
}

export type Wallets = { evm: PrivateKeyAccount | null; sol: Keypair | null };

/**
 * Stablecoins the trader can buy with and sell into ("Trade in stablecoins"), per network: USDT first (it's what most
 * funds are in), then USDC. Each buy uses whichever of the two the wallet holds more of on that network.
 */
export type Stable = { symbol: "USDT" | "USDC"; token: string; decimals: number };
export const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const STABLES: Partial<Record<LiveChain, Stable[]>> = {
  solana: [{ symbol: "USDT", token: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 }, { symbol: "USDC", token: USDC_SOL, decimals: 6 }],
  bsc: [{ symbol: "USDT", token: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 }, { symbol: "USDC", token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 }],
  ethereum: [{ symbol: "USDT", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 }, { symbol: "USDC", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 }],
};
export const stableBySymbol = (chain: string, symbol: string | null | undefined) => (STABLES[chain as LiveChain] || []).find((x) => x.symbol === symbol) || null;

/** Dollars of each stablecoin in the wallet on this network. */
export async function stableBalances(chain: LiveChain, w: Wallets): Promise<(Stable & { balance: number })[]> {
  const list = STABLES[chain] || [];
  return Promise.all(list.map(async (st) => {
    let raw = 0n;
    if (chain === "solana") raw = w.sol ? (await solTokenRaw(w.sol.publicKey, st.token).catch(() => ({ raw: 0n }))).raw : 0n;
    else if (w.evm) raw = await pub(chain).readContract({ address: getAddress(st.token), abi: erc20Abi, functionName: "balanceOf", args: [w.evm.address] }).catch(() => 0n);
    return { ...st, balance: Number(raw) / 10 ** st.decimals };
  }));
}
/** The stablecoin to pay with on this network: the one the wallet holds most of (USDT on a tie). */
export async function bestStable(chain: LiveChain, w: Wallets) {
  const list = await stableBalances(chain, w);
  return list.sort((a, b) => b.balance - a.balance)[0] || null;
}

/** How much of the chain's own coin the wallet holds. */
export async function chainBalance(chain: LiveChain, w: Wallets): Promise<number> {
  if (chain === "solana") {
    if (!w.sol) return 0;
    return (await solConn().getBalance(w.sol.publicKey)) / 1e9;
  }
  if (!w.evm) return 0;
  return Number(await pub(chain).getBalance({ address: w.evm.address })) / 1e18;
}

export const walletAddress = (chain: LiveChain, w: Wallets) => (chain === "solana" ? w.sol?.publicKey.toBase58() ?? null : w.evm?.address ?? null);

// ---------------------------------------------------------------- EVM

async function sendEvm(chain: Exclude<LiveChain, "solana">, account: PrivateKeyAccount, tx: { to: string; data: string; value: bigint; gas?: bigint }, approve?: { token: string; spender: string; amount: bigint }) {
  const pc = pub(chain), wc = wallet(chain, account);
  if (approve) {
    const have: bigint = await pc.readContract({ address: approve.token, abi: erc20Abi, functionName: "allowance", args: [account.address, approve.spender] });
    if (have < approve.amount) {
      // USDT on Ethereum refuses to change an allowance that isn't 0: reset it first.
      if (have > 0n && chain === "ethereum") {
        const z = await wc.writeContract({ address: approve.token, abi: erc20Abi, functionName: "approve", args: [approve.spender, 0n] });
        await pc.waitForTransactionReceipt({ hash: z, timeout: 90_000 });
      }
      const h = await wc.writeContract({ address: approve.token, abi: erc20Abi, functionName: "approve", args: [approve.spender, approve.amount] });
      await pc.waitForTransactionReceipt({ hash: h, timeout: 90_000 });
    }
  }
  const hash = await wc.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, ...(tx.gas ? { gas: tx.gas } : {}) });
  const r = await pc.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== "success") throw new Error("The swap transaction failed on-chain.");
  return { hash: hash as string, gas: BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice ?? 0n) };
}

/** A swap route on Robinhood Chain from LI.FI (native ETH is the zero address there). */
async function lifiQuote(from: string, to: string, amount: bigint, wallet: string, slipPct: number) { return lifiQuoteOn(4663, from, to, amount, wallet, slipPct); }
async function lifiQuoteOn(chainId: number, from: string, to: string, amount: bigint, wallet: string, slipPct: number) {
  const q = new URLSearchParams({ fromChain: String(chainId), toChain: String(chainId), fromToken: from, toToken: to, fromAmount: amount.toString(), fromAddress: wallet, slippage: String(Math.min(0.5, slipPct / 100)), integrator: "autistik" });
  const r = await fetch(`https://li.quest/v1/quote?${q}`, { headers: { accept: "application/json", ...(process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : {}) }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.transactionRequest) throw new Error(`No ${chainId === 4663 ? "Robinhood Chain" : chainId === 99901 ? "Elysium" : "swap"} route: ${j?.message || r.status}`);
  const t = j.transactionRequest;
  return { tx: { to: String(t.to), data: String(t.data), value: BigInt(t.value || "0"), gas: t.gasLimit ? BigInt(t.gasLimit) : undefined }, spender: j.estimate?.approvalAddress ? String(j.estimate.approvalAddress) : String(t.to) };
}

// ---------------------------------------------------------------- Relay (bridging, and swaps on Elysium)

export const relayReady = () => !!process.env.RELAY_API_KEY;
async function relayQuote(body: Record<string, unknown>) {
  if (!relayReady()) throw new Error("Add RELAY_API_KEY (free from relay.link) in Vercel to use Relay, then redeploy.");
  const r = await fetch("https://api.relay.link/quote/v2", { method: "POST", headers: { "content-type": "application/json", "x-api-key": String(process.env.RELAY_API_KEY) }, body: JSON.stringify({ tradeType: "EXACT_INPUT", ...body }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j?.steps)) throw new Error(`Relay: ${j?.message || j?.error || r.status}`);
  return j;
}

/** Sends every transaction step of a Relay quote from the trader's EVM wallet, in order, waiting for each. */
async function relayRun(q: any, account: PrivateKeyAccount): Promise<{ hashes: string[]; requestId: string | null }> {
  const hashes: string[] = [];
  let requestId: string | null = null;
  for (const step of q.steps) {
    requestId = requestId || step.requestId || null;
    if (step.kind !== "transaction") throw new Error("Relay asked for a signature step, which the trader can't do here.");
    for (const it of step.items || []) {
      if (it.status === "complete") continue;
      const d = it.data || {};
      const key = evmKeyOfId(Number(d.chainId));
      if (!key) throw new Error(`Relay wants a transaction on chain ${d.chainId}, which the trader doesn't use.`);
      if (String(d.from || "").toLowerCase() !== account.address.toLowerCase()) throw new Error("Relay's transaction isn't from the trading wallet.");
      const hash = await wallet(key, account).sendTransaction({ to: getAddress(d.to), data: d.data || "0x", value: BigInt(d.value || "0"), ...(d.gas ? { gas: BigInt(d.gas) } : {}) });
      const r = await pub(key).waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (r.status !== "success") throw new Error("A Relay transaction failed on-chain.");
      hashes.push(hash);
    }
  }
  return { hashes, requestId };
}

/** Hyperliquid's own chain for Relay, and its perps USDC (lands in the futures account, ready to trade). */
const HL_RELAY_ID = 1337, HL_PERPS_USDC = "0x00000000000000000000000000000000";

/** Signs and sends one Solana step of a Relay order (instructions + address lookup tables), waiting for confirmation. */
async function relaySolStep(kp: Keypair, d: any): Promise<string> {
  const conn = solConn();
  let tx: VersionedTransaction;
  if (Array.isArray(d?.instructions)) {
    const ixs = d.instructions.map((i: any) => new TransactionInstruction({
      programId: new PublicKey(i.programId),
      keys: (i.keys || []).map((k: any) => ({ pubkey: new PublicKey(k.pubkey), isSigner: !!k.isSigner, isWritable: !!k.isWritable })),
      data: Buffer.from(String(i.data || ""), "hex"),
    }));
    const luts = (await Promise.all(((d.addressLookupTableAddresses || []) as string[]).map((a) => conn.getAddressLookupTable(new PublicKey(a)).then((r) => r.value)))).filter(Boolean) as AddressLookupTableAccount[];
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    tx = new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts));
  } else if (typeof d?.serializedTransaction === "string" || typeof d?.transaction === "string") {
    tx = VersionedTransaction.deserialize(Buffer.from(String(d.serializedTransaction || d.transaction), "base64"));
  } else throw new Error("Relay sent a Solana step this can't read.");
  tx.sign([kp]);
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 2 });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = (await conn.getSignatureStatuses([sig]).catch(() => null))?.value?.[0];
    if (st?.err) throw new Error("The Solana transfer failed on-chain.");
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
    if (i % 3 === 2) conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
  }
  return sig; // sent; Relay's status says whether it arrived
}

/**
 * Sends USDT / USDC from the Solana trading wallet straight into a Hyperliquid futures account (Relay: one transfer
 * on Solana, arrives as trading USDC on Hyperliquid, no Arbitrum or ETH needed). quoteOnly: just the price.
 */
export async function solToHyperliquid(w: Wallets, recipient: string, usd: number, symbol: "USDT" | "USDC", quoteOnly = false) {
  if (!w.sol) throw new Error("There's no Solana wallet to send from.");
  const st = stableBySymbol("solana", symbol);
  if (!st) throw new Error("Pick USDT or USDC.");
  if (!(usd >= 5)) throw new Error("Send at least $5.");
  const have = Number((await solTokenRaw(w.sol.publicKey, st.token)).raw) / 10 ** st.decimals;
  if (usd > have + 1e-9) throw new Error(`That Solana wallet has only $${have.toFixed(2)} ${symbol}.`);
  return solCoinToHyperliquid(w.sol, recipient, st.token, parseUnits(usd.toFixed(6), st.decimals), quoteOnly);
}
/** SOL itself into the Hyperliquid account (Relay swaps it to trading USDC on the way). */
export async function solNativeToHyperliquid(kp: Keypair, recipient: string, sol: number, quoteOnly = false) {
  if (!(sol > 0)) throw new Error("No SOL to send.");
  return solCoinToHyperliquid(kp, recipient, SOL_NATIVE_RELAY, parseUnits(sol.toFixed(9), 9), quoteOnly);
}
async function solCoinToHyperliquid(kp: Keypair, recipient: string, token: string, raw: bigint, quoteOnly: boolean) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error("Create the AI Futures wallet first.");
  return solRelayTo(kp, recipient, token, raw, HL_RELAY_ID, HL_PERPS_USDC, quoteOnly);
}

/**
 * Money for a call on another network: USDT / USDC from the Solana wallet → the trading wallet on BNB Chain or
 * Ethereum (Relay, usually 10-30 seconds), either as that chain's USDT / USDC or as its own coin (for network fees).
 */
export async function solFundChain(kp: Keypair, evmAddr: string, from: Stable, usd: number, to: Exclude<LiveChain, "solana">, as: "stable" | "native") {
  const dest = as === "native" ? ZERO : (stableBySymbol(to, from.symbol) || stableBySymbol(to, "USDT"))?.token;
  if (!dest) throw new Error(`No stablecoin set up on ${to}.`);
  return solRelayTo(kp, evmAddr, from.token, parseUnits(usd.toFixed(6), from.decimals), RELAY_ID[to], dest, false);
}

async function solRelayTo(kp: Keypair, recipient: string, token: string, raw: bigint, destChainId: number, destCurrency: string, quoteOnly: boolean) {
  const q = await relayQuote({ user: kp.publicKey.toBase58(), recipient, originChainId: RELAY_ID.solana, destinationChainId: destChainId, originCurrency: token, destinationCurrency: destCurrency, amount: raw.toString() });
  const info = relayInfo(q);
  if (quoteOnly) return { ...info, requestId: null as string | null, sigs: [] as string[] };
  const sigs: string[] = [];
  let requestId: string | null = null;
  for (const step of q.steps) {
    requestId = requestId || step.requestId || null;
    if (step.kind !== "transaction") throw new Error("Relay asked for a signature step, which can't be done here.");
    for (const it of step.items || []) {
      if (it.status === "complete") continue;
      sigs.push(await relaySolStep(kp, it.data));
    }
  }
  return { ...info, requestId, sigs };
}
function relayInfo(q: any) {
  const fees = q.fees || {};
  const feeUsd = ["gas", "relayer", "app"].reduce((a, k) => a + (Number(fees[k]?.amountUsd) || 0), 0);
  return { receive: Number(q.details?.currencyOut?.amountUsd || q.details?.currencyOut?.amountFormatted) || null, feeUsd: +feeUsd.toFixed(4), seconds: Number(q.details?.timeEstimate) || null };
}

/**
 * Withdraw from the Hyperliquid futures account straight to a Solana address as USDT / USDC (Relay). Two signatures
 * from the futures wallet, no gas: Relay's "authorize" (links the transfer to this order), then the Hyperliquid
 * transfer to Relay, which pays out on Solana in about a minute.
 */
export async function hlToSolana(account: PrivateKeyAccount, recipient: string, usd: number, symbol: "USDT" | "USDC", quoteOnly = false) {
  const st = stableBySymbol("solana", symbol);
  if (!st) throw new Error("Pick USDT or USDC.");
  try { new PublicKey(recipient); } catch { throw new Error("That isn't a Solana address."); }
  if (!(usd >= 5)) throw new Error("Withdraw at least $5.");
  const q = await relayQuote({ user: account.address, recipient, refundTo: account.address, originChainId: HL_RELAY_ID, destinationChainId: RELAY_ID.solana, originCurrency: HL_PERPS_USDC, destinationCurrency: st.token, amount: parseUnits(usd.toFixed(2), 8).toString(), protocolVersion: "v2" });
  const info = relayInfo(q);
  if (quoteOnly) return { ...info, requestId: null as string | null };
  const { hlRelayStep } = await import("@/lib/hyperliquid");
  let requestId: string | null = null;
  for (const step of q.steps) {
    requestId = requestId || step.requestId || null;
    for (const it of step.items || []) {
      if (it.status === "complete") continue;
      const d = it.data || {};
      if (step.kind === "signature" && d.sign && d.post) {
        const sg = d.sign;
        const types = { ...(sg.types || {}) }; delete types.EIP712Domain;
        const domain = { ...sg.domain, chainId: 42161 };
        const signature = await account.signTypedData({ domain, types, primaryType: sg.primaryType, message: sg.value } as any);
        const body = { ...(d.post.body || {}), signatureChainId: 42161 };
        const r = await fetch(`https://api.relay.link${d.post.endpoint}?signature=${signature}`, { method: d.post.method || "POST", headers: { "content-type": "application/json", "x-api-key": String(process.env.RELAY_API_KEY) }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(`Relay authorize: ${j?.message || r.status}`); }
      } else if (step.kind === "transaction" && d.action) {
        await hlRelayStep(account, d);
      } else throw new Error(`Relay sent a step this can't do (${step.kind}).`);
    }
  }
  return { ...info, requestId };
}

/** A Solana wallet's SOL, USDT and USDC. Jupiter first (one call, reliable from the server), the RPC as backup. */
export async function solWalletBalances(owner: string): Promise<{ sol: number | null; usdt: number; usdc: number }> {
  const usdtMint = stableBySymbol("solana", "USDT")!.token, usdcMint = stableBySymbol("solana", "USDC")!.token;
  const h = await fetch(`${JUP}/ultra/v1/holdings/${owner}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const ui = (mint: string) => ((h?.tokens?.[mint] || []) as any[]).reduce((a, x) => a + (Number(x.uiAmount) || 0), 0);
  if (h && (h.uiAmount != null || h.amount != null || h.tokens)) {
    return { sol: h.uiAmount != null ? Number(h.uiAmount) : Number(h.amount || 0) / 1e9, usdt: ui(usdtMint), usdc: ui(usdcMint) };
  }
  const pk = new PublicKey(owner);
  const [sol, t, c] = await Promise.all([
    solConn().getBalance(pk).then((x) => x / 1e9).catch(() => null),
    solTokenRaw(pk, usdtMint).then((x) => Number(x.raw) / 1e6).catch(() => 0),
    solTokenRaw(pk, usdcMint).then((x) => Number(x.raw) / 1e6).catch(() => 0),
  ]);
  return { sol, usdt: t, usdc: c };
}

/** Where a Relay order stands: waiting, depositing, pending, success, refund or failure. */
export async function relayStatus(requestId: string): Promise<{ status: string; txs: string[] }> {
  const j = await fetch(`https://api.relay.link/intents/status/v3?requestId=${encodeURIComponent(requestId)}`, { headers: process.env.RELAY_API_KEY ? { "x-api-key": String(process.env.RELAY_API_KEY) } : {}, cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
  return { status: String(j?.status || "unknown"), txs: ((j?.txHashes || j?.outTxHashes || []) as any[]).map(String) };
}

const currencyOf = (chain: LiveChain) => (chain === "solana" ? SOL_NATIVE_RELAY : ZERO);

/**
 * A quote for moving the trader's own coin from one chain to another through Relay (e.g. BNB on BNB Chain → HYPE on
 * Elysium). The coins always arrive in the same trader's wallet on the other chain.
 */
export async function relayBridgeQuote(from: LiveChain, to: LiveChain, amountNative: number, w: Wallets) {
  if (from === "solana") throw new Error("Moving money out of Solana isn't supported here yet: send it from Phantom instead.");
  if (!w.evm) throw new Error("Create the trading wallet first.");
  const recipient = to === "solana" ? w.sol?.publicKey.toBase58() : w.evm.address;
  if (!recipient) throw new Error("Create or import the Solana wallet first.");
  if (from === to) throw new Error("Pick two different chains.");
  const q = await relayQuote({ user: w.evm.address, recipient, originChainId: RELAY_ID[from], destinationChainId: RELAY_ID[to], originCurrency: ZERO, destinationCurrency: currencyOf(to), amount: BigInt(Math.floor(amountNative * 1e18)).toString() });
  const out = q.details?.currencyOut;
  const fees = q.fees || {};
  const feeUsd = ["gas", "relayer", "app"].reduce((a, k) => a + (Number(fees[k]?.amountUsd) || 0), 0);
  return { quote: q, receive: Number(out?.amountFormatted) || null, receiveSymbol: NATIVE[to], feeUsd: +feeUsd.toFixed(4), seconds: Number(q.details?.timeEstimate) || null };
}

/** Moves the money: sends the Relay deposit from the trader's EVM wallet and returns the order id to follow. */
export async function relayBridge(from: LiveChain, to: LiveChain, amountNative: number, w: Wallets) {
  const avail = Math.max(0, (await chainBalance(from, w)) - GAS_KEEP[from]);
  if (amountNative > avail) throw new Error(`Only ${avail.toFixed(5)} ${NATIVE[from]} can be moved (some is kept for fees).`);
  const { quote, receive } = await relayBridgeQuote(from, to, amountNative, w);
  const r = await relayRun(quote, w.evm!);
  return { ...r, receive };
}

/** Same-chain swap on Elysium through Relay (LI.FI as the fallback). */
async function elysiumSwap(account: PrivateKeyAccount, fromToken: string, toToken: string, amount: bigint, slipBps: number, approveToken?: string) {
  try {
    const q = await relayQuote({ user: account.address, recipient: account.address, originChainId: 99901, destinationChainId: 99901, originCurrency: fromToken, destinationCurrency: toToken, amount: amount.toString(), slippageTolerance: String(slipBps) });
    const r = await relayRun(q, account);
    return { hash: r.hashes[r.hashes.length - 1] || "", gas: 0n };
  } catch (e) {
    // Fallback: LI.FI on Elysium.
    const q = await lifiQuoteOn(99901, fromToken, toToken, amount, account.address, slipBps / 100).catch(() => { throw e; });
    return sendEvm("elysium", account, q.tx, approveToken ? { token: approveToken, spender: q.spender, amount } : undefined);
  }
}

async function evmBuy(chain: Exclude<LiveChain, "solana">, account: PrivateKeyAccount, token: string, amountNative: number, tax: number) {
  const pc = pub(chain);
  const wei = BigInt(Math.floor(amountNative * 1e18));
  const tok = getAddress(token);
  const before: bigint = await pc.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const slip = Math.min(1500, SLIP_BPS + Math.ceil(tax * 100));
  let hash: string;
  if (chain === "elysium") {
    hash = (await elysiumSwap(account, ZERO, tok, wei, slip)).hash;
  } else if (chain === "robinhood") {
    const q = await lifiQuote(ZERO, tok, wei, account.address, slip / 100);
    hash = (await sendEvm(chain, account, q.tx)).hash;
  } else {
    const c = evmChain(chain);
    const q = await quote(c, c.native.address, tok, wei, 0);
    const tx = (await build(c, q, account.address, slip, true)) as EvmTx;
    hash = (await sendEvm(chain, account, { to: tx.to, data: tx.data, value: BigInt(tx.value) })).hash;
  }
  const after: bigint = await pc.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const decimals = Number(await pc.readContract({ address: tok, abi: erc20Abi, functionName: "decimals" }).catch(() => 18));
  return { hash, raw: after - before, decimals };
}

/** Normal sells allow 3% + tax; an emergency exit (stop-loss in a crash, a rug) passes `extra` to allow much more. */
const sellSlip = (tax: number, extra = 0) => Math.min(extra ? 4900 : 1500, SLIP_BPS + Math.ceil(tax * 100) + extra);

async function evmSell(chain: Exclude<LiveChain, "solana">, account: PrivateKeyAccount, token: string, raw: bigint, tax: number, extra = 0) {
  const pc = pub(chain);
  const tok = getAddress(token);
  const have: bigint = await pc.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const amount = raw > have ? have : raw;
  if (amount <= 0n) throw new Error("The wallet holds none of this coin any more.");
  const before: bigint = await pc.getBalance({ address: account.address });
  const slip = sellSlip(tax, extra);
  let res: { hash: string; gas: bigint };
  if (chain === "elysium") {
    res = await elysiumSwap(account, tok, ZERO, amount, slip, tok);
  } else if (chain === "robinhood") {
    const q = await lifiQuote(tok, ZERO, amount, account.address, slip / 100);
    res = await sendEvm(chain, account, q.tx, { token: tok, spender: q.spender, amount });
  } else {
    const c = evmChain(chain);
    const q = await quote(c, tok, c.native.address, amount, 0);
    const tx = (await build(c, q, account.address, slip, true)) as EvmTx;
    res = await sendEvm(chain, account, { to: tx.to, data: tx.data, value: BigInt(tx.value) }, tx.spender ? { token: tok, spender: tx.spender, amount } : undefined);
  }
  const after: bigint = await pc.getBalance({ address: account.address });
  return { hash: res.hash, receivedNative: Number(after - before + res.gas) / 1e18 };
}

// ---------------------------------------------------------------- Solana (Jupiter)

/**
 * How much of a coin the wallet holds, read straight from its token accounts (classic and Token-2022). The free public
 * Solana RPC refuses "list every token account" lookups (403 "Indexed requests"), so this asks for the exact accounts.
 */
async function solTokenRaw(owner: PublicKey, mint: string): Promise<{ raw: bigint; decimals: number }> {
  const m = new PublicKey(mint), conn = solConn();
  const atas = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((prog) => getAssociatedTokenAddressSync(m, owner, true, prog));
  const bals = await Promise.all(atas.map((a) => conn.getTokenAccountBalance(a, "confirmed").then((r) => r.value).catch(() => null)));
  let raw = 0n, decimals = 0;
  for (const b of bals) if (b) { raw += BigInt(b.amount); decimals = Number(b.decimals); }
  // The public RPC can refuse or rate-limit these reads from the server and answer "nothing". Jupiter's view of the
  // wallet is the second opinion, so a coin that's really there is never missed (it was: sells and recoveries failed).
  if (raw === 0n) {
    const j = await jupHolding(owner.toBase58(), mint).catch(() => null);
    if (j && j.raw > 0n) return j;
  }
  return { raw, decimals };
}

/** One coin's balance in a wallet, from Jupiter (raw units). */
async function jupHolding(owner: string, mint: string): Promise<{ raw: bigint; decimals: number } | null> {
  const h = await fetch(`${JUP}/ultra/v1/holdings/${owner}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
  const accs: any[] = h?.tokens?.[mint] || [];
  if (!accs.length) return null;
  let raw = 0n, decimals = 0;
  for (const a of accs) { try { raw += BigInt(String(a.amount ?? "0")); } catch { /* skip */ } decimals = Number(a.decimals) || decimals; }
  return { raw, decimals: decimals || 6 };
}

/**
 * A swap through Jupiter Ultra: Jupiter builds it, we sign it, and Jupiter sends it and confirms it on its own fast
 * lane (no public RPC involved, the part that kept reporting "not confirmed"). Returns the signature and, when Jupiter
 * reports it, how much came out (raw).
 */
async function ultraSwap(kp: Keypair, inputMint: string, outputMint: string, amount: bigint): Promise<{ sig: string; out: bigint | null }> {
  const o = await fetch(`${JUP}/ultra/v1/order?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&taker=${kp.publicKey.toBase58()}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).catch(() => null);
  if (!o?.transaction || !o?.requestId) throw new Error(`Jupiter Ultra: ${o?.errorMessage || o?.error || "no route"}`);
  const tx = VersionedTransaction.deserialize(Buffer.from(o.transaction, "base64"));
  tx.sign([kp]);
  const e = await fetch(`${JUP}/ultra/v1/execute`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ signedTransaction: Buffer.from(tx.serialize()).toString("base64"), requestId: o.requestId }) }).then((r) => r.json()).catch(() => null);
  if (e?.status !== "Success") throw new Error(`Jupiter Ultra: ${e?.error || e?.status || "not confirmed"}${e?.signature ? ` (${String(e.signature).slice(0, 12)}…)` : ""}`);
  let out: bigint | null = null;
  try { out = e.outputAmountResult != null ? BigInt(String(e.outputAmountResult)) : null; } catch { out = null; }
  return { sig: String(e.signature), out };
}

async function jupSwap(kp: Keypair, inputMint: string, outputMint: string, amount: bigint, slippageBps: number) {
  const q = await fetch(`${JUP}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`, { cache: "no-store", signal: AbortSignal.timeout(12_000) }).then((r) => r.json()).catch(() => null);
  if (!q?.outAmount) throw new Error(`No Solana route: ${q?.error || "Jupiter didn't answer"}`);
  const j = await fetch(`${JUP}/swap/v1/swap`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000), body: JSON.stringify({
    quoteResponse: q, userPublicKey: kp.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 2_000_000, priorityLevel: "veryHigh" } },
  }) }).then((r) => r.json()).catch(() => null);
  if (!j?.swapTransaction) throw new Error(`Couldn't build the Solana swap: ${j?.error || "no answer"}`);
  const tx = VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, "base64"));
  tx.sign([kp]);
  const conn = solConn();
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
  // Confirm by asking for the signature's status (the waiting method gave up early on serverless and reported a
  // "Signature … expired" error even when the swap went through). Re-send every ~1.5s until it lands or expires.
  const lastValid = Number(j.lastValidBlockHeight) || 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 70_000) {
    const st = (await conn.getSignatureStatuses([sig]).catch(() => null))?.value?.[0];
    if (st?.err) throw new Error("The Solana swap failed on-chain.");
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
    const h = await conn.getBlockHeight("confirmed").catch(() => 0);
    if (lastValid && h > lastValid + 5) break;
    conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  }
  const fin = (await conn.getSignatureStatuses([sig]).catch(() => null))?.value?.[0];
  if (fin && !fin.err && fin.confirmationStatus) return sig;
  throw new Error(`Solana swap not confirmed (${sig.slice(0, 12)}…)`);
}

/** Stablecoin → SOL (Jupiter Ultra). Returns the lamports that arrived (0 if none). */
async function stableToSol(kp: Keypair, stable: Stable, amt: bigint, errs: string[]): Promise<bigint> {
  const solBefore = await solConn().getBalance(kp.publicKey).catch(() => -1);
  try {
    const x = await ultraSwap(kp, stable.token, WSOL, amt);
    if (x.out != null && x.out > BigInt(0)) return x.out;
  } catch (e) {
    errs.push(`${stable.symbol}→SOL: ${(e as Error).message.slice(0, 70)}`);
    await new Promise((ok) => setTimeout(ok, 2500));
  }
  if (solBefore < 0) return BigInt(0);
  const now = await solConn().getBalance(kp.publicKey).catch(() => -1);
  return now > solBefore ? BigInt(now - solBefore) : BigInt(0);
}

/**
 * Buy a Solana coin with SOL or USDT / USDC. Brand-new coins (still on pump.fun's launch curve) often have no direct
 * stablecoin route, so it tries, in order, stopping at the first that works:
 *   1. Jupiter Ultra straight from what you pay with (Ultra reaches launch curves and lands the swap itself)
 *   2. Jupiter's normal route from it
 *   3. paying with a stablecoin: stablecoin → SOL, then SOL → the coin (Ultra, then the normal route)
 * After any failure it checks the wallet: if the coins arrived anyway it's a buy (tracked, so it's sold at TP/SL).
 */
async function solBuy(kp: Keypair, mint: string, amountIn: number, tax: number, stable: Stable | null = null) {
  const before = await solTokenRaw(kp.publicKey, mint);
  const slip = Math.min(1500, SLIP_BPS + Math.ceil(tax * 100));
  const arrived = async (tries: number) => {
    for (let i = 0; i < tries; i++) {
      const got = await solTokenRaw(kp.publicKey, mint).catch(() => before);
      if (got.raw > before.raw) return { raw: got.raw - before.raw, decimals: got.decimals || before.decimals || 6 };
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 3000));
    }
    return null;
  };
  const done = async (hash: string) => { const a = await arrived(4); return { hash, raw: a?.raw ?? 0n, decimals: a?.decimals ?? (before.decimals || 6) }; };
  /** One route; true = the coins are in the wallet. A route that sent something and then went quiet is watched before moving on. */
  const errs: string[] = [];
  const attempt = async (name: string, run: () => Promise<string>) => {
    try { return { hash: await run() }; }
    catch (e) {
      const m = (e as Error).message;
      errs.push(`${name}: ${m.slice(0, 70)}`);
      if (/failed on-chain/.test(m)) return null;
      // Sent but not confirmed: give it time to land before trying anything else (never buy twice).
      if (/not confirmed|expired|timeout/i.test(m)) { const a = await arrived(10); if (a) return { hash: "unconfirmed", ...a }; }
      else { const a = await arrived(1); if (a) return { hash: "unconfirmed", ...a }; }
      return null;
    }
  };
  const input = stable ? stable.token : WSOL, inDec = stable ? stable.decimals : 9;
  const amt = BigInt(Math.floor(amountIn * 10 ** inDec));
  let r = await attempt("Ultra", async () => (await ultraSwap(kp, input, mint, amt)).sig);
  if (!r) r = await attempt("Jupiter", () => jupSwap(kp, input, mint, amt, slip));
  if (!r && stable) {
    // Two steps through SOL: launch-curve coins trade against SOL only.
    const lamports = await stableToSol(kp, stable, amt, errs);
    if (lamports > BigInt(0)) {
      const use = lamports - lamports / BigInt(100); // a hair less, so fees never make it fail
      r = await attempt("SOL→coin (Ultra)", async () => (await ultraSwap(kp, WSOL, mint, use)).sig);
      if (!r) r = await attempt("SOL→coin", () => jupSwap(kp, WSOL, mint, use, slip));
      if (!r) throw new Error(`Couldn't buy it: the ${stable.symbol} was changed to SOL, which stays in the wallet (${errs.slice(-2).join(" · ")})`);
    }
  }
  if (!r) throw new Error(`No Solana route: ${errs.join(" · ")}`);
  if ("raw" in r && r.raw) return { hash: r.hash, raw: r.raw as bigint, decimals: (r as any).decimals as number };
  return done(r.hash);
}

async function solSell(kp: Keypair, mint: string, raw: bigint, tax: number, extra = 0, stable: Stable | null = null) {
  if (stable) return solSellStable(kp, mint, raw, tax, extra, stable);
  const have = (await solTokenRaw(kp.publicKey, mint)).raw;
  const amount = raw > have ? have : raw;
  if (amount <= 0n) throw new Error("The wallet holds none of this coin any more.");
  const conn = solConn();
  const before = await conn.getBalance(kp.publicKey).catch(() => null);
  // Jupiter Ultra first (Jupiter lands it itself); if Ultra can't, the normal Jupiter route with our own sending.
  let sig: string, out: bigint | null = null, ultraErr = "";
  try { ({ sig, out } = await ultraSwap(kp, mint, WSOL, amount)); }
  catch (e) {
    ultraErr = (e as Error).message;
    // Ultra may have sold it even though it didn't say so: if the coins are gone, don't sell twice.
    await new Promise((r) => setTimeout(r, 2500));
    const left = (await solTokenRaw(kp.publicKey, mint).catch(() => ({ raw: have }))).raw;
    if (left < have - amount / 2n) return { hash: "ultra", receivedNative: 0 };
    try { sig = await jupSwap(kp, mint, WSOL, amount, sellSlip(tax, extra)); }
    catch (e2) { throw new Error(`${(e2 as Error).message}${ultraErr ? ` · ${ultraErr}` : ""}`); }
  }
  const after = await conn.getBalance(kp.publicKey).catch(() => null);
  const got = out != null ? Number(out) / 1e9 : before != null && after != null ? Math.max(0, after - before) / 1e9 : 0;
  return { hash: sig, receivedNative: got };
}

/** How much of a coin a trading wallet holds right now (raw units and decimals). */
export async function tokenBalanceOn(chain: LiveChain, w: Wallets, token: string): Promise<{ raw: bigint; decimals: number }> {
  if (chain === "solana") { if (!w.sol) return { raw: 0n, decimals: 6 }; return solTokenRaw(w.sol.publicKey, token); }
  if (!w.evm) return { raw: 0n, decimals: 18 };
  const pc = pub(chain), tok = getAddress(token);
  const [raw, decimals] = await Promise.all([
    pc.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [w.evm.address] }) as Promise<bigint>,
    pc.readContract({ address: tok, abi: erc20Abi, functionName: "decimals" }).then(Number).catch(() => 18),
  ]);
  return { raw, decimals };
}

/** Sells a coin into USDT / USDC (Jupiter Ultra first, then the normal route). Returns the dollars received. */
async function solSellStable(kp: Keypair, mint: string, raw: bigint, tax: number, extra: number, st: Stable) {
  const USDC_SOL_ = st.token; // the stablecoin it sells into
  const have = (await solTokenRaw(kp.publicKey, mint)).raw;
  const amount = raw > have ? have : raw;
  if (amount <= 0n) throw new Error("The wallet holds none of this coin any more.");
  const before = (await solTokenRaw(kp.publicKey, USDC_SOL_).catch(() => ({ raw: 0n }))).raw;
  let sig: string, out: bigint | null = null, ultraErr = "";
  try { ({ sig, out } = await ultraSwap(kp, mint, USDC_SOL_, amount)); }
  catch (e) {
    ultraErr = (e as Error).message;
    await new Promise((r) => setTimeout(r, 2500));
    const left = (await solTokenRaw(kp.publicKey, mint).catch(() => ({ raw: have }))).raw;
    if (left < have - amount / 2n) return { hash: "ultra", receivedNative: 0 };
    try { sig = await jupSwap(kp, mint, USDC_SOL_, amount, sellSlip(tax, extra)); }
    catch (e2) { throw new Error(`${(e2 as Error).message}${ultraErr ? ` · ${ultraErr}` : ""}`); }
  }
  if (out == null) { const after = (await solTokenRaw(kp.publicKey, USDC_SOL_).catch(() => ({ raw: before }))).raw; out = after > before ? after - before : 0n; }
  return { hash: sig, receivedNative: Number(out) / 10 ** st.decimals };
}

/** Turns some SOL into USDT / USDC (or back into SOL) so the trader has stablecoins to buy with. */
export async function solConvert(w: Wallets, toStable: boolean, amount: number, symbol: "USDT" | "USDC" = "USDT") {
  if (!w.sol) throw new Error("Create the Solana wallet first.");
  if (!(amount > 0)) throw new Error("Enter an amount.");
  const st = stableBySymbol("solana", symbol)!;
  const raw = BigInt(Math.floor(amount * (toStable ? 1e9 : 10 ** st.decimals)));
  const [a, b] = toStable ? [WSOL, st.token] : [st.token, WSOL];
  const r = await ultraSwap(w.sol, a, b, raw).catch(async () => ({ sig: await jupSwap(w.sol!, a, b, raw, 100), out: null }));
  return r.sig;
}

// ---------------------------------------------------------------- EVM with stablecoins (BNB Chain, Ethereum)

async function evmStableBal(chain: Exclude<LiveChain, "solana">, owner: string, st: Stable): Promise<bigint> {
  return pub(chain).readContract({ address: getAddress(st.token), abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}
/** Buys a coin paying with USDT / USDC (approves the router for exactly this amount first). */
async function evmBuyStable(chain: Exclude<LiveChain, "solana">, account: PrivateKeyAccount, token: string, usd: number, tax: number, st: Stable) {
  if (chain === "elysium" || chain === "robinhood") throw new Error("Trading in stablecoins isn't set up on this network.");
  const pc = pub(chain), tok = getAddress(token);
  const amt = parseUnits(usd.toFixed(Math.min(6, st.decimals)), st.decimals);
  const before: bigint = await pc.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const c = evmChain(chain);
  const q = await quote(c, getAddress(st.token), tok, amt, 0);
  const tx = (await build(c, q, account.address, Math.min(1500, SLIP_BPS + Math.ceil(tax * 100)), true)) as EvmTx;
  const hash = (await sendEvm(chain, account, { to: tx.to, data: tx.data, value: BigInt(tx.value || 0) }, { token: getAddress(st.token), spender: tx.spender || tx.to, amount: amt })).hash;
  const after: bigint = await pc.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const decimals = Number(await pc.readContract({ address: tok, abi: erc20Abi, functionName: "decimals" }).catch(() => 18));
  return { hash, raw: after - before, decimals };
}
/** Sells a coin into USDT / USDC. Returns the dollars received. */
async function evmSellStable(chain: Exclude<LiveChain, "solana">, account: PrivateKeyAccount, token: string, raw: bigint, tax: number, extra: number, st: Stable) {
  if (chain === "elysium" || chain === "robinhood") throw new Error("Trading in stablecoins isn't set up on this network.");
  const pc = pub(chain), tok = getAddress(token);
  const have: bigint = await pc.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const amount = raw > have ? have : raw;
  if (amount <= 0n) throw new Error("The wallet holds none of this coin any more.");
  const before = await evmStableBal(chain, account.address, st);
  const c = evmChain(chain);
  const q = await quote(c, tok, getAddress(st.token), amount, 0);
  const tx = (await build(c, q, account.address, sellSlip(tax, extra), true)) as EvmTx;
  const res = await sendEvm(chain, account, { to: tx.to, data: tx.data, value: BigInt(tx.value || 0) }, { token: tok, spender: tx.spender || tx.to, amount });
  const after = await evmStableBal(chain, account.address, st);
  return { hash: res.hash, receivedNative: Number(after > before ? after - before : 0n) / 10 ** st.decimals };
}

// ---------------------------------------------------------------- One entry point per action

/** amountNative is in the chain's own coin, or in dollars of the stablecoin when `stable` is given. */
export async function liveBuyOn(chain: LiveChain, w: Wallets, token: string, amountNative: number, tax: number, stable: Stable | null = null) {
  if (chain === "solana") { if (!w.sol) throw new Error("Create the Solana wallet first."); return solBuy(w.sol, token, amountNative, tax, stable); }
  if (!w.evm) throw new Error("Create the trading wallet first.");
  if (stable) return evmBuyStable(chain, w.evm, token, amountNative, tax, stable);
  return evmBuy(chain, w.evm, token, amountNative, tax);
}

/** Sells for the chain's own coin, or into the stablecoin when `stable` is given (receivedNative = dollars then). */
export async function liveSellOn(chain: LiveChain, w: Wallets, token: string, raw: bigint, tax: number, extra = 0, stable: Stable | null = null) {
  if (chain === "solana") { if (!w.sol) throw new Error("There's no Solana wallet, so this can't be sold here."); return solSell(w.sol, token, raw, tax, extra, stable); }
  if (!w.evm) throw new Error("There's no trading wallet, so this can't be sold here.");
  if (stable) return evmSellStable(chain, w.evm, token, raw, tax, extra, stable);
  return evmSell(chain, w.evm, token, raw, tax, extra);
}
