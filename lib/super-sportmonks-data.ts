/**
 * SUPER board data adapter using the configured SportMonks Football API v3.
 * SUPER no longer depends on Highlightly; SPORT remains on its own provider.
 */
import { supabaseService } from "@/lib/supabase/server";
import { model } from "@/lib/sport";

const BASE = "https://api.sportmonks.com/v3/football";
const sb = () => supabaseService();
const TTL = 5 * 60_000;
const inflight = new Map<string, Promise<any>>();
export const superReady = () => !!process.env.SPORTMONKS_API_TOKEN;

async function api(path: string, ttl = TTL): Promise<any> {
  const token = process.env.SPORTMONKS_API_TOKEN;
  if (!token) throw new Error("SPORTMONKS_API_TOKEN is missing in Vercel Production. Add your SportMonks API token and redeploy.");
  const cacheKey = "super-sportmonks:" + path;
  const pending = inflight.get(cacheKey);
  if (pending) return pending;
  const task = (async () => {
    const { data: hit } = await sb().from("sport_cache").select("data,at").eq("key", cacheKey).maybeSingle();
    if (hit && Date.now() - Date.parse(hit.at) < ttl) return hit.data;
    const url = new URL(BASE + path);
    url.searchParams.set("api_token", token);
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body?.message || body?.error?.message || body?.error || response.statusText || "Provider error";
      throw new Error("SportMonks (" + response.status + "): " + String(message).slice(0, 220));
    }
    await sb().from("sport_cache").upsert({ key: cacheKey, data: body, at: new Date().toISOString() });
    return body;
  })();
  inflight.set(cacheKey, task);
  try { return await task; } finally { inflight.delete(cacheKey); }
}

const rows = (v: any): any[] => Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : [];
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z"));
const datePart = (d: Date) => d.toISOString().slice(0, 10);
const stateText = (m: any) => String(m?.state?.developer_name || m?.state?.short_name || m?.state?.name || m?.state?.description || "");
const isFinished = (m: any) => /^(ft|aet|pen|finished|full.?time|after.?extra.?time|after.?penalties|awarded)/i.test(stateText(m)) || [5, 6, 7].includes(Number(m?.state_id));
const isLive = (m: any) => /live|in.?play|1st.?half|2nd.?half|half.?time|break|extra.?time/i.test(stateText(m)) && !isFinished(m);

function participants(m: any) {
  const list = rows(m?.participants);
  const home = list.find((p: any) => p?.meta?.location === "home") || list[0];
  const away = list.find((p: any) => p?.meta?.location === "away") || list[1];
  return { home, away };
}
function currentScore(m: any) {
  const scores = rows(m?.scores);
  const current = scores.find((s: any) => String(s?.description || "").toUpperCase() === "CURRENT")
    || scores.find((s: any) => /2ND_HALF|FULL_TIME|CURRENT/i.test(String(s?.description || "")))
    || scores[scores.length - 1];
  let hg: number | null = null, ag: number | null = null;
  for (const item of scores) {
    const val = Number(item?.score?.goals ?? item?.goals);
    const side = String(item?.score?.participant || item?.participant?.meta?.location || item?.participant || "").toLowerCase();
    if (!Number.isFinite(val)) continue;
    if (side === "home") hg = val;
    if (side === "away") ag = val;
  }
  if (hg == null || ag == null) {
    const name = String(current?.score?.participant || "");
    const goals = Number(current?.score?.goals);
    if (name === "home" && Number.isFinite(goals)) hg = goals;
    if (name === "away" && Number.isFinite(goals)) ag = goals;
  }
  if ((hg == null || ag == null) && m?.result_info) {
    const match = String(m.result_info).match(/(\d+)\s*[-:]\s*(\d+)/);
    if (match) { hg = Number(match[1]); ag = Number(match[2]); }
  }
  return hg != null && ag != null ? { home: hg, away: ag } : null;
}
function fixture(m: any) {
  const { home, away } = participants(m);
  const score = currentScore(m);
  const finished = isFinished(m);
  const status = finished ? "FINISHED" : isLive(m) ? (/half.?time|break/i.test(stateText(m)) ? "PAUSED" : "IN_PLAY") : "SCHEDULED";
  return {
    id: m.id, provider: "sportmonks", date: m.starting_at ? (String(m.starting_at).includes("Z") ? m.starting_at : String(m.starting_at).replace(" ", "T") + "Z") : new Date(Number(m.starting_at_timestamp || 0) * 1000).toISOString(),
    status, competition: m?.league?.name || "Football",
    home: { id: Number(home?.id), name: String(home?.name || ""), logo: String(home?.image_path || "") },
    away: { id: Number(away?.id), name: String(away?.name || ""), logo: String(away?.image_path || "") },
    score
  };
}
function toLegacy(m: any) {
  const { home, away } = participants(m);
  const score = currentScore(m);
  return {
    id: m.id, date: fixture(m).date,
    homeTeam: { id: Number(home?.id), name: home?.name, logo: home?.image_path },
    awayTeam: { id: Number(away?.id), name: away?.name, logo: away?.image_path },
    league: { name: m?.league?.name || "Football" },
    state: { description: stateText(m), score: { current: score ? score.home + " - " + score.away : "" } },
    statistics: rows(m?.statistics)
  };
}
async function collectFixturePages(path: string) {
  const all = new Map<string, any>();
  let cursor = "";
  for (let page = 1; page <= 30; page++) {
    const suffix = cursor
      ? "&cursor=" + encodeURIComponent(cursor)
      : "&page=" + page;
    const body = await api(path + suffix, 60_000);
    const pageRows = rows(body);
    for (const item of pageRows) if (item?.id != null) all.set(String(item.id), item);
    const pagination = body?.pagination || body?.meta?.pagination || {};
    const next = String(pagination?.next_cursor || pagination?.nextCursor || "");
    if (pagination?.has_more === false || pagination?.hasMore === false || (!next && pageRows.length < 50)) break;
    if (next && next === cursor) break;
    if (next) cursor = next;
    else if (pageRows.length < 50) break;
  }
  return [...all.values()];
}
async function fixturesByDate(date: string) {
  const include = "?include=participants;league;state;scores.participant&per_page=50";
  let all = await collectFixturePages("/fixtures/date/" + date + include);
  // SportMonks has both date and date-range fixture endpoints. Retry through
  // the documented range endpoint if the date endpoint yields an empty slate.
  if (!all.length) all = await collectFixturePages("/fixtures/between/" + date + "/" + date + include);
  // Explicitly resolve UEFA Europa League and UEFA Conference League fixtures
  // for the selected matchday as well; some provider responses omit them from
  // the general date feed even though the leagues are present in the account.
  try {
    const leagueBody = await api("/leagues/date/" + date + "?per_page=50", 60_000);
    const europeanIds = rows(leagueBody)
      .filter((league: any) => /europa league|conference league/i.test(String(league?.name || "")))
      .map((league: any) => Number(league.id))
      .filter((id: number) => Number.isInteger(id) && id > 0);
    if (europeanIds.length) {
      const path = "/fixtures/between/" + date + "/" + date + include +
        "&filters=fixtureLeagues:" + europeanIds.join(",");
      for (const item of await collectFixturePages(path)) all.set(String(item.id), item);
    }
  } catch {
    // Keep the general date-feed results if league-date discovery is unavailable.
  }
  return [...all.values()];
}
async function fixturesForTeam(teamId: number, from: string, to: string) {
  const all = new Map<string, any>();
  const start = new Date(from + "T00:00:00Z").getTime();
  const finish = new Date(to + "T00:00:00Z").getTime();
  // SportMonks date-range endpoints allow up to 100 days; use 90-day
  // windows so a full season of form can be loaded without oversized requests.
  for (let cursor = start; cursor <= finish; cursor += 90 * 86400_000) {
    const windowStart = datePart(new Date(cursor));
    const windowEnd = datePart(new Date(Math.min(finish, cursor + 89 * 86400_000)));
    for (let page = 1; page <= 5; page++) {
      const path = "/fixtures/between/" + windowStart + "/" + windowEnd + "/" + teamId + "?include=participants;league;state;scores&per_page=50&page=" + page;
      const body = await api(path, 5 * 60_000);
      for (const item of rows(body)) if (item?.id != null) all.set(String(item.id), item);
      if (body?.pagination?.has_more === false || body?.meta?.pagination?.has_more === false || rows(body).length < 50) break;
    }
  }
  return [...all.values()];
}
function summarize(teamId: number, games: any[]) {
  const matches = games.map((m: any) => {
    const isHome = m.homeTeam?.id === teamId;
    const score = String(m.state?.score?.current || "").match(/(\d+)\s*-\s*(\d+)/);
    if (!score) return null;
    const h = Number(score[1]), a = Number(score[2]);
    const gf = isHome ? h : a, ga = isHome ? a : h;
    return { date: m.date, vs: isHome ? m.awayTeam?.name : m.homeTeam?.name, home: isHome, gf, ga, res: gf > ga ? "W" : gf === ga ? "D" : "L", comp: m.league?.name || "" };
  }).filter(Boolean).sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date));
  const home = matches.filter((x: any) => x.home), away = matches.filter((x: any) => !x.home);
  const mean = (xs: any[], k: "gf" | "ga") => xs.length ? +(xs.reduce((s: number, x: any) => s + x[k], 0) / xs.length).toFixed(2) : null;
  const count = (xs: any[], r: string) => xs.filter((x: any) => x.res === r).length;
  return { season: {
    form: matches.slice(0, 10).reverse().map((x: any) => x.res).join(""),
    played: { home: home.length, away: away.length, total: matches.length },
    wins: { home: count(home, "W"), away: count(away, "W"), total: count(matches, "W") },
    draws: { home: count(home, "D"), away: count(away, "D"), total: count(matches, "D") },
    loses: { home: count(home, "L"), away: count(away, "L"), total: count(matches, "L") },
    goalsFor: { home: mean(home, "gf"), away: mean(away, "gf"), total: mean(matches, "gf") },
    goalsAgainst: { home: mean(home, "ga"), away: mean(away, "ga"), total: mean(matches, "ga") },
    cleanSheets: { home: home.filter((x: any) => x.ga === 0).length, away: away.filter((x: any) => x.ga === 0).length, total: matches.filter((x: any) => x.ga === 0).length },
    failedToScore: { home: home.filter((x: any) => x.gf === 0).length, away: away.filter((x: any) => x.gf === 0).length, total: matches.filter((x: any) => x.gf === 0).length }
  }, last5: { games: matches.slice(0, 5), avg: {} } };
}

/** Resolve a selected team's display name to SportMonks IDs, then load its latest
 * completed fixture and next scheduled fixture. This avoids relying on a separate
 * football-data.org subscription for the team-match panel.
 */
export async function teamFixtureChoicesByName(teamName: string) {
  const name = String(teamName || "").trim();
  if (!name) throw new Error("Choose a team first.");
  const normalize = (value: any) => String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\b(football club|fc|afc|cf|sc|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const body = await api("/teams/search/" + encodeURIComponent(name) + "?include=country&per_page=50", 24 * 3600_000);
  const candidates = rows(body).filter((x: any) => x?.id && x?.name);
  const target = normalize(name);
  const exact = candidates.filter((x: any) => normalize(x.name) === target);
  const selected = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : null;
  if (!selected) throw new Error(candidates.length
    ? "SportMonks returned multiple possible teams for " + name + ". Please use the league fixture list."
    : "SportMonks could not find " + name + " in your subscription.");
  const now = new Date();
  const from = datePart(new Date(now.getTime() - 365 * 86400_000));
  const to = datePart(new Date(now.getTime() + 90 * 86400_000));
  const raw = await fixturesForTeam(Number(selected.id), from, to);
  const mapped = raw.map(fixture).filter((f: any) => f.home.id && f.away.id && Number.isFinite(Date.parse(f.date)));
  const last = mapped.filter((f: any) => f.status === "FINISHED" && f.score)
    .sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date))[0];
  const next = mapped.filter((f: any) => f.status !== "FINISHED" && Date.parse(f.date) >= now.getTime())
    .sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date))[0];
  return [last, next].filter(Boolean).map((f: any) => ({ ...f, fixtureSource: "SportMonks" }));
}

/** Active SportMonks league catalogue for the SPORT selector. */
export async function getSportMonksLeagueCatalogue() {
  if (!superReady()) throw new Error("SPORTMONKS_API_TOKEN is missing in Vercel Production.");
  const all = new Map<number, any>();
  for (let page = 1; page <= 20; page++) {
    const body = await api("/leagues?include=country;seasons&per_page=50&page=" + page, 24 * 3600_000);
    const pageRows = rows(body);
    for (const item of pageRows) if (item?.id && item?.name) all.set(Number(item.id), item);
    if (body?.pagination?.has_more === false || body?.meta?.pagination?.has_more === false || pageRows.length < 50) break;
  }
  const known: Array<[RegExp,string]> = [
    [/champions league/i,"CL"], [/europa league/i,"EL"], [/conference league/i,"ECL"],
    [/premier league/i,"PL"], [/championship/i,"ELC"], [/bundesliga/i,"BL1"],
    [/serie a/i,"SA"], [/la liga/i,"PD"], [/ligue 1/i,"FL1"], [/eredivisie/i,"DED"],
    [/primeira liga/i,"PPL"], [/brasileir[aã]o|brasileiro.*serie a/i,"BSA"]
  ];
  return [...all.values()].map((l: any) => {
    const code = known.find(([pattern]) => pattern.test(String(l.name)))?.[1] || "SM-" + String(l.id);
    const seasons = rows(l.seasons).map((season: any) => Number(season.year)).filter(Number.isFinite);
    return { id: Number(l.id), code, name: String(l.name), country: String(l.country?.name || "World"), seasons };
  }).sort((a: any, b: any) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
}

export async function searchTeams(q: string) {
  const s = q.trim(); if (s.length < 2) return [];
  const body = await api("/teams/search/" + encodeURIComponent(s) + "?per_page=50", 7 * 86400_000);
  return rows(body).filter((x: any) => x?.id && x?.name).slice(0, 15).map((x: any) => ({
    id: Number(x.id), name: String(x.name), country: String(x?.country?.name || ""), logo: String(x.image_path || "")
  }));
}
export async function todayCompetitionMatches() {
  // Always query both calendar days in Ghana time on every scan.
  const now = new Date();
  const dayInAccra = (d: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
  const today = dayInAccra(now);
  const tomorrow = dayInAccra(new Date(now.getTime() + 24 * 60 * 60_000));
  const [todayRows, tomorrowRows] = await Promise.all([
    fixturesByDate(today), fixturesByDate(tomorrow)
  ]);
  const unique = new Map<string, any>();
  for (const raw of [...todayRows, ...tomorrowRows]) {
    const row = fixture(raw);
    const kickoff = Date.parse(row.date);
    if (row.home.id && row.away.id && row.date &&
      row.status === "SCHEDULED" && Number.isFinite(kickoff) && kickoff >= now.getTime()) {
      unique.set(String(row.id), row);
    }
  }
  return [...unique.values()].sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date));
}
/** Upcoming fixtures for a selected SPORT competition, sourced from SportMonks.
 * The date-range endpoint supports up to 100 days; one 30-day request plus
 * pagination avoids 30 separate date calls and keeps European matchdays visible.
 */
export async function getSportMonksLeagueUpcomingFixtures(leagueCode: string, leagueName: string, leagueId?: number) {
  if (!superReady()) throw new Error("SPORTMONKS_API_TOKEN is missing in Vercel Production.");
  const now = new Date();
  const from = datePart(now);
  const to = datePart(new Date(now.getTime() + 30 * 86400_000));
  const all = new Map<string, any>();
  for (let page = 1; page <= 20; page++) {
    const leagueFilter = Number.isInteger(leagueId) && Number(leagueId) > 0
      ? "&filters=fixtureLeagues:" + Number(leagueId)
      : "";
    const path = "/fixtures/between/" + from + "/" + to +
      "?include=participants;league;state;scores.participant" + leagueFilter + "&per_page=50&page=" + page;
    const body = await api(path, 60_000);
    const pageRows = rows(body);
    for (const item of pageRows) if (item?.id != null) all.set(String(item.id), item);
    if (body?.pagination?.has_more === false || body?.meta?.pagination?.has_more === false || pageRows.length < 50) break;
  }
  const normalize = (value: any) => String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const aliases: Record<string, string[]> = {
    CL: ["uefa champions league", "champions league"],
    EC: ["uefa european championship", "european championship", "european championship qualification"],
    EL: ["uefa europa league", "europa league"],
    ECL: ["uefa conference league", "conference league"],
    PL: ["premier league"],
    ELC: ["championship"],
    BL1: ["bundesliga"],
    SA: ["serie a"],
    PD: ["la liga"],
    FL1: ["ligue 1"],
    DED: ["eredivisie"],
    PPL: ["primeira liga"],
    BSA: ["brasileirao", "serie a"]
  };
  const wanted = [leagueName, ...(aliases[String(leagueCode || "").toUpperCase()] || [])].map(normalize).filter(Boolean);
  const fixtures = [...all.values()].filter((raw: any) => {
    if (Number.isInteger(leagueId) && Number(leagueId) > 0) {
      return Number(raw?.league_id ?? raw?.league?.id) === Number(leagueId);
    }
    const competition = normalize(raw?.league?.name);
    return wanted.some((name) => competition === name || competition.includes(name) || name.includes(competition));
  }).map(fixture).filter((f: any) => {
    const kickoff = Date.parse(f.date || "");
    return f.home?.id && f.away?.id && Number.isFinite(kickoff) && kickoff >= now.getTime() &&
      f.status === "SCHEDULED";
  }).sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date));
  const clubs = new Map<number, any>();
  for (const f of fixtures) {
    clubs.set(Number(f.home.id), f.home);
    clubs.set(Number(f.away.id), f.away);
  }
  return {
    fixtures: fixtures.map((f: any) => ({ ...f, fixtureSource: "SportMonks", providerFixtureId: null })),
    clubs: [...clubs.values()].sort((a: any, b: any) => a.name.localeCompare(b.name)),
    fixtureProvider: "SportMonks",
    fixtureWindowDays: 30
  };
}

export async function matchesOnDate(date: string) {
  if (!validDate(date)) throw new Error("Choose a valid match date.");
  if (!superReady()) throw new Error("SPORTMONKS_API_TOKEN is missing in Vercel Production.");
  let body = await fixturesByDate(date);
  // Some SportMonks plans/edge responses return an empty date endpoint while
  // the date-range endpoint still contains that day's fixtures. Retry once
  // using a same-day range before reporting an empty slate.
  if (!body.length) {
    const fallback = await api("/fixtures/between/" + date + "/" + date + "?include=participants;league;state;scores.participant&per_page=50&page=1", 60_000);
    body = rows(fallback);
  }
  // Return every fixture on the selected date: scheduled, live and completed.
  // A missing full-time score is normal for a match that has not finished yet.
  const matches = body.map(fixture)
    .filter((x: any) => x.home.id && x.away.id && Number.isFinite(Date.parse(x.date)))
    .sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date))
    .map((x: any) => ({ ...x, fixtureSource: "SportMonks" }));
  // Persist the complete normalized SportMonks date result in the existing
  // database cache, in addition to every raw paginated API response cached by api().
  const importedAt = new Date().toISOString();
  const { error } = await sb().from("sport_cache").upsert({
    key: "sportmonks:matches:" + date,
    data: {
      provider: "SportMonks", date, importedAt, count: matches.length,
      counts: {
        scheduled: matches.filter((m: any) => m.status === "SCHEDULED").length,
        live: matches.filter((m: any) => ["IN_PLAY", "PAUSED"].includes(m.status)).length,
        completed: matches.filter((m: any) => m.status === "FINISHED" && m.score).length
      },
      matches
    },
    at: importedAt
  });
  if (error) throw new Error("SportMonks matches were fetched but could not be saved to the database: " + error.message);
  return matches;
}
export async function teamFixtureChoices(teamId: number) {
  const now = new Date();
  const from = datePart(new Date(now.getTime() - 180 * 86400_000));
  const to = datePart(new Date(now.getTime() + 45 * 86400_000));
  const body = await fixturesForTeam(teamId, from, to);
  const all = body.map(toLegacy).filter((m: any) => m.homeTeam?.id === teamId || m.awayTeam?.id === teamId);
  const last = all.filter((m: any) => isFinished({ state: { description: m.state.description } }) && Date.parse(m.date) < now.getTime() && currentScore({ scores: [] , result_info: m.state.score.current })).sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date))[0];
  const next = all.filter((m: any) => !isFinished({ state: { description: m.state.description } }) && Date.parse(m.date) >= now.getTime()).sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date))[0];
  return [last, next].filter(Boolean).map((m: any) => fixture({
    id: m.id, starting_at: m.date, league: m.league, participants: [
      { id: m.homeTeam.id, name: m.homeTeam.name, image_path: m.homeTeam.logo, meta: { location: "home" } },
      { id: m.awayTeam.id, name: m.awayTeam.name, image_path: m.awayTeam.logo, meta: { location: "away" } }
    ],
    state: { description: m.state.description }, state_id: /^(ft|finished)/i.test(m.state.description) ? 5 : 1,
    scores: m.state.score.current ? String(m.state.score.current).split("-").map((g: string, i: number) => ({ description: "CURRENT", score: { participant: i === 0 ? "home" : "away", goals: Number(g.trim()) } })) : []
  }));
}
export async function analyse(homeId: number, awayId: number, matchDate?: string) {
  if (matchDate && !validDate(matchDate)) throw new Error("Choose a valid match date.");
  const end = matchDate || datePart(new Date());
  const endDate = new Date(end + "T00:00:00Z");
  const from = datePart(new Date(endDate.getTime() - 365 * 86400_000));
  const [hBody, aBody, h2hBody] = await Promise.all([
    fixturesForTeam(homeId, from, end),
    fixturesForTeam(awayId, from, end),
    api("/fixtures/head-to-head/" + homeId + "/" + awayId + "?include=participants;league;state;scores.participant&per_page=50", 6 * 3600_000).catch(() => ({ data: [] }))
  ]);
  // For historical estimates, only use matches completed before the selected
  // calendar date so the target fixture's result cannot leak into the model.
  const completed = (list: any[]) => list.map(toLegacy).filter((m: any) => isFinished({ state: { description: m.state.description } }) && Date.parse(m.date) < Date.parse(end + "T00:00:00Z") && /\d+\s*-\s*\d+/.test(m.state.score.current));
  const hGames = completed(hBody).slice(-50).sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date));
  const aGames = completed(aBody).slice(-50).sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date));
  if (hGames.length < 2 || aGames.length < 2) throw new Error("SportMonks returned fewer than two completed matches for one team in the last 12 months. Check your plan's league coverage.");
  const h = summarize(homeId, hGames), a = summarize(awayId, aGames);
  const hHome = h.season.goalsFor.home ?? h.season.goalsFor.total ?? 1.35;
  const hCon = h.season.goalsAgainst.home ?? h.season.goalsAgainst.total ?? 1.2;
  const aAway = a.season.goalsFor.away ?? a.season.goalsFor.total ?? 1.1;
  const aCon = a.season.goalsAgainst.away ?? a.season.goalsAgainst.total ?? 1.35;
  const lh = Math.max(.2, Math.min(4.5, (hHome + aCon) / 2));
  const la = Math.max(.15, Math.min(4, (aAway + hCon) / 2));
  const m = model(lh, la);
  const h2h = rows(h2hBody).filter((g: any) => !matchDate || Date.parse(g.starting_at || "") < Date.parse(matchDate + "T00:00:00Z")).slice(0, 10).map((g: any) => {
    const score = currentScore(g);
    const pair = participants(g);
    return { date: g.starting_at, home: pair.home?.name, away: pair.away?.name, score: score ? score.home + "-" + score.away : "", comp: g?.league?.name || "" };
  });
  const fav = m.home >= m.away ? { side: "home", p: m.home } : { side: "away", p: m.away };
  const verdict = [
    fav.p >= 60 ? "Clear favourite: " + fav.side + " win (" + fav.p + "%)." : fav.p >= 45 ? "Leaning " + fav.side + " (" + fav.p + "%), but not safe." : "Close game: home " + m.home + "% / draw " + m.draw + "% / away " + m.away + "%.",
    m.over["1.5"] >= 75 ? "Goals likely: over 1.5 at " + m.over["1.5"] + "%." : "Over 1.5 goals: " + m.over["1.5"] + "%.",
    m.over["2.5"] >= 58 ? "Over 2.5 leans yes (" + m.over["2.5"] + "%)." : m.over["2.5"] <= 42 ? "Under 2.5 leans yes (" + (100 - m.over["2.5"]).toFixed(1) + "%)." : "Over/under 2.5 is close (" + m.over["2.5"] + "%).",
    m.btts >= 58 ? "Both teams to score: yes (" + m.btts + "%)." : m.btts <= 42 ? "Both teams to score: no (" + (100 - m.btts).toFixed(1) + "%)." : "Both teams to score: " + m.btts + "%.",
    "Likeliest score: " + m.scores[0].score + " (" + m.scores[0].p + "%)."
  ];
  const actuals = matchDate ? await fixturesByDate(matchDate).catch(() => []) : [];
  const actualMatch = actuals.find((x: any) => participants(x).home?.id === homeId && participants(x).away?.id === awayId);
  const actualScore = actualMatch ? currentScore(actualMatch) : null;
  const historical = !!matchDate && matchDate < datePart(new Date());
  return {
    leagues: { home: { id: 0, name: hGames[0]?.league?.name || "Football" }, away: { id: 0, name: aGames[0]?.league?.name || "Football" } },
    averages: { home: {}, away: {} }, teams: { home: h, away: a },
    strengths: { homeAttack: 1, homeDefence: 1, awayAttack: 1, awayDefence: 1 }, model: m, h2h, verdict,
    matchDate: matchDate || null, historical,
    actual: actualMatch && isFinished(actualMatch) && actualScore ? { date: actualMatch.starting_at, status: "FINISHED", homeGoals: actualScore.home, awayGoals: actualScore.away, competition: actualMatch?.league?.name || "Football" } : null
  };
}

/**
 * Fetch and normalize SportMonks pre-match odds for one fixture.
 * The adapter intentionally returns the same event/bookmaker/market/outcome
 * shape used by the value scanner, but no longer calls OddsPapi or OddsRelay.
 */
export async function getSuperMatchOdds(fixtureId: number, home: string, away: string, matchDate?: string) {
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) throw new Error("Missing SportMonks fixture ID for odds lookup.");
  if (matchDate && !validDate(matchDate)) throw new Error("Choose a valid match date for odds.");
  const body = await api("/odds/pre-match/fixtures/" + fixtureId + "?include=market;bookmaker;fixture", 60_000);
  const odds = rows(body);
  const norm = (v: any) => String(v || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9.]+/g, " ").trim().replace(/\s+/g, " ");
  const books = new Map<string, any>();
  for (const odd of odds) {
    const price = Number(odd?.value ?? odd?.odds);
    if (!Number.isFinite(price) || price <= 1) continue;
    const market = odd?.market || {};
    const marketName = String(market?.developer_name || market?.name || odd?.market_description || odd?.market_name || "");
    const marketKey = norm(marketName).replace(/\s/g, "");
    let key = "sportmonks_" + String(odd?.market_id ?? market?.id ?? "other");
    let title = marketName || "Other market";
    if (/double.?chance/.test(marketKey)) { key = "double_chance"; title = "Double chance"; }
    else if (/bothteamstoscore|btts/.test(marketKey)) { key = "btts"; title = "Both teams to score"; }
    else if (/over.?under|totalgoals|goalsoverunder|total.*goals/.test(marketKey)) { key = "totals"; title = "Goals · Over/Under"; }
    else if (/fulltimeresult|matchresult|1x2|winner/.test(marketKey)) { key = "h2h"; title = "1X2 · Match result"; }
    const bookmaker = odd?.bookmaker || {};
    const bookId = String(odd?.bookmaker_id ?? bookmaker?.id ?? "unknown");
    const bookTitle = String(bookmaker?.name || odd?.bookmaker_name || ("Bookmaker " + bookId));
    const rawLabel = String(odd?.label || odd?.name || odd?.outcome?.name || odd?.value_label || "");
    const line = odd?.total ?? odd?.handicap ?? odd?.line ?? odd?.special ?? null;
    let label = rawLabel;
    if (key === "h2h") {
      const n = norm(rawLabel);
      if (["home", "1", norm(home)].includes(n)) label = home;
      else if (["away", "2", norm(away)].includes(n)) label = away;
      else if (["draw", "the draw", "tie", "x"].includes(n)) label = "Draw";
    } else if (key === "double_chance") {
      const n = norm(rawLabel).replace(/\s/g, "");
      if (["1x", "homedraw", "homeordraw", "home draw"].includes(n)) label = "1X";
      else if (["x2", "drawaway", "draworaway", "draw away"].includes(n)) label = "X2";
      else if (["12", "homeaway", "homeoraway", "home away"].includes(n)) label = "12";
    } else if (key === "btts") {
      const n = norm(rawLabel);
      if (/^(yes|no)$/.test(n)) label = n === "yes" ? "Yes" : "No";
    } else if (key === "totals") {
      const n = norm(rawLabel);
      const side = /under/.test(n) ? "Under" : /over/.test(n) ? "Over" : "";
      const foundLine = rawLabel.match(/\d+(?:\.\d+)?/) || (line != null ? [String(line)] : null);
      if (side && foundLine) label = side + " " + foundLine[0];
      else if (!side && line != null) label = rawLabel + " " + String(line);
    }
    if (!label) label = rawLabel || String(odd?.id || "Selection");
    if (!books.has(bookId)) books.set(bookId, { key: "sportmonks:" + bookId, title: bookTitle, markets: new Map() });
    const book = books.get(bookId);
    const marketBucket = key + "|" + title;
    if (!book.markets.has(marketBucket)) book.markets.set(marketBucket, { key, title, outcomes: [] });
    const marketRow = book.markets.get(marketBucket);
    const previous = marketRow.outcomes.find((o: any) => norm(o.name) === norm(label));
    if (!previous) marketRow.outcomes.push({ name: label, price });
    else if (price > previous.price) previous.price = price;
  }
  const bookmakers = [...books.values()].map((b: any) => ({
    key: b.key, title: b.title,
    markets: [...b.markets.values()].map((m: any) => ({ key: m.key, title: m.title, outcomes: m.outcomes }))
  })).filter((b: any) => b.markets.length);
  const matched = bookmakers.length ? [{
    id: String(fixtureId), home_team: home, away_team: away,
    commence_time: matchDate ? matchDate + "T00:00:00.000Z" : "",
    bookmakers
  }] : [];
  return {
    region: "sportmonks", product: "SportMonks pre-match odds", count: odds.length,
    matched, availableBookmakers: bookmakers.map((b: any) => b.title).sort(),
    diagnostics: {
      eventsReturned: odds.length, matchingEvents: matched.length,
      requestedHome: home, requestedAway: away,
      providers: { sportmonks: { ok: true, odds: odds.length, bookmakers: bookmakers.length } },
      markets: [...new Set(bookmakers.flatMap((b: any) => b.markets.map((m: any) => m.key)))],
      sampleEvents: [{ home, away }]
    }
  };
}

export async function getSuperMatchOddsForTeams(home: string, away: string, matchDate: string) {
  if (!validDate(matchDate)) throw new Error("Choose a valid match date for odds lookup.");
  const clean = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\b(football club|fc|afc|cf|sc|club)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const h = clean(home), a = clean(away);
  const candidates = await fixturesByDate(matchDate);
  const match = candidates.find((f: any) => {
    const p = participants(f);
    return clean(String(p.home?.name || "")) === h && clean(String(p.away?.name || "")) === a;
  });
  if (!match?.id) throw new Error("SportMonks could not find this exact fixture on " + matchDate + ". No bookmaker odds were invented.");
  return getSuperMatchOdds(Number(match.id), home, away, matchDate);
}

export async function superOddsStatus() {
  return {
    keyConfigured: !!process.env.SPORTMONKS_API_TOKEN,
    provider: "SportMonks",
    oddsEndpoint: "pre-match odds by fixture",
    legacyProvidersRemoved: true
  };
}

export async function savePrediction(row: Record<string, unknown>) {
  const note = (() => { try { return JSON.parse(String(row.note || "{}")); } catch { return {}; } })();
  const { data, error } = await sb().from("sport_predictions").insert({ ...row, note: JSON.stringify({ ...note, provider: "super-sportmonks" }) }).select("id").single();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}
export async function saveOdds(id: number, selections: unknown, highestChance: unknown) {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Missing prediction history ID.");
  const safe = Array.isArray(selections) ? selections.slice(0, 60) : [];
  const { data: existing } = await sb().from("sport_predictions").select("note").eq("id", id).maybeSingle();
  let prior: any = {}; try { prior = existing?.note ? JSON.parse(existing.note) : {}; } catch {}
  const { error } = await sb().from("sport_predictions").update({ note: JSON.stringify({ ...prior, bookmakerComparison: safe, highestChance }) }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function history() {
  const { data, error } = await sb().from("sport_predictions").select("*").order("id", { ascending: false }).limit(150);
  if (error) throw new Error(error.message);
  return (data || []).filter((x: any) => { try { return JSON.parse(x.note || "{}").provider === "super-sportmonks"; } catch { return false; } }).slice(0, 30);
}
export async function setResult(id: number, result: string) {
  const { error } = await sb().from("sport_predictions").update({ result: result.slice(0, 20) }).eq("id", id);
  if (error) throw new Error(error.message);
}
