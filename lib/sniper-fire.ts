/**
 * Buys a token on the chain it lives on, from every selected sniper wallet at once.
 * BNB Chain keeps the PancakeSwap watcher. Ethereum, Base and Arbitrum use that chain's
 * aggregator (Kyber, or its V2 exchange). Solana uses Jupiter: every wallet's swap is
 * built and signed first, then sent in the same moment, with the priority fee you picked.
 * A wallet with no address on that chain, or not enough of the coin, is skipped.
 */
import { createPublicClient, createWalletClient, http, parseUnits, type Address } from "viem";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import type { PrivateKeyAccount } from "viem/accounts";
import { copyKey } from "@/lib/ai-copy";
import { flog, type FSettings } from "@/lib/ai-futures";
import { T } from "@/lib/ai-trader-ctx";
import { NATIVE, WCHAINS, WSOL } from "@/lib/wallet-chains";
import { build, quote } from "@/lib/wallet-server";
import { supabaseService } from "@/lib/supabase/server";
import { sniperSol } from "@/lib/sniper-chains";
import type { SnipeChain } from "@/lib/sniper-detect";

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const SOL_RPC = process.env.SNIPER_SOLANA_RPC || process.env.WALLET_SOLANA_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC || "https://solana-rpc.publicnode.com";
const JUP = process.env.JUPITER_API || "https://lite-api.jup.ag";
const PRIO: Record<string, number> = { low: 50_000, med: 200_000, high: 1_000_000, max: 5_000_000 };
const RESERVE: Record<SnipeChain, number> = { bsc: 0.0015, ethereum: 0.0004, base: 0.00015, arbitrum: 0.00015, solana: 0.02 };

export type ReadyWallet = { slot: number; address: string | null; balance: number | null; unit: string; need: number; ok: boolean; reason: string };

function payOf(t: any): "native" | "usdt" | "usdc" {
  return t?.pay === "usdt" || t?.pay === "usdc" ? t.pay : "native";
}
function unitOf(chain: SnipeChain, pay: "native" | "usdt" | "usdc") {
  if (pay === "native") return WCHAINS[chain].native.symbol;
  const hit = WCHAINS[chain].tokens.find((x) => x.symbol.toUpperCase() === pay.toUpperCase());
  return hit?.symbol || pay.toUpperCase();
}
function tokenIn(chain: SnipeChain, pay: "native" | "usdt" | "usdc") {
  if (pay === "native") return chain === "solana" ? WSOL : NATIVE;
  const hit = WCHAINS[chain].tokens.find((x) => x.symbol.toUpperCase() === pay.toUpperCase());
  if (!hit) throw new Error(`${WCHAINS[chain].name} has no ${pay.toUpperCase()} set up.`);
  return hit.address;
}

/** What each selected wallet holds on this chain, and whether it can pay the buy. */
export async function snipeReady(chain: SnipeChain, pay: "native" | "usdt" | "usdc", amount: number, slots: number[]): Promise<{ chain: SnipeChain; unit: string; wallets: ReadyWallet[] }> {
  const unit = unitOf(chain, pay);
  const need = Number(amount) > 0 ? Number(amount) : 0;
  const reserve = pay === "native" ? RESERVE[chain] : (chain === "solana" ? 0.01 : RESERVE[chain]);
  const wallets = await Promise.all(slots.map(async (slot): Promise<ReadyWallet> => {
    try {
      if (chain === "solana") {
        const kp = await sniperSol(slot);
        if (!kp) return { slot, address: null, balance: null, unit, need, ok: false, reason: "No Solana address" };
        const owner = kp.publicKey.toBase58();
        const bal = await solUi(owner, pay === "native" ? "SOL" : tokenIn(chain, pay));
        const ok = bal + 1e-12 >= need + (pay === "native" ? reserve : 0.01);
        return { slot, address: owner, balance: bal, unit, need, ok, reason: ok ? "Ready" : bal <= 0 ? `No ${unit}` : `Needs ${(need + (pay === "native" ? reserve : 0.01)).toFixed(4)} ${unit}` };
      }
      const a = await copyKey(slot);
      if (!a) return { slot, address: null, balance: null, unit, need, ok: false, reason: "No wallet" };
      const bal = await evmUi(chain, a.address, pay);
      const ok = bal + 1e-12 >= need + reserve;
      return { slot, address: a.address, balance: bal, unit, need, ok, reason: ok ? "Ready" : `Needs ${(need + reserve).toFixed(4)} ${unit}` };
    } catch (e) {
      return { slot, address: null, balance: null, unit, need, ok: false, reason: (e as Error).message.slice(0, 80) };
    }
  }));
  return { chain, unit, wallets };
}

async function evmUi(chain: SnipeChain, who: string, pay: "native" | "usdt" | "usdc"): Promise<number> {
  const c = WCHAINS[chain];
  const pc: any = createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 8_000 }) });
  if (pay === "native") return Number(await pc.getBalance({ address: who as Address })) / 1e18;
  const tok = tokenIn(chain, pay) as Address;
  const [raw, dec] = await Promise.all([
    pc.readContract({ address: tok, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [who] }).catch(() => 0n),
    pc.readContract({ address: tok, abi: [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }], functionName: "decimals" }).then(Number).catch(() => 18),
  ]);
  return Number(raw) / 10 ** dec;
}

async function solUi(owner: string, mintOrSol: string): Promise<number> {
  const h = await fetch(`${JUP}/ultra/v1/holdings/${owner}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (mintOrSol === "SOL") return h?.uiAmount != null ? Number(h.uiAmount) : Number(h?.amount || 0) / 1e9;
  return ((h?.tokens?.[mintOrSol] || []) as { uiAmount?: number }[]).reduce((a, x) => a + (Number(x.uiAmount) || 0), 0);
}

type Fire = { bought: number; why: string; sent?: boolean; fired?: number[]; ok?: number[] };

/** Buy `t` on its chain from every picked wallet that can pay. Others are skipped, not failed. */
export async function fireChain(s: FSettings, t: any): Promise<Fire> {
  const chain = t.chain as SnipeChain;
  if (!WCHAINS[chain] || chain === "bsc") return { bought: 0, why: "BNB Chain uses its own buyer" };
  const pay = payOf(t);
  const amount = n(t.amount);
  if (!(amount > 0)) return { bought: 0, why: "set how much to spend" };
  const pick: number[] = Array.isArray(t.wallets) && t.wallets.length ? t.wallets.map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const already = new Set((t.fired || []).map(Number));
  const slots = pick.filter((x) => !already.has(x));
  if (!slots.length) return { bought: 0, why: "every picked wallet already bought" };
  const ready = await snipeReady(chain, pay, amount, slots);
  const skip = ready.wallets.filter((w) => !w.ok);
  const go = ready.wallets.filter((w) => w.ok);
  if (!go.length) return { bought: 0, why: skip.map((w) => `#${w.slot} ${w.reason}`).join("; ") || "no wallet can pay" };
  try {
    if (chain === "solana") return await fireSol(s, t, pay, amount, go, skip);
    return await fireEvm(s, t, chain, pay, amount, go, skip);
  } catch (e) {
    return { bought: 0, why: (e as Error).message.slice(0, 160) };
  }
}

async function fireEvm(s: FSettings, t: any, chain: SnipeChain, pay: "native" | "usdt" | "usdc", amount: number, go: ReadyWallet[], skip: ReadyWallet[]): Promise<Fire> {
  const c = WCHAINS[chain];
  const inn = tokenIn(chain, pay);
  const dec = pay === "native" ? 18 : (c.tokens.find((x) => x.symbol.toUpperCase() === pay.toUpperCase())?.decimals || 6);
  const raw = parseUnits(amount.toFixed(Math.min(dec, 8)), dec);
  const slip = Math.min(4900, Math.max(30, Math.round((n((s as any).liq_slip) || 20) * 100)));
  const pc: any = createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 12_000 }) });
  const gas = await pc.getGasPrice().catch(() => 1_000_000_000n);
  const plans = (await Promise.all(go.map(async (w) => {
    const account = await copyKey(w.slot);
    if (!account || !w.address) return null;
    try {
      const q = await quote(c, inn, t.token, raw, 0);
      const tx = await build(c, q, w.address, slip, true);
      if (tx.kind !== "evm") return null;
      const nonce = Number(await pc.getTransactionCount({ address: account.address, blockTag: "pending" }));
      return { w, account, q, tx, nonce };
    } catch (e) {
      skip.push({ ...w, ok: false, reason: (e as Error).message.slice(0, 80) });
      return null;
    }
  }))).filter(Boolean) as { w: ReadyWallet; account: PrivateKeyAccount; q: any; tx: { to: Address; data: `0x${string}`; value: string }; nonce: number }[];
  if (!plans.length) return { bought: 0, why: skip.map((w) => `#${w.slot} ${w.reason}`).join("; ") || "no route yet" };
  const fired: number[] = [], ok: number[] = [];
  await Promise.all(plans.map(async (p) => {
    try {
      const wc: any = createWalletClient({ account: p.account, chain: c.viem, transport: http(c.rpc, { timeout: 20_000 }) });
      const hash = await wc.sendTransaction({ account: p.account, chain: c.viem, nonce: p.nonce, to: p.tx.to, data: p.tx.data, value: BigInt(p.tx.value || "0"), gasPrice: gas });
      fired.push(p.w.slot);
      const rc = await pc.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (rc.status !== "success") throw new Error("failed on-chain");
      ok.push(p.w.slot);
      await flog("open", `⚡ Wallet ${p.w.slot} sniped ${t.label || String(t.token).slice(0, 8)} on ${c.name} for ${amount} ${unitOf(chain, pay)} from ${p.w.address}. ${c.explorer}/tx/${hash}`);
      await remember(s, t, chain, amount, unitOf(chain, pay), p.w.slot, hash);
    } catch (e) {
      await flog("error", `Wallet ${p.w.slot} couldn't buy on ${c.name}: ${(e as Error).message.slice(0, 140)}`);
    }
  }));
  return { bought: ok.length, why: skip.length ? `skipped ${skip.map((w) => `#${w.slot} (${w.reason})`).join(", ")}` : "", sent: fired.length > 0, fired, ok };
}

async function fireSol(s: FSettings, t: any, pay: "native" | "usdt" | "usdc", amount: number, go: ReadyWallet[], skip: ReadyWallet[]): Promise<Fire> {
  const inn = tokenIn("solana", pay);
  const dec = pay === "native" ? 9 : 6;
  const raw = parseUnits(amount.toFixed(Math.min(dec, 6)), dec);
  const slip = Math.min(4900, Math.max(30, Math.round((n((s as any).liq_slip) || 20) * 100)));
  const prio = PRIO[String(t.prio || "high")] || PRIO.high;
  const conn = new Connection(SOL_RPC, "confirmed");
  const built = (await Promise.all(go.map(async (w) => {
    const kp = await sniperSol(w.slot);
    if (!kp) { skip.push({ ...w, ok: false, reason: "No Solana address" }); return null; }
    try {
      const q = await fetch(`${JUP}/swap/v1/quote?inputMint=${inn}&outputMint=${t.token}&amount=${raw}&slippageBps=${slip}&restrictIntermediateTokens=true`, { cache: "no-store", signal: AbortSignal.timeout(12_000) }).then((r) => r.json());
      if (!q?.outAmount) throw new Error(q?.error || "no pool yet");
      const j = await fetch(`${JUP}/swap/v1/swap`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000), body: JSON.stringify({
        quoteResponse: q, userPublicKey: kp.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: prio, priorityLevel: prio >= 1_000_000 ? "veryHigh" : "high" } },
      }) }).then((r) => r.json());
      if (!j?.swapTransaction) throw new Error(j?.error || "couldn't build");
      const tx = VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, "base64"));
      tx.sign([kp]);
      return { w, raw: tx.serialize(), kp };
    } catch (e) {
      skip.push({ ...w, ok: false, reason: (e as Error).message.slice(0, 80) });
      return null;
    }
  }))).filter(Boolean) as { w: ReadyWallet; raw: Uint8Array; kp: Keypair }[];
  if (!built.length) return { bought: 0, why: skip.map((w) => `#${w.slot} ${w.reason}`).join("; ") || "no Solana route yet" };
  const sent = await Promise.all(built.map(async (p) => {
    try {
      const sig = await conn.sendRawTransaction(p.raw, { skipPreflight: true, maxRetries: 0 });
      return { ...p, sig };
    } catch (e) {
      await flog("error", `Wallet ${p.w.slot} couldn't send the Solana buy: ${(e as Error).message.slice(0, 140)}`);
      return null;
    }
  }));
  const fired = sent.filter(Boolean).map((p) => p!.w.slot);
  const ok: number[] = [];
  await Promise.all(sent.map(async (p) => {
    if (!p) return;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const st = (await conn.getSignatureStatuses([p.sig]).catch(() => null))?.value?.[0];
      if (st?.err) { await flog("error", `Wallet ${p.w.slot} Solana buy failed on-chain.`); return; }
      if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") {
        ok.push(p.w.slot);
        await flog("open", `⚡ Wallet ${p.w.slot} sniped ${t.label || String(t.token).slice(0, 6)} on Solana for ${amount} ${unitOf("solana", pay)} from ${p.w.address}. https://solscan.io/tx/${p.sig}`);
        await remember(s, t, "solana", amount, unitOf("solana", pay), p.w.slot, p.sig);
        return;
      }
    }
  }));
  return { bought: ok.length, why: skip.length ? `skipped ${skip.map((w) => `#${w.slot} (${w.reason})`).join(", ")}` : "", sent: fired.length > 0, fired, ok };
}

async function remember(s: FSettings, t: any, chain: SnipeChain, amount: number, unit: string, slot: number, tx: string) {
  const sb = supabaseService();
  await sb.from("ai_futures_positions").insert({
    fut_id: T(), mode: s.mode, venue: "copy", coin: `${chain}:${t.token}`, side: "long", lev: 1,
    margin_usd: 0, notional_usd: 0, entry: amount, stop: 0, target: 0, liq: null, best: amount, last: amount,
    size: 0, fees_usd: 0, why: `${t.label || t.token}: sniped on ${WCHAINS[chain].name} (${amount} ${unit})`,
    open_tx: tx, risk_usd: 0, equity_at_open: 0, copy_from: t.token, copy_slot: slot, copy_pay: unit,
  }).then(() => {}, () => {});
}
