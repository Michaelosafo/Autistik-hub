/**
 * Extra chains on a sniper wallet. The EVM key already works on BNB Chain, Ethereum, Base and Arbitrum.
 * Solana is a new key in the same Vault, tied to that slot. A bridge goes from one of these wallets straight
 * to another of these wallets (Relay). A Solana swap stays in that same Solana address (Jupiter).
 * No extra address is inserted, and nothing is mixed.
 */
import { createPublicClient, createWalletClient, http, parseUnits, type Address } from "viem";
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount } from "@solana/web3.js";
import { MAX_KEYS, SLOTS, copyKey } from "@/lib/ai-copy";
import { logActivity } from "@/lib/activity";
import { flog } from "@/lib/ai-futures";
import { T } from "@/lib/ai-trader-ctx";
import { NATIVE, WCHAINS, WSOL } from "@/lib/wallet-chains";
import { supabaseService } from "@/lib/supabase/server";

export const CARD_CHAINS = ["bsc", "ethereum", "base", "arbitrum", "solana"] as const;
export type CardChain = (typeof CARD_CHAINS)[number];

const RELAY_ID: Record<CardChain, number> = { bsc: 56, ethereum: 1, base: 8453, arbitrum: 42161, solana: 792703809 };
const RELAY_SOL = "11111111111111111111111111111111";
const ZERO = "0x0000000000000000000000000000000000000000";
const JUP = process.env.JUPITER_API || "https://lite-api.jup.ag";
const SOL_RPC = process.env.SNIPER_SOLANA_RPC || process.env.WALLET_SOLANA_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC || "https://solana-rpc.publicnode.com";

const isCard = (c: string): c is CardChain => (CARD_CHAINS as readonly string[]).includes(c);
const slotOk = (slot: number) => { if (!SLOTS.includes(slot as any)) throw new Error(`Pick a wallet from 1 to ${MAX_KEYS}.`); };

function fromStored(hex: string): Keypair {
  const raw = hex.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{128}$/.test(raw)) throw new Error("The stored Solana key is unreadable.");
  return Keypair.fromSecretKey(Uint8Array.from(Buffer.from(raw, "hex")));
}
function toStored(kp: Keypair) {
  return Buffer.from(kp.secretKey).toString("hex");
}

/** The Solana key for this slot, or null if the admin hasn't added one. */
export async function sniperSol(slot: number): Promise<Keypair | null> {
  slotOk(slot);
  const { data, error } = await supabaseService().rpc("ai_copy_sol_key_get", { p_id: T(), p_slot: slot });
  if (error) throw new Error(error.message.includes("ai_copy_sol_key_get") ? "Run supabase/2026-11-19-sniper-sol-keys.sql in Supabase, then try again." : error.message);
  if (typeof data !== "string" || data.length < 64) return null;
  return fromStored(data);
}

/** A new Solana address for a wallet that already has an EVM key. One per slot. */
export async function createSniperSol(slot: number): Promise<{ slot: number; address: string }> {
  slotOk(slot);
  if (!(await copyKey(slot))) throw new Error(`Wallet ${slot} doesn't exist yet.`);
  if (await sniperSol(slot)) throw new Error(`Wallet ${slot} already has a Solana address.`);
  const kp = Keypair.generate();
  const { error } = await supabaseService().rpc("ai_copy_sol_key_set", { p_id: T(), p_slot: slot, p_key: toStored(kp) });
  if (error) throw new Error(error.message.includes("ai_copy_sol_key_set") ? "Run supabase/2026-11-19-sniper-sol-keys.sql in Supabase, then try again." : error.message);
  const address = kp.publicKey.toBase58();
  await flog("settings", `Wallet ${slot} Solana address created: ${address}.`);
  return { slot, address };
}

/** The Solana private key of this slot, as Phantom / Solflare import it (base58). */
export async function revealSniperSol(slot: number): Promise<{ slot: number; address: string; key: string }> {
  const kp = await sniperSol(slot);
  if (!kp) throw new Error(`Wallet ${slot} has no Solana address yet.`);
  const { b58encode } = await import("@/lib/ai-trader");
  await flog("settings", `Private key of sniper wallet ${slot} (Solana) was shown.`);
  return { slot, address: kp.publicKey.toBase58(), key: b58encode(kp.secretKey) };
}

/**
 * Use your own Solana wallet on this slot (Phantom / Solflare key, base58 or the [..] list).
 * Replacing a Solana address that still holds SOL is refused, so nothing is left behind.
 */
export async function importSniperSol(slot: number, raw: string): Promise<{ slot: number; address: string }> {
  slotOk(slot);
  if (!(await copyKey(slot))) throw new Error(`Wallet ${slot} doesn't exist yet.`);
  const { solKeypairFrom } = await import("@/lib/ai-trader");
  const kp = solKeypairFrom(String(raw || ""));
  const address = kp.publicKey.toBase58();
  for (const o of SLOTS) {
    if (o === slot) continue;
    const other = await sniperSol(o).catch(() => null);
    if (other?.publicKey.toBase58() === address) throw new Error(`That Solana wallet is already on wallet ${o}.`);
  }
  const cur = await sniperSol(slot);
  if (cur && cur.publicKey.toBase58() === address) return { slot, address };
  if (cur) {
    const lamports = await new Connection(SOL_RPC, "confirmed").getBalance(cur.publicKey).catch(() => 0);
    if (lamports > 2_000_000) throw new Error(`Wallet ${slot}'s current Solana address still holds ${(lamports / 1e9).toFixed(4)} SOL. Move it out first (Show private key → Phantom).`);
  }
  const { error } = await supabaseService().rpc("ai_copy_sol_key_set", { p_id: T(), p_slot: slot, p_key: toStored(kp) });
  if (error) throw new Error(error.message.includes("ai_copy_sol_key_set") ? "Run supabase/2026-11-19-sniper-sol-keys.sql in Supabase, then try again." : error.message);
  await flog("settings", `Wallet ${slot} now uses your Solana wallet: ${address}.`);
  return { slot, address };
}

/** Addresses this wallet can use. The EVM address is the same on every EVM chain. */
export async function walletCard(slot: number) {
  slotOk(slot);
  const evm = await copyKey(slot);
  if (!evm) throw new Error(`Wallet ${slot} doesn't exist.`);
  const sol = await sniperSol(slot).catch(() => null);
  const solAddr = sol?.publicKey.toBase58() || null;
  return {
    slot,
    evm: evm.address,
    sol: solAddr,
    chains: CARD_CHAINS.map((id) => {
      const c = WCHAINS[id];
      return { id, name: c.name, kind: c.kind, symbol: c.native.symbol, address: id === "solana" ? solAddr : evm.address, explorer: c.explorer };
    }),
  };
}

async function solHoldings(slot: number, extra: string[]) {
  const kp = await sniperSol(slot);
  if (!kp) throw new Error("Add a Solana address to this wallet first.");
  const owner = kp.publicKey.toBase58();
  const chain = WCHAINS.solana;
  const h = await fetch(`${JUP}/ultra/v1/holdings/${owner}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const ui = (mint: string) => ((h?.tokens?.[mint] || []) as { uiAmount?: number; amount?: string; decimals?: number }[]).reduce((a, x) => a + (Number(x.uiAmount) || 0), 0);
  const rawOf = (mint: string) => ((h?.tokens?.[mint] || []) as { amount?: string }[]).reduce((a, x) => { try { return a + BigInt(String(x.amount || "0")); } catch { return a; } }, 0n);
  const assets: { address: string; symbol: string; name: string; decimals: number; raw: string; amount: number; valueUsd: number | null }[] = [];
  const solAmt = h?.uiAmount != null ? Number(h.uiAmount) : Number(h?.amount || 0) / 1e9;
  const solRaw = h?.amount != null ? String(h.amount) : String(Math.round((solAmt || 0) * 1e9));
  assets.push({ address: WSOL, symbol: "SOL", name: "Solana", decimals: 9, raw: solRaw, amount: solAmt || 0, valueUsd: null });
  const known = new Map(chain.tokens.map((t) => [t.address, t]));
  for (const mint of extra) if (!known.has(mint)) known.set(mint, { address: mint, symbol: mint.slice(0, 4), name: "Token", decimals: 6 });
  for (const t of known.values()) {
    if (t.address === WSOL) continue;
    const amount = ui(t.address);
    if (amount <= 0 && t.symbol !== "USDT" && t.symbol !== "USDC" && !extra.includes(t.address)) continue;
    assets.push({ address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, raw: rawOf(t.address).toString(), amount, valueUsd: null });
  }
  return { slot, address: owner, chain: "solana" as const, coin: "SOL", explorer: chain.explorer, assets };
}

/** Balances for the chain tab. EVM chains share the wallet's one address. */
export async function cardHoldings(slot: number, chainKey: string, extra: string[] = []) {
  if (chainKey === "solana") return solHoldings(slot, extra.filter((x) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x)).slice(0, 6));
  const { walletHoldings } = await import("@/lib/sniper-wallet");
  return walletHoldings(slot, chainKey, extra);
}

const mintOf = (symbol: string) => {
  const up = symbol.trim().toUpperCase();
  if (up === "SOL" || up === "NATIVE") return WSOL;
  const hit = WCHAINS.solana.tokens.find((t) => t.symbol.toUpperCase() === up || t.address === symbol.trim());
  if (hit) return hit.address;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(symbol.trim())) return symbol.trim();
  throw new Error("Pick SOL, USDT, USDC, or a Solana token address.");
};

async function solRaw(owner: string, mint: string): Promise<{ raw: bigint; decimals: number; symbol: string }> {
  if (mint === WSOL) {
    const lamports = await new Connection(SOL_RPC, "confirmed").getBalance(new PublicKey(owner));
    return { raw: BigInt(lamports), decimals: 9, symbol: "SOL" };
  }
  const h = await fetch(`${JUP}/ultra/v1/holdings/${owner}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const accs = (h?.tokens?.[mint] || []) as { amount?: string; decimals?: number }[];
  let raw = 0n, decimals = WCHAINS.solana.tokens.find((t) => t.address === mint)?.decimals || 6;
  for (const a of accs) { try { raw += BigInt(String(a.amount || "0")); } catch { /* skip */ } decimals = Number(a.decimals) || decimals; }
  const symbol = WCHAINS.solana.tokens.find((t) => t.address === mint)?.symbol || "TOKEN";
  return { raw, decimals, symbol };
}

const shown = (raw: bigint, decimals: number) => {
  const n = Number(raw) / 10 ** decimals;
  if (!isFinite(n)) return "0";
  return n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 6 }) : n.toPrecision(6).replace(/\.?0+$/, "");
};

export async function solSwapQuote(slot: number, tokenIn: string, tokenOut: string, amount: number | "max", slippageBps: number) {
  const kp = await sniperSol(slot);
  if (!kp) throw new Error("Add a Solana address to this wallet first.");
  const slip = Math.round(Number(slippageBps));
  if (slip < 10 || slip > 4_900) throw new Error("Slippage must be between 0.1% and 49%.");
  const inn = mintOf(tokenIn), out = mintOf(tokenOut);
  if (inn === out) throw new Error("Pick two different assets.");
  const owner = kp.publicKey.toBase58();
  const held = await solRaw(owner, inn);
  const reserve = inn === WSOL ? 20_000_000n : 0n;
  let raw: bigint;
  if (amount === "max") raw = held.raw - reserve;
  else {
    const n = Number(amount);
    if (!(n > 0) || !isFinite(n)) throw new Error("Type an amount, or tap Max.");
    raw = parseUnits(n.toFixed(Math.min(held.decimals, 9)), held.decimals);
  }
  if (raw <= 0n) throw new Error(inn === WSOL ? "Keep about 0.02 SOL for the fee." : `No ${held.symbol} in this wallet.`);
  if (inn === WSOL && raw + reserve > held.raw) throw new Error("Keep about 0.02 SOL for the fee.");
  const q = await fetch(`${JUP}/swap/v1/quote?inputMint=${inn}&outputMint=${out}&amount=${raw}&slippageBps=${slip}&restrictIntermediateTokens=true`, { cache: "no-store", signal: AbortSignal.timeout(12_000) }).then((r) => r.json()).catch(() => null);
  if (!q?.outAmount) throw new Error(q?.error || "Jupiter has no route for that pair.");
  const outDec = out === WSOL ? 9 : (WCHAINS.solana.tokens.find((t) => t.address === out)?.decimals || 6);
  const outSym = out === WSOL ? "SOL" : (WCHAINS.solana.tokens.find((t) => t.address === out)?.symbol || "TOKEN");
  const min = (BigInt(q.outAmount) * BigInt(10_000 - slip)) / 10_000n;
  const impact = Number(q.priceImpactPct);
  return {
    chain: "solana" as const, slot, address: owner, via: "Jupiter",
    symbolIn: held.symbol, symbolOut: outSym, tokenIn: inn, tokenOut: out,
    amountIn: shown(raw, held.decimals), amountInRaw: raw.toString(), amountOut: shown(BigInt(q.outAmount), outDec), minOut: shown(min, outDec), minOutRaw: min.toString(),
    slippageBps: slip, impact: isFinite(impact) ? impact * 100 : null, gasUsd: null,
  };
}

export async function solSwapSend(slot: number, tokenIn: string, tokenOut: string, amount: number | "max", slippageBps: number, minOutRaw: string, confirmImpact: boolean) {
  const preview = await solSwapQuote(slot, tokenIn, tokenOut, amount, slippageBps);
  if (preview.impact != null && preview.impact >= 30) throw new Error(`This swap would move the price by about ${preview.impact.toFixed(1)}%. Use a smaller amount.`);
  if (preview.impact != null && preview.impact >= 10 && !confirmImpact) throw new Error(`This swap moves the price by about ${preview.impact.toFixed(1)}%. Confirm it again to send.`);
  if (BigInt(preview.minOutRaw) < BigInt(minOutRaw || "0")) throw new Error("The price moved. Get a new quote before sending.");
  const kp = await sniperSol(slot);
  if (!kp) throw new Error("Add a Solana address to this wallet first.");
  const quote = await fetch(`${JUP}/swap/v1/quote?inputMint=${preview.tokenIn}&outputMint=${preview.tokenOut}&amount=${preview.amountInRaw}&slippageBps=${preview.slippageBps}&restrictIntermediateTokens=true`, { cache: "no-store", signal: AbortSignal.timeout(12_000) }).then((r) => r.json());
  if (!quote?.outAmount || BigInt(quote.outAmount) < BigInt(minOutRaw)) throw new Error("The price moved. Get a new quote before sending.");
  const built = await fetch(`${JUP}/swap/v1/swap`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000), body: JSON.stringify({
    quoteResponse: quote, userPublicKey: kp.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" } },
  }) }).then((r) => r.json());
  if (!built?.swapTransaction) throw new Error(built?.error || "Jupiter couldn't build the swap.");
  const tx = VersionedTransaction.deserialize(Buffer.from(built.swapTransaction, "base64"));
  tx.sign([kp]);
  const sig = await sendSol(tx);
  const msg = `Swapped ${preview.amountIn} ${preview.symbolIn} for at least ${preview.minOut} ${preview.symbolOut} in wallet ${slot} on Solana (Jupiter). https://solscan.io/tx/${sig}`;
  await note("swap", msg, "solana", sig);
  return msg;
}

async function sendSol(tx: VersionedTransaction) {
  const conn = new Connection(SOL_RPC, "confirmed");
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 2 });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = (await conn.getSignatureStatuses([sig]).catch(() => null))?.value?.[0];
    if (st?.err) throw new Error("The Solana transaction failed on-chain.");
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
  }
  return sig;
}

// ---------------------------------------------------------------- Relay bridge (own wallet → own wallet)

type Coin = { relay: string; decimals: number; symbol: string };

function coin(chain: CardChain, asset: string): Coin {
  const up = asset.trim().toUpperCase();
  const c = WCHAINS[chain];
  if (!up || up === c.native.symbol || up === "NATIVE") {
    return { relay: chain === "solana" ? RELAY_SOL : ZERO, decimals: c.native.decimals, symbol: c.native.symbol };
  }
  const hit = c.tokens.find((t) => t.symbol.toUpperCase() === up);
  if (!hit || hit.address.toLowerCase() === NATIVE.toLowerCase() || hit.address === WSOL) throw new Error(`Pick ${c.native.symbol}, USDT or USDC.`);
  if (hit.symbol !== "USDT" && hit.symbol !== "USDC") throw new Error(`A bridge can move ${c.native.symbol}, USDT or USDC.`);
  return { relay: hit.address, decimals: hit.decimals, symbol: hit.symbol };
}

async function ends(fromSlot: number, toSlot: number, fromChain: CardChain, toChain: CardChain) {
  if (fromChain === toChain) throw new Error("Same network: use Transfer or Swap. A bridge is only for a different network.");
  slotOk(fromSlot); slotOk(toSlot);
  const fromEvm = await copyKey(fromSlot);
  const toEvm = await copyKey(toSlot);
  if (!fromEvm) throw new Error(`Wallet ${fromSlot} doesn't exist.`);
  if (!toEvm) throw new Error(`Wallet ${toSlot} doesn't exist.`);
  const fromSol = fromChain === "solana" ? await sniperSol(fromSlot) : null;
  const toSol = toChain === "solana" ? await sniperSol(toSlot) : null;
  if (fromChain === "solana" && !fromSol) throw new Error(`Add a Solana address on wallet ${fromSlot} first.`);
  if (toChain === "solana" && !toSol) throw new Error(`Add a Solana address on wallet ${toSlot} first.`);
  const from = fromChain === "solana" ? fromSol!.publicKey.toBase58() : fromEvm.address;
  const to = toChain === "solana" ? toSol!.publicKey.toBase58() : toEvm.address;
  if (fromSlot === toSlot && from === to) throw new Error("Pick another of your wallets, or a different network.");
  return { from, to, fromEvm, toEvm, fromSol, toSol };
}

async function balanceRaw(chain: CardChain, who: string, c: Coin): Promise<bigint> {
  if (chain === "solana") return (await solRaw(who, c.relay === RELAY_SOL ? WSOL : c.relay)).raw;
  const pc: any = createPublicClient({ chain: WCHAINS[chain].viem, transport: http(WCHAINS[chain].rpc, { timeout: 12_000 }) });
  if (c.relay === ZERO) return BigInt(await pc.getBalance({ address: who as Address }));
  const bal = await pc.readContract({ address: c.relay as Address, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address", name: "a" }], outputs: [{ type: "uint256", name: "" }] }], functionName: "balanceOf", args: [who] }).catch(() => 0n);
  return BigInt(bal);
}

async function relayQuote(body: Record<string, unknown>) {
  const key = (process.env.RELAY_API_KEY || "").trim();
  if (!key) throw new Error("Add RELAY_API_KEY (free at relay.link) in Vercel, then redeploy. The bridge uses Relay.");
  const r = await fetch("https://api.relay.link/quote/v2", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key }, body: JSON.stringify({ tradeType: "EXACT_INPUT", slippageTolerance: "100", ...body }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j?.steps)) throw new Error(`Relay: ${j?.message || j?.error || r.status}`.slice(0, 180));
  return j;
}

function feeOf(q: any) {
  const fees = q.fees || {};
  const gasUsd = Number(fees.gas?.amountUsd) || 0;
  const relayerUsd = Number(fees.relayer?.amountUsd) || 0;
  return { gasUsd: gasUsd || null, feeUsd: +(gasUsd + relayerUsd + (Number(fees.app?.amountUsd) || 0)).toFixed(4), seconds: Number(q.details?.timeEstimate) || null };
}

export async function bridgeQuote(fromSlot: number, toSlot: number, fromKey: string, toKey: string, assetIn: string, assetOut: string, amount: number | "max") {
  if (!isCard(fromKey) || !isCard(toKey)) throw new Error("Pick BNB Chain, Ethereum, Base, Arbitrum or Solana.");
  const endsAt = await ends(fromSlot, toSlot, fromKey, toKey);
  const inn = coin(fromKey, assetIn), out = coin(toKey, assetOut);
  const have = await balanceRaw(fromKey, endsAt.from, inn);
  const reserve = inn.relay === ZERO ? parseUnits(fromKey === "bsc" ? "0.002" : "0.0004", 18) : inn.relay === RELAY_SOL ? 20_000_000n : 0n;
  let raw: bigint;
  if (amount === "max") raw = have - reserve;
  else {
    const n = Number(amount);
    if (!(n > 0) || !isFinite(n)) throw new Error("Type an amount, or tap Max.");
    raw = parseUnits(n.toFixed(Math.min(inn.decimals, 8)), inn.decimals);
  }
  if (raw <= 0n) throw new Error(`Not enough ${inn.symbol} after the network fee.`);
  if (raw > have) throw new Error(`Wallet holds ${shown(have, inn.decimals)} ${inn.symbol}.`);
  const q = await relayQuote({
    user: endsAt.from, recipient: endsAt.to, refundTo: endsAt.from,
    originChainId: RELAY_ID[fromKey], destinationChainId: RELAY_ID[toKey],
    originCurrency: inn.relay, destinationCurrency: out.relay, amount: raw.toString(),
  });
  const echoed = String(q.details?.recipient || endsAt.to);
  if (echoed.toLowerCase() !== endsAt.to.toLowerCase()) throw new Error("Relay would not pay your wallet. Stopped.");
  const outRaw = String(q.details?.currencyOut?.amount || "0");
  const fees = feeOf(q);
  return {
    via: "Relay" as const, fromSlot, toSlot, fromChain: fromKey, toChain: toKey,
    from: endsAt.from, to: endsAt.to, symbolIn: inn.symbol, symbolOut: out.symbol,
    amountIn: shown(raw, inn.decimals), amountInRaw: raw.toString(), amountOut: String(q.details?.currencyOut?.amountFormatted || shown(BigInt(outRaw || "0"), out.decimals)),
    amountOutRaw: outRaw, ...fees,
  };
}

export async function bridgeSend(fromSlot: number, toSlot: number, fromKey: string, toKey: string, assetIn: string, assetOut: string, amount: number | "max", minOutRaw: string) {
  const preview = await bridgeQuote(fromSlot, toSlot, fromKey, toKey, assetIn, assetOut, amount);
  if (minOutRaw && preview.amountOutRaw && BigInt(preview.amountOutRaw) * 100n < BigInt(minOutRaw) * 95n) throw new Error("The quote got worse. Review it again.");
  const endsAt = await ends(fromSlot, toSlot, fromKey as CardChain, toKey as CardChain);
  if (endsAt.from.toLowerCase() !== preview.from.toLowerCase() || endsAt.to.toLowerCase() !== preview.to.toLowerCase()) throw new Error("That wallet changed. Start again.");
  const inn = coin(fromKey as CardChain, assetIn), out = coin(toKey as CardChain, assetOut);
  const have = await balanceRaw(fromKey as CardChain, endsAt.from, inn);
  const raw = BigInt(preview.amountInRaw);
  if (raw > have) throw new Error("The balance changed. Review it again.");
  const q = await relayQuote({
    user: endsAt.from, recipient: endsAt.to, refundTo: endsAt.from,
    originChainId: RELAY_ID[fromKey as CardChain], destinationChainId: RELAY_ID[toKey as CardChain],
    originCurrency: inn.relay, destinationCurrency: out.relay, amount: raw.toString(),
  });
  if (String(q.details?.recipient || endsAt.to).toLowerCase() !== endsAt.to.toLowerCase()) throw new Error("Relay would not pay your wallet. Stopped.");
  const hashes = await runRelay(q, fromKey as CardChain, endsAt);
  const msg = `Bridge ${preview.amountIn} ${preview.symbolIn} from wallet ${fromSlot} (${preview.from}) on ${WCHAINS[fromKey as CardChain].name} to wallet ${toSlot} (${preview.to}) on ${WCHAINS[toKey as CardChain].name} as about ${preview.amountOut} ${preview.symbolOut}. Relay, direct to that address. ${hashes[0] ? `tx ${hashes[0]}` : ""}`.replace(/\s+/g, " ");
  await note("bridge", msg, fromKey, hashes[0] || "");
  return msg;
}

async function runRelay(q: any, fromChain: CardChain, endsAt: { from: string; fromEvm: NonNullable<Awaited<ReturnType<typeof copyKey>>>; fromSol: Keypair | null }) {
  const hashes: string[] = [];
  for (const step of q.steps || []) {
    if (step.kind !== "transaction") throw new Error("Relay asked for a signature this page doesn't use. Stopped. Nothing extra was sent.");
    for (const it of step.items || []) {
      if (it.status === "complete") continue;
      const d = it.data || {};
      if (fromChain === "solana") {
        if (!endsAt.fromSol) throw new Error("No Solana key.");
        hashes.push(await relaySol(endsAt.fromSol, d));
      } else {
        const from = String(d.from || endsAt.from);
        if (from.toLowerCase() !== endsAt.from.toLowerCase()) throw new Error("Relay's transaction isn't from your wallet. Stopped.");
        if (Number(d.chainId) !== RELAY_ID[fromChain]) throw new Error("Relay asked for a different network. Stopped.");
        hashes.push(await relayEvm(endsAt.fromEvm, fromChain, d));
      }
    }
  }
  if (!hashes.length) throw new Error("Relay returned nothing to send.");
  return hashes;
}

async function relayEvm(account: NonNullable<Awaited<ReturnType<typeof copyKey>>>, chain: CardChain, d: any) {
  const c = WCHAINS[chain];
  const pc: any = createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 20_000 }) });
  const wc: any = createWalletClient({ account, chain: c.viem, transport: http(c.rpc, { timeout: 20_000 }) });
  const hash = await wc.sendTransaction({ account, chain: c.viem, to: d.to as Address, data: (d.data || "0x") as `0x${string}`, value: BigInt(d.value || "0"), ...(d.gas ? { gas: BigInt(d.gas) } : {}) });
  const rc = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (rc.status !== "success") throw new Error("A bridge transaction failed on-chain. Nothing further was sent.");
  return hash;
}

async function relaySol(kp: Keypair, d: any) {
  const conn = new Connection(SOL_RPC, "confirmed");
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
  } else throw new Error("Relay sent a Solana step this can't read. Stopped.");
  tx.sign([kp]);
  return sendSol(tx);
}

async function note(kind: string, text: string, chain: string, tx: string) {
  const owner = T() % 100_000;
  const { data } = await supabaseService().from("ai_trader_settings").select("user_id").eq("id", owner).maybeSingle();
  logActivity((data as { user_id?: string } | null)?.user_id, kind, text.slice(0, 200), undefined, { chain, tx: tx.slice(0, 80) });
  await flog("settings", text);
}
