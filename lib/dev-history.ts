/**
 * Dev wallet scanner. Server only. For any wallet: the tokens it created before, how each one did (bonded / listed on
 * a DEX, still alive, or dead), and from that a score for how likely a new token from this dev is to bond and do well.
 *
 * Sources (read-only, nothing is signed):
 *  - EVM chains: Etherscan's multichain API (ETHERSCAN_API_KEY). Contracts the wallet deployed itself, plus tokens it
 *    created through a launchpad factory (e.g. four.meme on BNB Chain): every token the wallet ever received is
 *    checked for who created it.
 *  - Solana: pump.fun's public list of coins a wallet created (with whether each one bonded), plus Solana coins
 *    launched on AUTISTIK.
 *  - Every chain: coins launched on AUTISTIK by that wallet, and DexScreener for each token's pools, liquidity,
 *    market cap and volume.
 * Results are kept for 30 minutes (dev_scans) so popular devs don't cost an API call each view.
 */
import { getAddress, isAddress } from "viem";
import { supabaseService } from "@/lib/supabase/server";
import { ACHAINS, type AChain } from "@/lib/analytics";

const ETHERSCAN = "https://api.etherscan.io/v2/api";
const DEX = process.env.DEXSCREENER_API || "https://api.dexscreener.com";
const CHAIN_ID: Partial<Record<AChain, number>> = {
  bsc: 56, ethereum: 1, base: 8453, arbitrum: 42161, polygon: 137, optimism: 10, avalanche: 43114, linea: 59144,
  blast: 81457, sonic: 146, berachain: 80094, unichain: 130, abstract: 2741,
};
/** DEXs where a token counts as "bonded" (out of a launchpad's bonding curve, trading in a real pool). */
const CURVES = new Set(["fourmeme", "four.meme", "pumpfun", "pump.fun", "moonshot", "flap", "virtuals", "bonk", "letsbonk", "believe"]);
const DAY = 86_400_000;

export type DevToken = {
  token: string; name: string | null; symbol: string | null; logo: string | null; createdAt: string | null;
  status: "bonded" | "alive" | "curve" | "dead" | "unknown"; dex: string | null;
  liquidityUsd: number | null; marketCap: number | null; volume24h: number | null; change24h: number | null;
  launchedHere: boolean;
};
export type DevReport = {
  chain: AChain; wallet: string; tokens: DevToken[]; scannedAt: string;
  stats: { launched: number; bonded: number; alive: number; dead: number; last30d: number; bestCap: number | null; bestSymbol: string | null };
  score: number; label: "Strong" | "Mixed" | "Risky" | "New dev"; bondChance: number; summary: string; notes: string[];
  sources: string[]; limited?: string;
};

const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : null; };
async function getJson(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------- finding the dev's tokens

/** EVM: contracts the wallet created, directly or through a factory. */
async function evmCreated(chain: AChain, wallet: string): Promise<{ list: { token: string; at: string | null }[]; limited?: string }> {
  const key = process.env.ETHERSCAN_API_KEY, id = CHAIN_ID[chain];
  if (!key || !id) return { list: [], limited: `Dev history on ${ACHAINS[chain].name} needs the Etherscan key.` };
  const q = (params: Record<string, string>) => getJson(`${ETHERSCAN}?chainid=${id}&apikey=${key}&${new URLSearchParams(params)}`);
  const out = new Map<string, string | null>();
  const [txs, transfers] = await Promise.all([
    q({ module: "account", action: "txlist", address: wallet, sort: "desc", page: "1", offset: "1000" }).catch(() => null),
    q({ module: "account", action: "tokentx", address: wallet, sort: "asc", page: "1", offset: "1000" }).catch(() => null),
  ]);
  const bad = [txs, transfers].find((j) => j && j.status === "0" && /key|plan|chain|rate|limit/i.test(String(j.result || j.message)));
  if (bad && !Array.isArray(txs?.result) && !Array.isArray(transfers?.result)) return { list: [], limited: `The explorer didn't answer for ${ACHAINS[chain].name}: ${String(bad.result || bad.message).slice(0, 120)}` };
  for (const t of Array.isArray(txs?.result) ? txs.result : []) {
    if (!t.to && t.contractAddress && isAddress(t.contractAddress) && t.isError !== "1") out.set(getAddress(t.contractAddress), new Date(Number(t.timeStamp) * 1000).toISOString());
  }
  // Tokens made through a factory: the wallet usually receives some at the start. Check who created each one.
  const seen = new Map<string, string>();
  for (const t of Array.isArray(transfers?.result) ? transfers.result : []) {
    if (isAddress(t.contractAddress) && !seen.has(getAddress(t.contractAddress))) seen.set(getAddress(t.contractAddress), new Date(Number(t.timeStamp) * 1000).toISOString());
  }
  const cands = [...seen.keys()].filter((a) => !out.has(a)).slice(0, 150);
  for (let i = 0; i < cands.length; i += 5) {
    const j = await q({ module: "contract", action: "getcontractcreation", contractaddresses: cands.slice(i, i + 5).join(",") }).catch(() => null);
    for (const c of Array.isArray(j?.result) ? j.result : []) {
      if (String(c.contractCreator || "").toLowerCase() === wallet.toLowerCase() && isAddress(c.contractAddress)) {
        const a = getAddress(c.contractAddress);
        out.set(a, c.timestamp ? new Date(Number(c.timestamp) * 1000).toISOString() : seen.get(a) ?? null);
      }
    }
    if (i > 0 && i % 25 === 0) await new Promise((r) => setTimeout(r, 300)); // stay under the explorer's rate limit
  }
  return { list: [...out].map(([token, at]) => ({ token, at })) };
}

type PumpCoin = { mint: string; name?: string; symbol?: string; image_uri?: string; created_timestamp?: number; complete?: boolean; usd_market_cap?: number };
/** Solana: coins the wallet created on pump.fun (with whether each bonded). */
async function pumpCreated(wallet: string): Promise<PumpCoin[] | null> {
  for (const base of ["https://frontend-api-v3.pump.fun", "https://frontend-api.pump.fun"]) {
    try {
      const j = await getJson(`${base}/coins/user-created-coins/${wallet}?offset=0&limit=100&includeNsfw=true`, { headers: { accept: "application/json" } });
      const list = Array.isArray(j) ? j : Array.isArray(j?.coins) ? j.coins : null;
      if (list) return list;
    } catch { /* try the next one */ }
  }
  return null;
}

// ---------------------------------------------------------------- how each token did

async function dexInfo(chain: AChain, tokens: string[]) {
  const by = new Map<string, any[]>();
  for (let i = 0; i < tokens.length; i += 30) {
    const pairs: any[] = await getJson(`${DEX}/tokens/v1/${ACHAINS[chain].dex}/${tokens.slice(i, i + 30).join(",")}`).catch(() => []);
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const k = String(p?.baseToken?.address || "").toLowerCase();
      if (!k) continue;
      by.set(k, [...(by.get(k) ?? []), p]);
    }
  }
  return by;
}

function judge(pairs: any[] | undefined, createdAt: string | null, bondedFlag?: boolean): Pick<DevToken, "status" | "dex" | "liquidityUsd" | "marketCap" | "volume24h" | "change24h"> & { name?: string; symbol?: string; logo?: string } {
  const list = (pairs ?? []).slice().sort((a, b) => (num(b?.liquidity?.usd) ?? 0) - (num(a?.liquidity?.usd) ?? 0));
  const best = list[0];
  const liq = list.reduce((s, p) => s + (num(p?.liquidity?.usd) ?? 0), 0);
  const vol = list.reduce((s, p) => s + (num(p?.volume?.h24) ?? 0), 0);
  const cap = best ? num(best.marketCap) ?? num(best.fdv) : null;
  const realDex = list.find((p) => !CURVES.has(String(p?.dexId || "").toLowerCase()) && (num(p?.liquidity?.usd) ?? 0) >= 1_000);
  const age = createdAt ? Date.now() - Date.parse(createdAt) : null;
  const alive = (cap ?? 0) >= 30_000 && (vol >= 1_000 || liq >= 10_000);
  let status: DevToken["status"];
  if (bondedFlag === true || realDex) status = alive ? "alive" : liq < 500 && vol < 100 ? "dead" : "bonded";
  else if (!list.length) status = age != null && age > 3 * DAY ? "dead" : bondedFlag === false ? "curve" : "unknown";
  // Still on a launchpad curve: dead once it's a couple of days old with almost no trading.
  else status = age != null && age > 2 * DAY && vol < 100 ? "dead" : "curve";
  return {
    status, dex: realDex?.dexId ?? best?.dexId ?? null, liquidityUsd: list.length ? liq : null, marketCap: cap, volume24h: list.length ? vol : null,
    change24h: best ? num(best?.priceChange?.h24) : null,
    name: best?.baseToken?.name, symbol: best?.baseToken?.symbol, logo: list.map((p) => p?.info?.imageUrl).find((u) => typeof u === "string" && u.startsWith("https://")),
  };
}

// ---------------------------------------------------------------- the score

function score(tokens: DevToken[]) {
  const n = tokens.length;
  const bonded = tokens.filter((t) => t.status === "bonded" || t.status === "alive").length;
  const alive = tokens.filter((t) => t.status === "alive").length;
  const dead = tokens.filter((t) => t.status === "dead").length;
  const last30d = tokens.filter((t) => t.createdAt && Date.now() - Date.parse(t.createdAt) < 30 * DAY).length;
  const best = tokens.filter((t) => t.marketCap != null).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))[0];
  // Smoothed rates, so one lucky (or unlucky) token doesn't decide everything.
  const bondRate = (bonded + 1) / (n + 2), aliveRate = (alive + 0.5) / (n + 2), deadRate = (dead + 0.5) / (n + 2);
  let s = 100 * (0.5 * bondRate + 0.3 * aliveRate + 0.2 * (1 - deadRate));
  const notes: string[] = [];
  if (last30d > 30) { s -= 30; notes.push(`Launched ${last30d} tokens in the last 30 days: a serial launcher. Most tokens like these are quick flips.`); }
  else if (last30d > 10) { s -= 15; notes.push(`Launched ${last30d} tokens in the last 30 days, which is a lot.`); }
  if (n >= 3 && dead / n > 0.7) notes.push(`${dead} of ${n} earlier tokens are dead (almost no liquidity or trading).`);
  if (alive > 0) notes.push(`${alive} earlier token${alive > 1 ? "s are" : " is"} still trading well.`);
  if (best?.marketCap && best.marketCap >= 1_000_000) { s += 8; notes.push(`Best one: $${best.symbol ?? "?"} at about $${Math.round(best.marketCap / 1e6 * 10) / 10}M market cap.`); }
  s = Math.max(1, Math.min(99, Math.round(s)));
  const label: DevReport["label"] = n === 0 ? "New dev" : s >= 65 ? "Strong" : s >= 40 ? "Mixed" : "Risky";
  const bondChance = Math.round(bondRate * 100);
  const summary = n === 0 ? "No earlier tokens found for this wallet. A new dev: there's no track record to go on, so be extra careful."
    : label === "Strong" ? `Good track record: ${bonded} of ${n} tokens bonded or reached a real pool${alive ? `, ${alive} still doing well` : ""}.`
    : label === "Mixed" ? `Mixed track record: ${bonded} of ${n} tokens bonded, ${dead} died.`
    : `Weak track record: only ${bonded} of ${n} tokens bonded and ${dead} died.`;
  return { stats: { launched: n, bonded, alive, dead, last30d, bestCap: best?.marketCap ?? null, bestSymbol: best?.symbol ?? null }, score: n === 0 ? 30 : s, label, bondChance, summary, notes };
}

// ---------------------------------------------------------------- the report

export async function devReport(chain: AChain, walletIn: string, fresh = false): Promise<DevReport> {
  const sol = ACHAINS[chain].kind === "solana";
  const wallet = sol ? walletIn : getAddress(walletIn);
  const sb = supabaseService();
  if (!fresh) {
    const { data } = await sb.from("dev_scans").select("report,scanned_at").eq("chain", chain).eq("wallet", wallet).maybeSingle();
    if (data && Date.now() - Date.parse(data.scanned_at) < 30 * 60_000) return data.report as DevReport;
  }
  const sources: string[] = [];
  let limited: string | undefined;
  const found = new Map<string, { at: string | null; bonded?: boolean; name?: string; symbol?: string; logo?: string; here?: boolean }>();

  // Coins this wallet launched on AUTISTIK.
  const { data: ours } = await sb.from("launches").select("token,name,symbol,created_at").eq("chain", chain).eq("creator", wallet).limit(200);
  for (const l of ours || []) found.set(sol ? l.token : getAddress(l.token), { at: l.created_at, name: l.name, symbol: l.symbol, here: true });
  if (ours?.length) sources.push("AUTISTIK Launch Pad");

  if (sol) {
    const pump = await pumpCreated(wallet);
    if (pump) {
      sources.push("pump.fun");
      for (const c of pump) if (c.mint) found.set(c.mint, { ...found.get(c.mint), at: c.created_timestamp ? new Date(c.created_timestamp).toISOString() : null, bonded: !!c.complete, name: c.name, symbol: c.symbol, logo: c.image_uri });
    } else limited = "pump.fun didn't answer, so Solana history may be missing tokens.";
  } else {
    // BNB Chain: tokens this wallet created on four.meme (our own index of its launches), with whether each bonded.
    if (chain === "bsc") {
      const { data: fm } = await sb.from("fm_tokens").select("token,name,symbol,created_at,bonded_at").eq("creator", wallet.toLowerCase()).order("created_at", { ascending: false }).limit(300);
      for (const t of fm || []) found.set(getAddress(t.token), { ...found.get(getAddress(t.token)), at: t.created_at, bonded: t.bonded_at ? true : undefined, name: t.name, symbol: t.symbol });
      if (fm?.length) sources.push("four.meme");
    }
    const r = await evmCreated(chain, wallet);
    if (r.limited) limited = chain === "bsc" ? "Tokens made outside four.meme and four.meme tokens from before our index started may be missing (the free explorer plan doesn't cover BNB Chain)." : r.limited;
    else sources.push("Etherscan");
    for (const t of r.list) found.set(t.token, { ...found.get(t.token), at: found.get(t.token)?.at ?? t.at });
  }

  const addrs = [...found.keys()].slice(0, 120);
  const dex = await dexInfo(chain, addrs);
  if (addrs.length) sources.push("DexScreener");
  const tokens: DevToken[] = addrs.map((token) => {
    const f = found.get(token)!;
    const j = judge(dex.get(token.toLowerCase()), f.at, f.bonded);
    return {
      token, name: f.name ?? j.name ?? null, symbol: f.symbol ?? j.symbol ?? null, logo: j.logo ?? (f.logo && f.logo.startsWith("https://") ? f.logo : null),
      createdAt: f.at, status: j.status, dex: j.dex, liquidityUsd: j.liquidityUsd, marketCap: j.marketCap, volume24h: j.volume24h, change24h: j.change24h,
      launchedHere: !!f.here,
    };
  }).sort((a, b) => Date.parse(b.createdAt ?? "0") - Date.parse(a.createdAt ?? "0"));

  const report: DevReport = { chain, wallet, tokens, scannedAt: new Date().toISOString(), ...score(tokens), sources, ...(limited ? { limited } : {}) };
  await sb.from("dev_scans").upsert({ chain, wallet, report, scanned_at: report.scannedAt }, { onConflict: "chain,wallet" });
  return report;
}
