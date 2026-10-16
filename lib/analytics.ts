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
 */
import { createPublicClient, formatUnits, getAddress, http, isAddress, parseAbi } from "viem";
import { bsc, mainnet } from "viem/chains";
import { supabaseService } from "@/lib/supabase/server";
import { CHAINS } from "@/lib/launchpad";

export const ACHAINS = {
  bsc: { key: "bsc", name: "BNB Chain", viem: bsc, rpc: CHAINS.bsc.rpc, moralis: "bsc", goplus: "56", explorer: "https://bscscan.com", dex: "bsc" },
  ethereum: { key: "ethereum", name: "Ethereum", viem: mainnet, rpc: CHAINS.ethereum.rpc, moralis: "eth", goplus: "1", explorer: "https://etherscan.io", dex: "ethereum" },
} as const;
export type AChain = keyof typeof ACHAINS;
export const isAChain = (c: unknown): c is AChain => typeof c === "string" && c in ACHAINS;

const TOP = 40;
const MEMBERSHIP_HOURS = 6; // how often the top-40 list itself is refreshed
const MOVE = 0.01; // a balance change under 1% is ignored
const SKIP = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const ERC20 = parseAbi([
  "function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function owner() view returns (address)",
]);

const client = (c: AChain) => createPublicClient({ chain: ACHAINS[c].viem as any, transport: http(ACHAINS[c].rpc, { timeout: 10_000 }) });
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
const lower = (a: string) => a.toLowerCase();

type Holder = { wallet: string; balance: string; isContract?: boolean; label?: string | null };
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
  if (!(await budget(1))) return null;
  try {
    const j = await moralis(`/erc20/${token}/owners?chain=${ACHAINS[chain].moralis}&order=DESC&limit=${TOP}`);
    return (j?.result || []).filter((h: any) => isAddress(h.owner_address) && !SKIP.has(lower(h.owner_address))).map((h: any) => ({
      wallet: getAddress(h.owner_address), balance: String(h.balance_formatted ?? "0"), isContract: !!h.is_contract, label: h.owner_address_label ? String(h.owner_address_label).slice(0, 40) : null,
    }));
  } catch (e) { console.error("Moralis holders failed:", (e as Error).message); return null; }
}

/** When a wallet first received this token (Moralis). Null when unknown. */
async function firstReceived(chain: AChain, token: string, wallet: string): Promise<string | null> {
  try {
    const j = await moralis(`/${wallet}/erc20/transfers?chain=${ACHAINS[chain].moralis}&contract_addresses%5B0%5D=${token}&order=ASC&limit=5`);
    const t = (j?.result || []).find((x: any) => lower(String(x.to_address)) === lower(wallet));
    return t?.block_timestamp ? new Date(t.block_timestamp).toISOString() : null;
  } catch { return null; }
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
async function apply(chain: AChain, token: string, t: { symbol: string; supply: number }, rows: any[], fresh: Map<string, string>, top?: Map<string, Holder & { rank: number }>) {
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
  if (!isAddress(tokenIn)) return "That isn't a token address.";
  const token = getAddress(tokenIn);
  const sb = supabaseService();
  const { data: existing } = await sb.from("tracked_tokens").select("*").eq("chain", chain).eq("token", token).maybeSingle();
  if (existing && !opts.force && existing.snapshot_at && Date.now() - Date.parse(existing.snapshot_at) < 10 * 60_000) {
    await sb.from("tracked_tokens").update({ viewed_at: new Date().toISOString() }).eq("chain", chain).eq("token", token);
    return null;
  }
  let m: Meta | null = null;
  try { m = await meta(chain, token); } catch { return `Couldn't reach ${ACHAINS[chain].name} right now. Try again in a minute.`; }
  if (!m) return `That address isn't a token on ${ACHAINS[chain].name}.`;
  const [gp, moralisTop] = await Promise.all([goplus(chain, token), topHolders(chain, token)]);
  const list = moralisTop || gp?.holders || [];
  const dev = (opts.dev && isAddress(opts.dev) ? getAddress(opts.dev) : null) || existing?.dev || gp?.creator || m.owner || null;
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
  const fresh = await balances(chain, token, m.decimals, all).catch(() => new Map<string, string>());
  await apply(chain, token, { symbol: m.symbol, supply: m.supply }, (rows2 || []).map((r: any) => (r.wallet === dev ? { ...r, is_dev: true } : r)), fresh, list.length ? top : undefined);
  await fillHoldingTimes(chain, token, 12);
  return null;
}

/** Looks up when wallets first got the token, a few at a time (each lookup is a paid call). */
async function fillHoldingTimes(chain: AChain, token: string, max: number) {
  if (!process.env.MORALIS_API_KEY) return;
  const sb = supabaseService();
  const { data } = await sb.from("token_holders").select("wallet").eq("chain", chain).eq("token", token).is("acquired_at", null).eq("is_contract", false)
    .or("in_top.eq.true,is_dev.eq.true").order("rank", { ascending: true, nullsFirst: false }).limit(max);
  const todo = data || [];
  if (!todo.length || !(await budget(todo.length))) return;
  await Promise.all(todo.map(async ({ wallet }: any) => {
    const at = await firstReceived(chain, token, wallet);
    if (at) await sb.from("token_holders").update({ acquired_at: at }).eq("chain", chain).eq("token", token).eq("wallet", wallet);
  }));
}

/** Re-checks the balances of every wallet followed for a token. Free (public RPC only). */
export async function checkToken(chain: AChain, token: string) {
  const sb = supabaseService();
  const { data: t } = await sb.from("tracked_tokens").select("symbol,decimals,total_supply").eq("chain", chain).eq("token", token).maybeSingle();
  if (!t) return [];
  const { data: rows } = await sb.from("token_holders").select("*").eq("chain", chain).eq("token", token);
  if (!rows?.length) return [];
  const fresh = await balances(chain, token, t.decimals, rows.map((r: any) => r.wallet));
  const ev = await apply(chain, token, { symbol: t.symbol || "", supply: num(t.total_supply) }, rows, fresh);
  await sb.from("tracked_tokens").update({ checked_at: new Date().toISOString() }).eq("chain", chain).eq("token", token);
  await fillHoldingTimes(chain, token, 4);
  return ev;
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
      done++;
    } catch (e) { console.error("analytics check failed", r.chain, r.token, (e as Error).message); }
  }
  return { checked: done, events, queued: queue.length };
}
