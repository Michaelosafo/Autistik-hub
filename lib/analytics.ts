/**
 * Analytics: keeps a record of each tracked token's top 40 wallets and its dev wallet, re-checks their balances,
 * and turns drops into "sold" events with notifications for members watching the token.
 *
 * Data sources (all read-only, nothing is ever signed or sent):
 * - The chain itself (public RPC): token details and every tracked wallet's balance. Free.
 * - Moralis (needs MORALIS_API_KEY, free plan): the top 40 holders and when each wallet first got the token.
 *   Calls are capped per day (MORALIS_DAILY_LIMIT, default 600).
 * - GoPlus (free, no key): the creator wallet, safety checks (honeypot, taxes, minting) and, without Moralis,
 *   the top 10 holders.
 * - Live trades (free, no key): every transfer into or out of the token's main trading pool, read from the chain's
 *   logs. Tokens leaving the pool are buys, tokens going into it are sells. The pool comes from DexScreener.
 */
import { createPublicClient, formatUnits, getAddress, http, isAddress, parseAbi, parseAbiItem } from "viem";
import { abstract, arbitrum, avalanche, base, berachain, blast, bsc, linea, mainnet, monad, optimism, polygon, robinhood, sonic, unichain } from "viem/chains";
import { supabaseService } from "@/lib/supabase/server";
import { CHAINS } from "@/lib/launchpad";
import { isSolAddress, solBalances, solGoplus, solMeta } from "@/lib/analytics-solana";

/** Another EVM chain, using viem's built-in network details (public node, explorer, multicall). */
function evm(key: string, name: string, chain: any, goplus: string, moralis: string | null): AChainInfo {
  return { key, name, kind: "evm", viem: chain, rpc: chain.rpcUrls.default.http[0], moralis, goplus, explorer: chain.blockExplorers.default.url, dex: key };
}
type AChainInfo = { key: string; name: string; kind: "evm" | "solana"; viem: any; rpc: string; moralis: string | null; goplus: string; explorer: string; dex: string };
export const ACHAINS = {
  bsc: { key: "bsc", name: "BNB Chain", kind: "evm", viem: bsc, rpc: CHAINS.bsc.rpc, moralis: "bsc", goplus: "56", explorer: "https://bscscan.com", dex: "bsc" },
  ethereum: { key: "ethereum", name: "Ethereum", kind: "evm", viem: mainnet, rpc: CHAINS.ethereum.rpc, moralis: "eth", goplus: "1", explorer: "https://etherscan.io", dex: "ethereum" },
  base: { key: "base", name: "Base", kind: "evm", viem: base, rpc: process.env.ANALYTICS_BASE_RPC || "https://mainnet.base.org", moralis: "base", goplus: "8453", explorer: "https://basescan.org", dex: "base" },
  robinhood: {
    key: "robinhood", name: "Robinhood Chain", kind: "evm", viem: robinhood, rpc: CHAINS.robinhood.rpc || "https://rpc.mainnet.chain.robinhood.com",
    moralis: null, goplus: "4663", explorer: CHAINS.robinhood.explorer || "https://robinhoodchain.blockscout.com", dex: "robinhood",
  },
  solana: { key: "solana", name: "Solana", kind: "solana", viem: null, rpc: "", moralis: null, goplus: "solana", explorer: "https://solscan.io", dex: "solana" },
  arbitrum: evm("arbitrum", "Arbitrum", arbitrum, "42161", "arbitrum"),
  polygon: evm("polygon", "Polygon", polygon, "137", "polygon"),
  avalanche: evm("avalanche", "Avalanche", avalanche, "43114", "avalanche"),
  optimism: evm("optimism", "Optimism", optimism, "10", "optimism"),
  sonic: evm("sonic", "Sonic", sonic, "146", null),
  berachain: evm("berachain", "Berachain", berachain, "80094", null),
  monad: evm("monad", "Monad", monad, "143", null),
  unichain: evm("unichain", "Unichain", unichain, "130", null),
  abstract: evm("abstract", "Abstract", abstract, "2741", null),
  linea: evm("linea", "Linea", linea, "59144", "linea"),
  blast: evm("blast", "Blast", blast, "81457", null),
} satisfies Record<string, AChainInfo>;
export type AChain = keyof typeof ACHAINS;
export const isAChain = (c: unknown): c is AChain => typeof c === "string" && c in ACHAINS;
const isSol = (c: AChain) => ACHAINS[c].kind === "solana";
/** A token or wallet address in the right format for the chain (0x… or a Solana address). */
export const isChainAddress = (c: AChain, a: unknown): a is string => (isSol(c) ? isSolAddress(a) : typeof a === "string" && isAddress(a));
const norm = (c: AChain, a: string) => (isSol(c) ? a : getAddress(a));

const TOP = 40;
const MEMBERSHIP_HOURS = 6; // how often the top-40 list itself is refreshed
const MOVE = 0.01; // a balance change under 1% is ignored
const SKIP = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const ERC20 = parseAbi([
  "function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function owner() view returns (address)",
]);

const client = (c: AChain) => createPublicClient({ chain: ACHAINS[c].viem, transport: http(ACHAINS[c].rpc, { timeout: 10_000 }) });
// Reading trade logs needs a node that allows it; the default public BNB node refuses big log requests.
const LOG_RPC: Record<AChain, string> = {
  bsc: process.env.ANALYTICS_BSC_RPC || "https://bsc-rpc.publicnode.com",
  ethereum: process.env.ANALYTICS_ETH_RPC || "https://ethereum-rpc.publicnode.com",
  base: process.env.ANALYTICS_BASE_LOG_RPC || "https://base-rpc.publicnode.com",
  robinhood: process.env.ANALYTICS_ROBINHOOD_RPC || "https://rpc.mainnet.chain.robinhood.com",
  solana: "",
  arbitrum: "https://arbitrum-one-rpc.publicnode.com",
  polygon: "https://polygon-bor-rpc.publicnode.com",
  avalanche: "https://avalanche-c-chain-rpc.publicnode.com",
  optimism: "https://optimism-rpc.publicnode.com",
  sonic: "https://sonic-rpc.publicnode.com",
  berachain: "https://berachain-rpc.publicnode.com",
  monad: "https://rpc.monad.xyz",
  unichain: "https://unichain-rpc.publicnode.com",
  abstract: "https://api.mainnet.abs.xyz",
  linea: "https://linea-rpc.publicnode.com",
  blast: "https://blast-rpc.publicnode.com",
};
const logClient = (c: AChain) => createPublicClient({ chain: ACHAINS[c].viem, transport: http(LOG_RPC[c], { timeout: 15_000 }) });
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
const lower = (a: string) => a.toLowerCase();

type Holder = { wallet: string; balance: string; isContract?: boolean; label?: string | null; tokenAccount?: string };
type GoPlus = { creator: string | null; owner: string | null; holders: Holder[]; security: Record<string, unknown> };

async function goplus(chain: AChain, token: string): Promise<GoPlus | null> {
  try {
    const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${ACHAINS[chain].goplus}?contract_addresses=${token}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    const j = r.ok ? await r.json() : null;
    const x = j?.result?.[lower(token)];
    if (!x) return null;
    const addr = (a: unknown) => (typeof a === "string" && isAddress(a) && !SKIP.has(lower(a)) ? getAddress(a) : null);
    const flag = (v: unknown) => (v === "1" ? true : v === "0" ? false : null);
    return {
      creator: addr(x.creator_address),
      owner: addr(x.owner_address),
      holders: (Array.isArray(x.holders) ? x.holders : []).filter((h: any) => addr(h.address)).map((h: any) => ({
        wallet: getAddress(h.address), balance: String(h.balance ?? "0"), isContract: h.is_contract === 1 || h.is_contract === "1", label: h.tag ? String(h.tag).slice(0, 40) : null,
      })),
      security: {
        honeypot: flag(x.is_honeypot), buyTax: x.buy_tax === "" ? null : num(x.buy_tax) * 100, sellTax: x.sell_tax === "" ? null : num(x.sell_tax) * 100,
        mintable: flag(x.is_mintable), openSource: flag(x.is_open_source), canTakeBack: flag(x.can_take_back_ownership),
        hiddenOwner: flag(x.hidden_owner), holderCount: x.holder_count ? num(x.holder_count) : null,
      },
    };
  } catch { return null; }
}

/** Spends from the daily paid-call budget. Returns false when today's budget is used up. */
async function budget(calls: number) {
  if (!process.env.MORALIS_API_KEY) return false;
  const { data } = await supabaseService().rpc("analytics_budget", { p_calls: calls, p_limit: Number(process.env.MORALIS_DAILY_LIMIT || 600) });
  return data === true;
}

async function moralis(path: string): Promise<any> {
  const r = await fetch(`https://deep-index.moralis.io/api/v2.2${path}`, {
    headers: { "X-API-Key": process.env.MORALIS_API_KEY!, accept: "application/json" }, signal: AbortSignal.timeout(10_000), cache: "no-store",
  });
  if (!r.ok) throw new Error(`Moralis ${r.status}`);
  return r.json();
}

async function topHolders(chain: AChain, token: string): Promise<Holder[] | null> {
  if (!ACHAINS[chain].moralis || !(await budget(1))) return null;
  try {
    const j = await moralis(`/erc20/${token}/owners?chain=${ACHAINS[chain].moralis}&order=DESC&limit=${TOP}`);
    return (j?.result || []).filter((h: any) => isAddress(h.owner_address) && !SKIP.has(lower(h.owner_address))).map((h: any) => ({
      wallet: getAddress(h.owner_address), balance: String(h.balance_formatted ?? "0"), isContract: !!h.is_contract, label: h.owner_address_label ? String(h.owner_address_label).slice(0, 40) : null,
    }));
  } catch (e) { console.error("Moralis holders failed:", (e as Error).message); return null; }
}

/** When a wallet first received this token, and from whom (Moralis). Null when unknown. */
async function firstReceived(chain: AChain, token: string, wallet: string): Promise<{ at: string; from: string | null } | null> {
  try {
    const j = await moralis(`/${wallet}/erc20/transfers?chain=${ACHAINS[chain].moralis}&contract_addresses%5B0%5D=${token}&order=ASC&limit=5`);
    const t = (j?.result || []).find((x: any) => lower(String(x.to_address)) === lower(wallet));
    if (!t?.block_timestamp) return null;
    return { at: new Date(t.block_timestamp).toISOString(), from: isAddress(t.from_address) ? getAddress(t.from_address) : null };
  } catch { return null; }
}

/**
 * Saves "connected wallet" links for the bubble map: one tracked wallet sent tokens to another (a → b).
 * Pools and other contracts are skipped, because every buyer gets tokens from the pool.
 */
async function saveLinks(chain: AChain, token: string, links: { a: string; b: string; kind: string; amount?: number }[]) {
  const seen = new Set<string>();
  const rows = links.filter((l) => l.a !== l.b && !seen.has(l.a + l.b) && seen.add(l.a + l.b))
    .map((l) => ({ chain, token, a: l.a, b: l.b, kind: l.kind, amount: l.amount ?? null, created_at: new Date().toISOString() }));
  if (rows.length) await supabaseService().from("token_links").upsert(rows, { onConflict: "chain,token,a,b" });
}

/** People (not pools or contracts) followed for a token. */
async function people(chain: AChain, token: string) {
  const { data } = await supabaseService().from("token_holders").select("wallet").eq("chain", chain).eq("token", token).eq("is_contract", false);
  return new Set((data || []).map((r: any) => r.wallet as string));
}

/** Recent transfers of the token between followed wallets (one paid call). */
async function recentLinks(chain: AChain, token: string) {
  if (!ACHAINS[chain].moralis || !(await budget(1))) return;
  try {
    const j = await moralis(`/erc20/${token}/transfers?chain=${ACHAINS[chain].moralis}&limit=100`);
    const ppl = await people(chain, token);
    const links = (j?.result || []).filter((x: any) => isAddress(x.from_address) && isAddress(x.to_address))
      .map((x: any) => ({ a: getAddress(x.from_address), b: getAddress(x.to_address), amount: num(x.value_decimal), kind: "transfer" }))
      .filter((l: any) => ppl.has(l.a) && ppl.has(l.b));
    await saveLinks(chain, token, links);
  } catch {}
}

type Meta = { name: string; symbol: string; decimals: number; supply: number; owner: string | null };
async function meta(chain: AChain, token: string): Promise<Meta | null> {
  const r = await client(chain).multicall({
    allowFailure: true,
    contracts: (["name", "symbol", "decimals", "totalSupply", "owner"] as const).map((functionName) => ({ address: token as `0x${string}`, abi: ERC20, functionName })),
  } as any) as any[];
  if (r[2]?.status !== "success" || r[3]?.status !== "success") return null;
  const decimals = Number(r[2].result);
  const owner = r[4]?.status === "success" && isAddress(r[4].result) && !SKIP.has(lower(r[4].result)) ? getAddress(r[4].result) : null;
  return {
    name: r[0]?.status === "success" ? String(r[0].result).slice(0, 64) : "", symbol: r[1]?.status === "success" ? String(r[1].result).slice(0, 24) : "",
    decimals, supply: num(formatUnits(r[3].result as bigint, decimals)), owner,
  };
}

async function balances(chain: AChain, token: string, decimals: number, wallets: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < wallets.length; i += 100) {
    const part = wallets.slice(i, i + 100);
    const r = await client(chain).multicall({
      allowFailure: true, contracts: part.map((w) => ({ address: token as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [w] })),
    } as any) as any[];
    r.forEach((x, j) => { if (x?.status === "success") out.set(part[j], formatUnits(x.result as bigint, decimals)); });
  }
  return out;
}

/** Balances on any chain. On Solana it also returns newly found token accounts, to be saved with the wallet. */
async function freshBalances(chain: AChain, token: string, decimals: number, wallets: string[], accts: Map<string, string>) {
  if (!isSol(chain)) return { balances: await balances(chain, token, decimals, wallets), found: new Map<string, string>() };
  return solBalances(token, wallets, accts);
}

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const fmtAmount = (n: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
export function heldFor(since: string | null | undefined, until = Date.now()) {
  if (!since) return "";
  const h = (until - Date.parse(since)) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

/**
 * Saves new balances and turns drops into events. Rows that aren't in `fresh` keep their old balance.
 * Liquidity pools and other contracts change all the time with trading, so they never raise alerts.
 */
async function apply(chain: AChain, token: string, t: { symbol: string; supply: number }, rows: any[], fresh: Map<string, string>, top?: Map<string, Holder & { rank: number }>, accts?: Map<string, string>) {
  const sb = supabaseService();
  const now = new Date().toISOString();
  const events: any[] = [];
  const updates: any[] = [];
  const known = new Map(rows.map((r) => [r.wallet, r]));
  const wallets = new Set([...known.keys(), ...(top ? top.keys() : [])]);
  for (const wallet of wallets) {
    const row = known.get(wallet);
    const h = top?.get(wallet);
    const bal = fresh.get(wallet) ?? h?.balance ?? row?.balance;
    if (bal == null) continue;
    const now$ = num(bal), old = num(row?.balance);
    const isContract = h?.isContract ?? row?.is_contract ?? false;
    const u: any = {
      chain, token, wallet, balance: bal, pct: t.supply ? (now$ / t.supply) * 100 : null, peak_balance: Math.max(now$, num(row?.peak_balance)),
      is_contract: isContract, is_dev: row?.is_dev ?? false,
    };
    const acct = accts?.get(wallet) ?? h?.tokenAccount;
    if (acct) u.token_account = acct;
    if (h) Object.assign(u, { rank: h.rank, in_top: true, label: h.label ?? row?.label ?? null });
    else if (top) Object.assign(u, { in_top: false });
    if (row && old > 0 && Math.abs(now$ - old) > old * MOVE && Math.abs(now$ - old) > t.supply * 1e-6) {
      u.last_change_at = now;
      if (!isContract) {
        const down = now$ < old;
        events.push({
          chain, token, wallet, kind: !down ? "buy" : now$ <= old * 0.01 ? "exit" : "sell",
          amount: String(Math.abs(now$ - old)), pct_of_holding: down ? ((old - now$) / old) * 100 : ((now$ - old) / old) * 100,
          balance_after: bal, is_dev: !!row.is_dev, held_since: row.acquired_at || row.first_seen_at,
        });
      }
    }
    updates.push(u);
  }
  if (updates.length) await sb.from("token_holders").upsert(updates, { onConflict: "chain,token,wallet" });
  if (!events.length) return events;
  await sb.from("holder_events").insert(events);

  // One wallet dropping and another rising by the same amount in the same check: tokens moved between them.
  const ups = events.filter((e) => e.kind === "buy");
  const moves = events.filter((e) => e.kind !== "buy").flatMap((d) => ups
    .filter((u) => Math.abs(num(u.amount) - num(d.amount)) <= num(d.amount) * 0.03)
    .map((u) => ({ a: d.wallet, b: u.wallet, kind: "moved", amount: num(d.amount) })));
  if (moves.length) await saveLinks(chain, token, moves);

  // Tell everyone watching this token about sells (not buys). At most 3 alerts per token per check.
  const sells = events.filter((e) => e.kind !== "buy").sort((a, b) => Number(b.is_dev) - Number(a.is_dev) || b.pct_of_holding - a.pct_of_holding).slice(0, 3);
  if (sells.length) {
    const { data: watchers } = await sb.from("launch_watchers").select("user_id").eq("chain", chain).eq("token", token).limit(5000);
    const notes = (watchers || []).flatMap((w: any) => sells.map((e) => {
      const who = e.is_dev ? "The dev" : `Top holder ${short(e.wallet)}`;
      const did = e.kind === "exit" ? "sold everything" : `sold ${Math.round(e.pct_of_holding)}% of their bag`;
      const held = heldFor(e.held_since);
      return {
        user_id: w.user_id, title: `${e.is_dev ? "⚠️ " : ""}${t.symbol || "Token"}: ${who} ${did}`,
        body: `${fmtAmount(num(e.amount))} ${t.symbol} sold or moved out${held ? ` after holding for ${held}` : ""}.`, link: `/analytics/${chain}/${token}`,
      };
    }));
    for (let i = 0; i < notes.length; i += 500) await sb.from("notifications").insert(notes.slice(i, i + 500));
  }
  return events;
}

/**
 * Adds a token to Analytics, or refreshes its top-40 list. `dev` is the launch creator for tokens launched here.
 * Returns an error message, or null when done.
 */
export async function scanToken(chain: AChain, tokenIn: string, opts: { userId?: string | null; dev?: string | null; force?: boolean } = {}): Promise<string | null> {
  if (!isChainAddress(chain, tokenIn)) return `That isn't a ${ACHAINS[chain].name} token address.`;
  const token = norm(chain, tokenIn);
  const sol = isSol(chain);
  const sb = supabaseService();
  const { data: existing } = await sb.from("tracked_tokens").select("*").eq("chain", chain).eq("token", token).maybeSingle();
  if (existing && !opts.force && existing.snapshot_at && Date.now() - Date.parse(existing.snapshot_at) < 10 * 60_000) {
    await sb.from("tracked_tokens").update({ viewed_at: new Date().toISOString() }).eq("chain", chain).eq("token", token);
    return null;
  }
  let m: Meta | null = null;
  try { m = sol ? await solMeta(token) : await meta(chain, token); } catch { return `Couldn't reach ${ACHAINS[chain].name} right now. Try again in a minute.`; }
  if (!m) return `That address isn't a token on ${ACHAINS[chain].name}.`;
  const [gp, moralisTop] = await Promise.all([sol ? solGoplus(token) : goplus(chain, token), topHolders(chain, token)]);
  if (gp && "name" in gp) { m.name ||= gp.name; m.symbol ||= gp.symbol; }
  const list: Holder[] = moralisTop || gp?.holders || [];
  const dev = (opts.dev && isChainAddress(chain, opts.dev) ? norm(chain, opts.dev) : null) || existing?.dev || gp?.creator || m.owner || null;
  const devSource = opts.dev ? "launchpad" : existing?.dev_source || (gp?.creator ? "creator" : m.owner ? "owner" : null);

  await sb.from("tracked_tokens").upsert({
    chain, token, name: m.name, symbol: m.symbol, decimals: m.decimals, total_supply: m.supply, dev, dev_source: devSource,
    security: gp?.security ?? existing?.security ?? null, holder_source: moralisTop ? "moralis" : existing?.holder_source || (gp ? "goplus" : null),
    added_by: existing?.added_by ?? opts.userId ?? null, snapshot_at: list.length || !existing ? new Date().toISOString() : existing.snapshot_at,
    checked_at: new Date().toISOString(), viewed_at: new Date().toISOString(),
  }, { onConflict: "chain,token" });

  const { data: rows } = await sb.from("token_holders").select("*").eq("chain", chain).eq("token", token);
  const top = new Map(list.slice(0, TOP).map((h, i) => [h.wallet, { ...h, rank: i + 1 }]));
  // Make sure the dev wallet is always followed, even when it isn't in the top 40.
  if (dev && !(rows || []).some((r: any) => r.wallet === dev)) {
    await sb.from("token_holders").upsert({ chain, token, wallet: dev, is_dev: true, in_top: top.has(dev) }, { onConflict: "chain,token,wallet" });
  }
  if (dev) await sb.from("token_holders").update({ is_dev: false }).eq("chain", chain).eq("token", token).neq("wallet", dev).eq("is_dev", true);
  const { data: rows2 } = await sb.from("token_holders").select("*").eq("chain", chain).eq("token", token);
  const all = [...new Set([...(rows2 || []).map((r: any) => r.wallet), ...top.keys()])];
  const accts = new Map<string, string>([...(rows2 || []).filter((r: any) => r.token_account).map((r: any) => [r.wallet, r.token_account] as [string, string]), ...list.filter((h) => h.tokenAccount).map((h) => [h.wallet, h.tokenAccount!] as [string, string])]);
  const { balances: fresh, found } = await freshBalances(chain, token, m.decimals, all, accts).catch(() => ({ balances: new Map<string, string>(), found: new Map<string, string>() }));
  await apply(chain, token, { symbol: m.symbol, supply: m.supply }, (rows2 || []).map((r: any) => (r.wallet === dev ? { ...r, is_dev: true } : r)), fresh, list.length ? top : undefined, found);
  await fillHoldingTimes(chain, token, 12);
  if (list.length) await recentLinks(chain, token);
  await syncTrades(chain, token).catch((e) => console.error("trades failed", token, (e as Error).message));
  return null;
}

/** Looks up when wallets first got the token, a few at a time (each lookup is a paid call). */
async function fillHoldingTimes(chain: AChain, token: string, max: number) {
  if (!process.env.MORALIS_API_KEY || !ACHAINS[chain].moralis) return;
  const sb = supabaseService();
  const { data } = await sb.from("token_holders").select("wallet").eq("chain", chain).eq("token", token).is("acquired_at", null).eq("is_contract", false)
    .or("in_top.eq.true,is_dev.eq.true").order("rank", { ascending: true, nullsFirst: false }).limit(max);
  const todo = data || [];
  if (!todo.length || !(await budget(todo.length))) return;
  const ppl = await people(chain, token);
  const links: { a: string; b: string; kind: string }[] = [];
  await Promise.all(todo.map(async ({ wallet }: any) => {
    const first = await firstReceived(chain, token, wallet);
    if (!first) return;
    await sb.from("token_holders").update({ acquired_at: first.at }).eq("chain", chain).eq("token", token).eq("wallet", wallet);
    // Their first tokens came from another followed wallet (often the dev): they're connected.
    if (first.from && ppl.has(first.from)) links.push({ a: first.from, b: wallet, kind: "funded" });
  }));
  await saveLinks(chain, token, links);
}

/** Re-checks the balances of every wallet followed for a token. Free (public RPC only). */
export async function checkToken(chain: AChain, token: string) {
  const sb = supabaseService();
  const { data: t } = await sb.from("tracked_tokens").select("symbol,decimals,total_supply").eq("chain", chain).eq("token", token).maybeSingle();
  if (!t) return [];
  const { data: rows } = await sb.from("token_holders").select("*").eq("chain", chain).eq("token", token);
  if (!rows?.length) return [];
  const accts = new Map<string, string>(rows.filter((r: any) => r.token_account).map((r: any) => [r.wallet, r.token_account]));
  const { balances: fresh, found } = await freshBalances(chain, token, t.decimals, rows.map((r: any) => r.wallet), accts);
  const ev = await apply(chain, token, { symbol: t.symbol || "", supply: num(t.total_supply) }, rows, fresh, undefined, found);
  await sb.from("tracked_tokens").update({ checked_at: new Date().toISOString() }).eq("chain", chain).eq("token", token);
  await fillHoldingTimes(chain, token, 4);
  return ev;
}

/** The token's main trading pool (most liquidity), from DexScreener. */
async function findPair(chain: AChain, token: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    const j = r.ok ? await r.json() : null;
    const pairs = (j?.pairs || []).filter((p: any) => p?.chainId === ACHAINS[chain].dex && isChainAddress(chain, p?.pairAddress));
    pairs.sort((a: any, b: any) => num(b?.liquidity?.usd) - num(a?.liquidity?.usd));
    return pairs[0] ? norm(chain, pairs[0].pairAddress) : null;
  } catch { return null; }
}

const LOOKBACK = 10_000n; // first look back about 2 hours on BNB Chain
const CHUNK = 2_500n;

/**
 * Reads every buy and sell through the token's main pool since the last check, saves them, and alerts watchers
 * about big sells. Free: only public blockchain reads. Returns how many trades were found.
 */
export async function syncTrades(chain: AChain, token: string, maxChunks = 8): Promise<number> {
  const sb = supabaseService();
  const { data: t } = await sb.from("tracked_tokens").select("symbol,decimals,total_supply,pair,last_block,dev").eq("chain", chain).eq("token", token).maybeSingle();
  if (!t) return 0;
  const pair = t.pair || (await findPair(chain, token));
  if (!pair) return 0;
  if (!t.pair) await sb.from("tracked_tokens").update({ pair }).eq("chain", chain).eq("token", token);
  // Solana trades aren't read from logs; its sells are caught by the balance checks instead.
  if (isSol(chain)) { await sb.from("tracked_tokens").update({ trades_at: new Date().toISOString() }).eq("chain", chain).eq("token", token); return 0; }
  const lc = logClient(chain);
  const head = await lc.getBlockNumber();
  let from = t.last_block ? BigInt(t.last_block) + 1n : head - LOOKBACK;
  if (head - from > LOOKBACK * 4n) from = head - LOOKBACK * 4n;
  if (from < 0n) from = 0n;
  // Read at most `maxChunks` pieces per call and remember where we stopped, so a slow call never loses progress.
  const latest = from + CHUNK * BigInt(maxChunks) - 1n < head ? from + CHUNK * BigInt(maxChunks) - 1n : head;
  if (from > latest) { await sb.from("tracked_tokens").update({ pair, trades_at: new Date().toISOString() }).eq("chain", chain).eq("token", token); return 0; }

  const logs: any[] = [];
  for (let a = from; a <= latest; a += CHUNK) {
    const b = a + CHUNK - 1n > latest ? latest : a + CHUNK - 1n;
    logs.push(...(await lc.getLogs({ address: token as `0x${string}`, event: TRANSFER, fromBlock: a, toBlock: b } as any)));
  }

  // Turn pool transfers into trades. When a router passes tokens on in the same transaction, credit the real wallet.
  const P = lower(pair), T = lower(token);
  const byTx = new Map<string, any[]>();
  const seenLog = new Set<string>();
  for (const l of logs) {
    const k = `${l.transactionHash}:${l.logIndex}`;
    if (seenLog.has(k)) continue;
    seenLog.add(k);
    byTx.set(l.transactionHash, [...(byTx.get(l.transactionHash) || []), l]);
  }
  const dec = Number(t.decimals ?? 18);
  const trades: any[] = [];
  for (const [tx, list] of byTx) {
    for (const l of list) {
      const f = lower(l.args.from), to = lower(l.args.to), amount = num(formatUnits(l.args.value, dec));
      if (!amount) continue;
      let side: "buy" | "sell" | null = null, wallet = "";
      if (f === P && to !== T && to !== P && !SKIP.has(to)) {
        side = "buy"; wallet = to;
        const next = list.find((x) => lower(x.args.from) === to && lower(x.args.to) !== P && Math.abs(num(formatUnits(x.args.value, dec)) - amount) <= amount * 0.1);
        if (next) wallet = lower(next.args.to);
      } else if (to === P && f !== T && f !== P && !SKIP.has(f)) {
        side = "sell"; wallet = f;
        const prev = list.find((x) => lower(x.args.to) === f && lower(x.args.from) !== P && lower(x.args.from) !== T && Math.abs(num(formatUnits(x.args.value, dec)) - amount) <= amount * 0.1);
        if (prev) wallet = lower(prev.args.from);
      }
      if (!side || SKIP.has(wallet) || wallet === T) continue;
      // One sale or buy that moves in several pieces in the same transaction counts once, with the pieces added up.
      const same = trades.find((x) => x.tx_hash === tx && x.side === side && lower(x.wallet) === wallet);
      if (same) same.amount = String(num(same.amount) + amount);
      else trades.push({ chain, token, tx_hash: tx, log_index: Number(l.logIndex), wallet: getAddress(wallet), side, amount: String(amount), block: Number(l.blockNumber) });
    }
  }

  // Free "connected wallet" links: tokens sent straight from one wallet to another (no pool in the transaction).
  // Senders that hand tokens to lots of wallets (exchanges, airdrops) are left out.
  const sends: { a: string; b: string; kind: string; amount: number }[] = [];
  for (const list of byTx.values()) {
    if (list.some((l) => lower(l.args.from) === P || lower(l.args.to) === P)) continue;
    for (const l of list) {
      const f = lower(l.args.from), to = lower(l.args.to), amount = num(formatUnits(l.args.value, dec));
      if (amount && f !== to && f !== T && to !== T && !SKIP.has(f) && !SKIP.has(to)) sends.push({ a: getAddress(f), b: getAddress(to), kind: "transfer", amount });
    }
  }
  const fanOut = new Map<string, Set<string>>();
  for (const x of sends) fanOut.set(x.a, (fanOut.get(x.a) || new Set()).add(x.b));
  await saveLinks(chain, token, sends.filter((x) => fanOut.get(x.a)!.size <= 5).slice(0, 200)).catch(() => {});

  if (trades.length) {
    // Times from block numbers (one lookup for the speed of the chain, not one per block).
    const [now, back] = await Promise.all([lc.getBlock({ blockNumber: head }), lc.getBlock({ blockNumber: head - 1000n })]);
    const per = Number(now.timestamp - back.timestamp) / 1000;
    for (const tr of trades) tr.at = new Date((Number(now.timestamp) - (Number(head) - tr.block) * per) * 1000).toISOString();
    // Where each trader stands now.
    const wallets = [...new Set(trades.map((x) => x.wallet as string))];
    const bal = await balances(chain, token, dec, wallets).catch(() => new Map<string, string>());
    const supply = num(t.total_supply);
    for (const tr of trades) {
      const b = bal.get(tr.wallet);
      if (b != null) { tr.balance_after = b; tr.pct_after = supply ? (num(b) / supply) * 100 : null; }
    }
    for (let i = 0; i < trades.length; i += 500) await sb.from("token_trades").upsert(trades.slice(i, i + 500), { onConflict: "chain,tx_hash,log_index", ignoreDuplicates: true });

    // Big sells (0.3% of supply or more) alert everyone watching the token.
    const big = trades.filter((x) => x.side === "sell" && supply && num(x.amount) >= supply * 0.003).sort((a, b) => num(b.amount) - num(a.amount)).slice(0, 3);
    if (big.length) {
      const { data: watchers } = await sb.from("launch_watchers").select("user_id").eq("chain", chain).eq("token", token).limit(5000);
      const notes = (watchers || []).flatMap((w: any) => big.map((x) => ({
        user_id: w.user_id,
        title: `${x.wallet === t.dev ? "⚠️ " : "🔴 "}${t.symbol || "Token"}: ${x.wallet === t.dev ? "the dev" : short(x.wallet)} sold ${((num(x.amount) / supply) * 100).toFixed(2)}% of the supply`,
        body: `${fmtAmount(num(x.amount))} ${t.symbol} sold${x.pct_after != null ? `. They now hold ${num(x.pct_after).toFixed(2)}%` : ""}.`,
        link: `/analytics/${chain}/${token}`,
      })));
      for (let i = 0; i < notes.length; i += 500) await sb.from("notifications").insert(notes.slice(i, i + 500));
    }
  }
  await sb.from("tracked_tokens").update({ pair, last_block: Number(latest), trades_at: new Date().toISOString() }).eq("chain", chain).eq("token", token);
  return trades.length;
}

/** The scheduled check (every 10 minutes): the tokens people looked at or watch recently, oldest check first. */
export async function runChecks(deadlineMs: number) {
  const sb = supabaseService();
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [{ data: recent }, { data: watched }] = await Promise.all([
    sb.from("tracked_tokens").select("chain,token,snapshot_at,checked_at").gt("viewed_at", since).order("checked_at", { ascending: true, nullsFirst: true }).limit(60),
    sb.from("launch_watchers").select("chain,token").limit(1000),
  ]);
  const watchedKeys = new Set((watched || []).map((w: any) => `${w.chain}:${w.token}`));
  let extra: any[] = [];
  if (watchedKeys.size) {
    const { data } = await sb.from("tracked_tokens").select("chain,token,snapshot_at,checked_at").in("token", [...new Set((watched || []).map((w: any) => w.token))].slice(0, 300));
    extra = (data || []).filter((r: any) => watchedKeys.has(`${r.chain}:${r.token}`));
  }
  const seen = new Set<string>();
  const queue = [...recent || [], ...extra].filter((r: any) => { const k = `${r.chain}:${r.token}`; if (seen.has(k)) return false; seen.add(k); return isAChain(r.chain); })
    .sort((a: any, b: any) => (a.checked_at ? Date.parse(a.checked_at) : 0) - (b.checked_at ? Date.parse(b.checked_at) : 0));
  let done = 0, events = 0;
  for (const r of queue) {
    if (Date.now() > deadlineMs) break;
    try {
      const stale = !r.snapshot_at || Date.now() - Date.parse(r.snapshot_at) > MEMBERSHIP_HOURS * 3_600_000;
      if (stale) await scanToken(r.chain, r.token, { force: true });
      else events += (await checkToken(r.chain, r.token)).length;
      events += await syncTrades(r.chain, r.token).catch((e) => { console.error("trades failed", r.token, (e as Error).message); return 0; });
      done++;
    } catch (e) { console.error("analytics check failed", r.chain, r.token, (e as Error).message); }
  }
  return { checked: done, events, queued: queue.length };
}
