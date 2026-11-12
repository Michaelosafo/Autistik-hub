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
import { createPublicClient, createWalletClient, defineChain, erc20Abi, getAddress, http, type PrivateKeyAccount } from "viem";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
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
  return { raw, decimals };
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

async function solBuy(kp: Keypair, mint: string, amountSol: number, tax: number) {
  const before = await solTokenRaw(kp.publicKey, mint);
  let sig: string;
  try { sig = await jupSwap(kp, WSOL, mint, BigInt(Math.floor(amountSol * 1e9)), Math.min(1500, SLIP_BPS + Math.ceil(tax * 100))); }
  catch (e) {
    // Not confirmed in time: if the coins arrived anyway, it's a buy (so it's tracked and sold at TP/SL, never lost).
    await new Promise((r) => setTimeout(r, 3000));
    const got = await solTokenRaw(kp.publicKey, mint).catch(() => before);
    if (got.raw > before.raw) return { hash: "unconfirmed", raw: got.raw - before.raw, decimals: got.decimals || before.decimals || 6 };
    throw e;
  }
  const after = await solTokenRaw(kp.publicKey, mint);
  return { hash: sig, raw: after.raw - before.raw, decimals: after.decimals || before.decimals || 6 };
}

async function solSell(kp: Keypair, mint: string, raw: bigint, tax: number, extra = 0) {
  const have = (await solTokenRaw(kp.publicKey, mint)).raw;
  const amount = raw > have ? have : raw;
  if (amount <= 0n) throw new Error("The wallet holds none of this coin any more.");
  const conn = solConn();
  const before = await conn.getBalance(kp.publicKey);
  const sig = await jupSwap(kp, mint, WSOL, amount, sellSlip(tax, extra));
  const after = await conn.getBalance(kp.publicKey);
  return { hash: sig, receivedNative: Math.max(0, after - before) / 1e9 };
}

// ---------------------------------------------------------------- One entry point per action

export async function liveBuyOn(chain: LiveChain, w: Wallets, token: string, amountNative: number, tax: number) {
  if (chain === "solana") { if (!w.sol) throw new Error("Create the Solana wallet first."); return solBuy(w.sol, token, amountNative, tax); }
  if (!w.evm) throw new Error("Create the trading wallet first.");
  return evmBuy(chain, w.evm, token, amountNative, tax);
}

export async function liveSellOn(chain: LiveChain, w: Wallets, token: string, raw: bigint, tax: number, extra = 0) {
  if (chain === "solana") { if (!w.sol) throw new Error("There's no Solana wallet, so this can't be sold here."); return solSell(w.sol, token, raw, tax, extra); }
  if (!w.evm) throw new Error("There's no trading wallet, so this can't be sold here.");
  return evmSell(chain, w.evm, token, raw, tax, extra);
}
