/**
 * OddsPapi v4 football odds adapter for SUPER.
 * Uses one date-scoped fixture request and one tournament-odds request,
 * then normalizes bookmaker prices into the same shape as OddsRelay.
 */
import { supabaseService } from "@/lib/supabase/server";

const BASE = "https://api.oddspapi.io/v4";
const sb = () => supabaseService();
const rows = (v: any): any[] => Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : v?.fixtureId ? [v] : [];

const inflight = new Map<string, Promise<any>>();
const endpointLastRequest = new Map<string, number>();
const endpointQueues = new Map<string, Promise<void>>();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function errorMessage(body: any, fallback: string) {
  const error = body?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const parts = [error.code, error.message, error.details].filter(Boolean);
    if (parts.length) return parts.join(" — ");
  }
  return String(body?.message || body?.detail || fallback);
}

async function cachedGet(path: string, ttl: number) {
  const cacheKey = "super-oddspapi:" + path;
  const pending = inflight.get(cacheKey);
  if (pending) return pending;
  const task = (async () => {
    const { data: hit } = await sb().from("sport_cache").select("data,at").eq("key", cacheKey).maybeSingle();
    if (hit && Date.now() - Date.parse(hit.at) < ttl) return hit.data;
    const key = process.env.ODDSPAPI_API_KEY;
    if (!key) throw new Error("ODDSPAPI_API_KEY is missing in Vercel Production.");
    const url = new URL(BASE + path);
    url.searchParams.set("apiKey", key);

    // OddsPapi applies cooldowns per endpoint, not per URL. Serialize calls
    // across different query strings so multiple bookmakers don't trigger 429s.
    const endpoint = url.pathname;
    const cooldown = endpoint.endsWith("/fixtures") ? 2100 :
      endpoint.endsWith("/odds-by-tournaments") ? 1100 : 1100;
    const previous = endpointQueues.get(endpoint) || Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => turn);
    endpointQueues.set(endpoint, queued);
    await previous;
    try {
      const wait = cooldown - (Date.now() - (endpointLastRequest.get(endpoint) || 0));
      if (wait > 0) await sleep(wait);
      let response: Response | null = null;
      let body: any = {};
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
        body = await response.json().catch(() => ({}));
        endpointLastRequest.set(endpoint, Date.now());
        if (response.ok) break;
        const code = String(body?.error?.code || body?.code || "");
        const retryMs = Number(body?.error?.retryMs ?? body?.retryMs ?? 0);
        if (response.status === 429 && code === "RATE_LIMITED" && attempt === 0 && retryMs > 0) {
          await sleep(Math.min(retryMs + 150, 5000));
          continue;
        }
        const message = errorMessage(body, response.statusText || "OddsPapi request failed");
        throw new Error("OddsPapi (" + response.status + ", " + (code || "API_ERROR") + "): " + message);
      }
      if (!response?.ok) throw new Error("OddsPapi request failed after rate-limit retry.");
      await sb().from("sport_cache").upsert({ key: cacheKey, data: body, at: new Date().toISOString() });
      return body;
    } finally {
      release();
    }
  })();
  inflight.set(cacheKey, task);
  try { return await task; } finally { inflight.delete(cacheKey); }
}
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "")
  .replace(/\b(football club|fc|afc|cf|sc|club)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

function canonicalTeam(value: string) {
  const x = norm(value);
  const aliases: Record<string,string> = {
    "ca mineiro": "atletico mineiro", "atletico mg": "atletico mineiro",
    "atletico mineiro mg": "atletico mineiro",
    "sc corinthians paulista": "corinthians", "corinthians paulista": "corinthians",
    "manchester united": "man utd", "manchester city": "man city",
    "paris saint germain": "psg", "paris sg": "psg",
    "atletico madrid": "atletico", "inter milan": "inter",
    "borussia dortmund": "dortmund", "bayern munich": "bayern"
  };
  return aliases[x] || x;
}
function nameMatches(a: string, b: string) {
  const x = canonicalTeam(a), y = canonicalTeam(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function outcomeName(market: any, outcomeId: string, player: any, home: string, away: string) {
  const catalogue = rows(market?.outcomes).find((o: any) => String(o.outcomeId) === String(outcomeId));
  const raw = String(catalogue?.outcomeName || player?.bookmakerOutcomeId || "");
  const key = norm(raw).replace(/\s/g, "");
  if (market.__kind === "h2h") {
    if (["1", "home", "homewin", norm(home).replace(/\s/g, "")].includes(key)) return home;
    if (["2", "away", "awaywin", norm(away).replace(/\s/g, "")].includes(key)) return away;
    if (["x", "draw", "thedraw", "tie"].includes(key)) return "Draw";
  }
  if (market.__kind === "double_chance") {
    if (["1x", "homedraw", "homeordraw"].includes(key)) return "1X";
    if (["x2", "drawaway", "draworaway"].includes(key)) return "X2";
    if (["12", "homeaway", "homeoraway"].includes(key)) return "12";
  }
  return raw;
}

let marketMapCache: { at: number; map: Map<string, any> } | null = null;
async function getMarketMap() {
  if (marketMapCache && Date.now() - marketMapCache.at < 24 * 3600_000) return marketMapCache.map;
  const data = await cachedGet("/markets?language=en", 24 * 3600_000);
  const map = new Map<string, any>();
  for (const m of rows(data)) map.set(String(m.marketId), m);
  marketMapCache = { at: Date.now(), map };
  return map;
}

export async function getOddsPapiStatus() {
  if (!process.env.ODDSPAPI_API_KEY) {
    return { keyConfigured: false, provider: "OddsPapi", active: false, bookmakers: [], error: "ODDSPAPI_API_KEY is missing in Vercel Production." };
  }
  const account = await cachedGet("/account", 60 * 60_000);
  const subscriptions = rows(account?.subscriptions).filter((s: any) => s?.is_active !== false);
  const bookmakers = [...new Set(subscriptions.flatMap((s: any) =>
    Object.keys(s?.bookmakers || {}).filter((slug: string) => s.bookmakers[slug] !== false)
  ))] as string[];
  return {
    keyConfigured: true,
    provider: "OddsPapi",
    active: bookmakers.length > 0,
    bookmakers,
    subscriptionCount: subscriptions.length,
    error: bookmakers.length ? null : "OddsPapi account has no active bookmaker subscription."
  };
}

export async function getOddsPapiUpcomingFixtures() {
  const key = process.env.ODDSPAPI_API_KEY;
  if (!key) throw new Error("ODDSPAPI_API_KEY is missing in Vercel Production.");
  const account = await cachedGet("/account", 60 * 60_000);
  const subscriptions = rows(account?.subscriptions).filter((s: any) => s?.is_active !== false);
  const bookmakerSlugs = [...new Set(subscriptions.flatMap((s: any) =>
    Object.keys(s?.bookmakers || {}).filter((slug: string) => s.bookmakers[slug] !== false)
  ))].slice(0, 3);
  if (!bookmakerSlugs.length) throw new Error("OddsPapi account has no active bookmaker subscription.");
  const now = new Date();
  const dayInAccra = (d: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
  const days = [dayInAccra(now), dayInAccra(new Date(now.getTime() + 24 * 60 * 60_000))];
  const fixtures: any[] = [];
  for (const day of days) {
    const from = day + "T00:00:00Z";
    const end = new Date(new Date(from).getTime() + 24 * 60 * 60_000 - 1).toISOString();
    const path = "/fixtures?sportId=10&from=" + encodeURIComponent(from) +
      "&to=" + encodeURIComponent(end) + "&statusId=0&hasOdds=true&bookmakers=" +
      encodeURIComponent(bookmakerSlugs.join(","));
    fixtures.push(...rows(await cachedGet(path, 3 * 60_000)));
  }
  const unique = new Map<string, any>();
  for (const f of fixtures) {
    const date = String(f?.startTime || "");
    if (!f?.fixtureId || !f?.participant1Name || !f?.participant2Name || !date || Date.parse(date) < now.getTime()) continue;
    unique.set(String(f.fixtureId), {
      id: "oddspapi:" + String(f.fixtureId),
      date,
      status: "SCHEDULED",
      competition: String(f.tournamentName || f.categoryName || "Football"),
      home: { id: 0, name: String(f.participant1Name), logo: "" },
      away: { id: 0, name: String(f.participant2Name), logo: "" },
      score: null,
      oddsFixtureId: String(f.fixtureId)
    });
  }
  return [...unique.values()].sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date)).slice(0, 40);
}

export async function getOddsPapiMatchOdds(home: string, away: string, matchDate?: string) {
  const key = process.env.ODDSPAPI_API_KEY;
  if (!key) throw new Error("ODDSPAPI_API_KEY is missing in Vercel Production.");
  const day = matchDate ? new Date(matchDate + "T00:00:00.000Z") : new Date();
  if (Number.isNaN(day.getTime())) throw new Error("Invalid match date.");
  const date = day.toISOString().slice(0, 10);
  const from = date + "T00:00:00Z";
  const to = new Date(day.getTime() + 24 * 3600_000 - 1).toISOString();

  // OddsPapi exposes the bookmaker slugs included in the active subscription.
  // The tournament odds endpoint expects the subscribed bookmaker filter.
  const account = await cachedGet("/account", 60 * 60_000);
  const subscriptions = rows(account?.subscriptions).filter((s: any) => s?.is_active !== false);
  const bookmakerSlugs = [...new Set(subscriptions.flatMap((s: any) =>
    Object.keys(s?.bookmakers || {}).filter((slug: string) => s.bookmakers[slug] !== false)
  ))].slice(0, 3);
  if (!bookmakerSlugs.length) {
    throw new Error("OddsPapi account has no active bookmaker subscription. Check GET /v4/account and enable at least one football bookmaker.");
  }

  const fixturePath = "/fixtures?sportId=10&from=" + encodeURIComponent(from) +
    "&to=" + encodeURIComponent(to) + "&statusId=0&hasOdds=true&bookmakers=" + encodeURIComponent(bookmakerSlugs.join(","));
  const fixtureData = await cachedGet(fixturePath, 5 * 60_000);
  const fixtureRows = rows(fixtureData);
  const relevant = fixtureRows.filter((f: any) => f?.fixtureId && f?.tournamentId &&
    (nameMatches(String(f.participant1Name || f.participant1ShortName || ""), home) &&
     nameMatches(String(f.participant2Name || f.participant2ShortName || ""), away)));
  const tournamentIds = [...new Set(relevant.map((f: any) => String(f.tournamentId)))];
  const oddsFixtures: any[] = [];
  // OddsPapi v4 requires exactly ONE bookmaker on odds-by-tournaments.
  // Request each subscribed bookmaker separately, then merge its prices by
  // fixture ID so the value scanner can compare all available books.
  for (const bookmaker of bookmakerSlugs) {
    for (let i = 0; i < tournamentIds.length; i += 3) {
      const chunk = tournamentIds.slice(i, i + 3);
      const path = "/odds-by-tournaments?tournamentIds=" + encodeURIComponent(chunk.join(",")) +
        "&bookmaker=" + encodeURIComponent(bookmaker) +
        "&language=en&oddsFormat=decimal&verbosity=3";
      const result = await cachedGet(path, 3 * 60_000);
      oddsFixtures.push(...rows(result));
    }
  }
  const markets = await getMarketMap();
  const byId = new Map(oddsFixtures.map((f: any) => [String(f.fixtureId), f]));
  const matched = relevant.map((f: any) => {
    const oddsFixture: any = byId.get(String(f.fixtureId));
    if (!oddsFixture?.bookmakerOdds) return null;
    const bookmakers = Object.entries(oddsFixture.bookmakerOdds)
      .filter(([, book]: [string, any]) => book?.bookmakerIsActive !== false && book?.suspended !== true)
      .map(([slug, book]: [string, any]) => ({
        key: slug, title: String(book?.bookmakerName || slug),
        markets: Object.entries(book?.markets || {}).flatMap(([marketId, marketData]: [string, any]) => {
          if (marketData?.marketActive === false) return [];
          const meta = markets.get(String(marketId));
          const marketType = norm(String(meta?.marketType || "")).replace(/\s/g, "");
          const marketTitle = norm(String(meta?.marketName || "")).replace(/\s/g, "");
          const isH2h = marketType === "1x2" || marketTitle.includes("fulltimeresult") || marketTitle === "matchresult";
          const isDouble = marketType.includes("doublechance") || marketTitle.includes("doublechance");
          const isBtts = marketType.includes("btts") || marketTitle.includes("bothteamstoscore");
          const isTotals = marketType.includes("total") || marketType.includes("overunder") || marketTitle.includes("totalgoals") || marketTitle.includes("overunder");
          const kind = isH2h ? "h2h" : isDouble ? "double_chance" : isBtts ? "btts" : isTotals ? "totals" : "other";
          const normalizedKey = kind === "other" ? "oddspapi_" + String(marketId) : kind;
          const market: any = { ...(meta || {}), __kind: kind };
          const outcomes = Object.entries(marketData?.outcomes || {}).flatMap(([outcomeId, outcomeData]: [string, any]) =>
            Object.values(outcomeData?.players || {}).map((player: any) => {
              const raw = outcomeName(market, String(outcomeId), player, String(f.participant1Name), String(f.participant2Name));
              const playerName = String(player?.playerName || player?.name || player?.handicap || "");
              const line = String(player?.handicap ?? player?.line ?? "");
              const outcomeIdLabel = String(player?.bookmakerOutcomeId || "");
              const totalFromId = outcomeIdLabel.match(/(\d+(?:\.\d+)?)\s*\/\s*(over|under)/i);
              const name = kind === "btts" ? (/^(yes|no)$/i.test(raw) ? raw : /^(yes|no)$/i.test(playerName) ? playerName : raw)
                : kind === "totals" ? (/^(over|under)\s/i.test(raw) ? raw : totalFromId ? totalFromId[2] + " " + totalFromId[1] : /^(over|under)$/i.test(playerName) && line ? playerName + " " + line : raw)
                : kind === "other" && (!raw || raw === outcomeIdLabel) ? (playerName || raw) : raw;
              return { name, price: Number(player?.price) };
            }).filter((o: any) => o.name && Number.isFinite(o.price) && o.price > 1 && playerActive(marketData, outcomeId, outcomeData))
          );
          return outcomes.length ? [{ key: normalizedKey, outcomes }] : [];
        })
      })).filter((b: any) => b.markets.length);
    return {
      id: String(f.fixtureId), home_team: String(f.participant1Name || f.participant1ShortName),
      away_team: String(f.participant2Name || f.participant2ShortName), commence_time: f.startTime,
      bookmakers
    };
  }).filter(Boolean);
  return {
    region: "global", product: "oddspapi", count: oddsFixtures.length, matched,
    availableBookmakers: [...new Set(matched.flatMap((e: any) => e.bookmakers.map((b: any) => b.title)))].sort(),
    diagnostics: {
      eventsReturned: oddsFixtures.length, fixtureEvents: fixtureRows.length,
      matchingFixtures: relevant.length, matchingEvents: matched.length,
      requestedHome: home, requestedAway: away, tournamentCount: tournamentIds.length,
      bookmakerSlugs,
      sampleEvents: fixtureRows.slice(0, 8).map((f: any) => ({ home: f.participant1Name, away: f.participant2Name, hasOdds: f.hasOdds }))
    }
  };
}

function playerActive(_marketData: any, _outcomeId: string, outcomeData: any) {
  return Object.values(outcomeData?.players || {}).some((p: any) => p?.active !== false);
}
