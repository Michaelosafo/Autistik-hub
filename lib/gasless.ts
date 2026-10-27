/**
 * Gasless swaps. Server only.
 *
 * Solana: swaps go through Jupiter Ultra. When a wallet has too little SOL for the network fee, Jupiter pays it for
 * qualifying trades (free for us). With SOLANA_GAS_KEY set (a small wallet the team funds with SOL), AUTISTIK pays
 * the network fee for every swap instead, within limits so the wallet can't be drained: swaps of $3 or more, at most
 * SPONSOR_PER_WALLET a day per wallet, and at most SOLANA_GAS_DAILY_SOL a day in total.
 *
 * BNB Chain: BNB Chain's MegaFuel paymaster. A transaction it agrees to sponsor is signed with a gas price of 0 and
 * sent through MegaFuel, which pays the gas. The sponsor policy (which contracts, how much) is set up and funded by the
 * team on NodeReal; its endpoint goes in MEGAFUEL_URL. This needs a wallet that can sign without sending, so it works
 * with the built-in AUTISTIK wallet; other wallets pay the normal (tiny) gas.
 */
import { createHash } from "crypto";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { supabaseService } from "@/lib/supabase/server";

const ULTRA = (process.env.JUPITER_ULTRA_API || "https://lite-api.jup.ag/ultra/v1").replace(/\/$/, "");
const SPONSOR_PER_WALLET = Number(process.env.SPONSOR_PER_WALLET || 5);
const SOL_DAILY = BigInt(Math.round(Number(process.env.SOLANA_GAS_DAILY_SOL || 0.5) * 1e9));
const MIN_USD = 3;

// ---------------------------------------------------------------- the team's Solana gas wallet

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(s: string) {
  let n = 0n;
  for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error("bad key"); n = n * 58n + BigInt(i); }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}
let sponsor: Keypair | null | undefined;
export function solSponsor(): Keypair | null {
  if (sponsor !== undefined) return sponsor;
  const raw = (process.env.SOLANA_GAS_KEY || "").trim();
  try { const k = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : b58(raw); sponsor = k.length === 64 ? Keypair.fromSecretKey(k) : null; }
  catch { sponsor = null; }
  return sponsor;
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);
async function sponsorAllowed(chain: string, wallet: string, cost: bigint) {
  const sb = supabaseService();
  const [{ data: mine }, { data: all }] = await Promise.all([
    sb.from("gas_sponsored").select("count").eq("day", today()).eq("chain", chain).eq("wallet", wallet).maybeSingle(),
    sb.from("gas_sponsored").select("spent").eq("day", today()).eq("chain", chain),
  ]);
  const spent = (all || []).reduce((s: bigint, r: any) => s + BigInt(String(r.spent ?? "0").split(".")[0]), 0n);
  return (mine?.count ?? 0) < SPONSOR_PER_WALLET && spent + cost <= SOL_DAILY;
}
async function noteSponsored(chain: string, wallet: string, cost: bigint) {
  await supabaseService().rpc("gas_sponsored_add", { p_day: today(), p_chain: chain, p_wallet: wallet, p_spent: cost.toString() });
}

// ---------------------------------------------------------------- Solana: Jupiter Ultra

export type UltraTx = { kind: "ultra"; tx: string; requestId: string; gasless: boolean; sponsored: boolean; outAmount: string };

async function order(params: Record<string, string>) {
  const r = await fetch(`${ULTRA}/order?${new URLSearchParams(params)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.transaction) throw new Error(j?.errorMessage || j?.error || "No route found for this swap right now.");
  return j;
}

/** A Solana swap the member signs. The network fee is paid by Jupiter (low SOL) or by AUTISTIK (when sponsored). */
export async function ultraSwap(tokenIn: string, tokenOut: string, amount: bigint, taker: string): Promise<UltraTx> {
  const base = { inputMint: tokenIn, outputMint: tokenOut, amount: amount.toString(), taker };
  const plain = await order(base);
  let j = plain, sponsored = false;
  const pay = solSponsor();
  const cost = BigInt(Number(plain.signatureFeeLamports || 5000) + Number(plain.prioritizationFeeLamports || 0) + Number(plain.rentFeeLamports || 0));
  // Jupiter already covers it, or nothing to cover: no need for ours.
  if (pay && !plain.gasless && Number(plain.swapUsdValue || plain.inUsdValue || 0) >= MIN_USD && await sponsorAllowed("solana", taker, cost).catch(() => false)) {
    try {
      const s = await order({ ...base, payer: pay.publicKey.toBase58() });
      if (s.signatureFeePayer === pay.publicKey.toBase58() || s.prioritizationFeePayer === pay.publicKey.toBase58()) { j = s; sponsored = true; }
    } catch { /* fall back to the normal order */ }
  }
  // Remember exactly what Jupiter built, so our wallet only ever co-signs that transaction and nothing else.
  if (sponsored) {
    const msg = VersionedTransaction.deserialize(Buffer.from(j.transaction, "base64")).message.serialize();
    const { error } = await supabaseService().from("gas_orders").insert({ request_id: String(j.requestId), msg_hash: sha(msg), taker });
    if (error) { j = plain; sponsored = false; }
  }
  return { kind: "ultra", tx: j.transaction, requestId: j.requestId, gasless: !!j.gasless || sponsored, sponsored, outAmount: String(j.outAmount ?? "") };
}

/** Sends a signed Ultra swap (adding AUTISTIK's signature when it pays the fee). Returns the signature. */
export async function ultraExecute(signedB64: string, requestId: string, sponsored: boolean, taker: string): Promise<string> {
  let tx = signedB64;
  if (sponsored) {
    const pay = solSponsor();
    if (!pay) throw new Error("Gas sponsorship isn't available right now. Get a new quote.");
    const v = VersionedTransaction.deserialize(Buffer.from(signedB64, "base64"));
    // Only ever co-sign the exact transaction Jupiter built for this order (and only once).
    const { data: o } = await supabaseService().from("gas_orders").delete().eq("request_id", requestId).eq("taker", taker).select("msg_hash").maybeSingle();
    if (!o || o.msg_hash !== sha(v.message.serialize()) || !v.message.staticAccountKeys[0].equals(pay.publicKey)) throw new Error("That swap changed. Get a new quote and try again.");
    v.sign([pay]);
    tx = Buffer.from(v.serialize()).toString("base64");
  }
  const r = await fetch(`${ULTRA}/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedTransaction: tx, requestId }), cache: "no-store", signal: AbortSignal.timeout(40_000) });
  const j = await r.json().catch(() => null);
  if (j?.status !== "Success") throw new Error(j?.error ? `Solana rejected it: ${String(j.error).slice(0, 140)}` : "The swap didn't go through. Nothing was traded. Try again.");
  if (sponsored) await noteSponsored("solana", taker, 10_000n).catch(() => {});
  return String(j.signature);
}

// ---------------------------------------------------------------- BNB Chain: MegaFuel

const MEGAFUEL = (process.env.MEGAFUEL_URL || "").trim();
export const megafuelOn = () => /^https:\/\//.test(MEGAFUEL);
async function mf(method: string, params: unknown[], ua = false) {
  const r = await fetch(MEGAFUEL, {
    method: "POST", headers: { "content-type": "application/json", ...(ua ? { "user-agent": "autistik-hub/1.0" } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: AbortSignal.timeout(12_000),
  });
  const j = await r.json().catch(() => null);
  if (j?.error) throw new Error(String(j.error.message || "MegaFuel error"));
  return j?.result;
}

/** Whether BNB Chain's paymaster will pay the gas for this transaction, and the nonce to sign it with. */
export async function megafuelCheck(tx: { from: string; to: string; data: string; value: string; gas: string }) {
  if (!megafuelOn()) return { sponsorable: false as const };
  const r = await mf("pm_isSponsorable", [tx]).catch(() => null);
  if (!r?.Sponsorable && !r?.sponsorable) return { sponsorable: false as const };
  const nonce = await mf("eth_getTransactionCount", [tx.from, "pending"]);
  return { sponsorable: true as const, policy: String(r.SponsorPolicy || r.sponsorPolicy || "AUTISTIK"), nonce: String(nonce) };
}

/** Sends a gas-price-0 transaction the member signed, through MegaFuel. */
export async function megafuelSend(raw: string): Promise<string> {
  return String(await mf("eth_sendRawTransaction", [raw], true));
}
