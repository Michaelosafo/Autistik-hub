import { NextResponse } from "next/server";
import { createPublicClient, erc20Abi, getAddress, http, isAddress } from "viem";
import { detectChain } from "@/lib/analytics-detect";
import { rateLimit } from "@/lib/ratelimit";
import { supabaseServer } from "@/lib/supabase/server";
import { WCHAINS, isNative, type WChainKey } from "@/lib/wallet-chains";
import { balances } from "@/lib/wallet-server";

// Hyperfocus GP scanner: paste any address. A token opens its race and holder breakdown; a wallet shows what it holds
// (public blockchain reads, no sign-in). Nothing here can move money. Not financial advice.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOL_RPC = process.env.WALLET_SOLANA_RPC || process.env.ANALYTICS_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const out = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { "Cache-Control": status === 200 ? "private, max-age=20" : "no-store" } });

/** True when a Solana address is a token mint rather than a wallet. */
async function isSolMint(a: string) {
  try {
    const r = await fetch(SOL_RPC, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(6000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [a, { encoding: "jsonParsed" }] }) });
    const j = await r.json();
    return j?.result?.value?.data?.parsed?.type === "mint";
  } catch { return false; }
}

/** True when an EVM address is an ERC-20 token. Smart-contract wallets (Safe, EIP-7702 accounts) have code too, but no token supply. */
async function isErc20(ch: WChainKey, a: `0x${string}`) {
  try {
    const c = WCHAINS[ch];
    const pc: any = createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 5000 }) });
    const [d, sup] = await Promise.all([
      pc.readContract({ address: a, abi: erc20Abi, functionName: "decimals" }),
      pc.readContract({ address: a, abi: erc20Abi, functionName: "totalSupply" }),
    ]);
    return d != null && sup != null;
  } catch { return false; }
}

/** Tokens this wallet holds that Hyperfocus already races (from the tracked holder lists). */
async function racedTokens(owner: string, sol: boolean) {
  try {
    const base = supabaseServer().from("token_holders").select("chain,token").gt("balance", 0);
    const { data } = await (sol ? base.eq("wallet", owner) : base.ilike("wallet", owner)).limit(60);
    return (data || []) as { chain: string; token: string }[];
  } catch { return []; }
}

export async function GET(req: Request) {
  const limited = await rateLimit(req, "hf-lookup", 40, 60);
  if (limited) return limited;
  const q = String(new URL(req.url).searchParams.get("q") || "").trim();
  const sol = SOL.test(q) && !q.startsWith("0x");
  if (!sol && !isAddress(q, { strict: false })) return out({ error: "Paste a wallet or token address." }, 400);

  // A token? Open its race.
  if (sol ? await isSolMint(q) : false) return out({ kind: "token", chain: "solana", token: q });
  if (!sol) {
    const ch = await detectChain(q).catch(() => null);
    if (ch && ch !== "solana" && ch !== "robinhood" && await isErc20(ch as WChainKey, getAddress(q))) return out({ kind: "token", chain: ch, token: getAddress(q) });
  }

  // A wallet: what it holds, on every network we support.
  const owner = sol ? q : getAddress(q);
  const raced = await racedTokens(owner, sol);
  const keys: WChainKey[] = sol ? ["solana"] : ["bsc", "base", "ethereum"];
  const lists = await Promise.all(keys.map(async (k) => {
    const c = WCHAINS[k];
    const extra = raced.filter((r) => r.chain === k).map((r) => r.token);
    try {
      return (await balances(c, owner, extra)).filter((h) => h.amount > 0).map((h) => ({
        chain: k, chainName: c.name, address: h.address, symbol: h.symbol, name: h.name, logo: h.logo ?? null,
        amount: h.amount, priceUsd: h.priceUsd, valueUsd: h.valueUsd, native: isNative(c, h.address),
        raced: raced.some((r) => r.chain === k && r.token.toLowerCase() === h.address.toLowerCase()),
      }));
    } catch { return []; }
  }));
  const all = lists.flat().sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  const total = all.reduce((s, h) => s + (h.valueUsd || 0), 0);
  // Airdropped spam and dust: no price, or worth less than a cent. Kept only when Hyperfocus races that coin.
  const holdings = all.filter((h) => h.native || h.raced || (h.valueUsd ?? 0) >= 0.01).slice(0, 40);
  return out({ kind: "wallet", address: owner, chains: keys, total, holdings, hidden: all.length - holdings.length });
}
