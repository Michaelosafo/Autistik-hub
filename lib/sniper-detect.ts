/**
 * Which chain a pasted snipe address lives on. Solana mints are base58. An 0x address is checked on
 * BNB Chain, Ethereum, Base and Arbitrum: a contract (eth_getCode) and a DexScreener pool, if one exists yet.
 * A token can be armed before its pool exists. When it is a contract on more than one chain, the caller picks.
 */
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import { WCHAINS, type WChainKey } from "@/lib/wallet-chains";

export const SNIPE_CHAINS = ["bsc", "ethereum", "base", "arbitrum", "solana"] as const;
export type SnipeChain = (typeof SNIPE_CHAINS)[number];

const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOKEN_PROG = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
const DEX: Record<string, SnipeChain> = { bsc: "bsc", ethereum: "ethereum", base: "base", arbitrum: "arbitrum", solana: "solana" };
const API = process.env.DEXSCREENER_API || "https://api.dexscreener.com";
const SOL_RPC = process.env.SNIPER_SOLANA_RPC || process.env.WALLET_SOLANA_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC || "https://solana-rpc.publicnode.com";

export type ChainHit = { id: SnipeChain; name: string; symbol: string; hasCode: boolean; hasPool: boolean; liquidityUsd: number };

async function pools(addr: string): Promise<Map<SnipeChain, number>> {
  const out = new Map<SnipeChain, number>();
  try {
    const r = await fetch(`${API}/latest/dex/tokens/${addr}`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    const pairs: any[] = r.ok ? ((await r.json())?.pairs ?? []) : [];
    for (const p of pairs) {
      const id = DEX[String(p?.chainId || "")];
      if (!id) continue;
      const base = String(p?.baseToken?.address || "");
      if (id === "solana" ? base !== addr : base.toLowerCase() !== addr.toLowerCase()) continue;
      out.set(id, (out.get(id) || 0) + (Number(p?.liquidity?.usd) || 0));
    }
  } catch { /* no pool yet is normal before launch */ }
  return out;
}

export async function detectSnipe(raw: string): Promise<{ kind: "evm" | "solana" | "unknown"; normalized: string; hits: ChainHit[]; suggested: SnipeChain | null }> {
  const a = raw.trim().match(/0x[0-9a-fA-F]{40}/)?.[0] || raw.trim();
  if (isAddress(a, { strict: false })) {
    const addr = getAddress(a);
    const liq = await pools(addr);
    const code = await Promise.all((["bsc", "ethereum", "base", "arbitrum"] as const).map(async (id) => {
      const c = WCHAINS[id];
      try {
        const pc = createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 5000 }) });
        const hex = await pc.getBytecode({ address: addr });
        return hex && hex !== "0x" ? id : null;
      } catch { return null; }
    }));
    const ids = new Set<SnipeChain>([...code.filter(Boolean) as SnipeChain[], ...liq.keys()]);
    const hits = [...ids].map((id) => ({
      id, name: WCHAINS[id].name, symbol: WCHAINS[id].native.symbol,
      hasCode: code.some((c) => c === id), hasPool: liq.has(id), liquidityUsd: liq.get(id) || 0,
    }));
    const suggested = [...hits].sort((x, y) => (y.hasPool ? y.liquidityUsd : -1) - (x.hasPool ? x.liquidityUsd : -1) || Number(y.hasCode) - Number(x.hasCode))[0]?.id ?? null;
    return { kind: "evm", normalized: addr, hits, suggested };
  }
  if (SOL.test(a) && !a.startsWith("0x")) {
    let hasCode = false;
    try {
      const info = await new Connection(SOL_RPC, "confirmed").getAccountInfo(new PublicKey(a));
      hasCode = !!info && TOKEN_PROG.has(info.owner.toBase58());
    } catch { /* mint may not exist yet */ }
    const liq = await pools(a);
    const hit: ChainHit = { id: "solana", name: "Solana", symbol: "SOL", hasCode, hasPool: liq.has("solana"), liquidityUsd: liq.get("solana") || 0 };
    return { kind: "solana", normalized: a, hits: [hit], suggested: "solana" };
  }
  return { kind: "unknown", normalized: a, hits: [], suggested: null };
}

export const isSnipeChain = (c: string): c is SnipeChain => (SNIPE_CHAINS as readonly string[]).includes(c);
export const chainMeta = (id: SnipeChain) => WCHAINS[id as WChainKey];

/** The ⚡ Sniper is BNB Chain only: an 0x token checked on BNB Chain (contract and/or PancakeSwap pool). */
export async function detectSnipeBsc(raw: string): Promise<{ kind: "evm" | "unknown"; normalized: string; hits: ChainHit[]; suggested: SnipeChain | null }> {
  const a = raw.trim().match(/0x[0-9a-fA-F]{40}/)?.[0] || "";
  if (!a || !isAddress(a, { strict: false })) return { kind: "unknown", normalized: raw.trim(), hits: [], suggested: null };
  const addr = getAddress(a);
  const c = WCHAINS.bsc;
  const [liq, hasCode] = await Promise.all([
    pools(addr),
    (async () => {
      try {
        const hex = await createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 5000 }) }).getBytecode({ address: addr });
        return !!hex && hex !== "0x";
      } catch { return false; }
    })(),
  ]);
  if (!hasCode && !liq.has("bsc")) return { kind: "evm", normalized: addr, hits: [], suggested: null };
  const hit: ChainHit = { id: "bsc", name: c.name, symbol: c.native.symbol, hasCode, hasPool: liq.has("bsc"), liquidityUsd: liq.get("bsc") || 0 };
  return { kind: "evm", normalized: addr, hits: [hit], suggested: "bsc" };
}
