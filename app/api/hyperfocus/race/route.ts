import { NextResponse } from "next/server";
import { ACHAINS, isAChain, isChainAddress, type AChain } from "@/lib/analytics";
import { loadArena } from "@/lib/arena-server";
import { GT } from "@/lib/market";

// Hyperfocus GP: one real token's race. Every tracked holder becomes a car. How fast it drives comes from how far
// that wallet is up since it got in (today's price over the price when it bought, from free price history), and the
// last day's real buys and sells replay during the race. Public, read-only data (blockchain reads, DexScreener,
// GeckoTerminal). Nothing here is financial advice.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v !== "" && isFinite(+v) ? +v : null);
const json = (b: unknown, status = 200, cache = "public, max-age=30, s-maxage=60") => NextResponse.json(b, { status, headers: { "Cache-Control": cache } });

async function market(chain: AChain, token: string) {
  const slug = (ACHAINS[chain] as any).dex;
  if (!slug) return null;
  try {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/${slug}/${token}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(6000) });
    const pairs: any[] = r.ok ? await r.json() : [];
    let best: any = null;
    for (const p of Array.isArray(pairs) ? pairs : []) if (!best || (num(p?.liquidity?.usd) ?? 0) > (num(best?.liquidity?.usd) ?? 0)) best = p;
    if (!best) return null;
    return {
      pool: String(best.pairAddress || ""),
      price: num(best.priceUsd),
      ch1: num(best.priceChange?.h1),
      ch24: num(best.priceChange?.h24),
      mcap: num(best.marketCap) ?? num(best.fdv),
      symbol: typeof best.baseToken?.symbol === "string" ? best.baseToken.symbol.slice(0, 16) : null,
      name: typeof best.baseToken?.name === "string" ? best.baseToken.name.slice(0, 40) : null,
      image: typeof best.info?.imageUrl === "string" && best.info.imageUrl.startsWith("https://") ? best.info.imageUrl : null,
    };
  } catch { return null; }
}

/** Closing prices, oldest first: daily for the long run, hourly for the last month. */
async function history(chain: AChain, pool: string) {
  const net = GT[chain];
  if (!net || !pool) return { day: [] as number[][], hour: [] as number[][] };
  const get = async (frame: string) => {
    try {
      const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pool}/ohlcv/${frame}&currency=usd&token=base`, { next: { revalidate: 900 }, signal: AbortSignal.timeout(6000), headers: { accept: "application/json" } });
      const list: any[] = r.ok ? (await r.json())?.data?.attributes?.ohlcv_list || [] : [];
      return list.map((c) => [Number(c[0]) * 1000, Number(c[4])]).filter((c) => c[1] > 0).sort((a, b) => a[0] - b[0]);
    } catch { return []; }
  };
  const [day, hour] = await Promise.all([get("day?limit=1000"), get("hour?limit=720")]);
  return { day, hour };
}

function priceAt(h: { day: number[][]; hour: number[][] }, t: number) {
  const pick = (list: number[][]) => {
    if (!list.length || t < list[0][0] - 86_400_000) return null;
    let best = list[0];
    for (const c of list) { if (c[0] <= t) best = c; else break; }
    return best[1];
  };
  return (h.hour.length && t >= h.hour[0][0] ? pick(h.hour) : null) ?? pick(h.day);
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const chain = String(u.searchParams.get("chain") || "");
  const token = String(u.searchParams.get("token") || "").trim();
  if (!isAChain(chain)) return json({ error: "Pick a network." }, 400, "no-store");
  if (!isChainAddress(chain, token)) return json({ error: chain === "solana" ? "Paste the token's Solana address." : "Paste the token's contract address (it starts with 0x)." }, 400, "no-store");

  const [data, m] = await Promise.all([loadArena(chain, token).catch(() => null), market(chain, token)]);
  if (!data) return json({ tracked: false, chain, token, symbol: m?.symbol ?? null, name: m?.name ?? null, image: m?.image ?? null }, 200, "no-store");

  const { t } = data;
  const price = m?.price ?? null;
  const h = price && m?.pool ? await history(chain, m.pool) : { day: [], hour: [] };
  const firstBuy = new Map<string, number>();
  for (const tr of data.trades as any[]) {
    if (tr.side !== "buy" || !tr.wallet) continue;
    const at = Date.parse(tr.at);
    const k = String(tr.wallet).toLowerCase();
    if (isFinite(at) && (!firstBuy.has(k) || at < firstBuy.get(k)!)) firstBuy.set(k, at);
  }

  const holders = (data.holders as any[])
    .filter((x) => !x.is_contract)
    .slice(0, 40)
    .map((x) => {
      const w = String(x.wallet);
      // Only a real buy time counts (when it acquired the coin, or its first buy we saw). "First seen by us" is not a buy.
      const got = Date.parse(x.acquired_at || "") || firstBuy.get(w.toLowerCase()) || 0;
      const entry = got ? priceAt(h, got) : null;
      const mult = price && entry ? Math.max(0.01, Math.min(100000, price / entry)) : null;
      const bal = Number(x.balance) || 0, peak = Number(x.peak_balance) || bal;
      return {
        w, lbl: typeof x.label === "string" ? x.label.slice(0, 20) : null, dev: !!x.is_dev,
        pct: num(x.pct), bal, usd: price ? bal * price : null,
        x: mult, est: !x.acquired_at,
        sold: peak > 0 && bal < peak * 0.98, out: bal <= 0,
      };
    });

  const since = Date.now() - 86_400_000;
  const trades = (data.trades as any[])
    .filter((tr) => Date.parse(tr.at) >= since && (tr.side === "buy" || tr.side === "sell"))
    .slice(0, 300)
    .map((tr) => ({ w: String(tr.wallet), s: tr.side === "buy" ? 1 : -1, amt: Number(tr.amount) || 0, at: Date.parse(tr.at), left: num(tr.balance_after) }))
    .sort((a, b) => a.at - b.at);

  return json({
    tracked: true, chain, token: t.token,
    symbol: m?.symbol || t.symbol || null, name: m?.name || t.name || null, image: m?.image || t.image_url || null,
    price, ch1: m?.ch1 ?? null, ch24: m?.ch24 ?? null, mcap: m?.mcap ?? null,
    holders, trades, at: Date.now(),
  });
}
