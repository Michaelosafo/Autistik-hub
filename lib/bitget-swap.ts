/**
 * Copy buys through Bitget Wallet's swap service (server only), BNB Chain, paying with BNB.
 *
 * Bitget Wallet's aggregator (the same one inside the Bitget Wallet app, 110+ exchanges) finds the route; your own
 * Copy key signs the transaction here and Bitget sends it. The coins arrive in that same wallet. Nothing is given to
 * Bitget except the signed swap: the key never leaves the server.
 *
 * Flow (Bitget Wallet's public agent API, no API key; see github.com/bitget-wallet-ai-lab/bitget-wallet-skill):
 * quote -> confirm (orderId) -> makeOrder (unsigned txs, response signed by Bitget and checked here) -> sign -> send
 * -> getOrderDetails until it succeeds or fails.
 *
 * Turn it off with COPY_VIA_BITGET=0 in Vercel. If Bitget can't quote or build the order, the buy falls back to
 * PancakeSwap and the route service as before. Once a signed order has been sent it never falls back (that could
 * buy twice).
 */
import { createHash, createPublicKey, verify as rsaVerify } from "crypto";
import { createPublicClient, encodeFunctionData, fallback, formatEther, http, type PrivateKeyAccount } from "viem";
import { arbitrum, base, bsc, mainnet, polygon } from "viem/chains";
import { Connection, PublicKey, VersionedTransaction, type Keypair } from "@solana/web3.js";

const BASE = "https://copenapi.bgwapi.io";
// Bitget Wallet's published key for the security-check headers on makeOrder (from the open-source skill).
const BGW_KEY = process.env.BGW_SECURITY_PUBLIC_KEY || [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAk18NCL9CoiE8OQ588ehJ",
  "hVoCenARvVymahlH3Sw8URZATuZw4k8ZKC8Sf7Zu9i9l3L3K5X4m2I20UENkOBzP",
  "YGCRHk3Dy8SQk/e7ucj/hXJH07yNDJuv1t1nWXRhvwpG8rdW03KpDhJy4pgcAMXl",
  "JYnJYqhfj7HW/urMD0KXw7dLNKyWKBoaGzKkoRvvxTSDHk35cjETcYg6H+bEm+Px",
  "a+GnIJkuN5U2/LfZ4WxgNiIdE2zacHLcFoFsM14jTQdcvPid+6ilY8SQCA3GWc72",
  "n1RudWoTj1ThEUVNWXgcwxLFIdiLCNH1YF7qINdRrjOOCCBBBpr6jdANdI2e4Dcy",
  "DQIDAQAB",
  "-----END PUBLIC KEY-----",
].join("\n");

export const bitgetOn = () => process.env.COPY_VIA_BITGET !== "0";

/** An error from before the signed order was sent: safe to buy another way instead. */
export class BitgetNotSent extends Error {}

const RPCS = [process.env.COPY_BSC_RPC, "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org", "https://bsc-dataseed.bnbchain.org"].filter(Boolean) as string[];
let client: any = null;
const pc = () => (client ||= createPublicClient({ chain: bsc, transport: fallback(RPCS.map((u) => http(u, { timeout: 5000, retryCount: 0 })), { retryCount: 1 }) }));
const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address", name: "a" }], outputs: [{ type: "uint256", name: "" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8", name: "" }] },
] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function checkSig(sigHex: string, data: Buffer): boolean {
  try { return rsaVerify("sha256", data, createPublicKey(BGW_KEY), Buffer.from(sigHex.replace(/^0x/i, ""), "hex")); } catch { return false; }
}

export async function bgwCall(path: string, body: object, checked = false): Promise<any> {
  const ts = String(Date.now());
  const bodyStr = JSON.stringify(body);
  const sign = "0x" + createHash("sha256").update("POST" + path + bodyStr + ts).digest("hex");
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", channel: "toc_agent", brand: "toc_agent", clientversion: "10.0.0", language: "en", token: "toc_agent", "X-SIGN": sign, "X-TIMESTAMP": ts },
    body: bodyStr,
    signal: AbortSignal.timeout(10_000),
  });
  const raw = Buffer.from(await r.arrayBuffer());
  if (!r.ok) throw new Error(`Bitget Wallet ${path.split("/").pop()}: HTTP ${r.status}`);
  const j = JSON.parse(raw.toString("utf8"));
  if (j?.status !== 0 || (j.error_code != null && j.error_code !== 0)) throw new Error(`Bitget Wallet ${path.split("/").pop()}: ${j?.msg || j?.error_code || "refused"}`);
  if (checked) {
    // The order to sign must really come from Bitget: three RSA signatures over the response and our request.
    const a = r.headers.get("security-check") || "", b = r.headers.get("security-request-check") || "", c = r.headers.get("security-double-check") || "";
    if (!a || !b || !c || !checkSig(a, raw) || !checkSig(b, Buffer.from(bodyStr, "utf8")) || !checkSig(c, Buffer.from(a + b, "utf8"))) {
      throw new Error("Bitget Wallet's order failed its security check, so it wasn't signed.");
    }
  }
  return j.data;
}

const toWei = (v: unknown) => { const s = String(v ?? "0"); return s.includes(".") ? BigInt(Math.round(Number(s) * 1e18)) : BigInt(s || "0"); };
const toGasPrice = (v: unknown) => { const s = String(v ?? "0"); if (!s.includes(".")) return BigInt(s || "0"); const f = Number(s); return BigInt(Math.round(f < 1 ? f * 1e18 : f * 1e9)); };
const toNum = (v: unknown) => { const s = String(v ?? "0"); return s.startsWith("0x") ? Number(BigInt(s)) : Number(s); };

/**
 * Buy `token` with `bnb` BNB from wallet `a`, through Bitget Wallet. The coins go to the same wallet.
 * Returns what arrived (from the wallet's balance before and after), like the other buy routes.
 */
export async function bitgetBuy(a: PrivateKeyAccount, token: string, bnb: number, slipPct: number): Promise<{ raw: bigint; decimals: number; hash: string; slip: number }> {
  return bitgetEvmBuy(a, "bnb", { contract: "", symbol: "BNB", amount: bnb }, token, slipPct);
}

// ------------------------------------------------------------------ every EVM network Bitget swaps on

export type BgEvm = "bnb" | "eth" | "base" | "arbitrum" | "matic";
const EVM: Record<BgEvm, { id: number; chain: any; rpcs: string[] }> = {
  bnb: { id: 56, chain: bsc, rpcs: RPCS },
  eth: { id: 1, chain: mainnet, rpcs: [process.env.SNIPER_ETH_RPC, "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://eth.llamarpc.com"].filter(Boolean) as string[] },
  base: { id: 8453, chain: base, rpcs: [process.env.NEXT_PUBLIC_BASE_RPC, "https://mainnet.base.org", "https://base-rpc.publicnode.com"].filter(Boolean) as string[] },
  arbitrum: { id: 42161, chain: arbitrum, rpcs: [process.env.NEXT_PUBLIC_ARBITRUM_RPC, "https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"].filter(Boolean) as string[] },
  matic: { id: 137, chain: polygon, rpcs: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"] },
};
/** The Hub's network names (Wallet / Sniper) → Bitget's. */
export const BG_CHAIN: Record<string, BgEvm | "sol"> = { bsc: "bnb", bnb: "bnb", ethereum: "eth", eth: "eth", base: "base", arbitrum: "arbitrum", polygon: "matic", matic: "matic", solana: "sol", sol: "sol" };
const clients: Partial<Record<BgEvm, any>> = { bnb: undefined };
const pcOf = (k: BgEvm) => (k === "bnb" ? pc() : (clients[k] ||= createPublicClient({ chain: EVM[k].chain, transport: fallback(EVM[k].rpcs.map((u) => http(u, { timeout: 6000, retryCount: 0 })), { retryCount: 1 }) })));
const ALLOW = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address", name: "o" }, { type: "address", name: "s" }], outputs: [{ type: "uint256", name: "" }] }] as const;
const APPROVE = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address", name: "s" }, { type: "uint256", name: "v" }], outputs: [{ type: "bool", name: "" }] }] as const;
const human = (v: number, d = 8) => v.toFixed(d).replace(/0+$/, "").replace(/\.$/, "");

/** Coins Bitget just said it has no route for: skipped for a little while, so a waiting snipe goes straight to the pool. */
const noRoute = new Map<string, number>();
const NO_ROUTE_MS = 20_000;
const quiet = (key: string) => Date.now() - (noRoute.get(key) || 0) < NO_ROUTE_MS;

/** Quote → confirm → makeOrder (signature-checked). Throws BitgetNotSent for anything before the order is out. */
async function bgOrder(chain: BgEvm | "sol", from: string, pay: { contract: string; symbol: string; amount: string }, token: string, slip: string) {
  const key = `${chain}:${token.toLowerCase()}`;
  if (quiet(key)) throw new BitgetNotSent("no route for this coin yet");
  const b = { fromChain: chain, fromSymbol: pay.symbol, fromContract: pay.contract, fromAmount: pay.amount, fromAddress: from, toChain: chain, toSymbol: "", toContract: token, toAddress: from };
  try {
    const q = await bgwCall("/swap-go/swapx/quote", { ...b, tab_type: "swap", publicKey: "", slippage: slip, requestId: String(Date.now()) });
    const best = (q?.quoteResults || [])[0];
    if (!best?.market?.id) { noRoute.set(key, Date.now()); throw new Error("Bitget Wallet has no route for this coin yet"); }
    const market = best.market.id, protocol = best.market.protocol || best.protocol || "";
    const cf = await bgwCall("/swap-go/swapx/confirm", {
      ...b, market, protocol, slippage: slip, recommendSlippage: slip, gasLevel: "fast", features: ["user_gas"], lastOutAmount: String(best.outAmount || ""),
      mevProtection: { chain, mevFee: "0", amountMin: pay.amount, mevTarget: true, mode: "smart" },
    });
    if (!cf?.orderId) throw new Error("Bitget Wallet didn't give an order");
    const order = await bgwCall("/swap-go/swapx/makeOrder", { orderId: cf.orderId, ...b, slippage: slip, market, protocol, source: "agent" }, true);
    if (!order?.txs?.length) throw new Error("Bitget Wallet's order had nothing to sign");
    return order;
  } catch (e) {
    if (e instanceof BitgetNotSent) throw e;
    throw new BitgetNotSent((e as Error).message);
  }
}

/** Waits for Bitget's order to finish; returns the transaction hash. */
async function bgWait(orderId: string): Promise<string> {
  let hash = "";
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const st = await bgwCall("/swap-go/swapx/getOrderDetails", { orderId }).catch(() => null);
    const det = st?.details;
    if (det?.toTxId || det?.fromTxId) hash = det.toTxId || det.fromTxId;
    if (det?.status === "success") break;
    if (det?.status && /fail|refund|cancel/i.test(det.status)) throw new Error(`Bitget Wallet's swap ${det.status}${st?.tips ? `: ${st.tips}` : ""}`);
  }
  if (!hash) throw new Error("Bitget Wallet took the order but hasn't confirmed it yet. Check the wallet on the explorer before buying again.");
  return hash;
}

/**
 * Buy `token` on an EVM network through Bitget Wallet, paying with the chain's own coin (contract "") or a token such
 * as USDT. The wallet's key signs here; Bitget sends it; the coins land in the same wallet. A token payment gets
 * approved for Bitget's swap contract first if it isn't already (that approval is not a buy, so it's still safe to
 * fall back after it).
 */
export async function bitgetEvmBuy(a: PrivateKeyAccount, chain: BgEvm, pay: { contract: string; symbol: string; amount: number }, token: string, slipPct: number): Promise<{ raw: bigint; decimals: number; hash: string; slip: number }> {
  const cfg = EVM[chain], c = pcOf(chain), from = a.address;
  const amount = human(pay.amount, pay.contract ? 6 : 8), slip = String(Math.min(49, Math.max(0.5, slipPct)));
  const [before, dec] = await Promise.all([
    c.readContract({ address: token as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [from] }).catch(() => 0n) as Promise<bigint>,
    c.readContract({ address: token as `0x${string}`, abi: ERC20, functionName: "decimals" }).then(Number).catch(() => 18),
  ]);
  const order = await bgOrder(chain, from, { contract: pay.contract, symbol: pay.symbol, amount }, token, slip);
  try {
    const parsed = order.txs.map((t: any) => {
      const d = t.deriveTransaction || (typeof t.data === "object" && t.data ? t.data : {});
      const cid = toNum(t.chainId || d.chainId || cfg.id);
      if (cid !== cfg.id) throw new Error("Bitget Wallet's order was for another network");
      if (t.function === "signTypeData" || t.msgs || d.msgs) throw new Error("Bitget Wallet asked for a signature type the bots don't use");
      const to = String(t.to || d.to || ""), data = String(typeof t.data === "string" ? t.data : d.calldata || d.data || "0x");
      if (!/^0x[0-9a-fA-F]{40}$/.test(to) || !/^0x[0-9a-fA-F]*$/.test(data)) throw new Error("Bitget Wallet's order looked wrong");
      return { t, d, to: to as `0x${string}`, data: data as `0x${string}`, value: toWei(d.value ?? t.value), approve: data.toLowerCase().startsWith("0x095ea7b3") };
    });
    for (const x of parsed) {
      if (pay.contract ? x.value > 10n ** 16n : x.value > toWei(amount) + 10n ** 15n) throw new Error("Bitget Wallet's order would spend more than the buy");
    }
    // Paying with a token and Bitget didn't include the approval: approve its swap contract once (max), then buy.
    if (pay.contract && !parsed.some((x: any) => x.approve)) {
      const swap = parsed[parsed.length - 1];
      const allow = BigInt(await c.readContract({ address: pay.contract as `0x${string}`, abi: ALLOW, functionName: "allowance", args: [from, swap.to] }).catch(() => 0n));
      const need = BigInt(Math.ceil(pay.amount * 10 ** 6)) * 10n ** 12n; // generous: covers 6- and 18-decimal dollar coins
      if (allow < need) {
        const nonce = await c.getTransactionCount({ address: from, blockTag: "pending" });
        const raw = await a.signTransaction({ chainId: cfg.id, to: pay.contract as `0x${string}`, data: encodeFunctionData({ abi: APPROVE, functionName: "approve", args: [swap.to, 2n ** 256n - 1n] }), value: 0n, type: "legacy", gas: 90_000n, gasPrice: await c.getGasPrice(), nonce });
        const h = await c.sendRawTransaction({ serializedTransaction: raw });
        const rc = await c.waitForTransactionReceipt({ hash: h, timeout: 90_000 });
        if (rc.status !== "success") throw new Error("the approval for Bitget Wallet failed");
      }
    }
    let nonce = await c.getTransactionCount({ address: from, blockTag: "pending" });
    const gp = await c.getGasPrice();
    for (const x of parsed) {
      const n = x.d.nonce != null && !Number.isNaN(toNum(x.d.nonce)) && toNum(x.d.nonce) >= nonce ? toNum(x.d.nonce) : nonce;
      const gas = BigInt(toNum(x.d.gasLimit ?? x.t.gasLimit) || 600_000);
      const tip = x.d.maxPriorityFeePerGas ?? x.t.maxPriorityFeePerGas, max = x.d.maxFeePerGas ?? x.t.maxFeePerGas;
      x.t.sig = max != null
        ? await a.signTransaction({ chainId: cfg.id, to: x.to, data: x.data, value: x.value, type: "eip1559", gas, maxFeePerGas: toGasPrice(max) || gp * 2n, maxPriorityFeePerGas: toGasPrice(tip) || gp / 10n, nonce: n })
        : await a.signTransaction({ chainId: cfg.id, to: x.to, data: x.data, value: x.value, type: "legacy", gas, gasPrice: toGasPrice(x.d.gasPrice ?? x.t.gasPrice) || gp, nonce: n });
      nonce = n + 1;
    }
  } catch (e) {
    throw new BitgetNotSent((e as Error).message);
  }
  // From here the order is out: never fall back to another route (it could buy twice).
  await bgwCall("/swap-go/swapx/send", { orderId: order.orderId, txs: order.txs });
  const hash = await bgWait(order.orderId);
  const after = await c.readContract({ address: token as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [from] }).catch(() => before) as bigint;
  return { raw: after > before ? after - before : 0n, decimals: dec, hash, slip: Number(slip) };
}

// ------------------------------------------------------------------ Solana

const B58A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s: string): Buffer {
  let n = 0n;
  for (const ch of s) { const i = B58A.indexOf(ch); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0); }
  return Buffer.from(out);
}
/** Bitget's unsigned Solana transaction, wherever it sits in the order (base58 for v0, base64 for v1), as bytes. */
export function bgSolTx(t: any): Buffer | null {
  const seen = new Set<any>();
  const hits: { v: string; enc?: string }[] = [];
  const walk = (o: any, enc?: string, depth = 0) => {
    if (!o || depth > 6 || seen.has(o)) return;
    if (typeof o === "string") { if (o.length > 150) hits.push({ v: o, enc }); return; }
    if (typeof o !== "object") return;
    seen.add(o);
    const e = typeof o.encoding === "string" ? o.encoding.toLowerCase() : enc;
    for (const k of ["serializedTx", "serializedTransaction", "tx", "transaction", "rawTx", "data"]) if (typeof o[k] === "string") walk(o[k], e, depth + 1);
    for (const v of Object.values(o)) walk(v, e, depth + 1);
  };
  walk(t);
  for (const h of hits) {
    const s = h.v.trim();
    try {
      if (h.enc === "base64" || (!h.enc && /[+/=]/.test(s) && /^[A-Za-z0-9+/=]+$/.test(s))) { const b = Buffer.from(s, "base64"); if (b.length > 100) return b; }
      else if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) { const b = b58decode(s); if (b.length > 100) return b; }
      else if (/^[A-Za-z0-9+/=]+$/.test(s)) { const b = Buffer.from(s, "base64"); if (b.length > 100) return b; }
    } catch { /* next */ }
  }
  return null;
}

const SOL_RPC = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC || "https://solana-rpc.publicnode.com";
async function splBalance(conn: Connection, owner: PublicKey, mint: string): Promise<{ raw: bigint; decimals: number }> {
  const r = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) }).catch(() => null);
  let raw = 0n, decimals = 6;
  for (const a of r?.value || []) { const ta = (a.account.data as any)?.parsed?.info?.tokenAmount; if (ta) { raw += BigInt(ta.amount || "0"); decimals = Number(ta.decimals ?? decimals); } }
  return { raw, decimals };
}

/**
 * Buy SPL token `mint` through Bitget Wallet, paying with SOL (mint "") or a token such as USDT. The keypair signs
 * here and the Hub's Solana node sends it; the coins land in the same wallet.
 */
export async function bitgetSolBuy(kp: Keypair, pay: { mint: string; symbol: string; amount: number }, mint: string, slipPct: number): Promise<{ raw: bigint; decimals: number; hash: string; slip: number }> {
  const conn = new Connection(SOL_RPC, "confirmed");
  const owner = kp.publicKey, from = owner.toBase58();
  const slip = String(Math.min(49, Math.max(0.5, slipPct)));
  const amount = human(pay.amount, pay.mint ? 6 : 9);
  const before = await splBalance(conn, owner, mint);
  const order = await bgOrder("sol", from, { contract: pay.mint, symbol: pay.symbol, amount }, mint, slip);
  let raws: Uint8Array[];
  try {
    raws = order.txs.map((t: any) => {
      const bytes = bgSolTx(t);
      if (!bytes) throw new Error("Bitget Wallet's Solana order had no transaction");
      const tx = VersionedTransaction.deserialize(bytes);
      const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
      if (!signers.length || !signers[0].equals(owner) || signers.length > 1) throw new Error("Bitget Wallet's Solana order needs another signer");
      tx.sign([kp]);
      return tx.serialize();
    });
  } catch (e) {
    throw new BitgetNotSent((e as Error).message);
  }
  // Sent from here on: never fall back (it could buy twice).
  let hash = "";
  for (const raw of raws) {
    hash = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 });
    let done = false;
    for (let i = 0; i < 30 && !done; i++) {
      await sleep(1500);
      const st = (await conn.getSignatureStatuses([hash]).catch(() => null))?.value?.[0];
      if (st?.err) throw new Error(`Bitget Wallet's Solana swap failed on-chain: https://solscan.io/tx/${hash}`);
      if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") done = true;
    }
    if (!done) throw new Error(`The Solana swap was sent but isn't confirmed yet: https://solscan.io/tx/${hash}. Check it before buying again.`);
  }
  const after = await splBalance(conn, owner, mint);
  return { raw: after.raw > before.raw ? after.raw - before.raw : 0n, decimals: after.decimals || before.decimals, hash, slip: Number(slip) };
}
