/**
 * Buys a token on the chain it lives on, from every selected sniper wallet at once.
 * BNB Chain keeps the PancakeSwap watcher. Ethereum, Base and Arbitrum use that chain's
 * aggregator (Kyber, or its V2 exchange). Solana uses Jupiter: every wallet's swap is
 * built and signed first, then sent in the same moment, with the priority fee you picked.
 * A wallet with no address on that chain, or not enough of the coin, is skipped.
 */
import { createPublicClient, createWalletClient, http, parseUnits, type Address } from "viem";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { PrivateKeyAccount } from "viem/accounts";
import { copyKey } from "@/lib/ai-copy";
import { flog, type FSettings } from "@/lib/ai-futures";
import { T } from "@/lib/ai-trader-ctx";
import { NATIVE, WCHAINS, WSOL } from "@/lib/wallet-chains";
import { build, quote } from "@/lib/wallet-server";
import { supabaseService } from "@/lib/supabase/server";
import { sniperSol, solBalances } from "@/lib/sniper-chains";
import { BG_CHAIN, BitgetNotSent, bitgetEvmBuy, bitgetOn, bitgetSolBuy } from "@/lib/bitget-swap";
import type { SnipeChain } from "@/lib/sniper-detect";

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const SOL_RPC = process.env.SNIPER_SOLANA_RPC || process.env.WALLET_SOLANA_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC || "https://solana-rpc.publicnode.com";
// lite-api.jup.ag (keyless) is being throttled and phased out by Jupiter; with JUPITER_API_KEY set, use api.jup.ag.
const JUP_KEY = process.env.JUPITER_API_KEY || "";
const JUP = process.env.JUPITER_API || (JUP_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag");
const JUP_H: Record<string, string> = JUP_KEY ? { "x-api-key": JUP_KEY } : {};
const PRIO: Record<string, number> = { low: 50_000, med: 200_000, high: 1_000_000, max: 5_000_000 };
/** SOL a Solana wallet keeps for fees when it snipes with USDT (network + priority fee + the new token account). */
const SOL_FEE = 0.01;
const RESERVE: Record<SnipeChain, number> = { bsc: 0.0015, ethereum: 0.0004, base: 0.00015, arbitrum: 0.00015, solana: 0.02 };

export type ReadyWallet = { slot: number; address: string | null; balance: number | null; gas?: number; gasNeed?: number; unit: string; need: number; ok: boolean; reason: string };

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
/** $ for one unit of what pays (1 for USDT / USDC). */
export async function payUsd(chain: SnipeChain, pay: "native" | "usdt" | "usdc"): Promise<number> {
  if (pay !== "native") return 1;
  const { nativeUsd } = await import("@/lib/ai-trader-chains");
  return nativeUsd(chain === "bsc" ? "bsc" : chain === "solana" ? "solana" : "ethereum").catch(() => 0);
}

/** inUsd: the amounts are dollars, turned into the pay coin at today's price. */
export async function snipeReady(chain: SnipeChain, pay: "native" | "usdt" | "usdc", amount: number, slots: number[], amounts: Record<string, number> = {}, inUsd = false): Promise<{ chain: SnipeChain; unit: string; price: number; extra: number; wallets: ReadyWallet[] }> {
  const unit = unitOf(chain, pay);
  const price = inUsd ? await payUsd(chain, pay) : 0;
  if (inUsd && !(price > 0)) throw new Error(`No ${unit} price right now. Try again in a moment.`);
  const reserve = pay === "native" ? RESERVE[chain] : (chain === "solana" ? 0.01 : RESERVE[chain]);
  const wallets = await Promise.all(slots.map(async (slot): Promise<ReadyWallet> => {
    // This wallet's own amount for the token, else the one typed for all.
    const need = inUsd ? +(amountOf(slot, amount, amounts) / price).toFixed(9) : amountOf(slot, amount, amounts);
    try {
      if (chain === "solana") {
        const kp = await sniperSol(slot);
        if (!kp) return { slot, address: null, balance: null, unit, need, ok: false, reason: "No Solana address" };
        const owner = kp.publicKey.toBase58();
        let bal: number;
        try { bal = await solUi(owner, pay === "native" ? "SOL" : tokenIn(chain, pay)); }
        catch (e) { return { slot, address: owner, balance: null, unit, need, ok: false, reason: (e as Error).message.slice(0, 80) }; }
        if (pay !== "native") {
          // Paying in USDT: the buy spends USDT, and SOL only pays the network / priority fee (and a token account).
          const sol = await solUi(owner, "SOL").catch(() => 0);
          const gasOk = sol + 1e-12 >= SOL_FEE;
          const ok = need > 0 && bal + 1e-12 >= need && gasOk;
          return { slot, address: owner, balance: bal, gas: sol, gasNeed: SOL_FEE, unit, need, ok, reason: ok ? "Ready" : !(need > 0) ? "No amount set" : bal + 1e-12 < need ? `Needs ${need.toFixed(2)} ${unit}` : `Needs ${SOL_FEE} SOL for fees` };
        }
        const ok = need > 0 && bal + 1e-12 >= need + reserve;
        return { slot, address: owner, balance: bal, unit, need, ok, reason: ok ? "Ready" : !(need > 0) ? "No amount set" : bal <= 0 ? `No ${unit}` : `Needs ${(need + reserve).toFixed(4)} ${unit}` };
      }
      const a = await copyKey(slot);
      if (!a) return { slot, address: null, balance: null, unit, need, ok: false, reason: "No wallet" };
      if (pay !== "native") {
        // Paying in USDT: the buy spends USDT, and BNB (the chain's coin) only pays the gas.
        const [bal, gas] = await Promise.all([evmUi(chain, a.address, pay), evmUi(chain, a.address, "native")]);
        const gasOk = gas + 1e-12 >= reserve;
        const ok = need > 0 && bal + 1e-12 >= need && gasOk;
        const coin = WCHAINS[chain].native.symbol;
        return { slot, address: a.address, balance: bal, gas, gasNeed: reserve, unit, need, ok, reason: ok ? "Ready" : !(need > 0) ? "No amount set" : bal + 1e-12 < need ? `Needs ${need.toFixed(2)} ${unit}` : `Needs ${reserve} ${coin} for gas` };
      }
      const bal = await evmUi(chain, a.address, pay);
      const ok = need > 0 && bal + 1e-12 >= need + reserve;
      return { slot, address: a.address, balance: bal, unit, need, ok, reason: ok ? "Ready" : !(need > 0) ? "No amount set" : `Needs ${(need + reserve).toFixed(4)} ${unit}` };
    } catch (e) {
      return { slot, address: null, balance: null, unit, need, ok: false, reason: (e as Error).message.slice(0, 80) };
    }
  }));
  // What a wallet must hold on top of the buy (fees), so the page can work out "ready" from the amounts typed right now.
  const extra = pay === "native" ? reserve : 0;
  return { chain, unit, price, extra, wallets };
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

/**
 * A Solana wallet's SOL or token balance, read straight from the network (same as the wallet cards).
 * It used to come from Jupiter's holdings service, and any failure there read as 0, so funded wallets showed "No SOL".
 * A failed read now throws, so the wallet shows the error instead of a fake 0.
 */
async function solUi(owner: string, mintOrSol: string): Promise<number> {
  const bal = await solBalances(owner).catch(() => null);
  if (!bal) throw new Error("Couldn't read the Solana balance. Try again in a moment.");
  if (mintOrSol === "SOL") return Number(bal.lamports) / 1e9;
  return bal.tokens.get(mintOrSol)?.ui || 0;
}

/** A wallet's own amount (set for this token or this chain), else the shared one. */
export function amountOf(slot: number, amount: number, amounts: Record<string, number> | undefined) {
  const own = n(amounts?.[String(slot)]);
  return own > 0 ? own : Number(amount) > 0 ? Number(amount) : 0;
}

type Fire = { bought: number; why: string; sent?: boolean; fired?: number[]; ok?: number[] };

/** Buy `t` on its chain from every picked wallet that can pay. Others are skipped, not failed. */
export async function fireChain(s: FSettings, t: any): Promise<Fire> {
  const chain = t.chain as SnipeChain;
  if (!WCHAINS[chain] || chain === "bsc") return { bought: 0, why: "BNB Chain uses its own buyer" };
  const pay = payOf(t);
  const amount = n(t.amount);
  const amounts: Record<string, number> = t.amounts && typeof t.amounts === "object" ? t.amounts : {};
  if (!(amount > 0) && !Object.values(amounts).some((v) => n(v) > 0)) return { bought: 0, why: "set how much to spend" };
  const pick: number[] = Array.isArray(t.wallets) && t.wallets.length ? t.wallets.map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const already = new Set((t.fired || []).map(Number));
  const slots = pick.filter((x) => !already.has(x));
  if (!slots.length) return { bought: 0, why: "every picked wallet already bought" };
  if (chain === "solana") {
    // One cheap route check first: until Jupiter can route to the token, no wallet is read or built (fast, and it
    // keeps well under Jupiter's rate limit while waiting).
    const probe = await fetch(`${JUP}/swap/v1/quote?inputMint=${tokenIn("solana", pay)}&outputMint=${t.token}&amount=${pay === "native" ? 10_000_000 : 1_000_000}&slippageBps=5000&restrictIntermediateTokens=true`, { cache: "no-store", headers: JUP_H, signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => null);
    if (!probe?.outAmount) return { bought: 0, why: "no Solana pool Jupiter can route to yet" };
  }
  const ready = await snipeReady(chain, pay, amount, slots, amounts);
  const skip = ready.wallets.filter((w) => !w.ok);
  const go = ready.wallets.filter((w) => w.ok);
  if (!go.length) return { bought: 0, why: skip.map((w) => `#${w.slot} ${w.reason}`).join("; ") || "no wallet can pay" };
  // Bitget Wallet first, like Copy Trade; wallets Bitget can't serve yet buy straight from the pool / Jupiter.
  const bg = await bitgetFirst(s, t, chain, pay, go);
  const rest = go.filter((w) => !bg.fired.includes(w.slot));
  if (!rest.length) return { bought: bg.ok.length, sent: bg.fired.length > 0, fired: bg.fired, ok: bg.ok, why: bg.ok.length ? "" : bg.why || "the Bitget Wallet buys didn't finish" };
  let r: Fire;
  try {
    r = chain === "solana" ? await fireSol(s, t, pay, rest, skip) : await fireEvm(s, t, chain, pay, rest, skip);
  } catch (e) {
    r = { bought: 0, why: (e as Error).message.slice(0, 160) };
  }
  if (!bg.fired.length) return r;
  const ok = [...bg.ok, ...(r.ok || [])], fired = [...bg.fired, ...(r.fired || [])];
  return { bought: ok.length, sent: true, fired, ok, why: ok.length ? "" : r.why };
}

/** Each ready wallet buys through Bitget Wallet's swap. A sent order counts as fired (never bought twice). */
async function bitgetFirst(s: FSettings, t: any, chain: SnipeChain, pay: "native" | "usdt" | "usdc", go: ReadyWallet[]): Promise<{ ok: number[]; fired: number[]; why: string }> {
  const bgc = BG_CHAIN[chain];
  const ok: number[] = [], fired: number[] = [];
  let why = "";
  if (!bitgetOn() || !bgc) return { ok, fired, why };
  const slipPct = Math.min(49, Math.max(3, n((s as any).liq_slip) || 20));
  const unit = unitOf(chain, pay);
  const [payPx, payIn] = await Promise.all([payUsd(chain, pay).catch(() => (pay === "native" ? 0 : 1)), Promise.resolve(pay === "native" ? "" : tokenIn(chain, pay))]);
  await Promise.all(go.map(async (w) => {
    try {
      let r: { raw: bigint; decimals: number; hash: string };
      if (bgc === "sol") {
        const kp = await sniperSol(w.slot);
        if (!kp) return;
        r = await bitgetSolBuy(kp, { mint: payIn, symbol: unit, amount: w.need }, String(t.token), slipPct);
      } else {
        const a = await copyKey(w.slot);
        if (!a) return;
        r = await bitgetEvmBuy(a, bgc, { contract: payIn, symbol: unit, amount: w.need }, String(t.token), slipPct);
      }
      fired.push(w.slot);
      const size = Number(r.raw) / 10 ** r.decimals;
      if (!(size > 0)) throw new Error("the swap went through but no coins arrived");
      ok.push(w.slot);
      const scan = chain === "solana" ? `https://solscan.io/tx/${r.hash}` : `${WCHAINS[chain].explorer}/tx/${r.hash}`;
      await flog("open", `⚡ Wallet ${w.slot} sniped ${t.label || String(t.token).slice(0, 8)} on ${WCHAINS[chain].name} via Bitget Wallet for ${w.need} ${unit}. ${scan}`);
      await remember(s, t, chain, w.need, unit, w.slot, r.hash, { size, usd: w.need * (payPx || 0) });
    } catch (e) {
      if (e instanceof BitgetNotSent) { why ||= `Bitget Wallet: ${(e as Error).message}`; return; }
      if (!fired.includes(w.slot)) fired.push(w.slot);
      await flog("error", `Wallet ${w.slot}'s Bitget Wallet buy on ${WCHAINS[chain].name} didn't finish: ${(e as Error).message.slice(0, 140)}`);
    }
  }));
  return { ok, fired, why };
}

async function fireEvm(s: FSettings, t: any, chain: SnipeChain, pay: "native" | "usdt" | "usdc", go: ReadyWallet[], skip: ReadyWallet[]): Promise<Fire> {
  const c = WCHAINS[chain];
  const inn = tokenIn(chain, pay);
  const dec = pay === "native" ? 18 : (c.tokens.find((x) => x.symbol.toUpperCase() === pay.toUpperCase())?.decimals || 6);
  const rawOf = (w: ReadyWallet) => parseUnits(w.need.toFixed(Math.min(dec, 8)), dec);
  const slip = Math.min(4900, Math.max(30, Math.round((n((s as any).liq_slip) || 20) * 100)));
  const pc: any = createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 12_000 }) });
  const gas = await pc.getGasPrice().catch(() => 1_000_000_000n);
  const plans = (await Promise.all(go.map(async (w) => {
    const account = await copyKey(w.slot);
    if (!account || !w.address) return null;
    try {
      const q = await quote(c, inn, t.token, rawOf(w), 0);
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
      await flog("open", `⚡ Wallet ${p.w.slot} sniped ${t.label || String(t.token).slice(0, 8)} on ${c.name} for ${p.w.need} ${unitOf(chain, pay)} from ${p.w.address}. ${c.explorer}/tx/${hash}`);
      await remember(s, t, chain, p.w.need, unitOf(chain, pay), p.w.slot, hash);
    } catch (e) {
      await flog("error", `Wallet ${p.w.slot} couldn't buy on ${c.name}: ${(e as Error).message.slice(0, 140)}`);
    }
  }));
  return { bought: ok.length, why: skip.length ? `skipped ${skip.map((w) => `#${w.slot} (${w.reason})`).join(", ")}` : "", sent: fired.length > 0, fired, ok };
}

async function fireSol(s: FSettings, t: any, pay: "native" | "usdt" | "usdc", go: ReadyWallet[], skip: ReadyWallet[]): Promise<Fire> {
  const inn = tokenIn("solana", pay);
  const dec = pay === "native" ? 9 : 6;
  const slip = Math.min(4900, Math.max(30, Math.round((n((s as any).liq_slip) || 20) * 100)));
  const prio = PRIO[String(t.prio || "high")] || PRIO.high;
  const conn = new Connection(SOL_RPC, "confirmed");
  const built = (await Promise.all(go.map(async (w) => {
    const kp = await sniperSol(w.slot);
    if (!kp) { skip.push({ ...w, ok: false, reason: "No Solana address" }); return null; }
    try {
      const raw = parseUnits(w.need.toFixed(Math.min(dec, 6)), dec);
      const q = await fetch(`${JUP}/swap/v1/quote?inputMint=${inn}&outputMint=${t.token}&amount=${raw}&slippageBps=${slip}&restrictIntermediateTokens=true`, { cache: "no-store", headers: JUP_H, signal: AbortSignal.timeout(12_000) }).then((r) => r.json());
      if (!q?.outAmount) throw new Error(q?.error || "no pool yet");
      const j = await fetch(`${JUP}/swap/v1/swap`, { method: "POST", headers: { "content-type": "application/json", ...JUP_H }, signal: AbortSignal.timeout(15_000), body: JSON.stringify({
        quoteResponse: q, userPublicKey: kp.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: prio, priorityLevel: prio >= 1_000_000 ? "veryHigh" : "high" } },
      }) }).then((r) => r.json());
      if (!j?.swapTransaction) throw new Error(j?.error || "couldn't build");
      const tx = VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, "base64"));
      tx.sign([kp]);
      return { w, raw: tx.serialize(), kp, out: BigInt(q.outAmount) };
    } catch (e) {
      skip.push({ ...w, ok: false, reason: (e as Error).message.slice(0, 80) });
      return null;
    }
  }))).filter(Boolean) as { w: ReadyWallet; raw: Uint8Array; kp: Keypair; out: bigint }[];
  // Token decimals and the $ per pay coin, so each buy is saved with its coins and its cost (take profit needs both).
  const [mintDec, payPx] = await Promise.all([
    conn.getTokenSupply(new PublicKey(t.token)).then((x) => x.value.decimals).catch(() => 6),
    payUsd("solana", pay).catch(() => (pay === "native" ? 0 : 1)),
  ]);
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
        await flog("open", `⚡ Wallet ${p.w.slot} sniped ${t.label || String(t.token).slice(0, 6)} on Solana for ${p.w.need} ${unitOf("solana", pay)} from ${p.w.address}. https://solscan.io/tx/${p.sig}`);
        await remember(s, t, "solana", p.w.need, unitOf("solana", pay), p.w.slot, p.sig, { size: Number(p.out) / 10 ** mintDec, usd: p.w.need * (payPx || 0) });
        return;
      }
    }
  }));
  return { bought: ok.length, why: skip.length ? `skipped ${skip.map((w) => `#${w.slot} (${w.reason})`).join(", ")}` : "", sent: fired.length > 0, fired, ok };
}

async function remember(s: FSettings, t: any, chain: SnipeChain, amount: number, unit: string, slot: number, tx: string, got?: { size: number; usd: number }) {
  const sb = supabaseService();
  // With the coins and the $ cost known, entry is the $ price per coin (like BNB Chain snipes), so take profit works.
  const priced = !!got && got.size > 0 && got.usd > 0;
  const entry = priced ? got!.usd / got!.size : amount;
  await sb.from("ai_futures_positions").insert({
    fut_id: T(), mode: s.mode, venue: "copy", coin: `${chain}:${t.token}`, side: "long", lev: 1,
    margin_usd: priced ? got!.usd : 0, notional_usd: priced ? got!.usd : 0, entry, stop: 0, target: 0, liq: null, best: entry, last: entry,
    size: priced ? got!.size : 0, fees_usd: 0, why: `${t.label || t.token}: sniped on ${WCHAINS[chain].name} (${amount} ${unit})`,
    open_tx: tx, risk_usd: 0, equity_at_open: 0, copy_from: t.token, copy_slot: slot, copy_pay: unit,
  }).then(() => {}, () => {});
}
