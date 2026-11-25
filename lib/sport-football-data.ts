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
  const r = await fetch(BASE + path, {
    headers: { "X-Auth-Token": token, "X-Unfold-Goals": "true" },
    cache: "no-store",
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (hit) return hit.data;
    const message = body?.message || body?.error || r.statusText || "Unknown provider error";
    throw new Error("Football data: " + String(message).slice(0, 180));
  }
  await sb().from("sport_cache").upsert({ key, data: body, at: new Date().toISOString() });
  return body;
}

const COMPETITIONS = ["PL", "ELC", "BL1", "SA", "PD", "FL1", "DED", "PPL", "BSA", "CL", "EC", "WC"];

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
  const actualMatch = matchDate ? await matchOnDate(homeId, awayId, matchDate) : null;
  const dateIsPast = !!matchDate && cutoff.getTime() < new Date().setUTCHours(0, 0, 0, 0);
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
export async function history() {
  const { data } = await sb().from("sport_predictions").select("*").order("id", { ascending: false }).limit(30);
  return data || [];
}
export async function setResult(id: number, result: string) {
  await sb().from("sport_predictions").update({ result: result.slice(0, 20) }).eq("id", id);
}
