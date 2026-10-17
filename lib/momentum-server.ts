/**
 * Live momentum data (GeckoTerminal trending pools + GoPlus safety), the track record of past picks, and the
 * momentum alerts sent by the 5-minute check. Server only.
 */
import { supabaseService } from "@/lib/supabase/server";
import { notify } from "@/lib/push";
import { proUsersOf } from "@/lib/pro-server";
import {
  DEFAULT_PREFS, FREE_ALERTS_PER_DAY, MOMENTUM_CHAINS, PRO_ALERTS_PER_DAY, chainName, matches, rank, usd,
  type AlertPrefs, type MomentumChain, type Pick, type Pool,
} from "@/lib/momentum";

const GT = "https://api.geckoterminal.com/api/v2";
const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const num = (v: unknown) => (v == null || v === "" ? null : isFinite(Number(v)) ? Number(v) : null);

function parsePools(chain: MomentumChain, j: any): Pool[] {
  const tokens = new Map<string, any>((j?.included || []).filter((x: any) => x?.type === "token").map((x: any) => [x.id, x.attributes]));
  return (j?.data || []).map((d: any) => {
    const a = d?.attributes || {}, base = tokens.get(d?.relationships?.base_token?.data?.id) || {};
    const tx = (k: string) => { const t = a.transactions?.[k]; return t ? { buys: n(t.buys), sells: n(t.sells), buyers: n(t.buyers), sellers: n(t.sellers) } : undefined; };
    const frames = ["m5", "m15", "h1", "h6", "h24"] as const;
    const token = String(base.address || String(d?.relationships?.base_token?.data?.id || "").split("_").slice(1).join("_"));
    return {
      chain, pool: String(a.address || ""), token, symbol: String(base.symbol || String(a.name || "").split(" / ")[0] || "?").slice(0, 16),
      name: String(base.name || a.name || "").slice(0, 40), image: typeof base.image_url === "string" && base.image_url.startsWith("https://") ? base.image_url : null,
      price: n(a.base_token_price_usd),
      change: Object.fromEntries(frames.map((f) => [f, num(a.price_change_percentage?.[f]) ?? 0])),
      volume: Object.fromEntries(frames.map((f) => [f, num(a.volume_usd?.[f]) ?? 0])),
      tx: { m15: tx("m15"), h1: tx("h1"), h24: tx("h24") },
      liquidity: n(a.reserve_in_usd), mcap: num(a.market_cap_usd) ?? num(a.fdv_usd),
      ageHours: a.pool_created_at ? (Date.now() - Date.parse(a.pool_created_at)) / 3_600_000 : null,
    } as Pool;
  }).filter((p: Pool) => p.pool && p.token);
}

async function getJson(url: string, revalidate: number) {
  const r = await fetch(url, { next: { revalidate }, signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
  return r.ok ? r.json() : null;
}

/** GoPlus safety for many tokens at once (one call per chain). */
async function safety(chain: MomentumChain, tokens: string[]) {
  const c = MOMENTUM_CHAINS.find((x) => x.key === chain)!;
  const out = new Map<string, Pool["safety"]>();
  if (!tokens.length) return out;
  try {
    const path = chain === "solana" ? "solana/token_security" : `token_security/${c.goplus}`;
    const j = await getJson(`https://api.gopluslabs.io/api/v1/${path}?contract_addresses=${tokens.join(",")}`, 900);
    const flag = (v: unknown) => (v === "1" || v === 1 ? true : v === "0" || v === 0 ? false : null);
    for (const [addr, x] of Object.entries<any>(j?.result || {})) {
      out.set(addr.toLowerCase(), {
        honeypot: flag(x.is_honeypot), mintable: chain === "solana" ? flag(x.mintable?.status) : flag(x.is_mintable),
        buyTax: x.buy_tax === "" || x.buy_tax == null ? null : n(x.buy_tax) * 100, sellTax: x.sell_tax === "" || x.sell_tax == null ? null : n(x.sell_tax) * 100,
      });
    }
  } catch { /* safety stays unknown */ }
  return out;
}

/** Ranked momentum picks for the chosen chains (cached about 2 minutes). */
export async function momentum(chains: MomentumChain[] = MOMENTUM_CHAINS.map((c) => c.key), revalidate = 120): Promise<Pick[]> {
  const lists = await Promise.all(chains.map(async (chain) => {
    const gt = MOMENTUM_CHAINS.find((c) => c.key === chain)!.gt;
    try {
      const j = await getJson(`${GT}/networks/${gt}/trending_pools?include=base_token&duration=1h&page=1`, revalidate);
      const pools = parsePools(chain, j);
      const sf = await safety(chain, [...new Set(pools.map((p) => p.token))].slice(0, 25));
      return pools.map((p) => ({ ...p, safety: sf.get(p.token.toLowerCase()) ?? null }));
    } catch { return []; }
  }));
  return rank(lists.flat());
}

/** Current USD price of up to 30 pools on one chain. */
async function poolPrices(chain: MomentumChain, pools: string[]) {
  const gt = MOMENTUM_CHAINS.find((c) => c.key === chain)!.gt;
  const out = new Map<string, number>();
  for (let i = 0; i < pools.length; i += 30) {
    const j = await getJson(`${GT}/networks/${gt}/pools/multi/${pools.slice(i, i + 30).join(",")}`, 60).catch(() => null);
    for (const d of j?.data || []) if (d?.attributes?.address) out.set(String(d.attributes.address).toLowerCase(), n(d.attributes.base_token_price_usd));
  }
  return out;
}

export type Record7d = { picks: number; hit2x: number; hit15: number; hitStop: number; best: { symbol: string; x: number } | null };

/** How the Hot picks of the last 7 days actually did (graded for 48 hours after each pick). */
export async function trackRecord(): Promise<Record7d> {
  const { data } = await supabaseService().from("momentum_picks").select("symbol,entry,peak,low").gt("picked_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).limit(2000);
  const rows = data || [];
  let best: Record7d["best"] = null;
  for (const r of rows) { const x = n(r.peak) / Math.max(n(r.entry), 1e-30); if (!best || x > best.x) best = { symbol: r.symbol, x }; }
  return {
    picks: rows.length,
    hit2x: rows.filter((r: any) => n(r.peak) >= n(r.entry) * 2).length,
    hit15: rows.filter((r: any) => n(r.peak) >= n(r.entry) * 1.5).length,
    hitStop: rows.filter((r: any) => n(r.low) <= n(r.entry) * 0.8 && n(r.peak) < n(r.entry) * 1.5).length,
    best,
  };
}

export async function getPrefs(userId: string): Promise<AlertPrefs> {
  const { data } = await supabaseService().from("momentum_alerts").select("*").eq("user_id", userId).maybeSingle();
  return data?.user_id ? { enabled: !!data.enabled, chains: data.chains || [], min_score: data.min_score, min_liquidity: Number(data.min_liquidity), max_mcap: data.max_mcap == null ? null : Number(data.max_mcap), follow_ups: !!data.follow_ups } : DEFAULT_PREFS;
}

/**
 * Runs every 5 minutes: records new Hot picks, follows up on the last 48 hours of picks (1.5x, 2x, stop), and alerts
 * members whose momentum alert settings match. Each member gets each token once, up to their daily limit.
 */
export async function runMomentum(deadline: number) {
  const sb = supabaseService();
  const picks = await momentum(undefined, 60);
  const now = new Date().toISOString();
  const pk = (p: { chain: string; pool: string }) => `${p.chain}:${p.pool.toLowerCase()}`;

  // 1. Remember new picks worth following (Hot ones the scanner says to buy).
  const hot = picks.filter((p) => p.level === "hot" && p.action === "buy");
  const { data: recent } = await sb.from("momentum_picks").select("id,chain,pool,symbol,token,entry,peak,low,tp1_at,tp2_at,stop_at,picked_at")
    .gt("picked_at", new Date(Date.now() - 48 * 3_600_000).toISOString()).limit(1000);
  const known = new Set((recent || []).map((r: any) => pk(r)));
  const fresh = hot.filter((p) => !known.has(pk(p)));
  if (fresh.length) {
    await sb.from("momentum_picks").insert(fresh.map((p) => ({ chain: p.chain, pool: p.pool.toLowerCase(), token: p.token, symbol: p.symbol, score: p.score, entry: p.price, peak: p.price, low: p.price, picked_at: now })));
  }

  // 2. Follow up on recent picks: update peak/low and spot 1.5x, 2x and stop-loss moments.
  const follow: { kind: "tp1" | "tp2" | "stop"; row: any; price: number }[] = [];
  const byChain = new Map<MomentumChain, any[]>();
  for (const r of recent || []) byChain.set(r.chain, [...(byChain.get(r.chain) || []), r]);
  for (const [chain, rows] of byChain) {
    if (Date.now() > deadline) break;
    const prices = await poolPrices(chain, rows.map((r) => r.pool));
    for (const r of rows) {
      const price = prices.get(r.pool);
      if (!price) continue;
      const up: any = {};
      if (price > n(r.peak)) up.peak = price;
      if (price < n(r.low)) up.low = price;
      if (!r.tp1_at && price >= n(r.entry) * 1.5) { up.tp1_at = now; follow.push({ kind: "tp1", row: r, price }); }
      if (!r.tp2_at && price >= n(r.entry) * 2) { up.tp2_at = now; follow.push({ kind: "tp2", row: r, price }); }
      if (!r.stop_at && !r.tp1_at && price <= n(r.entry) * 0.8) { up.stop_at = now; follow.push({ kind: "stop", row: r, price }); }
      if (Object.keys(up).length) await sb.from("momentum_picks").update(up).eq("id", r.id);
    }
  }

  // 3. Alerts.
  const { data: subs } = await sb.from("momentum_alerts").select("*").eq("enabled", true).limit(5000);
  if (!subs?.length) return { picks: picks.length, fresh: fresh.length, followUps: follow.length, sent: 0 };
  const pros = new Set(await proUsersOf(subs.map((s: any) => s.user_id)));
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { data: sentToday } = await sb.from("momentum_sent").select("user_id,kind").gt("sent_at", dayAgo).in("user_id", subs.map((s: any) => s.user_id));
  const count = new Map<string, number>();
  for (const s of sentToday || []) if (s.kind === "new") count.set(s.user_id, (count.get(s.user_id) || 0) + 1);
  const { data: already } = await sb.from("momentum_sent").select("user_id,chain,pool,kind").gt("sent_at", new Date(Date.now() - 48 * 3_600_000).toISOString()).in("user_id", subs.map((s: any) => s.user_id));
  const got = new Set((already || []).map((s: any) => `${s.user_id}|${s.chain}:${s.pool}|${s.kind}`));

  const notes: { user_id: string; title: string; body: string; link: string; strong: boolean }[] = [];
  const marks: { user_id: string; chain: string; pool: string; kind: string }[] = [];
  for (const s of subs) {
    const prefs: AlertPrefs = { enabled: true, chains: s.chains || [], min_score: s.min_score, min_liquidity: Number(s.min_liquidity), max_mcap: s.max_mcap == null ? null : Number(s.max_mcap), follow_ups: !!s.follow_ups };
    const limit = pros.has(s.user_id) ? PRO_ALERTS_PER_DAY : FREE_ALERTS_PER_DAY;
    let used = count.get(s.user_id) || 0;
    for (const p of picks) {
      if (used >= limit) break;
      if (!matches(p, prefs) || got.has(`${s.user_id}|${pk(p)}|new`)) continue;
      const why = p.signs.filter((x) => x.lean > 0).slice(0, 2).map((x) => x.text).join(" ");
      notes.push({
        user_id: s.user_id, strong: true, link: `/momentum?chain=${p.chain}#${p.pool.toLowerCase()}`,
        title: `🔥 $${p.symbol} is heating up on ${chainName(p.chain)} (${p.score}/100)`,
        body: `${why} Suggested buy ${usd(p.buy![0])}–${usd(p.buy![1])}, take profit ${usd(p.tp1)} (1.5x) and ${usd(p.tp2)} (2x), stop ${usd(p.stop)}. Suggestion only, not financial advice.`,
      });
      marks.push({ user_id: s.user_id, chain: p.chain, pool: p.pool.toLowerCase(), kind: "new" });
      used++;
    }
    // Follow-ups for tokens this member was alerted about.
    if (prefs.follow_ups) for (const f of follow) {
      const key = `${f.row.chain}:${f.row.pool}`;
      if (!got.has(`${s.user_id}|${key}|new`) || got.has(`${s.user_id}|${key}|${f.kind}`)) continue;
      const x = (f.price / n(f.row.entry)).toFixed(2);
      const T = {
        tp1: [`💰 $${f.row.symbol} hit 1.5x (${x}x)`, "First target reached. Many traders take some profit here and move their stop up to the buy price."],
        tp2: [`🚀 $${f.row.symbol} hit 2x (${x}x)!`, "Second target reached. Consider taking more profit; let only a small part ride."],
        stop: [`🛑 $${f.row.symbol} fell 20% from the pick`, "It reached the suggested stop. Many traders cut the loss here to protect their money."],
      }[f.kind];
      notes.push({ user_id: s.user_id, strong: true, link: `/momentum?chain=${f.row.chain}`, title: T[0], body: `${T[1]} Price ${usd(f.price)}. Not financial advice.` });
      marks.push({ user_id: s.user_id, chain: f.row.chain, pool: f.row.pool, kind: f.kind });
    }
  }
  if (marks.length) await sb.from("momentum_sent").upsert(marks.map((m) => ({ ...m, sent_at: now })), { onConflict: "user_id,chain,pool,kind", ignoreDuplicates: true });
  if (notes.length) await notify(notes);
  return { picks: picks.length, fresh: fresh.length, followUps: follow.length, sent: notes.length };
}
