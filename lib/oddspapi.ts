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
    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body?.message || body?.error || body?.detail || response.statusText || "OddsPapi request failed";
      throw new Error("OddsPapi (" + response.status + "): " + String(message).slice(0, 200));
    }
    await sb().from("sport_cache").upsert({ key: cacheKey, data: body, at: new Date().toISOString() });
    return body;
  })();
  inflight.set(cacheKey, task);
  try { return await task; } finally { inflight.delete(cacheKey); }
}

const norm = (s: string) => String(s || "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "")
  .replace(/\b(football club|fc|afc|cf|sc|club)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

function nameMatches(a: string, b: string) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const aliases: Record<string,string> = {
    "manchester united":"man utd", "manchester city":"man city",
    "paris saint germain":"psg", "paris sg":"psg",
    "atletico madrid":"atletico", "inter milan":"inter",
    "borussia dortmund":"dortmund", "bayern munich":"bayern"
  };
  return (aliases[x] || x) === (aliases[y] || y);
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

export async function getOddsPapiMatchOdds(home: string, away: string, matchDate?: string) {
  const key = process.env.ODDSPAPI_API_KEY;
  if (!key) throw new Error("ODDSPAPI_API_KEY is missing in Vercel Production.");
  const day = matchDate ? new Date(matchDate + "T00:00:00.000Z") : new Date();
  if (Number.isNaN(day.getTime())) throw new Error("Invalid match date.");
  const date = day.toISOString().slice(0, 10);
  const from = date + "T00:00:00Z";
  const to = new Date(day.getTime() + 24 * 3600_000 - 1).toISOString();
  const fixtureData = await cachedGet("/fixtures?sportId=10&from=" + encodeURIComponent(from) +
    "&to=" + encodeURIComponent(to) + "&statusId=0&hasOdds=true", 5 * 60_000);
  const fixtureRows = rows(fixtureData);
  const relevant = fixtureRows.filter((f: any) => f?.fixtureId && f?.tournamentId &&
    (nameMatches(String(f.participant1Name || f.participant1ShortName || ""), home) &&
     nameMatches(String(f.participant2Name || f.participant2ShortName || ""), away)));
  const tournamentIds = [...new Set(fixtureRows.filter((f: any) => f?.hasOdds && f?.tournamentId)
    .map((f: any) => String(f.tournamentId)))];
  let oddsFixtures: any[] = [];
  if (tournamentIds.length) {
    const oddsData = await cachedGet("/odds-by-tournaments?tournamentIds=" + encodeURIComponent(tournamentIds.join(",")) +
      "&language=en&oddsFormat=decimal&verbosity=3", 3 * 60_000);
    oddsFixtures = rows(oddsData);
  }
  const markets = await getMarketMap();
  const byId = new Map(oddsFixtures.map((f: any) => [String(f.fixtureId), f]));
  const matched = relevant.map((f: any) => {
    const oddsFixture: any = byId.get(String(f.fixtureId));
    if (!oddsFixture?.bookmakerOdds) return null;
    const bookmakers = Object.entries(oddsFixture.bookmakerOdds).map(([slug, book]: [string, any]) => ({
      key: slug, title: String(book?.bookmakerName || slug),
      markets: Object.entries(book?.markets || {}).flatMap(([marketId, marketData]: [string, any]) => {
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
            const name = kind === "btts" ? (/^(yes|no)$/i.test(raw) ? raw : /^(yes|no)$/i.test(playerName) ? playerName : raw)
              : kind === "totals" ? (/^(over|under)\\s/i.test(raw) ? raw : /^(over|under)$/i.test(playerName) && line ? playerName + " " + line : raw)
              : kind === "other" && (!raw || raw === String(player?.bookmakerOutcomeId || "")) ? (playerName || raw) : raw;
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
  const events = oddsFixtures.length;
  return {
    region: "global", product: "oddspapi", count: events, matched,
    availableBookmakers: [...new Set(matched.flatMap((e: any) => e.bookmakers.map((b: any) => b.title)))].sort(),
    diagnostics: {
      eventsReturned: events, matchingEvents: matched.length,
      requestedHome: home, requestedAway: away, tournamentCount: tournamentIds.length,
      sampleEvents: fixtureRows.slice(0, 8).map((f: any) => ({ home: f.participant1Name, away: f.participant2Name }))
    }
  };
}

function playerActive(_marketData: any, _outcomeId: string, outcomeData: any) {
  return Object.values(outcomeData?.players || {}).some((p: any) => p?.active !== false);
}
