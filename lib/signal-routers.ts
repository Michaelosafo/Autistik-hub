/**
 * Signal's other routers (server only): LI.FI (swaps and bridges across chains, no API key) and OKX DEX (swaps on
 * one chain; needs OKX_API_KEY, OKX_SECRET_KEY, OKX_API_PASSPHRASE and OKX_PROJECT_ID in Vercel).
 *
 * Each returns ready-to-sign transactions for the owner's own wallet: on EVM chains a call to that router's contract
 * (plus who must be approved when paying with a token); on Solana a serialized transaction (base64). Coins go to the
 * receiving address the owner chose. No keys here.
 */
import { createHmac } from "crypto";

export type ChainKey = "bnb" | "eth" | "base" | "arbitrum" | "matic" | "sol";
export type Exec =
  | { kind: "evm"; chainId: number; tx: { to: string; data: string; value: string; gas?: string }; spender?: string }
  | { kind: "sol"; txB64: string };
export type RouterRoute = { router: "lifi" | "okx"; label: string; out: string; min: string; gasUsd: number | null; exec: Exec; track?: { fromChain: string; toChain: string } };

const EVM_ID: Record<Exclude<ChainKey, "sol">, number> = { bnb: 56, eth: 1, base: 8453, arbitrum: 42161, matic: 137 };
const LIFI_CHAIN = (c: ChainKey) => (c === "sol" ? "SOL" : String(EVM_ID[c]));
const OKX_CHAIN = (c: ChainKey) => (c === "sol" ? "501" : String(EVM_ID[c]));
const SOL_NATIVE = "11111111111111111111111111111111";
const lifiToken = (c: ChainKey, contract: string) => contract || (c === "sol" ? SOL_NATIVE : "0x0000000000000000000000000000000000000000");
const okxToken = (c: ChainKey, contract: string) => contract || (c === "sol" ? SOL_NATIVE : "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");

function toRaw(human: string, dec: number): string {
  const [i, f = ""] = human.trim().split(".");
  return (BigInt(i || "0") * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0")).toString();
}
function toHuman(raw: string | number | undefined, dec: number): string {
  const v = BigInt(String(raw ?? "0").split(".")[0] || "0"), d = 10n ** BigInt(dec);
  const frac = (v % d).toString().padStart(dec, "0").replace(/0+$/, "");
  return (v / d).toString() + (frac ? "." + frac.slice(0, 8) : "");
}
const hex = (v: unknown) => { const s = String(v ?? "0"); return s.startsWith("0x") ? s : "0x" + BigInt(s || "0").toString(16); };

const LIFI = "https://li.quest/v1";
const lifiH = (): Record<string, string> => (process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : {});
async function lifiGet(path: string, q: Record<string, string>) {
  const r = await fetch(`${LIFI}${path}?${new URLSearchParams(q)}`, { headers: lifiH(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`LI.FI: ${j?.message || `HTTP ${r.status}`}`);
  return j;
}
/** A token's decimals (LI.FI's token list covers every chain here). */
export async function decimalsOf(chain: ChainKey, contract: string): Promise<number> {
  const t = await lifiGet("/token", { chain: LIFI_CHAIN(chain), token: lifiToken(chain, contract) });
  const d = Number(t?.decimals);
  if (!Number.isFinite(d)) throw new Error("Couldn't read that token's decimals.");
  return d;
}

export type Req = { fromChain: ChainKey; fromContract: string; fromAmount: string; fromAddress: string; toChain: ChainKey; toContract: string; toAddress: string; slippage: number };

export async function lifiRoute(q: Req): Promise<RouterRoute> {
  const dec = await decimalsOf(q.fromChain, q.fromContract);
  const j = await lifiGet("/quote", {
    fromChain: LIFI_CHAIN(q.fromChain), toChain: LIFI_CHAIN(q.toChain),
    fromToken: lifiToken(q.fromChain, q.fromContract), toToken: lifiToken(q.toChain, q.toContract),
    fromAmount: toRaw(q.fromAmount, dec), fromAddress: q.fromAddress, toAddress: q.toAddress,
    slippage: String(q.slippage / 100), integrator: process.env.LIFI_INTEGRATOR || "autistik",
  });
  const tdec = Number(j?.action?.toToken?.decimals ?? 18), tr = j?.transactionRequest || {};
  const gasUsd = (j?.estimate?.gasCosts || []).reduce((a: number, g: any) => a + Number(g?.amountUSD || 0), 0);
  const label = `LI.FI · ${j?.toolDetails?.name || j?.tool || "best route"}`;
  const base = { router: "lifi" as const, label, out: toHuman(j?.estimate?.toAmount, tdec), min: toHuman(j?.estimate?.toAmountMin, tdec), gasUsd: gasUsd || null, track: { fromChain: LIFI_CHAIN(q.fromChain), toChain: LIFI_CHAIN(q.toChain) } };
  if (q.fromChain === "sol") {
    if (!tr.data) throw new Error("LI.FI gave no Solana transaction for this.");
    return { ...base, exec: { kind: "sol", txB64: String(tr.data) } };
  }
  if (!tr.to || !tr.data) throw new Error("LI.FI gave no transaction for this.");
  return { ...base, exec: { kind: "evm", chainId: EVM_ID[q.fromChain], tx: { to: tr.to, data: tr.data, value: hex(tr.value), gas: tr.gasLimit ? hex(tr.gasLimit) : undefined }, spender: q.fromContract ? j?.estimate?.approvalAddress || tr.to : undefined } };
}

/** LI.FI's view of a sent swap or bridge: pending, done or failed, and the arrival transaction. */
export async function lifiStatus(txHash: string, fromChain: string, toChain: string) {
  const j = await lifiGet("/status", { txHash, fromChain, toChain });
  const s = String(j?.status || "PENDING");
  return { status: s === "DONE" ? "success" : s === "FAILED" ? "failed" : "pending", toTx: j?.receiving?.txHash || null, tips: j?.substatusMessage || null };
}

// ---------------------------------------------------------------- OKX DEX (one chain)
const OKX = "https://web3.okx.com";
export const okxReady = () => !!(process.env.OKX_API_KEY && process.env.OKX_SECRET_KEY && process.env.OKX_API_PASSPHRASE && process.env.OKX_PROJECT_ID);
async function okxGet(path: string, q: Record<string, string>) {
  const qs = "?" + new URLSearchParams(q).toString(), ts = new Date().toISOString();
  const sign = createHmac("sha256", process.env.OKX_SECRET_KEY || "").update(ts + "GET" + path + qs).digest("base64");
  const r = await fetch(OKX + path + qs, {
    headers: { "OK-ACCESS-KEY": process.env.OKX_API_KEY || "", "OK-ACCESS-SIGN": sign, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": process.env.OKX_API_PASSPHRASE || "", "OK-ACCESS-PROJECT": process.env.OKX_PROJECT_ID || "" },
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || String(j?.code) !== "0") throw new Error(`OKX: ${j?.msg || `HTTP ${r.status}`}`);
  return j.data;
}

export async function okxRoute(q: Req): Promise<RouterRoute> {
  if (!okxReady()) throw new Error("OKX isn't set up: add OKX_API_KEY, OKX_SECRET_KEY, OKX_API_PASSPHRASE and OKX_PROJECT_ID in Vercel.");
  if (q.fromChain !== q.toChain) throw new Error("OKX here swaps on one network only. Use Bitget Wallet or LI.FI to bridge.");
  const dec = await decimalsOf(q.fromChain, q.fromContract);
  const amount = toRaw(q.fromAmount, dec), chainIndex = OKX_CHAIN(q.fromChain);
  const d = await okxGet("/api/v6/dex/aggregator/swap", {
    chainIndex, amount, fromTokenAddress: okxToken(q.fromChain, q.fromContract), toTokenAddress: okxToken(q.toChain, q.toContract),
    slippagePercent: String(q.slippage), userWalletAddress: q.fromAddress, swapReceiverAddress: q.toAddress,
  });
  const x = Array.isArray(d) ? d[0] : d, rr = x?.routerResult || {}, tx = x?.tx || {};
  const tdec = Number(rr?.toToken?.decimal ?? rr?.toToken?.decimals ?? 18);
  const out = toHuman(rr?.toTokenAmount, tdec);
  const minRaw = tx?.minReceiveAmount ?? rr?.toTokenAmount;
  const base = { router: "okx" as const, label: `OKX DEX${rr?.dexRouterList?.[0]?.dexProtocol?.dexName ? ` · ${rr.dexRouterList[0].dexProtocol.dexName}` : ""}`, out, min: toHuman(minRaw, tdec), gasUsd: null };
  if (q.fromChain === "sol") {
    // OKX gives Solana transactions in base58; the page wants base64.
    const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = 0n; for (const ch of String(tx?.data || "")) n = n * 58n + BigInt(B58.indexOf(ch));
    const bytes: number[] = []; while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
    for (const ch of String(tx?.data || "")) { if (ch !== "1") break; bytes.unshift(0); }
    if (!bytes.length) throw new Error("OKX gave no Solana transaction for this.");
    return { ...base, exec: { kind: "sol", txB64: Buffer.from(bytes).toString("base64") } };
  }
  if (!tx?.to || !tx?.data) throw new Error("OKX gave no transaction for this.");
  let spender: string | undefined;
  if (q.fromContract) {
    const a = await okxGet("/api/v6/dex/aggregator/approve-transaction", { chainIndex, tokenContractAddress: q.fromContract, approveAmount: amount });
    spender = (Array.isArray(a) ? a[0] : a)?.dexContractAddress;
    if (!spender) throw new Error("OKX didn't say which contract to approve.");
  }
  return { ...base, exec: { kind: "evm", chainId: EVM_ID[q.fromChain as Exclude<ChainKey, "sol">], tx: { to: tx.to, data: tx.data, value: hex(tx.value), gas: tx.gas ? hex(tx.gas) : undefined }, spender } };
}
