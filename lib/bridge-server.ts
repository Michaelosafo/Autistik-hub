/**
 * Swap across networks, server side: token lists, routes and transfer status from LI.FI.
 * Like the rest of the Wallet, the server never holds keys or money: it asks LI.FI for a route that pays out to the
 * address the member picked, checks the route goes through the LI.FI contract, and hands it to their wallet to sign.
 * Server only.
 */
import { createPublicClient, erc20Abi, getAddress, http } from "viem";
import { FEE_BPS, WCHAINS } from "@/lib/wallet-chains";
import { XCHAINS, XCHAIN_BY_KEY, isXAddress, isXNative, lifiDiamond, xNative, type XChain, type XQuote, type XToken } from "@/lib/bridge-chains";

const LIFI = process.env.LIFI_API || "https://li.quest/v1";
/**
 * The name LI.FI knows this site by. The 0.5% fee is only added once it is registered at portal.li.fi with the
 * treasury as fee wallet (LIFI_INTEGRATOR set); until then cross-network swaps carry no AUTISTIK fee.
 */
const INTEGRATOR = (process.env.LIFI_INTEGRATOR || "").trim();
const HEADERS: Record<string, string> = { accept: "application/json", ...(process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : {}) };
export const xFeeBps = INTEGRATOR ? FEE_BPS : 0;

const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
async function lifi(path: string, timeout = 12_000): Promise<any> {
  const r = await fetch(`${LIFI}${path}`, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(timeout) });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    // LI.FI's messages are plain English ("No available quotes for the requested transfer"); keep them short.
    const msg = String(j?.message || `HTTP ${r.status}`);
    throw new Error(/no available quotes|no routes?|not found/i.test(msg) ? "No route found for this swap. Try another coin or a bigger amount." : msg.slice(0, 150));
  }
  return j;
}

const tok = (t: any): XToken => ({ address: String(t.address), symbol: String(t.symbol || "?"), name: String(t.name || t.symbol || ""), decimals: num(t.decimals),
  logo: t.logoURI || null, priceUsd: t.priceUSD != null && isFinite(Number(t.priceUSD)) ? Number(t.priceUSD) : null });

// ---------------------------------------------------------------- Networks and tokens

let chainMeta: { at: number; logos: Record<number, string> } | null = null;
/** Network logos from LI.FI (cached for a day). The page falls back to a colored badge without them. */
export async function xChainLogos(): Promise<Record<number, string>> {
  if (chainMeta && Date.now() - chainMeta.at < 86_400_000) return chainMeta.logos;
  const j = await lifi("/chains?chainTypes=EVM,SVM").catch(() => null);
  const logos: Record<number, string> = {};
  for (const c of j?.chains || []) if (c?.id in XCHAINS && typeof c.logoURI === "string" && c.logoURI.startsWith("https://")) logos[c.id] = c.logoURI;
  if (j) chainMeta = { at: Date.now(), logos };
  return logos;
}

const lists = new Map<number, { at: number; tokens: XToken[] }>();
/** The coins people trade most: shown first when nothing is typed. */
const POPULAR = ["USDC", "USDT", "WETH", "ETH", "WBTC", "cbBTC", "BTCB", "DAI", "USDC.e", "USDT0", "USDe", "WBNB", "POL", "AVAX", "ARB", "OP", "LINK", "UNI", "JUP", "BONK", "WIF", "PEPE"];

async function tokenList(c: XChain): Promise<XToken[]> {
  const hit = lists.get(c.id);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.tokens;
  const j = await lifi(`/tokens?chains=${c.id}`, 15_000);
  const tokens = ((j?.tokens?.[c.id] || []) as any[]).map(tok).filter((t) => t.decimals >= 0 && t.decimals <= 36);
  lists.set(c.id, { at: Date.now(), tokens });
  return tokens;
}

/** Coins on a network: the chain's own coin, AUTISTIK and the popular ones first, or those matching a search. */
export async function xTokens(c: XChain, query: string): Promise<XToken[]> {
  const all = await tokenList(c).catch(() => [] as XToken[]);
  // The Wallet's starter coins (AUTISTIK on BNB Chain) even if LI.FI doesn't list them.
  const starters: XToken[] = c.wchain ? WCHAINS[c.wchain].tokens.map((t) => ({ ...t, logo: t.logo ?? null })) : [];
  const native = all.find((t) => isXNative(c, t.address)) || { address: xNative(c), symbol: c.native.symbol, name: c.native.symbol, decimals: c.native.decimals, logo: null, priceUsd: null };
  const seen = new Set<string>();
  const out: XToken[] = [];
  const add = (t: XToken) => { const k = t.address.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } };
  const q = query.trim().toLowerCase();
  if (!q) {
    add(native);
    for (const t of starters) add(all.find((x) => x.address.toLowerCase() === t.address.toLowerCase()) || t);
    for (const s of POPULAR) { const t = all.find((x) => x.symbol === s); if (t) add(t); }
    for (const t of all) { if (out.length >= 40) break; if (t.priceUsd) add(t); }
    return out.slice(0, 40);
  }
  const pool = [native, ...starters, ...all];
  const exact = pool.filter((t) => t.address.toLowerCase() === q || t.symbol.toLowerCase() === q);
  const starts = pool.filter((t) => t.symbol.toLowerCase().startsWith(q));
  const has = pool.filter((t) => t.name.toLowerCase().includes(q));
  [...exact, ...starts, ...has].forEach(add);
  if (!out.length && /^0x[0-9a-f]{40}$|^[1-9a-hj-np-z]{32,44}$/i.test(query.trim())) {
    const one = await lifi(`/token?chain=${c.id}&token=${encodeURIComponent(query.trim())}`).catch(() => null);
    if (one?.address) add(tok(one));
  }
  return out.slice(0, 40);
}

// ---------------------------------------------------------------- Routes

const sum = (list: any[] | undefined, pick: (x: any) => boolean = () => true) => {
  const v = (list || []).filter(pick).reduce((s, x) => s + num(x?.amountUSD), 0);
  return v > 0 ? v : null;
};
const same = (a: unknown, b: string, c: XChain) => c.kind === "solana" ? String(a) === b : String(a).toLowerCase() === b.toLowerCase();

/**
 * The best route from one coin on one network to another coin on another (or the same) network, ready to sign.
 * Every answer is checked: right networks, right coins, right amount, paying out to `toAddress`, and (EVM) only
 * through the LI.FI contract.
 */
export async function xQuote(p: { from: XChain; to: XChain; fromToken: string; toToken: string; amount: bigint; fromAddress: string; toAddress: string; slippageBps: number }): Promise<XQuote> {
  const q = new URLSearchParams({
    fromChain: String(p.from.id), toChain: String(p.to.id), fromToken: p.fromToken, toToken: p.toToken, fromAmount: p.amount.toString(),
    fromAddress: p.fromAddress, toAddress: p.toAddress, slippage: String(p.slippageBps / 10_000), integrator: INTEGRATOR || "autistik-hub",
  });
  if (xFeeBps) q.set("fee", String(xFeeBps / 10_000));
  const j = await lifi(`/quote?${q}`, 20_000);
  const a = j?.action, e = j?.estimate, tx = j?.transactionRequest;
  if (!a || !e || !tx?.data) throw new Error("No route found for this swap. Try another coin or a bigger amount.");
  const ok = Number(a.fromChainId) === p.from.id && Number(a.toChainId) === p.to.id
    && same(a.fromToken?.address, p.fromToken, p.from) && same(a.toToken?.address, p.toToken, p.to)
    && String(a.fromAmount) === p.amount.toString()
    && same(a.fromAddress, p.fromAddress, p.from) && same(a.toAddress ?? p.toAddress, p.toAddress, p.to);
  if (!ok) throw new Error("The route didn't match your swap. Please try again.");

  let evm: XQuote["evm"] = null, sol: string | null = null;
  if (p.from.kind === "evm") {
    const diamond = getAddress(lifiDiamond(p.from.id));
    if (getAddress(tx.to) !== diamond || (tx.chainId != null && Number(tx.chainId) !== p.from.id)) throw new Error("Unexpected swap contract. Swap stopped for your safety.");
    const native = isXNative(p.from, p.fromToken);
    if (!native && e.approvalAddress && getAddress(e.approvalAddress) !== diamond) throw new Error("Unexpected swap contract. Swap stopped for your safety.");
    evm = { to: diamond, data: tx.data, value: BigInt(tx.value || 0).toString(), spender: native ? null : diamond };
  } else {
    if (typeof tx.data !== "string" || tx.data.length > 3000 || !/^[A-Za-z0-9+/=]+$/.test(tx.data)) throw new Error("Couldn't build the swap. Try again.");
    sol = tx.data;
  }

  const steps = ((j.includedSteps || []) as any[]).map((s) => ({ kind: String(s.type || "swap"), name: String(s.toolDetails?.name || s.tool || ""), logo: s.toolDetails?.logoURI || null }));
  return {
    fromChain: p.from.id, toChain: p.to.id, fromToken: p.fromToken, toToken: p.toToken, fromAddress: p.fromAddress, toAddress: p.toAddress,
    fromAmount: p.amount.toString(), toAmount: String(e.toAmount), toAmountMin: String(e.toAmountMin || e.toAmount),
    fromUsd: num(e.fromAmountUSD) || null, toUsd: num(e.toAmountUSD) || null,
    gasUsd: sum(e.gasCosts), feeUsd: sum(e.feeCosts, (f) => !f?.included), feeBps: xFeeBps,
    seconds: num(e.executionDuration) || null,
    tool: String(j.tool || ""), toolName: String(j.toolDetails?.name || j.tool || "LI.FI"), toolLogo: j.toolDetails?.logoURI || null,
    steps, evm, sol, at: Date.now(),
  };
}

export type XStatus = { status: "pending" | "done" | "failed" | "refunded"; message: string | null; receiveHash: string | null; receiveAmount: string | null; link: string | null };

/** Where a cross-network transfer is: still on its way, arrived, or failed (and refunded). */
export async function xStatus(txHash: string, fromChain: number, toChain: number, tool: string): Promise<XStatus> {
  const q = new URLSearchParams({ txHash, fromChain: String(fromChain), toChain: String(toChain) });
  if (/^[a-z0-9-]{1,40}$/i.test(tool)) q.set("bridge", tool);
  const j = await lifi(`/status?${q}`).catch(() => null);
  const s = String(j?.status || "PENDING");
  const sub = String(j?.substatus || "");
  return {
    status: s === "DONE" ? (sub === "REFUNDED" ? "refunded" : "done") : s === "FAILED" || s === "INVALID" ? "failed" : "pending",
    message: j?.substatusMessage ? String(j.substatusMessage).slice(0, 200) : null,
    receiveHash: j?.receiving?.txHash || null, receiveAmount: j?.receiving?.amount ? String(j.receiving.amount) : null,
    link: typeof j?.lifiExplorerLink === "string" && j.lifiExplorerLink.startsWith("https://") ? j.lifiExplorerLink : null,
  };
}

// ---------------------------------------------------------------- Which network is a pasted address on?

const DEX_API = process.env.DEXSCREENER_API || "https://api.dexscreener.com";
/** DexScreener's names where they differ from ours. */
const DEX_ALIAS: Record<string, string> = { gnosischain: "gnosis", seiv2: "sei", flowevm: "flow", hyperliquid: "hyperevm", zksyncera: "zksync", apechain: "apechain" };
/** Busiest networks first, for the contract check when no pool exists yet. */
const CODE_ORDER = ["bsc", "base", "ethereum", "arbitrum", "polygon", "optimism", "avalanche", "sonic", "hyperevm", "unichain", "linea", "berachain", "blast", "monad"];

/**
 * The network a pasted coin address lives on, and the coin itself, so nobody has to pick a network first.
 * Solana addresses look different from 0x ones. For 0x addresses: DexScreener's pools (the network with the most
 * liquidity wins), then the networks' own nodes (the first where that address is a contract).
 */
export async function xDetect(raw: string): Promise<{ chain: number; token: XToken } | null> {
  const a = raw.trim();
  const sol = XCHAIN_BY_KEY.solana;
  if (!a.startsWith("0x") && isXAddress(sol, a)) {
    const list = await xTokens(sol, a).catch(() => []);
    const t = list.find((x) => x.address === a);
    return t ? { chain: sol.id, token: t } : null;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return null;
  const addr = getAddress(a);
  let found: XChain | null = null;
  let hint: Partial<XToken> = {};
  try {
    const r = await fetch(`${DEX_API}/latest/dex/tokens/${addr}`, { signal: AbortSignal.timeout(6000), next: { revalidate: 300 } } as any);
    const pairs: any[] = r.ok ? ((await r.json())?.pairs ?? []) : [];
    const liq = new Map<string, number>();
    for (const p of pairs) {
      if (String(p?.baseToken?.address || "").toLowerCase() !== addr.toLowerCase()) continue;
      const key = DEX_ALIAS[p?.chainId] || p?.chainId;
      if (!XCHAIN_BY_KEY[key]) continue;
      liq.set(key, (liq.get(key) || 0) + num(p?.liquidity?.usd));
      if (!hint.symbol) hint = { symbol: p.baseToken.symbol, name: p.baseToken.name, logo: p.info?.imageUrl || null, priceUsd: num(p.priceUsd) || null };
    }
    const best = [...liq].sort((x, y) => y[1] - x[1])[0];
    if (best) found = XCHAIN_BY_KEY[best[0]];
  } catch { /* fall through to the contract check */ }
  if (!found) {
    const hits = await Promise.all(CODE_ORDER.map(async (k) => {
      const c = XCHAIN_BY_KEY[k];
      try {
        const code = await (createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 4000 }) }) as any).getCode({ address: addr });
        return code && code !== "0x" ? c : null;
      } catch { return null; }
    }));
    found = hits.find(Boolean) ?? null;
  }
  if (!found) return null;
  // Name and decimals from the token itself: decimals must be right, or amounts would be wrong.
  const read = (functionName: "name" | "symbol" | "decimals") => ({ address: addr, abi: erc20Abi, functionName } as const);
  const pc: any = createPublicClient({ chain: found.viem, transport: http(found.rpc, { timeout: 6000 }) });
  const res = await pc
    .multicall({ contracts: [read("name"), read("symbol"), read("decimals")], allowFailure: true }).catch(() => null);
  if (!res || res[2].status !== "success") return null;
  return { chain: found.id, token: { address: addr, symbol: String(res[1].result ?? hint.symbol ?? "?"), name: String(res[0].result ?? hint.name ?? ""), decimals: Number(res[2].result), logo: hint.logo ?? null, priceUsd: hint.priceUsd ?? null } };
}
