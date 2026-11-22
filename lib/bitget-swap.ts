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
import { createPublicClient, fallback, formatEther, http, type PrivateKeyAccount } from "viem";
import { bsc } from "viem/chains";

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

async function call(path: string, body: object, checked = false): Promise<any> {
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
  const from = a.address, amount = bnb.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  const slip = String(Math.min(49, Math.max(0.5, slipPct)));
  const c = pc();
  const [before, dec] = await Promise.all([
    c.readContract({ address: token as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [from] }).catch(() => 0n) as Promise<bigint>,
    c.readContract({ address: token as `0x${string}`, abi: ERC20, functionName: "decimals" }).then(Number).catch(() => 18),
  ]);
  const base = { fromChain: "bnb", fromSymbol: "BNB", fromContract: "", fromAmount: amount, fromAddress: from, toChain: "bnb", toSymbol: "", toContract: token, toAddress: from };
  let order: any;
  try {
    const q = await call("/swap-go/swapx/quote", { ...base, tab_type: "swap", publicKey: "", slippage: slip, requestId: String(Date.now()) });
    const best = (q?.quoteResults || [])[0];
    if (!best?.market?.id) throw new Error("Bitget Wallet has no route for this coin yet");
    const market = best.market.id, protocol = best.market.protocol || best.protocol || "";
    const cf = await call("/swap-go/swapx/confirm", {
      ...base, market, protocol, slippage: slip, recommendSlippage: slip, gasLevel: "fast", features: ["user_gas"], lastOutAmount: String(best.outAmount || ""),
      mevProtection: { chain: "bnb", mevFee: "0", amountMin: amount, mevTarget: true, mode: "smart" },
    });
    if (!cf?.orderId) throw new Error("Bitget Wallet didn't give an order");
    order = await call("/swap-go/swapx/makeOrder", { orderId: cf.orderId, ...base, slippage: slip, market, protocol, source: "agent" }, true);
    if (!order?.txs?.length) throw new Error("Bitget Wallet's order had nothing to sign");
    // Sign each transaction with this wallet's key. Only plain transactions from this wallet on BNB Chain are signed.
    for (const t of order.txs) {
      const d = t.deriveTransaction || (typeof t.data === "object" ? t.data : {});
      const cid = toNum(t.chainId || d.chainId || 56);
      if (cid !== 56) throw new Error("Bitget Wallet's order wasn't for BNB Chain");
      if (t.function === "signTypeData" || t.msgs || d.msgs) throw new Error("Bitget Wallet asked for a signature type Copy doesn't use");
      const to = (t.to || d.to) as `0x${string}`, data = (typeof t.data === "string" ? t.data : d.calldata || d.data) as `0x${string}`;
      if (!/^0x[0-9a-fA-F]{40}$/.test(String(to)) || !/^0x[0-9a-fA-F]*$/.test(String(data))) throw new Error("Bitget Wallet's order looked wrong");
      const value = toWei(d.value ?? t.value);
      if (value > toWei(amount) + 10n ** 15n) throw new Error("Bitget Wallet's order would spend more BNB than the buy");
      t.sig = await a.signTransaction({
        chainId: 56, to, data, value, type: "legacy",
        gas: BigInt(toNum(d.gasLimit ?? t.gasLimit) || 600_000),
        gasPrice: toGasPrice(d.gasPrice ?? t.gasPrice) || (await c.getGasPrice()),
        nonce: d.nonce != null ? toNum(d.nonce) : await c.getTransactionCount({ address: from, blockTag: "pending" }),
      });
    }
  } catch (e) {
    throw new BitgetNotSent((e as Error).message);
  }
  // From here the order is out: never fall back to another route (it could buy twice).
  await call("/swap-go/swapx/send", { orderId: order.orderId, txs: order.txs });
  let hash = "";
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    const st = await call("/swap-go/swapx/getOrderDetails", { orderId: order.orderId }).catch(() => null);
    const det = st?.details;
    if (det?.toTxId || det?.fromTxId) hash = det.toTxId || det.fromTxId;
    if (det?.status === "success") break;
    if (det?.status && /fail|refund|cancel/i.test(det.status)) throw new Error(`Bitget Wallet's swap ${det.status}${st?.tips ? `: ${st.tips}` : ""}`);
  }
  if (!hash) throw new Error("Bitget Wallet took the order but hasn't confirmed it yet. Check this wallet on BscScan before buying again.");
  const after = await c.readContract({ address: token as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [from] }).catch(() => before) as bigint;
  return { raw: after > before ? after - before : 0n, decimals: dec, hash, slip: Number(slip) };
}

export const fmtBnb = (wei: bigint) => formatEther(wei);
