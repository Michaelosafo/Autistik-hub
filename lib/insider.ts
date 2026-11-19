/**
 * Insider: read public posts the owner is tracking, score the caller from later prices, and
 * (when paper mode is off and the kill switch is up) buy with the owner's sniper wallets.
 * The minute cron does the work. A long-lived X filtered stream is optional (worker/insider-stream.mjs).
 */
import { supabaseService } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { dexSignals, extract, resolve, xPosts, type Flow } from "@/lib/ai-signals";
import { buyParallel, gate, sellSlots, tradeChain } from "@/lib/insider-trade";

const sb = () => supabaseService();
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const CHAINS = ["bsc", "ethereum", "base", "arbitrum", "solana", "polygon", "avalanche", "optimism"];
const GECKO: Record<string, string> = { bsc: "bsc", ethereum: "eth", base: "base", arbitrum: "arbitrum", solana: "solana", polygon: "polygon_pos", avalanche: "avax", optimism: "optimism" };

export type InsiderSettings = { killed: boolean; dry_run: boolean; tg_offset: number; last_run: string | null; last_note: string | null };
export type Source = { id: number; kind: "x" | "telegram" | "reddit" | "dex"; handle: string; enabled: boolean };
export type Rule = {
  id: number; caller: string | null; source_id: number | null; min_score: number; chains: string[]; max_buy_usd: number;
  wallets: number[]; max_per_hour: number; min_liq_usd: number; max_tax_pct: number; max_age_min: number;
  tp_multiple: number; sl_pct: number; max_hold_min: number; partial_pct: number | null; enabled: boolean;
};
type Call = {
  id: number; source_kind: string; who: string; chain: string; token: string; symbol: string | null; pool: string | null;
  url: string | null; posted_at: string; price_usd: number | null; liq_usd: number | null; pool_at: string | null;
  max_1h: number | null; max_6h: number | null; max_24h: number | null; multiple: number | null; hit_2x: boolean | null;
  early_min: number | null; peaks: Record<string, boolean>;
};
type Pos = {
  id: number; chain: string; token: string; symbol: string | null; wallet_slot: number | null; wallet: string | null;
  mode: "paper" | "live"; entry_usd: number; size_usd: number; remaining_pct: number; tx: string | null;
  status: string; pnl_usd: number | null; reason: string | null; opened_at: string; closed_at: string | null;
  tp_multiple: number; sl_pct: number; max_hold_min: number; partial_pct: number | null; took_partial: boolean; exit_usd: number | null;
};
type Post = { kind: "x" | "telegram" | "reddit"; who: string; text: string; url: string; at: number };

async function note(text: string) {
  await sb().from("insider_log").insert({ text: text.slice(0, 400) });
  await sb().from("insider_settings").update({ last_note: text.slice(0, 400), last_run: new Date().toISOString() }).eq("id", 1);
}

export async function insiderState() {
  const s = sb();
  const [settings, sources, rules, calls, positions, log] = await Promise.all([
    s.from("insider_settings").select("*").eq("id", 1).maybeSingle(),
    s.from("insider_sources").select("*").order("id"),
    s.from("insider_rules").select("*").order("id"),
    s.from("insider_calls").select("*").order("posted_at", { ascending: false }).limit(400),
    s.from("insider_positions").select("*").order("opened_at", { ascending: false }).limit(80),
    s.from("insider_log").select("at,text").order("at", { ascending: false }).limit(30),
  ]);
  const missing = settings.error?.message || sources.error?.message;
  const rows = (calls.data || []) as Call[];
  return {
    ready: !missing,
    setup: missing ? "Run supabase/2026-11-19-insider.sql in the Supabase SQL editor, then reload." : "",
    settings: (settings.data || { killed: false, dry_run: true, last_note: null, last_run: null }) as InsiderSettings,
    sources: (sources.data || []) as Source[],
    rules: (rules.data || []) as Rule[],
    calls: rows,
    positions: (positions.data || []) as Pos[],
    log: log.data || [],
    leaderboard: leaderboard(rows),
    discover: discover(rows, (sources.data || []) as Source[]),
    liveChains: Object.keys(WCHAINS_KEYS),
  };
}

const WCHAINS_KEYS = { bsc: 1, ethereum: 1, base: 1, arbitrum: 1, solana: 1 };

export function leaderboard(calls: Call[]) {
  const by = new Map<string, Call[]>();
  for (const c of calls) {
    const k = `${c.source_kind}:${c.who}`;
    by.set(k, [...(by.get(k) || []), c]);
  }
  return [...by.entries()].map(([key, list]) => {
    const [source_kind, who] = key.split(":");
    const s = scoreOf(list);
    return { source_kind, who, ...s };
  }).sort((a, b) => b.score - a.score).slice(0, 40);
}

function scoreOf(list: Call[]) {
  const priced = list.filter((c) => n(c.price_usd) > 0 && c.multiple != null);
  const hit = priced.length ? priced.filter((c) => c.hit_2x || n(c.multiple) >= 2).length / priced.length : 0;
  const multiples = priced.map((c) => n(c.multiple)).sort((a, b) => a - b);
  const median = multiples.length ? multiples[Math.floor((multiples.length - 1) / 2)] : 0;
  const earlies = list.map((c) => c.early_min).filter((x): x is number => x != null).sort((a, b) => a - b);
  const early = earlies.length ? earlies[Math.floor((earlies.length - 1) / 2)] : null;
  const earlyPts = early == null ? 0 : early <= 5 ? 20 : early <= 30 ? 12 : early <= 120 ? 6 : 0;
  const score = Math.round(hit * 50 + Math.min(30, Math.max(0, (median - 1) * 15)) + earlyPts);
  return { calls: list.length, priced: priced.length, hit, median, early, score };
}

function discover(calls: Call[], sources: Source[]) {
  const tracked = new Set(sources.filter((s) => s.kind !== "dex").map((s) => s.handle.replace(/^@/, "").toLowerCase()));
  return leaderboard(calls).filter((r) => r.source_kind !== "dex" && r.priced >= 2 && (r.early == null || r.early <= 30) && !tracked.has(r.who.replace(/^@/, "").toLowerCase())).slice(0, 12);
}

export async function runInsider(deadline = Date.now() + 45_000) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "no database" };
  const state = await insiderState();
  if (!state.ready) return { error: state.setup };
  const { settings, sources, rules } = state;
  const posts = await collect(sources.filter((s) => s.enabled), settings.tg_offset).catch((e) => {
    console.error("insider collect:", (e as Error).message);
    return [] as Post[];
  });
  let added = 0;
  for (const post of posts) {
    if (Date.now() > deadline) break;
    added += await ingest(post);
  }
  await refresh(deadline);
  await exits(settings, deadline);
  const bought = settings.killed ? 0 : await entries(settings, rules, deadline);
  const line = `Checked ${posts.length} posts, saved ${added} calls, opened ${bought} buy${bought === 1 ? "" : "s"}.${settings.killed ? " Kill switch is on." : ""}${settings.dry_run ? " Paper mode." : " Live."}`;
  await note(line);
  return { posts: posts.length, added, bought, dry_run: settings.dry_run, killed: settings.killed };
}

async function collect(sources: Source[], tgOffset: number): Promise<Post[]> {
  const posts: Post[] = [];
  const xs = sources.filter((s) => s.kind === "x").map((s) => s.handle);
  if (xs.length) {
    const tw = await xPosts(xs).catch(() => []);
    for (const t of tw) posts.push({ kind: "x", who: t.user || "x", text: t.text, url: t.url, at: t.at });
  }
  const tgs = sources.filter((s) => s.kind === "telegram").map((s) => s.handle.replace(/^@/, ""));
  posts.push(...await telegramBot(tgs, tgOffset));
  posts.push(...await telegramSession(tgs));
  for (const s of sources.filter((x) => x.kind === "reddit")) posts.push(...await reddit(s.handle));
  if (sources.some((s) => s.kind === "dex")) {
    const sigs = await dexSignals(CHAINS).catch(() => []);
    for (const sig of sigs.slice(0, 8)) {
      const flow = await resolve({ chain: sig.chain, token: sig.token }, CHAINS).catch(() => null);
      if (flow) await saveCall("dex", "DexScreener", flow, sig.url || `https://dexscreener.com/${sig.chain}/${sig.token}`, sig.at);
    }
  }
  return posts;
}

async function telegramBot(handles: string[], offset: number): Promise<Post[]> {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!token || !handles.length) return [];
  const want = new Set(handles.map((h) => h.toLowerCase()));
  const j = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=0&offset=${offset}&allowed_updates=${encodeURIComponent(JSON.stringify(["message", "channel_post"]))}`, { signal: AbortSignal.timeout(12_000) }).then((r) => r.json()).catch(() => null);
  const updates: any[] = j?.result || [];
  if (updates.length) await sb().from("insider_settings").update({ tg_offset: Number(updates[updates.length - 1].update_id) + 1 }).eq("id", 1);
  const out: Post[] = [];
  for (const u of updates) {
    const m = u.channel_post || u.message;
    if (!m?.text && !m?.caption) continue;
    const user = String(m.chat?.username || "").toLowerCase();
    if (!want.has(user)) continue;
    out.push({ kind: "telegram", who: user, text: String(m.text || m.caption), url: `https://t.me/${user}/${m.message_id}`, at: Number(m.date) * 1000 || Date.now() });
  }
  return out;
}

async function telegramSession(handles: string[]): Promise<Post[]> {
  const apiId = Number(process.env.TELEGRAM_API_ID || 0);
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  const session = process.env.TELEGRAM_SESSION || "";
  if (!apiId || !apiHash || !session || !handles.length) return [];
  try {
    const { TelegramClient } = await import("telegram");
    const { StringSession } = await import("telegram/sessions");
    const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 1 });
    await client.connect();
    const out: Post[] = [];
    for (const h of handles.slice(0, 6)) {
      const msgs: any[] = await client.getMessages(h, { limit: 12 });
      for (const m of msgs) {
        const text = String(m.message || "");
        if (!text) continue;
        out.push({ kind: "telegram", who: h.toLowerCase(), text, url: `https://t.me/${h}/${m.id}`, at: (Number(m.date) || Date.now() / 1000) * 1000 });
      }
    }
    await client.disconnect();
    return out;
  } catch (e) {
    await note(`Telegram session: ${(e as Error).message?.slice(0, 160) || "couldn't connect"}`);
    return [];
  }
}

async function reddit(handle: string): Promise<Post[]> {
  const h = handle.replace(/^\/?(r\/|u\/)/, "").replace(/^@/, "");
  const kind = /^u\//i.test(handle) || handle.startsWith("u/") ? "user" : "r";
  const url = kind === "user" ? `https://www.reddit.com/user/${h}/submitted.json?limit=20` : `https://www.reddit.com/r/${h}/new.json?limit=20`;
  const j = await fetch(url, { headers: { "user-agent": "autistik-hub/insider" }, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
  const kids: any[] = j?.data?.children || [];
  return kids.map((k) => k.data).filter(Boolean).map((d) => ({
    kind: "reddit" as const,
    who: kind === "user" ? String(d.author || h) : `r/${h}`,
    text: `${d.title || ""}\n${d.selftext || ""}`,
    url: `https://www.reddit.com${d.permalink || ""}`,
    at: Number(d.created_utc) * 1000 || Date.now(),
  }));
}

async function ingest(post: Post): Promise<number> {
  const { evm, sol, tickers } = extract(post.text);
  const refs = [
    ...evm.map((token) => ({ token })),
    ...sol.map((token) => ({ token, chain: "solana" })),
    ...(evm.length || sol.length ? [] : tickers.slice(0, 1).map((ticker) => ({ ticker }))),
  ].slice(0, 3);
  let nSaved = 0;
  for (const ref of refs) {
    const flow = await resolve(ref, CHAINS).catch(() => null);
    if (flow && await saveCall(post.kind, post.who, flow, post.url, post.at)) nSaved++;
  }
  return nSaved;
}

async function saveCall(kind: string, who: string, flow: Flow, url: string, at: number): Promise<boolean> {
  const posted = new Date(at || Date.now()).toISOString();
  const poolAt = flow.ageHours < 900 ? new Date(Date.now() - flow.ageHours * 36e5).toISOString() : null;
  const early = poolAt ? (new Date(posted).getTime() - new Date(poolAt).getTime()) / 60_000 : null;
  const row = {
    source_kind: kind, who: who.slice(0, 80), chain: flow.chain, token: flow.chain === "solana" ? flow.token : flow.token.toLowerCase(),
    symbol: flow.symbol, pool: flow.pool, url: url.slice(0, 300), posted_at: posted, price_usd: flow.price || null,
    liq_usd: flow.liquidity || null, pool_at: poolAt, early_min: early, max_1h: flow.price || null, multiple: 1, hit_2x: false,
  };
  const { error } = await sb().from("insider_calls").insert(row);
  return !error;
}

async function refresh(deadline: number) {
  const since = new Date(Date.now() - 26 * 36e5).toISOString();
  const { data } = await sb().from("insider_calls").select("*").gte("posted_at", since).order("posted_at", { ascending: false }).limit(25);
  for (const raw of (data || []) as Call[]) {
    if (Date.now() > deadline) break;
    const flow = await resolve({ chain: raw.chain, token: raw.token }, [raw.chain]).catch(() => null);
    const ageMin = (Date.now() - new Date(raw.posted_at).getTime()) / 60_000;
    let max1 = n(raw.max_1h), max6 = n(raw.max_6h), max24 = n(raw.max_24h);
    const spot = flow?.price || 0;
    if (spot > 0 && ageMin <= 60) max1 = Math.max(max1, spot);
    if (spot > 0 && ageMin <= 360) max6 = Math.max(max6, spot);
    if (spot > 0 && ageMin <= 1440) max24 = Math.max(max24, spot);
    const peaks = { ...(raw.peaks || {}) };
    const high = async (key: string, from: number, to: number) => {
      if (peaks[key] || !raw.pool || raw.pool.startsWith("curve:")) return;
      const h = await geckoHigh(raw.chain, raw.pool, from, to);
      if (h) { if (key === "g1") max1 = Math.max(max1, h); if (key === "g6") max6 = Math.max(max6, h); if (key === "g24") max24 = Math.max(max24, h); peaks[key] = true; }
    };
    const posted = new Date(raw.posted_at).getTime();
    if (ageMin >= 60) await high("g1", posted, posted + 36e5);
    if (ageMin >= 360) await high("g6", posted, posted + 6 * 36e5);
    if (ageMin >= 1440) await high("g24", posted, posted + 24 * 36e5);
    const peak = Math.max(max1, max6, max24, spot);
    const multiple = n(raw.price_usd) > 0 ? peak / n(raw.price_usd) : null;
    await sb().from("insider_calls").update({
      max_1h: max1 || null, max_6h: max6 || null, max_24h: max24 || null, multiple, hit_2x: multiple != null && multiple >= 2, peaks, liq_usd: flow?.liquidity || raw.liq_usd,
    }).eq("id", raw.id);
  }
}

async function geckoHigh(chain: string, pool: string, from: number, to: number): Promise<number | null> {
  const net = GECKO[chain];
  if (!net) return null;
  const j = await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pool}/ohlcv/minute?aggregate=5&limit=300&currency=usd`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
  const rows: number[][] = j?.data?.attributes?.ohlcv_list || [];
  let max = 0;
  for (const row of rows) {
    const t = Number(row[0]) * 1000;
    if (t >= from && t <= to) max = Math.max(max, Number(row[2]) || 0);
  }
  return max || null;
}

async function entries(settings: InsiderSettings, rules: Rule[], deadline: number): Promise<number> {
  const { data } = await sb().from("insider_calls").select("*").order("posted_at", { ascending: false }).limit(30);
  const calls = (data || []) as Call[];
  const { data: recentPos } = await sb().from("insider_positions").select("token,chain,opened_at").gte("opened_at", new Date(Date.now() - 36e5).toISOString());
  const hour = (recentPos || []) as { token: string; chain: string }[];
  let bought = 0;
  let solNote = false;
  for (const call of calls) {
    if (Date.now() > deadline || bought >= 3) break;
    if (Date.now() - new Date(call.posted_at).getTime() > 15 * 60_000) continue;
    if (hour.some((p) => p.chain === call.chain && p.token === call.token)) continue;
    const { data: openSame } = await sb().from("insider_positions").select("id").eq("status", "open").eq("chain", call.chain).eq("token", call.token).limit(1);
    if (openSame?.length) continue;
    const rule = pickRule(rules, call.who);
    if (!rule || !rule.chains.includes(call.chain)) continue;
    const { data: history } = await sb().from("insider_calls").select("*").eq("who", call.who).eq("source_kind", call.source_kind).limit(200);
    const score = scoreOf((history || []) as Call[]).score;
    if (score < n(rule.min_score)) continue;
    if (n(call.liq_usd) < n(rule.min_liq_usd)) continue;
    const ageMin = call.pool_at ? (Date.now() - new Date(call.pool_at).getTime()) / 60_000 : 9999;
    if (ageMin > n(rule.max_age_min)) continue;
    if (hour.length >= n(rule.max_per_hour)) continue;
    const safe = await gate(call.chain, call.token, n(rule.max_tax_pct));
    if (!safe.ok) { await note(`Skipped ${call.symbol || call.token.slice(0, 8)} (${call.who}): ${safe.reason}`); continue; }
    const chainOk = tradeChain(call.chain);
    const live = !settings.dry_run && !!chainOk && chainOk.kind === "evm";
    if (!settings.dry_run && !live && !solNote) {
      solNote = true;
      await note("Solana stays on paper. Live buys use the EVM sniper wallets (BNB, Ethereum, Base, Arbitrum).");
    }
    const mode = live ? "live" : "paper";
    if (mode === "live") {
      const hits = await buyParallel(call.chain, call.token, n(rule.max_buy_usd), rule.wallets.map(Number).filter((x) => x >= 1 && x <= 13));
      for (const hit of hits) {
        if (!hit.tx) { if (hit.error) await note(`Wallet ${hit.slot}: ${hit.error}`); continue; }
        await openPos(call, rule, "live", hit.slot, hit.wallet || null, hit.tx);
        logActivity(null, "swap", `Insider live buy ${call.symbol || ""} ${call.chain} wallet ${hit.slot}`.trim(), "/admin/insider", { chain: call.chain, tx: hit.tx });
        bought++;
      }
    } else {
      await openPos(call, rule, "paper", rule.wallets[0] ?? null, null, null);
      logActivity(null, "swap", `Insider paper buy ${call.symbol || ""} ${call.chain} (${call.who})`.trim(), "/admin/insider", { chain: call.chain });
      bought++;
    }
    hour.push({ token: call.token, chain: call.chain });
  }
  return bought;
}

function pickRule(rules: Rule[], who: string): Rule | null {
  const on = rules.filter((r) => r.enabled);
  return on.find((r) => r.caller && r.caller.replace(/^@/, "").toLowerCase() === who.replace(/^@/, "").toLowerCase())
    || on.find((r) => !r.caller && !r.source_id)
    || null;
}

async function openPos(call: Call, rule: Rule, mode: "paper" | "live", slot: number | null, wallet: string | null, tx: string | null) {
  await sb().from("insider_positions").insert({
    call_id: call.id, chain: call.chain, token: call.token, symbol: call.symbol, wallet_slot: slot, wallet, mode,
    entry_usd: n(call.price_usd), size_usd: n(rule.max_buy_usd), tx, tp_multiple: n(rule.tp_multiple) || 2,
    sl_pct: n(rule.sl_pct) || 40, max_hold_min: n(rule.max_hold_min) || 360, partial_pct: rule.partial_pct,
  });
}

async function exits(settings: InsiderSettings, deadline: number) {
  const { data } = await sb().from("insider_positions").select("*").eq("status", "open").limit(20);
  for (const p of (data || []) as Pos[]) {
    if (Date.now() > deadline) break;
    const flow = await resolve({ chain: p.chain, token: p.token }, [p.chain]).catch(() => null);
    const px = flow?.price || 0;
    if (!(px > 0) || !(n(p.entry_usd) > 0)) continue;
    const mult = px / n(p.entry_usd);
    const age = (Date.now() - new Date(p.opened_at).getTime()) / 60_000;
    const tp = n(p.tp_multiple) || 2;
    const sl = n(p.sl_pct) || 40;
    let reason = "";
    let pct = 100;
    if (!p.took_partial && p.partial_pct && mult >= tp) { reason = "take profit"; pct = Math.min(99, Math.max(1, Math.round(n(p.partial_pct)))); }
    else if (mult >= tp) reason = "take profit";
    else if (mult <= 1 - sl / 100) reason = "stop";
    else if (age >= n(p.max_hold_min)) reason = "time";
    if (!reason) continue;
    if (p.mode === "live" && !settings.killed) {
      const hits = await sellSlots(p.chain, p.token, p.wallet_slot ? [{ slot: p.wallet_slot }] : [], pct);
      const ok = hits.find((h) => h.tx);
      if (!ok) { await note(`Sell ${p.symbol || p.token.slice(0, 8)} did not land: ${hits[0]?.error || "no route"}`); continue; }
      await closePos(p, px, reason, pct, ok.tx || null);
      logActivity(null, "swap", `Insider sell ${p.symbol || ""} ${reason}`.trim(), "/admin/insider", { chain: p.chain, tx: ok.tx });
    } else {
      await closePos(p, px, p.mode === "paper" ? reason : `${reason} (kill switch: paper mark)`, pct, null);
      logActivity(null, "swap", `Insider ${p.mode} sell ${p.symbol || ""} ${reason}`.trim(), "/admin/insider", { chain: p.chain });
    }
  }
}

async function closePos(p: Pos, px: number, reason: string, pct: number, tx: string | null) {
  const part = pct < 100;
  const pnl = n(p.size_usd) * (px / n(p.entry_usd) - 1) * (pct / 100);
  if (part) {
    await sb().from("insider_positions").update({
      took_partial: true, remaining_pct: Math.max(0, n(p.remaining_pct) - pct), exit_tx: tx, reason: `Sold ${pct}% at ${reason}`,
    }).eq("id", p.id);
    return;
  }
  const full = n(p.size_usd) * (n(p.remaining_pct) / 100) * (px / n(p.entry_usd) - 1);
  await sb().from("insider_positions").update({
    status: reason === "take profit" ? "tp" : reason.startsWith("stop") ? "sl" : "time",
    exit_usd: px, pnl_usd: (p.took_partial ? pnl : 0) + full, reason, exit_tx: tx, closed_at: new Date().toISOString(), remaining_pct: 0,
  }).eq("id", p.id);
}

/** A Railway worker (or anything with the cron key) can push posts it already read. */
export async function ingestPushed(posts: Post[]) {
  let added = 0;
  for (const p of posts.slice(0, 20)) added += await ingest(p);
  return { added };
}
