import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
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

/** Tokens this wallet holds that Hyperfocus already races (from the tracked holder lists). */
async function racedTokens(owner: string, sol: boolean) {
  try {
    const q = supabaseServer().from("token_holders").select("chain,token").gt("balance", 0).limit(60);
    const { data } = await (sol ? q.eq("wallet", owner) : q.ilike("wallet", owner));
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
    if (ch && ch !== "solana" && ch !== "robinhood") return out({ kind: "token", chain: ch, token: getAddress(q) });
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
  const holdings = lists.flat().sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  const total = holdings.reduce((s, h) => s + (h.valueUsd || 0), 0);
  return out({ kind: "wallet", address: owner, chains: keys, total, holdings });
}
