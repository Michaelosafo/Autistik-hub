/**
 * SPORT data adapter using football-data.org v4.
 * The existing Poisson model remains in lib/sport.ts; this adapter supplies
 * team search, recent results, and season goal averages from the free-tier API.
 */
import { supabaseService } from "@/lib/supabase/server";
import { model } from "@/lib/sport";

const BASE = "https://api.football-data.org/v4";
const TTL = 6 * 60 * 60_000;
const sb = () => supabaseService();

export const sportReady = () => !!process.env.FOOTBALL_DATA_TOKEN;

async function api(path: string, ttl = TTL): Promise<any> {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) throw new Error("Add FOOTBALL_DATA_TOKEN in Vercel (football-data.org free account), then redeploy.");
  const key = "football-data:" + path;
  const { data: hit } = await sb().from("sport_cache").select("data,at").eq("key", key).maybeSingle();
  if (hit && Date.now() - Date.parse(hit.at) < ttl) return hit.data;
  let r: Response;
  let body: any = {};
  try {
    // Do not let a stalled upstream request consume Vercel's full 60-second
    // function budget. Prefer the last cached response when the provider stalls.
    r = await fetch(BASE + path, {
      headers: { "X-Auth-Token": token, "X-Unfold-Goals": "true" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    body = await r.json().catch(() => ({}));
  } catch (error) {
    if (hit?.data) return hit.data;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error("Football data request timed out or failed: " + reason.slice(0, 140));
  }
  if (!r.ok) {
    if (hit?.data) return hit.data;
    const message = body?.message || body?.error || r.statusText || "Unknown provider error";
    throw new Error("Football data (" + r.status + "): " + String(message).slice(0, 180));
  }
  await sb().from("sport_cache").upsert({ key, data: body, at: new Date().toISOString() });
  return body;
}


const COMPETITIONS = ["PL", "ELC", "BL1", "SA", "PD", "FL1", "DED", "PPL", "BSA", "CL", "EC", "WC"];

/** Competitions available to this football-data.org account. */
export async function getLeagueCatalogue() {
  const data = await api("/competitions", 12 * 60 * 60_000);
  const available = Array.isArray(data?.competitions) ? data.competitions : [];
  const enabled = new Set(COMPETITIONS);
  return available
    .filter((x: any) => x?.code && enabled.has(String(x.code)))
    .map((x: any) => ({
      id: Number(x.id),
      code: String(x.code),
      name: String(x.name || x.code),
      country: String(x.area?.name || "International"),
      seasons: x.currentSeason?.id ? [Number(x.currentSeason.id)] : [],
      emblem: x.emblem || null,
    }))
    .sort((a: any, b: any) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
}

/** Upcoming fixtures and participating clubs for one football-data.org competition. */
export async function getLeagueUpcomingFixtures(code: string) {
  const competition = String(code || "").trim().toUpperCase();
  if (!COMPETITIONS.includes(competition)) throw new Error("Choose a competition supported by the connected football-data.org plan.");
  const now = new Date();
  const from = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  // European cup matchdays are often more than seven days apart. A 30-day
  // window keeps the league selector useful between Champions/Europa League rounds.
  const toDate = new Date(now.getTime() + 30 * 86400_000);
  const to = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit" }).format(toDate);
  const [matchesData, teamsData] = await Promise.all([
    api("/competitions/" + competition + "/matches?dateFrom=" + from + "&dateTo=" + to + "&limit=500", 5 * 60_000),
    api("/competitions/" + competition + "/teams", 12 * 60 * 60_000).catch(() => ({ teams: [] })),
  ]);
  const fixtures = (Array.isArray(matchesData?.matches) ? matchesData.matches : [])
    .filter((m: any) => m?.id && m.homeTeam?.id && m.awayTeam?.id && m.utcDate &&
      ["SCHEDULED", "TIMED"].includes(m.status) && Date.parse(m.utcDate) >= now.getTime())
    .sort((a: any, b: any) => Date.parse(a.utcDate) - Date.parse(b.utcDate))
    .map((m: any) => ({
      id: Number(m.id), date: m.utcDate, status: m.status,
      competition: m.competition?.name || competition,
      home: { id: Number(m.homeTeam.id), name: m.homeTeam.name, logo: m.homeTeam.crest || "" },
      away: { id: Number(m.awayTeam.id), name: m.awayTeam.name, logo: m.awayTeam.crest || "" },
    }));
  const clubs = (Array.isArray(teamsData?.teams) ? teamsData.teams : [])
    .filter((t: any) => t?.id && t?.name)
    .map((t: any) => ({ id: Number(t.id), name: String(t.name), logo: String(t.crest || "") }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
  return { fixtures, clubs };
}


/** Upcoming fixtures across all competitions enabled on the football-data.org account. */
export async function upcomingMatches(days = 7) {
  const now = new Date();
  const dateInAccra = (d: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
  const from = dateInAccra(now);
  const to = dateInAccra(new Date(now.getTime() + Math.max(1, Math.min(14, days)) * 86400_000));
  const data = await api("/matches?dateFrom=" + from + "&dateTo=" + to + "&limit=500", 3 * 60_000);
  return (Array.isArray(data?.matches) ? data.matches : [])
    .filter((m: any) => m?.id && m.homeTeam?.id && m.awayTeam?.id && m.utcDate &&
      ["SCHEDULED", "TIMED"].includes(String(m.status)) && Date.parse(m.utcDate) > Date.now())
    .sort((a: any, b: any) => Date.parse(a.utcDate) - Date.parse(b.utcDate))
    .map((m: any) => ({
      id: Number(m.id), date: String(m.utcDate), status: String(m.status),
      competition: String(m.competition?.name || "Football"),
      home: { id: Number(m.homeTeam.id), name: String(m.homeTeam.name), logo: String(m.homeTeam.crest || "") },
      away: { id: Number(m.awayTeam.id), name: String(m.awayTeam.name), logo: String(m.awayTeam.crest || "") },
    }));
}


export async function searchTeams(q: string) {
  const query = q.trim().toLocaleLowerCase();
  if (query.length < 3) return [];
  const data = await api("/teams?limit=500", 7 * 24 * 3600_000);
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  return teams
    .filter((t: any) => [t.name, t.shortName, t.tla].some((v: any) => String(v || "").toLocaleLowerCase().includes(query)))
    .slice(0, 12)
    .map((t: any) => ({ id: t.id, name: t.name, country: t.area?.name, logo: t.crest }));
}

type Match = any;

/** Today's fixtures across every competition code enabled in this football-data feed (UTC). */
export async function todayCompetitionMatches() {
  // Use one account-level date-range request rather than firing one request per
  // competition. The old 12-request Promise.all regularly hit the free API's
  // rate limit and silently dropped tomorrow's fixtures.
  const now = new Date();
  const dayInAccra = (d: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
  const today = dayInAccra(now);
  const tomorrow = dayInAccra(new Date(now.getTime() + 24 * 60 * 60_000));
  const data = await api("/matches?dateFrom=" + today + "&dateTo=" + tomorrow + "&limit=500", 60_000);
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  const unique = new Map<number, Match>();
  for (const m of matches) {
    if (m?.id && m.homeTeam?.id && m.awayTeam?.id && m.utcDate &&
      ["SCHEDULED", "TIMED"].includes(m.status) &&
      Date.parse(m.utcDate) >= now.getTime()) unique.set(Number(m.id), m);
  }
  return [...unique.values()]
    .sort((a: any, b: any) => Date.parse(a.utcDate) - Date.parse(b.utcDate))
    .map((m: any) => ({
      id: m.id, date: m.utcDate, status: m.status,
      competition: m.competition?.name || m.competition?.code || "Football",
      home: { id: m.homeTeam.id, name: m.homeTeam.name, logo: m.homeTeam.crest || "" },
      away: { id: m.awayTeam.id, name: m.awayTeam.name, logo: m.awayTeam.crest || "" },
      score: null,
    }));
}

/** Resolve OddsPapi fixture team names to football-data IDs in one cached API call. */
export async function resolveTeamIds(names: string[]) {
  const data = await api("/teams?limit=500", 7 * 24 * 3600_000);
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  const normalize = (value: string) => String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\b(football club|fc|afc|cf|sc|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const result: Record<string, number> = {};
  for (const name of names) {
    const target = normalize(name);
    if (!target) continue;
    const exact = teams.filter((team: any) => [team.name, team.shortName, team.tla].some((v: any) => normalize(String(v || "")) === target));
    const candidates = exact.length ? exact : teams.filter((team: any) => [team.name, team.shortName].some((v: any) => {
      const candidate = normalize(String(v || ""));
      return candidate && (candidate.includes(target) || target.includes(candidate));
    }));
    if (candidates.length === 1 && Number(candidates[0].id) > 0) result[target] = Number(candidates[0].id);
  }
  return result;
}

/** Completed fixtures played on one selected calendar date, with verified full-time scores. */
export async function matchesOnDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z"))) {
    throw new Error("Choose a valid match date.");
  }
  const next = new Date(date + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const dateTo = next.toISOString().slice(0, 10);
  const data = await api("/matches?dateFrom=" + date + "&dateTo=" + dateTo + "&limit=500", 30 * 60_000);
  return (data?.matches || [])
    .filter((m: any) => finished(m) && m.homeTeam?.id && m.awayTeam?.id && m.utcDate && String(m.utcDate).slice(0, 10) === date)
    .sort((x: any, y: any) => Date.parse(x.utcDate) - Date.parse(y.utcDate))
    .map((m: any) => ({
      id: m.id,
      date: m.utcDate,
      status: m.status,
      competition: m.competition?.name || "Football",
      home: { id: m.homeTeam.id, name: m.homeTeam.name, logo: m.homeTeam.crest || "" },
      away: { id: m.awayTeam.id, name: m.awayTeam.name, logo: m.awayTeam.crest || "" },
      score: { home: m.score.fullTime.home, away: m.score.fullTime.away },
    }));
}

/** Return exactly the latest completed match and the next scheduled fixture for one-click analysis. */
export async function teamFixtureChoices(teamId: number) {
  // football-data.org rejects date windows longer than 750 days.
  // Keep the combined past + future window safely below that limit.
  const from = new Date(Date.now() - 560 * 86400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 180 * 86400_000).toISOString().slice(0, 10);
  const data = await api("/teams/" + teamId + "/matches?dateFrom=" + from + "&dateTo=" + to + "&limit=500", 5 * 60_000);
  const now = Date.now();
  const matches = (data?.matches || []).filter((m: any) =>
    ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "FINISHED"].includes(m.status) &&
    m.homeTeam?.id && m.awayTeam?.id && m.utcDate
  );
  const next = matches
    .filter((m: any) => m.status !== "FINISHED" && Date.parse(m.utcDate) >= now)
    .sort((a: any, b: any) => Date.parse(a.utcDate) - Date.parse(b.utcDate))[0];
  const last = matches
    .filter((m: any) => finished(m) && Date.parse(m.utcDate) < now)
    .sort((a: any, b: any) => Date.parse(b.utcDate) - Date.parse(a.utcDate))[0];
  return [last, next].filter(Boolean).map((m: any) => ({
    id: m.id, date: m.utcDate, status: m.status, competition: m.competition?.name || "",
    home: { id: m.homeTeam.id, name: m.homeTeam.name, logo: m.homeTeam.crest || "" },
    away: { id: m.awayTeam.id, name: m.awayTeam.name, logo: m.awayTeam.crest || "" },
    score: finished(m) ? { home: m.score.fullTime.home, away: m.score.fullTime.away } : null,
  }));
}

const finished = (m: Match) => m?.status === "FINISHED" && Number.isFinite(m?.score?.fullTime?.home) && Number.isFinite(m?.score?.fullTime?.away);
const sideGoals = (m: Match, teamId: number) => m.homeTeam?.id === teamId
  ? { gf: m.score.fullTime.home, ga: m.score.fullTime.away, home: true }
  : { gf: m.score.fullTime.away, ga: m.score.fullTime.home, home: false };

async function teamMatches(teamId: number, before?: string) {
  const cutoff = before ? new Date(before) : new Date();
  const from = new Date(cutoff.getTime() - 700 * 86400_000).toISOString().slice(0, 10);
  const to = new Date(cutoff.getTime() + 86400_000).toISOString().slice(0, 10);
  const query = before ? `?dateFrom=${from}&dateTo=${to}&limit=100` : "?status=FINISHED&limit=30";
  const data = await api("/teams/" + teamId + "/matches" + query, before ? 12 * 3600_000 : 3 * 3600_000);
  return (data?.matches || []).filter(finished)
    .filter((m: Match) => Date.parse(m.utcDate) < cutoff.getTime())
    .sort((a: Match, b: Match) => Date.parse(b.utcDate) - Date.parse(a.utcDate))
    .slice(0, 30);
}
async function matchOnDate(homeId: number, awayId: number, date: string) {
  const next = new Date(date + "T00:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
  const dateTo = next.toISOString().slice(0, 10);
  // Use the same all-competitions date feed as the date-search list, so
  // the score lookup is consistent with the exact fixture the user selected.
  const data = await api("/matches?dateFrom=" + date + "&dateTo=" + dateTo + "&limit=500", 30 * 60_000);
  return (data?.matches || []).find((m: Match) =>
    m.homeTeam?.id === homeId && m.awayTeam?.id === awayId &&
    m.status === "FINISHED" && String(m.utcDate || "").slice(0, 10) === date
  ) || null;
}

function summarise(teamId: number, matches: Match[]) {
  const recent = matches.slice(0, 5);
  const all = matches.slice(0, 30);
  const stats = (list: Match[]) => {
    let homeGF = 0, homeGA = 0, homeN = 0, awayGF = 0, awayGA = 0, awayN = 0;
    let wins = 0, draws = 0, losses = 0;
    for (const m of list) {
      const s = sideGoals(m, teamId);
      if (s.home) { homeGF += s.gf; homeGA += s.ga; homeN++; }
      else { awayGF += s.gf; awayGA += s.ga; awayN++; }
      if (s.gf > s.ga) wins++; else if (s.gf === s.ga) draws++; else losses++;
    }
    return {
      form: list.map((m) => { const s = sideGoals(m, teamId); return s.gf > s.ga ? "W" : s.gf === s.ga ? "D" : "L"; }).reverse().join(""),
      played: { home: homeN, away: awayN, total: list.length },
      wins: { total: wins }, draws: { total: draws }, loses: { total: losses },
      goalsFor: { home: homeN ? +(homeGF / homeN).toFixed(2) : null, away: awayN ? +(awayGF / awayN).toFixed(2) : null, total: list.length ? +((homeGF + awayGF) / list.length).toFixed(2) : null },
      goalsAgainst: { home: homeN ? +(homeGA / homeN).toFixed(2) : null, away: awayN ? +(awayGA / awayN).toFixed(2) : null, total: list.length ? +((homeGA + awayGA) / list.length).toFixed(2) : null },
      cleanSheets: { total: list.filter((m) => sideGoals(m, teamId).ga === 0).length },
      failedToScore: { total: list.filter((m) => sideGoals(m, teamId).gf === 0).length },
    };
  };
  const s = stats(all);
  const games = recent.map((m) => {
    const x = sideGoals(m, teamId);
    const opponent = m.homeTeam?.id === teamId ? m.awayTeam : m.homeTeam;
    return {
      date: m.utcDate, vs: opponent?.name || "Opponent", home: x.home, gf: x.gf, ga: x.ga,
      res: x.gf > x.ga ? "W" : x.gf === x.ga ? "D" : "L",
      comp: m.competition?.name || "",
    };
  });
  const competitionCounts = new Map<string, { name: string; count: number }>();
  for (const m of all) {
    const code = m.competition?.code || "";
    if (code) {
      const current = competitionCounts.get(code) || { name: m.competition?.name || code, count: 0 };
      current.count++;
      competitionCounts.set(code, current);
    }
  }
  const mainCompetition = [...competitionCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  return { season: s, last5: { games, avg: {} }, competition: mainCompetition ? { code: mainCompetition[0], name: mainCompetition[1].name } : null };
}

async function competitionAverages(code: string) {
  try {
    const data = await api("/competitions/" + encodeURIComponent(code) + "/standings", 12 * 3600_000);
    const table = (data?.standings || []).find((x: any) => x.type === "TOTAL")?.table || [];
    const played = table.reduce((n: number, t: any) => n + Number(t.playedGames || 0), 0);
    const gf = table.reduce((n: number, t: any) => n + Number(t.goalsFor || 0), 0);
    const ga = table.reduce((n: number, t: any) => n + Number(t.goalsAgainst || 0), 0);
    const teams = table.length;
    const games = played / 2;
    return { home: games ? Math.max(0.5, gf / games / 2) : 1.45, away: games ? Math.max(0.5, ga / games / 2) : 1.15, teams };
  } catch {
    return { home: 1.45, away: 1.15, teams: 0 };
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const formPoints = (f: string) => {
  const a = f.slice(-5);
  return a.length ? [...a].reduce((n, c) => n + (c === "W" ? 3 : c === "D" ? 1 : 0), 0) / (a.length * 3) : 0.5;
};

export async function analyse(homeId: number, awayId: number, matchDate?: string) {
  const cutoff = matchDate ? new Date(matchDate + "T00:00:00Z") : new Date();
  if (Number.isNaN(cutoff.getTime())) throw new Error("Invalid match date.");
  // Look up the fixture first so a completed game from earlier today is treated
  // as historical too, rather than using statistics that include the result.
  const dateIsPast = !!matchDate && cutoff.getTime() < new Date().setUTCHours(0, 0, 0, 0);
  // Future fixtures cannot already have a final score; skip a redundant API call.
  const actualMatch = dateIsPast ? await matchOnDate(homeId, awayId, matchDate!) : null;
  const kickoffIsPast = !!actualMatch && Date.parse(actualMatch.utcDate) < Date.now();
  const historical = dateIsPast || kickoffIsPast;
  const [hm, am] = await Promise.all([
    teamMatches(homeId, historical ? matchDate : undefined),
    teamMatches(awayId, historical ? matchDate : undefined),
  ]);
  if (!hm.length || !am.length) throw new Error("Not enough completed match data for one of these teams on the free data plan.");
  const h = summarise(homeId, hm), a = summarise(awayId, am);
  const hCode = h.competition?.code || "PL", aCode = a.competition?.code || "PL";
  const [hAvg, aAvg] = historical
    ? [{ home: Math.max(0.5, h.season.goalsFor.home ?? 1.45), away: Math.max(0.5, h.season.goalsAgainst.home ?? 1.15), teams: 0 }, { home: Math.max(0.5, a.season.goalsAgainst.away ?? 1.45), away: Math.max(0.5, a.season.goalsFor.away ?? 1.15), teams: 0 }]
    : await Promise.all([competitionAverages(hCode), competitionAverages(aCode)]);
  const hAtt = (h.season.goalsFor.home ?? hAvg.home) / hAvg.home;
  const hDef = (h.season.goalsAgainst.home ?? hAvg.away) / hAvg.away;
  const aAtt = (a.season.goalsFor.away ?? aAvg.away) / aAvg.away;
  const aDef = (a.season.goalsAgainst.away ?? aAvg.home) / aAvg.home;
  let lh = hAtt * aDef * ((hAvg.home + aAvg.home) / 2);
  let la = aAtt * hDef * ((hAvg.away + aAvg.away) / 2);
  const fh = formPoints(h.season.form), fa = formPoints(a.season.form);
  lh *= 1 + clamp((fh - fa) * 0.15, -0.1, 0.1);
  la *= 1 + clamp((fa - fh) * 0.15, -0.1, 0.1);
  lh = clamp(lh, 0.2, 4.5); la = clamp(la, 0.15, 4);
  const m = model(lh, la);
  const h2h = hm.filter((x: Match) => x.awayTeam?.id === awayId || x.homeTeam?.id === awayId).slice(0, 6).map((f: Match) => ({
    date: f.utcDate, home: f.homeTeam?.name, away: f.awayTeam?.name,
    score: (f.score?.fullTime?.home ?? "-") + "-" + (f.score?.fullTime?.away ?? "-"), comp: f.competition?.name,
  }));
  const verdict: string[] = [];
  const fav = m.home >= m.away ? { side: "home", p: m.home } : { side: "away", p: m.away };
  verdict.push(fav.p >= 60 ? "Clear favourite: " + fav.side + " win (" + fav.p + "%)." : fav.p >= 45 ? "Leaning " + fav.side + " (" + fav.p + "%), but not safe." : "Close game: home " + m.home + "% / draw " + m.draw + "% / away " + m.away + "%.");
  verdict.push(m.over["1.5"] >= 75 ? "Goals likely: over 1.5 at " + m.over["1.5"] + "%." : "Over 1.5 goals: " + m.over["1.5"] + "%.");
  verdict.push(m.over["2.5"] >= 58 ? "Over 2.5 leans yes (" + m.over["2.5"] + "%)." : m.over["2.5"] <= 42 ? "Under 2.5 leans yes (" + (100 - m.over["2.5"]).toFixed(1) + "%)." : "Over/under 2.5 is close (" + m.over["2.5"] + "%).");
  verdict.push(m.btts >= 58 ? "Both teams to score: yes (" + m.btts + "%)." : m.btts <= 42 ? "Both teams to score: no (" + (100 - m.btts).toFixed(1) + "%)." : "Both teams to score: " + m.btts + "%.");
  verdict.push("Likeliest score: " + m.scores[0].score + " (" + m.scores[0].p + "%).");
  const leagueName = h.competition?.name || "Football";
  return {
    leagues: { home: { name: leagueName, season: new Date().getUTCFullYear() }, away: { name: a.competition?.name || leagueName, season: new Date().getUTCFullYear() } },
    averages: { home: hAvg, away: aAvg },
    teams: { home: { season: h.season, last5: h.last5 }, away: { season: a.season, last5: a.last5 } },
    strengths: { homeAttack: +hAtt.toFixed(2), homeDefence: +hDef.toFixed(2), awayAttack: +aAtt.toFixed(2), awayDefence: +aDef.toFixed(2) },
    model: m, h2h, verdict, matchDate: matchDate || null, historical, actual: actualMatch ? { date: actualMatch.utcDate, status: actualMatch.status, homeGoals: actualMatch.score?.fullTime?.home ?? null, awayGoals: actualMatch.score?.fullTime?.away ?? null, competition: actualMatch.competition?.name || "" } : null,
  };
}

export async function savePrediction(row: Record<string, unknown>) {
  const { data, error } = await sb().from("sport_predictions").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}
export async function saveOdds(id: number, selections: unknown, highestChance: unknown) {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Missing prediction history ID.");
  const safeSelections = Array.isArray(selections) ? selections.slice(0, 60) : [];
  const { data: existing } = await sb().from("sport_predictions").select("note").eq("id", id).maybeSingle();
  let prior: any = {};
  try { prior = existing?.note ? JSON.parse(existing.note) : {}; } catch { prior = {}; }
  const { error } = await sb().from("sport_predictions").update({ note: JSON.stringify({ ...prior, bookmakerComparison: safeSelections, highestChance }) }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function saveSuperSnapshot(input: {
  homeId: number; awayId: number; home: string; away: string; league: string;
  kickoff: string; analysis: any; selections: any[];
}) {
  const kickoff = new Date(input.kickoff).toISOString();
  const m = input.analysis?.model;
  const note = {
    source: "SUPER",
    fixtureHomeId: input.homeId,
    fixtureAwayId: input.awayId,
    matchDate: kickoff.slice(0, 10),
    snapshotAt: new Date().toISOString(),
    selections: input.selections.slice(0, 100),
  };
  const payload: any = {
    home: input.home, away: input.away, league: input.league, kickoff,
    xg_home: m?.xg?.home ?? null, xg_away: m?.xg?.away ?? null,
    p_home: m?.home ?? null, p_draw: m?.draw ?? null, p_away: m?.away ?? null,
    p_btts: m?.btts ?? null, p_o25: m?.over?.["2.5"] ?? null,
    pick: "SUPER odds + Autistik model snapshot",
    note: JSON.stringify(note),
  };
  const { data: existing, error: lookupError } = await sb().from("sport_predictions")
    .select("id").eq("home", input.home).eq("away", input.away).eq("kickoff", kickoff).maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing?.id) {
    const { error } = await sb().from("sport_predictions").update(payload).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id;
  }
  const { data, error } = await sb().from("sport_predictions").insert(payload).select("id").single();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

function settleSelection(selection: any, home: string, away: string, homeGoals: number, awayGoals: number) {
  const market = String(selection.market || "").toLowerCase();
  const label = String(selection.selection || "");
  if (market.includes("straight win")) {
    if (label.toLowerCase() === home.toLowerCase()) return homeGoals > awayGoals ? "WIN" : homeGoals === awayGoals ? "PUSH" : "LOSS";
    if (label.toLowerCase() === away.toLowerCase()) return awayGoals > homeGoals ? "WIN" : homeGoals === awayGoals ? "PUSH" : "LOSS";
  }
  const total = homeGoals + awayGoals;
  const totals = label.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
  if (totals) {
    const line = Number(totals[2]);
    const value = totals[1].toLowerCase() === "over" ? total - line : line - total;
    return value > 0 ? "WIN" : value < 0 ? "LOSS" : "PUSH";
  }
  const handicap = label.match(/^(home|away)\s+([+-]\d+(?:\.5)?)$/i);
  if (handicap) {
    const sideHome = handicap[1].toLowerCase() === "home";
    const line = Number(handicap[2]);
    const adjusted = sideHome ? homeGoals + line - awayGoals : awayGoals + line - homeGoals;
    return adjusted > 0 ? "WIN" : adjusted < 0 ? "LOSS" : "PUSH";
  }
  return "UNSETTLED";
}

export async function settleSuperSnapshots(limit = 10) {
  const { data, error } = await sb().from("sport_predictions").select("id,home,away,kickoff,note,result")
    .is("result", null).lt("kickoff", new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()).order("kickoff", { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);
  let settled = 0;
  for (const row of data || []) {
    let note: any = {};
    try { note = row.note ? JSON.parse(row.note) : {}; } catch { continue; }
    if (note.source !== "SUPER" || !Number(note.fixtureHomeId) || !Number(note.fixtureAwayId)) continue;
    const date = String(note.matchDate || String(row.kickoff).slice(0, 10));
    const analysis = await analyse(Number(note.fixtureHomeId), Number(note.fixtureAwayId), date).catch(() => null);
    const actual = analysis?.actual;
    if (!actual || !Number.isFinite(Number(actual.homeGoals)) || !Number.isFinite(Number(actual.awayGoals))) continue;
    const settledSelections = (Array.isArray(note.selections) ? note.selections : []).map((selection: any) => ({
      ...selection,
      outcome: settleSelection(selection, row.home, row.away, Number(actual.homeGoals), Number(actual.awayGoals)),
    }));
    const wins = settledSelections.filter((x: any) => x.outcome === "WIN").length;
    const losses = settledSelections.filter((x: any) => x.outcome === "LOSS").length;
    const pushes = settledSelections.filter((x: any) => x.outcome === "PUSH").length;
    const updatedNote = { ...note, settledAt: new Date().toISOString(), actual, settledSelections };
    const { error: updateError } = await sb().from("sport_predictions").update({
      result: "W:" + wins + " L:" + losses + " P:" + pushes,
      note: JSON.stringify(updatedNote),
    }).eq("id", row.id);
    if (updateError) throw new Error(updateError.message);
    settled++;
  }
  return { settled };
}

export async function getSuperOddsPerformance() {
  const { data, error } = await sb().from("sport_predictions").select("note").not("result", "is", null).order("id", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  const bands: Record<string, { wins: number; losses: number; pushes: number }> = {};
  for (const row of data || []) {
    let note: any = {};
    try { note = row.note ? JSON.parse(row.note) : {}; } catch { continue; }
    if (note.source !== "SUPER") continue;
    for (const item of note.settledSelections || []) {
      const odds = Number(item.odds);
      if (!Number.isFinite(odds) || odds <= 1) continue;
      const band = odds < 1.5 ? "1.01–1.49" : odds < 2 ? "1.50–1.99" : odds < 2.5 ? "2.00–2.49" : odds < 3.5 ? "2.50–3.49" : "3.50+";
      bands[group] ||= { wins: 0, losses: 0, pushes: 0 };
      if (item.outcome === "WIN") bands[group].wins++;
      else if (item.outcome === "LOSS") bands[group].losses++;
      else if (item.outcome === "PUSH") bands[group].pushes++;
    }
  }
  return Object.entries(bands).map(([group, counts]) => ({
    group, ...counts,
    settled: counts.wins + counts.losses + counts.pushes,
    winRate: counts.wins + counts.losses ? +(counts.wins / (counts.wins + counts.losses) * 100).toFixed(1) : null,
  })).sort((a, b) => a.oddsBand.localeCompare(b.oddsBand));
}

export async function history() {
  const { data } = await sb().from("sport_predictions").select("*").order("id", { ascending: false }).limit(30);
  return data || [];
}
export async function setResult(id: number, result: string) {
  await sb().from("sport_predictions").update({ result: result.slice(0, 20) }).eq("id", id);
}
