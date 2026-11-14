/**
 * Caller scout. Learns who calls winners, then trades them from a capped budget.
 *
 * 1. Reads every group / channel the Telegram account is in (not only the ones picked for copy trading) and public
 *    ones added by link, plus the X accounts / lists you follow. Every contract address posted is a "call": who
 *    posted it first in that chat, and when. A chat's first read takes its last 100 messages, so it learns at once.
 * 2. Scores each call against real prices: the coin's 15-minute candles (GeckoTerminal) from the moment of the call
 *    to 24 hours later give the price at the call, the highest price after it, how fast it doubled, and whether it
 *    collapsed (a rug).
 * 3. Ranks callers (a person in groups, or an X account) by how many of their calls reached the target multiple
 *    (3x by default) within 24 hours, and groups by how many of their calls doubled fast (within 30 minutes).
 * 4. Follows the ones that clear your bar: a top caller is added as a caller (in all groups) and marked trusted; a
 *    fast-pumping group is added to the live watch (every call there is bought). Ones that fall below the bar are
 *    dropped again. Their trades come out of the scout budget only (lib/ai-trader.ts: pot "scout").
 *
 * Win rates from a handful of calls are luck as often as skill, and callers delete or edit losing calls: the minimum
 * number of calls (5 by default) is there for that, and the scoreboard shows every number so you can judge.
 */
import { supabaseService } from "@/lib/supabase/server";
import { T, tq } from "@/lib/ai-trader-ctx";
import { extract } from "@/lib/ai-signals";
import { tgaSavedChats, tgaScoutRead } from "@/lib/tg-account";

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const GT_NET: Record<string, string> = { solana: "solana", bsc: "bsc", ethereum: "eth", base: "base", arbitrum: "arbitrum" };
const DS_CHAIN = new Set(Object.keys(GT_NET));

export type ScoutSettings = {
  scout_on: boolean; scout_budget: number; scout_trade_usd: number; scout_min_win: number; scout_min_calls: number;
  scout_multiple: number; scout_fast_min: number; scout_group_rate: number; scout_trust_skip: boolean; scout_honeypot_trusted: boolean;
};

async function settings(): Promise<ScoutSettings & { use_x: boolean }> {
  const { data } = await supabaseService().from("ai_trader_settings").select("scout_on,scout_budget,scout_trade_usd,scout_min_win,scout_min_calls,scout_multiple,scout_fast_min,scout_group_rate,scout_trust_skip,scout_honeypot_trusted,use_x").eq("id", T()).single();
  const s = (data || {}) as any;
  for (const k of ["scout_budget", "scout_trade_usd", "scout_min_win", "scout_min_calls", "scout_multiple", "scout_fast_min", "scout_group_rate"]) s[k] = n(s[k]);
  return s;
}
const log = (kind: string, text: string) => tq("ai_trader_log").insert({ kind, text: text.slice(0, 600) }).then(() => {}, () => {});

// ---------------------------------------------------------------- 1. Collect calls

/** Records the first call of each coin in each chat (who posted it and when). */
async function record(platform: "tg" | "x", chatRef: string, chatTitle: string, posts: { text: string; at: number; who: string }[]) {
  const rows: any[] = [];
  const seen = new Set<string>();
  for (const p of posts.sort((a, b) => a.at - b.at)) {
    const { evm, sol } = extract(p.text);
    for (const [chain, token] of [...sol.map((t) => ["solana", t]), ...evm.map((t) => ["", t.toLowerCase()])] as [string, string][]) {
      if (seen.has(token)) continue;
      seen.add(token);
      rows.push({ platform, chat_ref: chatRef, chat_title: chatTitle.slice(0, 120), who: p.who.slice(0, 64), chain: chain || "evm", token, called_at: new Date(p.at).toISOString() });
    }
  }
  if (rows.length) await tq("ai_scout_calls").upsert(rows.slice(0, 200), { onConflict: "trader_id,platform,chat_ref,token", ignoreDuplicates: true });
  return rows.length;
}

/**
 * Every minute (after the live watch): reads a few of the chats it's learning from. Keeps the list in step with every
 * group / channel the Telegram account is in.
 */
export async function scoutTick(budgetMs = 8_000) {
  const s = await settings();
  if (!s.scout_on) return;
  // New chats the account joined since: add them (all groups and channels, not only the ones you copy trade).
  const saved = await tgaSavedChats().catch(() => []);
  if (saved.length) await tq("ai_scout_chats").upsert(saved.map((c) => ({ ref: c.ref, title: c.title, kind: c.kind, username: c.username })), { onConflict: "trader_id,ref", ignoreDuplicates: true });
  const { data } = await tq("ai_scout_chats").select("ref,title,username,last_msg_id").eq("enabled", true).order("scanned_at", { ascending: true, nullsFirst: true }).limit(8);
  const chats = (data || []) as { ref: string; title: string | null; username: string | null; last_msg_id: number | null }[];
  const reads = await tgaScoutRead(chats, budgetMs);
  for (const r of reads) {
    const ch = chats.find((c) => c.ref === r.ref);
    await tq("ai_scout_chats").update({ last_msg_id: r.top, scanned_at: new Date().toISOString() }).eq("ref", r.ref);
    // Channel posts are the channel's own call (who = ""); in groups, the person who posted (username, else user id).
    await record("tg", r.ref, ch?.title || "Telegram", r.posts.filter((p) => !p.isBot).map((p) => ({ text: p.text, at: p.at, who: p.isChannel ? "" : p.from?.username || p.from?.id || "" })));
  }
}

/** X: the accounts / lists you follow (the posts the copy trader already reads), recorded as calls by their author. */
export async function scoutX(posts: { text: string; user: string; at: number }[]) {
  const s = await settings();
  if (!s.scout_on || !posts.length) return;
  const by = new Map<string, { text: string; at: number; who: string }[]>();
  for (const p of posts) { const h = String(p.user || "").replace(/^@/, "").toLowerCase(); if (!h) continue; by.set(h, [...(by.get(h) || []), { text: p.text, at: p.at, who: h }]); }
  for (const [h, list] of by) await record("x", "x", `X · @${h}`, list);
}

// ---------------------------------------------------------------- 2. Score calls against real prices

/** The coin's main pool, chain and symbol (DexScreener; an EVM address is looked up on every chain). */
async function poolOf(chain: string, token: string): Promise<{ chain: string; pool: string; symbol: string } | null> {
  const url = chain === "solana" ? `https://api.dexscreener.com/tokens/v1/solana/${token}` : `https://api.dexscreener.com/latest/dex/tokens/${token}`;
  const j = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
  const pairs: any[] = (Array.isArray(j) ? j : j?.pairs || []).filter((p: any) => DS_CHAIN.has(p?.chainId) && String(p?.baseToken?.address || "").toLowerCase() === token.toLowerCase());
  const best = pairs.sort((a, b) => n(b?.liquidity?.usd) - n(a?.liquidity?.usd))[0];
  return best ? { chain: best.chainId, pool: best.pairAddress, symbol: best.baseToken?.symbol || "" } : null;
}

/** 15-minute candles from the call to 24h after (or now): price at the call, the peak, when it doubled, the latest. */
async function candles(chain: string, pool: string, from: number) {
  const until = Math.min(Date.now(), from + 24 * 36e5);
  const url = `https://api.geckoterminal.com/api/v2/networks/${GT_NET[chain]}/pools/${pool}/ohlcv/minute?aggregate=15&limit=100&currency=usd&before_timestamp=${Math.floor(until / 1000) + 900}`;
  const j = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const list: number[][] = (j?.data?.attributes?.ohlcv_list || []).map((x: any[]) => x.map(Number)).filter((x: number[]) => x[0] * 1000 >= from - 15 * 60_000 && x[0] * 1000 <= until).sort((a: number[], b: number[]) => a[0] - b[0]);
  if (!list.length) return null;
  const price0 = list[0][1] || list[0][4];
  if (!(price0 > 0)) return null;
  let peak = 0, peakAt = 0, x2At: number | null = null;
  for (const [t, , h] of list) { if (h > peak) { peak = h; peakAt = t * 1000; } if (x2At == null && h >= price0 * 2) x2At = t * 1000; }
  return { price0, peak, peakAt, x2At, last: list[list.length - 1][4] };
}

/** Every 5 minutes: scores up to 12 calls (each re-scored as its 24 hours fill in; final after 24h). */
export async function scoutScore() {
  const s = await settings();
  if (!s.scout_on) return;
  const old = new Date(Date.now() - 20 * 60_000).toISOString();
  const { data } = await tq("ai_scout_calls").select("id,chain,token,called_at,checked_at").eq("final", false).lt("called_at", old)
    .or(`checked_at.is.null,checked_at.lt.${new Date(Date.now() - 45 * 60_000).toISOString()}`).order("checked_at", { ascending: true, nullsFirst: true }).limit(12);
  for (const c of (data || []) as any[]) {
    const at = Date.parse(c.called_at);
    const done = Date.now() - at > 24 * 36e5;
    const pool = await poolOf(c.chain, c.token).catch(() => null);
    const k = pool ? await candles(pool.chain, pool.pool, at).catch(() => null) : null;
    const tooOld = Date.now() - at > 7 * 864e5;
    await tq("ai_scout_calls").update(k ? {
      chain: pool!.chain, symbol: pool!.symbol || null, price0: k.price0, peak: k.peak, peak_at: k.peakAt ? new Date(k.peakAt).toISOString() : null, last: k.last,
      x2_at: k.x2At ? new Date(k.x2At).toISOString() : null, rugged: k.last < k.price0 * 0.1, final: done, checked_at: new Date().toISOString(),
    } : { checked_at: new Date().toISOString(), final: done && tooOld, ...(pool ? { chain: pool.chain, symbol: pool.symbol || null } : {}) }).eq("id", c.id);
  }
}

// ---------------------------------------------------------------- 3. Rank, 4. follow the best

export type Row = { key: string; platform: "tg" | "x"; who: string; chats: string[]; calls: number; wins: number; winRate: number; medianPeak: number; rugRate: number; fastRate: number; following: boolean; rugs: number; priced: number };

/** The scoreboard: callers (people / X accounts) and groups, from scored calls of the last 30 days. */
export async function scoutBoard(): Promise<{ callers: Row[]; groups: Row[]; calls: number; scored: number; chats: number }> {
  const s = await settings();
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data }, { count: chats }, { data: fc }, { data: fs }] = await Promise.all([
    tq("ai_scout_calls").select("platform,chat_ref,chat_title,who,price0,peak,x2_at,called_at,rugged,checked_at").gte("called_at", since).limit(5000),
    tq("ai_scout_chats").select("ref", { count: "exact", head: true }).eq("enabled", true),
    tq("ai_trader_callers").select("platform,who").eq("scout", true),
    tq("ai_trader_sources").select("ref").eq("scout", true).eq("scout_kind", "group").eq("enabled", true),
  ]);
  const all = (data || []) as any[];
  // Scored: 24h passed (or already hit the target, which can't un-happen).
  const mult = s.scout_multiple > 1 ? s.scout_multiple : 3, fastMs = (s.scout_fast_min || 30) * 60_000;
  const scored = all.filter((c) => n(c.price0) > 0 && (Date.now() - Date.parse(c.called_at) > 24 * 36e5 || n(c.peak) >= n(c.price0) * mult));
  // Rugs over EVERY priced call in the 30 days (not only scored ones): a caller whose coin rugged an hour ago counts.
  const rugsBy = new Map<string, { rugs: number; priced: number }>();
  for (const c of all) {
    if (!(n(c.price0) > 0) || !c.who) continue;
    const k = `${c.platform}:${c.who}`, r = rugsBy.get(k) || { rugs: 0, priced: 0 };
    r.priced++; if (c.rugged) r.rugs++;
    rugsBy.set(k, r);
  }
  const followC = new Set(((fc || []) as any[]).map((r) => `${r.platform}:${r.who}`)), followG = new Set(((fs || []) as any[]).map((r) => r.ref));
  const agg = (list: any[], key: (c: any) => string | null, label: (c: any) => { platform: "tg" | "x"; who: string }, follow: (k: string) => boolean): Row[] => {
    const m = new Map<string, any[]>();
    for (const c of list) { const k = key(c); if (k) m.set(k, [...(m.get(k) || []), c]); }
    return [...m.entries()].map(([k, cs]) => {
      const peaks = cs.map((c) => n(c.peak) / n(c.price0)).sort((a, b) => a - b);
      const wins = cs.filter((c) => n(c.peak) >= n(c.price0) * mult).length;
      return {
        key: k, ...label(cs[0]), chats: [...new Set(cs.map((c) => String(c.chat_title || "")))].slice(0, 3), calls: cs.length, wins,
        winRate: (wins / cs.length) * 100, medianPeak: peaks[Math.floor(peaks.length / 2)] || 0,
        rugRate: (cs.filter((c) => c.rugged).length / cs.length) * 100,
        fastRate: (cs.filter((c) => c.x2_at && Date.parse(c.x2_at) - Date.parse(c.called_at) <= fastMs).length / cs.length) * 100,
        following: follow(k),
        rugs: rugsBy.get(k)?.rugs ?? cs.filter((c) => c.rugged).length, priced: rugsBy.get(k)?.priced ?? cs.length,
      };
    }).sort((a, b) => b.winRate - a.winRate || b.calls - a.calls);
  };
  const callers = agg(scored, (c) => (c.who ? `${c.platform}:${c.who}` : null), (c) => ({ platform: c.platform, who: c.who }), (k) => followC.has(k));
  const groups = agg(scored.filter((c) => c.platform === "tg"), (c) => c.chat_ref, (c) => ({ platform: "tg", who: c.chat_title || "Telegram" }), (k) => followG.has(k))
    .sort((a, b) => b.fastRate - a.fastRate || b.calls - a.calls);
  return { callers: callers.slice(0, 40), groups: groups.slice(0, 40), calls: all.length, scored: scored.length, chats: chats || 0 };
}

/**
 * Every 5 minutes: follows callers and groups that clear the bar, drops scout-followed ones that no longer do.
 * Callers you added yourself are never touched.
 */
export async function scoutFollow() {
  const s = await settings();
  if (!s.scout_on) return;
  const b = await scoutBoard();
  const minCalls = Math.max(3, s.scout_min_calls || 5);
  // Callers must have a clean record: not a single rugged coin in the last 30 days, as well as the win rate.
  const goodC = b.callers.filter((r) => r.calls >= minCalls && r.winRate >= s.scout_min_win && r.rugs === 0);
  const goodG = b.groups.filter((r) => r.calls >= minCalls && r.fastRate >= s.scout_group_rate && r.rugRate < 34);
  const { data: mineC } = await tq("ai_trader_callers").select("id,platform,who,scout");
  const have = new Map(((mineC || []) as any[]).map((r) => [`${r.platform}:${r.who}`, r]));
  for (const r of goodC) {
    if (have.has(r.key)) continue; // already followed (by you, or by the scout)
    await tq("ai_trader_callers").insert({ platform: r.platform, who: r.who, usd: s.scout_trade_usd || 5, chat: "", scout: true, trusted: true });
    await log("settings", `🔎 Scout: following ${r.platform === "x" ? "X " : ""}@${r.who}: ${r.wins} of ${r.calls} calls reached ${s.scout_multiple}x (${Math.round(r.winRate)}%), median peak ${r.medianPeak.toFixed(1)}x. Trusted, buys from the scout budget.`);
  }
  for (const [k, row] of have) if (row.scout && !goodC.some((r) => r.key === k)) {
    await tq("ai_trader_callers").delete().eq("id", row.id);
    const r = b.callers.find((x) => x.key === k);
    await log("settings", `🔎 Scout: stopped following @${row.who} (${r?.rugs ? `${r.rugs} of ${r.priced} calls rugged` : "no longer clears the bar"}).`);
  }
  // Groups: watch them live (every call there is bought from the scout budget). Also the chats top callers post in.
  const { data: srcs } = await tq("ai_trader_sources").select("id,ref,enabled,scout,scout_kind").eq("kind", "tg_chat");
  const byRef = new Map(((srcs || []) as any[]).map((r) => [r.ref, r]));
  const { data: chatRows } = await tq("ai_scout_chats").select("ref,title,username");
  const info = new Map(((chatRows || []) as any[]).map((r) => [r.ref, r]));
  const callerChats = new Set<string>();
  if (goodC.length) {
    const { data: cc } = await tq("ai_scout_calls").select("chat_ref,who").eq("platform", "tg").in("who", goodC.filter((r) => r.platform === "tg").map((r) => r.who).slice(0, 50));
    for (const r of (cc || []) as any[]) callerChats.add(r.chat_ref);
  }
  const want = new Map<string, "group" | "caller">([...[...callerChats].map((r) => [r, "caller"] as const), ...goodG.map((g) => [g.key, "group"] as const)]);
  for (const [ref, kind] of want) {
    const cur = byRef.get(ref);
    if (cur && !cur.scout) continue; // you already follow it yourself
    const i = info.get(ref);
    if (!cur) {
      await tq("ai_trader_sources").insert({ kind: "tg_chat", ref, title: i?.title || ref, handle: i?.username || null, enabled: true, scout: true, scout_kind: kind });
      if (kind === "group") await log("settings", `🔎 Scout: watching "${i?.title || ref}" live: its calls doubled fast often enough. Every call there buys from the scout budget.`);
    } else if (!cur.enabled || cur.scout_kind !== kind) await tq("ai_trader_sources").update({ enabled: true, scout_kind: kind }).eq("id", cur.id);
  }
  for (const r of (srcs || []) as any[]) if (r.scout && r.enabled && !want.has(r.ref)) await tq("ai_trader_sources").update({ enabled: false }).eq("id", r.id);
}

// ---------------------------------------------------------------- Budget

/**
 * What the scout may still put into trades: the budget plus what its trades made or lost so far, minus what's in
 * open scout trades now. It never spends past this (a loss shrinks it, a win grows it).
 */
export async function scoutAvailable(budget: number, bnbUsd: number): Promise<{ avail: number; inTrades: number; pnl: number }> {
  const [{ data: open }, { data: closed }] = await Promise.all([
    tq("ai_trader_positions").select("spent").eq("pot", "scout").in("status", ["open", "closing"]),
    tq("ai_trader_positions").select("pnl").eq("pot", "scout").eq("status", "closed"),
  ]);
  const inTrades = ((open || []) as any[]).reduce((a, p) => a + n(p.spent), 0) * bnbUsd;
  const pnl = ((closed || []) as any[]).reduce((a, p) => a + n(p.pnl), 0) * bnbUsd;
  return { avail: Math.max(0, budget + pnl - inTrades), inTrades, pnl };
}

/**
 * Your callers, wherever they post: every chat the account is in where one of your active Telegram callers (set for
 * "all groups") has posted a coin in the last 14 days is read for buys, but only for your callers' calls (never anyone
 * else's). Up to 4 chats per caller, 12 in all, most recent first. Chats you switched off yourself stay off; chats
 * added this way are removed again when the caller is removed or stops posting there.
 */
export async function followCallerChats(): Promise<string[]> {
  const { data: cs } = await tq("ai_trader_callers").select("who,chat,usd,scout,platform").eq("platform", "tg");
  const names = [...new Set(((cs || []) as any[]).filter((c) => !c.scout && Number(c.usd) > 0 && !String(c.chat || "")).map((c) => String(c.who).replace(/^@/, "").toLowerCase()).filter(Boolean))];
  const want = new Map<string, string>();
  if (names.length) {
    const { data: calls } = await tq("ai_scout_calls").select("chat_ref,chat_title,who,called_at").eq("platform", "tg").in("who", names).gte("called_at", new Date(Date.now() - 14 * 86400_000).toISOString()).order("called_at", { ascending: false }).limit(1000);
    const per = new Map<string, number>();
    for (const c of (calls || []) as any[]) {
      const ref = String(c.chat_ref || "");
      if (!ref || want.has(ref) || want.size >= 12) continue;
      const k = (per.get(c.who) || 0);
      if (k >= 4) continue;
      per.set(c.who, k + 1);
      want.set(ref, String(c.chat_title || ref));
    }
  }
  const saved = new Map((await tgaSavedChats().catch(() => [])).map((c) => [c.ref, c]));
  const { data: srcs } = await tq("ai_trader_sources").select("id,ref,enabled,scout,scout_kind").eq("kind", "tg_chat");
  const have = new Map(((srcs || []) as any[]).map((r) => [String(r.ref), r]));
  const added: string[] = [];
  for (const [ref, title] of want) {
    const cur = have.get(ref);
    if (cur) continue; // already listed: enabled stays enabled, and one you switched off stays off
    const i = saved.get(ref);
    await tq("ai_trader_sources").insert({ kind: "tg_chat", ref, title: i?.title || title, handle: (i as any)?.username || null, enabled: true, scout: false, scout_kind: "follow" });
    added.push(i?.title || title);
  }
  for (const r of (srcs || []) as any[]) if (r.scout_kind === "follow" && !r.scout && !want.has(String(r.ref))) await tq("ai_trader_sources").delete().eq("id", r.id);
  return added;
}
