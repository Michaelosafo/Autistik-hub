/**
 * Relay (relay.link): a second route finder next to LI.FI, often the cheapest for moving coins between networks.
 * Used by swap-by-message for routes that start on an EVM network (Relay's Solana-side transactions come in a
 * different shape). Relay's app fee (the chat fee) goes to the marketing wallet: it builds up as a USDC balance at
 * relay.link that the wallet's owner claims any time. Server only; nothing here holds keys or moves money.
 */
import { encodeFunctionData, erc20Abi, getAddress } from "viem";
import { SOLANA_ID, isXNative, type XChain } from "@/lib/bridge-chains";

const API = "https://api.relay.link";
const RELAY_SOLANA = 792703809;
const RELAY_SOL_NATIVE = "11111111111111111111111111111111";
const KEY = (process.env.RELAY_API_KEY || "").trim();
const HEADERS: Record<string, string> = { "content-type": "application/json", accept: "application/json", ...(KEY ? { "x-api-key": KEY } : {}) };
/** Relay only takes an app fee (and serves /quote/v2) with an API key from relay.link; without one, routes carry no fee. */
export const relayFeeOn = !!KEY;

const rid = (c: XChain) => (c.id === SOLANA_ID ? RELAY_SOLANA : c.id);
const cur = (c: XChain, a: string) => (isXNative(c, a) ? (c.kind === "solana" ? RELAY_SOL_NATIVE : "0x0000000000000000000000000000000000000000") : a);
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : null; };

/** One transaction for the member's wallet to send, in order. */
export type RelayTx = { kind: "approve" | "tx"; chainId: number; to: `0x${string}`; data: `0x${string}`; value: string };
export type RelayQuote = {
  requestId: string; txs: RelayTx[];
  toAmount: string; toAmountMin: string; fromUsd: number | null; toUsd: number | null;
  gasUsd: number | null; relayerUsd: number | null; appUsd: number | null; seconds: number | null;
  topupUsd: number | null; at: number;
};

/**
 * The route and the transactions to send. Every transaction is checked: on the right network, approvals only for the
 * coin being paid and never for more than the amount, and no more of the network's coin sent than the swap needs.
 */
export async function relayQuote(p: {
  from: XChain; to: XChain; fromToken: string; toToken: string; amount: bigint; user: string; recipient: string;
  slippageBps: number; feeBps: number; feeWallet: string | null; topupUsd?: number;
}): Promise<RelayQuote> {
  if (p.from.kind !== "evm") throw new Error("Relay: EVM networks only.");
  const body: Record<string, unknown> = {
    user: p.user, recipient: p.recipient, originChainId: rid(p.from), destinationChainId: rid(p.to),
    originCurrency: cur(p.from, p.fromToken), destinationCurrency: cur(p.to, p.toToken),
    amount: p.amount.toString(), tradeType: "EXACT_INPUT", slippageTolerance: String(p.slippageBps),
    ...(KEY ? { referrer: "autistik.io" } : {}), // keyless quotes are refused with a referrer
  };
  if (KEY && p.feeBps > 0 && p.feeWallet) body.appFees = [{ recipient: p.feeWallet, fee: String(p.feeBps) }];
  if (p.topupUsd && p.from.id !== p.to.id) { body.topupGas = true; body.topupGasAmount = String(Math.round(p.topupUsd * 1e6)); }
  const r = await fetch(`${API}/${KEY ? "quote/v2" : "quote"}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || !j?.steps) throw new Error(String(j?.message || "No Relay route.").slice(0, 150));

  const native = isXNative(p.from, p.fromToken);
  const txs: RelayTx[] = [];
  let requestId = "";
  for (const st of j.steps as any[]) {
    if (st.kind !== "transaction") throw new Error("Relay asked for a signature step; skipped.");
    for (const it of st.items || []) {
      const d = it.data || {};
      if (Number(d.chainId) !== p.from.id) throw new Error("Relay route on the wrong network.");
      const to = getAddress(d.to), data = String(d.data || "0x") as `0x${string}`, value = BigInt(d.value || 0);
      if (st.id === "approve") {
        // approve(spender, amount) on the coin being paid, for no more than the swap.
        if (native || to !== getAddress(p.fromToken) || !data.startsWith("0x095ea7b3")) throw new Error("Unexpected Relay approval. Stopped for your safety.");
        // Relay asks for an unlimited approval: rewrite it to exactly this swap's amount (nothing left lying around).
        const spender = getAddress("0x" + data.slice(34, 74));
        const exact = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, p.amount] });
        txs.push({ kind: "approve", chainId: p.from.id, to, data: exact, value: "0" });
      } else {
        // Exact input: the gas top-up comes out of the amount, never on top of it.
        if (value > (native ? p.amount : 0n)) throw new Error("Relay route asked for too much. Stopped for your safety.");
        txs.push({ kind: "tx", chainId: p.from.id, to, data, value: value.toString() });
      }
    }
    requestId = requestId || String(st.requestId || "");
  }
  if (!txs.some((t) => t.kind === "tx")) throw new Error("No Relay route.");

  const out = j.details?.currencyOut, inn = j.details?.currencyIn, f = j.fees || {};
  return {
    requestId: requestId || String(j.requestId || ""), txs,
    toAmount: String(out?.amount || "0"), toAmountMin: String(out?.minimumAmount || out?.amount || "0"),
    fromUsd: num(inn?.amountUsd), toUsd: num(out?.amountUsd),
    gasUsd: num(f.gas?.amountUsd), relayerUsd: num(f.relayer?.amountUsd), appUsd: num(f.app?.amountUsd),
    seconds: num(j.details?.timeEstimate), topupUsd: j.details?.currencyGasTopup ? num(j.details.currencyGasTopup.amountUsd) : null,
    at: Date.now(),
  };
}

/** Where a Relay transfer is: "pending" | "done" | "failed" | "refunded", and the arrival transaction. */
export async function relayStatus(requestId: string): Promise<{ status: "pending" | "done" | "failed" | "refunded"; receiveHash: string | null }> {
  const r = await fetch(`${API}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const j: any = await r.json().catch(() => null);
  const s = String(j?.status || "pending");
  const hashes: string[] = j?.txHashes || [];
  return { status: s === "success" ? "done" : s === "failure" ? "failed" : s === "refund" ? "refunded" : "pending", receiveHash: hashes[hashes.length - 1] || null };
}
