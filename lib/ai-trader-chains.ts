/**
 * Live trading on each chain for the AI trader (server only). Each trader has one EVM wallet (the same address on
 * BNB Chain, Ethereum and Robinhood Chain) and, if they create one, a Solana wallet. Every chain buys with its own
 * coin, so the wallet needs that coin on that chain: BNB on BNB Chain, ETH on Ethereum, ETH on Robinhood Chain and
 * SOL on Solana. Nothing is bridged.
 *
 * Swaps: BNB Chain and Ethereum through KyberSwap (the route the Wallet already uses, fee-free for the trader's own
 * wallet), Robinhood Chain through LI.FI, Solana through Jupiter. Each buy reports exactly how many tokens arrived
 * and each sell exactly how much of the chain's coin came back.
 */
import { createPublicClient, createWalletClient, defineChain, erc20Abi, getAddress, http, type PrivateKeyAccount } from "viem";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { WCHAINS, WSOL } from "@/lib/wallet-chains";
import { build, market, quote, walletChainClient, type EvmTx } from "@/lib/wallet-server";

export const LIVE_CHAINS = ["bsc", "ethereum", "robinhood", "solana"] as const;
export type LiveChain = (typeof LIVE_CHAINS)[number];
export const isLiveChain = (c: string): c is LiveChain => (LIVE_CHAINS as readonly string[]).includes(c);
export const NATIVE: Record<LiveChain, string> = { bsc: "BNB", ethereum: "ETH", robinhood: "ETH", solana: "SOL" };
/** Always left in each wallet for fees. */
export const GAS_KEEP: Record<LiveChain, number> = { bsc: 0.003, ethereum: 0.004, robinhood: 0.0005, solana: 0.01 };
const SLIP_BPS = 300; // 3% plus the coin's tax
const ZERO = "0x0000000000000000000000000000000000000000";

const RH_RPC = process.env.ROBINHOOD_RPC || "https://rpc.mainnet.chain.robinhood.com";
const ROBINHOOD = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RH_RPC] } } });
const JUP = process.env.JUPITER_API || "https://lite-api.jup.ag";
const solConn = () => new Connection(WCHAINS.solana.rpc, "confirmed");

const evmChain = (chain: "bsc" | "ethereum") => WCHAINS[chain];
function pub(chain: Exclude<LiveChain, "solana">): any {
  return chain === "robinhood" ? createPublicClient({ chain: ROBINHOOD, transport: http(RH_RPC, { timeout: 20_000 }) }) : walletChainClient(evmChain(chain));
}
function wallet(chain: Exclude<LiveChain, "solana">, account: PrivateKeyAccount): any {
  return chain === "robinhood"
    ? createWalletClient({ account, chain: ROBINHOOD, transport: http(RH_RPC, { timeout: 20_000 }) })
    : createWalletClient({ account, chain: evmChain(chain).viem, transport: http(evmChain(chain).rpc, { timeout: 20_000 }) });
}

/** Dollar price of each chain's coin (ETH for Ethereum and Robinhood Chain). */
export async function nativeUsd(chain: LiveChain): Promise<number> {
  const c = chain === "bsc" ? WCHAINS.bsc : chain === "solana" ? WCHAINS.solana : WCHAINS.ethereum;
  const m = await market(c, c.native.address);
  if (!m.priceUsd) throw new Error(`No ${NATIVE[chain]} price right now.`);
  return m.priceUsd;
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
async function lifiQuote(from: string, to: string, amount: bigint, wallet: string, slipPct: number) {
  const q = new URLSearchParams({ fromChain: "4663", toChain: "4663", fromToken: from, toToken: to, fromAmount: amount.toString(), fromAddress: wallet, slippage: String(Math.min(0.5, slipPct / 100)), integrator: "autistik" });
  const r = await fetch(`https://li.quest/v1/quote?${q}`, { headers: { accept: "application/json", ...(process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : {}) }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.transactionRequest) throw new Error(`No Robinhood Chain route: ${j?.message || r.status}`);
  const t = j.transactionRequest;
  return { tx: { to: String(t.to), data: String(t.data), value: BigInt(t.value || "0"), gas: t.gasLimit ? BigInt(t.gasLimit) : undefined }, spender: j.estimate?.approvalAddress ? String(j.estimate.approvalAddress) : String(t.to) };
}

async function evmBuy(chain: Exclude<LiveChain, "solana">, account: PrivateKeyAccount, token: string, amountNative: number, tax: number) {
  const pc = pub(chain);
  const wei = BigInt(Math.floor(amountNative * 1e18));
  const tok = getAddress(token);
  const before: bigint = await pc.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const slip = Math.min(1500, SLIP_BPS + Math.ceil(tax * 100));
  let hash: string;
  if (chain === "robinhood") {
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

async function evmSell(chain: Exclude<LiveChain, "solana">, account: PrivateKeyAccount, token: string, raw: bigint, tax: number) {
  const pc = pub(chain);
  const tok = getAddress(token);
  const have: bigint = await pc.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const amount = raw > have ? have : raw;
  if (amount <= 0n) throw new Error("The wallet holds none of this coin any more.");
  const before: bigint = await pc.getBalance({ address: account.address });
  const slip = Math.min(1500, SLIP_BPS + Math.ceil(tax * 100));
  let res: { hash: string; gas: bigint };
  if (chain === "robinhood") {
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

async function solTokenRaw(owner: PublicKey, mint: string): Promise<{ raw: bigint; decimals: number }> {
  const r = await solConn().getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
  let raw = 0n, decimals = 0;
  for (const a of r.value) { const t = (a.account.data as any).parsed?.info?.tokenAmount; if (t) { raw += BigInt(t.amount); decimals = Number(t.decimals); } }
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
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  const conf = await conn.confirmTransaction({ signature: sig, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: Number(j.lastValidBlockHeight) }, "confirmed");
  if (conf.value.err) throw new Error("The Solana swap failed on-chain.");
  return sig;
}

async function solBuy(kp: Keypair, mint: string, amountSol: number, tax: number) {
  const before = await solTokenRaw(kp.publicKey, mint);
  const sig = await jupSwap(kp, WSOL, mint, BigInt(Math.floor(amountSol * 1e9)), Math.min(1500, SLIP_BPS + Math.ceil(tax * 100)));
  const after = await solTokenRaw(kp.publicKey, mint);
  return { hash: sig, raw: after.raw - before.raw, decimals: after.decimals || before.decimals || 6 };
}

async function solSell(kp: Keypair, mint: string, raw: bigint, tax: number) {
  const have = (await solTokenRaw(kp.publicKey, mint)).raw;
  const amount = raw > have ? have : raw;
  if (amount <= 0n) throw new Error("The wallet holds none of this coin any more.");
  const conn = solConn();
  const before = await conn.getBalance(kp.publicKey);
  const sig = await jupSwap(kp, mint, WSOL, amount, Math.min(1500, SLIP_BPS + Math.ceil(tax * 100)));
  const after = await conn.getBalance(kp.publicKey);
  return { hash: sig, receivedNative: Math.max(0, after - before) / 1e9 };
}

// ---------------------------------------------------------------- One entry point per action

export async function liveBuyOn(chain: LiveChain, w: Wallets, token: string, amountNative: number, tax: number) {
  if (chain === "solana") { if (!w.sol) throw new Error("Create the Solana wallet first."); return solBuy(w.sol, token, amountNative, tax); }
  if (!w.evm) throw new Error("Create the trading wallet first.");
  return evmBuy(chain, w.evm, token, amountNative, tax);
}

export async function liveSellOn(chain: LiveChain, w: Wallets, token: string, raw: bigint, tax: number) {
  if (chain === "solana") { if (!w.sol) throw new Error("There's no Solana wallet, so this can't be sold here."); return solSell(w.sol, token, raw, tax); }
  if (!w.evm) throw new Error("There's no trading wallet, so this can't be sold here.");
  return evmSell(chain, w.evm, token, raw, tax);
}
