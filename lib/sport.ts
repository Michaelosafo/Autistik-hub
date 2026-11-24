/**
 * Sport board (owner only, server side): football team stats from API-Football (api-sports.io, key APIFOOTBALL_KEY
 * in Vercel) and a match model.
 *
 * The model is the standard Poisson one: each side's expected goals = its attack strength × the other side's defence
 * weakness × the league's average, using home-only numbers for the home side and away-only numbers for the away
 * side, nudged a little by recent form and last-5 shot quality (xG when the API has it). From the two expected-goal
 * numbers it works out every score's chance, and from those 1X2, double chance, both teams to score, overs/unders
 * and the likeliest scores.
 *
 * API answers are cached in sport_cache (6 h; finished fixtures 7 days) so the free plan's 100 calls a day go far.
 */
import { supabaseService } from "@/lib/supabase/server";

const BASE = "https://v3.football.api-sports.io";
const TTL_MS = 6 * 3600_000;
const sb = () => supabaseService();

export const sportReady = () => !!process.env.APIFOOTBALL_KEY;

async function api(path: string, ttl = TTL_MS): Promise<any[]> {
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) throw new Error("Add APIFOOTBALL_KEY in Vercel (free key from api-football.com / dashboard.api-football.com), then redeploy.");
  const { data: hit } = await sb().from("sport_cache").select("data,at").eq("key", path).maybeSingle();
  if (hit && Date.now() - Date.parse(hit.at) < ttl) return hit.data as any[];
  const r = await fetch(BASE + path, { headers: { "x-apisports-key": key }, cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  const errs = d?.errors && (Array.isArray(d.errors) ? d.errors : Object.values(d.errors));
  if (!r.ok || (errs && errs.length)) {
    if (hit) return hit.data as any[]; // stale is better than nothing
    throw new Error(`Football data: ${String(errs?.[0] || r.status).slice(0, 160)}`);
  }
  const out = d?.response ?? [];
  await sb().from("sport_cache").upsert({ key: path, data: out, at: new Date().toISOString() });
  return out;
}

export async function searchTeams(q: string) {
  const s = q.trim();
  if (s.length < 3) return [];
  const rows = await api(`/teams?search=${encodeURIComponent(s)}`, 7 * 24 * 3600_000);
  return rows.slice(0, 12).map((x: any) => ({ id: x.team.id, name: x.team.name, country: x.team.country, logo: x.team.logo }));
}

/** The team's current domestic league (type League), else its first current competition. */
async function homeLeague(team: number) {
  const rows = await api(`/leagues?team=${team}&current=true`, 24 * 3600_000);
  const pick = rows.find((x: any) => x.league?.type === "League") || rows[0];
  if (!pick) throw new Error("Couldn't find this team's current league.");
  const season = (pick.seasons || []).find((s: any) => s.current)?.year ?? pick.seasons?.[0]?.year;
  return { id: pick.league.id as number, name: pick.league.name as string, country: pick.country?.name as string, season: Number(season), logo: pick.league.logo as string };
}

/** League averages per game: home side's goals and away side's goals (from the table). */
async function leagueAverages(league: number, season: number) {
  const rows = await api(`/standings?league=${league}&season=${season}`);
  const table: any[] = (rows[0]?.league?.standings || []).flat();
  let hg = 0, hp = 0, ag = 0, ap = 0;
  for (const t of table) { hg += t.home?.goals?.for || 0; hp += t.home?.played || 0; ag += t.away?.goals?.for || 0; ap += t.away?.played || 0; }
  return { home: hp ? hg / hp : 1.5, away: ap ? ag / ap : 1.2, teams: table.length };
}

const num = (v: any) => (v == null || v === "" ? null : Number(String(v).replace("%", "")));
const per = (a: number | null, n: number) => (a == null || !n ? null : +(a / n).toFixed(2));

/** Averages over the team's last 5 finished matches: shots, on target, long shots, passes, possession, corners, xG. */
async function lastFive(team: number) {
  const fx = await api(`/fixtures?team=${team}&last=5`, 3 * 3600_000);
  const games = fx.filter((f: any) => ["FT", "AET", "PEN"].includes(f.fixture?.status?.short));
  const sums: Record<string, number> = {}, counts: Record<string, number> = {};
  const want: Record<string, string> = {
    "Total Shots": "shots", "Shots on Goal": "onTarget", "Shots outsidebox": "longShots", "Shots insidebox": "boxShots",
    "Total passes": "passes", "Passes %": "passPct", "Ball Possession": "possession", "Corner Kicks": "corners",
    "expected_goals": "xg", "Fouls": "fouls", "Goalkeeper Saves": "saves",
  };
  const results: { date: string; vs: string; home: boolean; gf: number; ga: number; res: "W" | "D" | "L"; comp: string }[] = [];
  await Promise.all(games.map(async (f: any) => {
    const home = f.teams.home.id === team;
    const gf = Number(home ? f.goals.home : f.goals.away), ga = Number(home ? f.goals.away : f.goals.home);
    results.push({ date: f.fixture.date, vs: home ? f.teams.away.name : f.teams.home.name, home, gf, ga, res: gf > ga ? "W" : gf === ga ? "D" : "L", comp: f.league?.name || "" });
    const st = await api(`/fixtures/statistics?fixture=${f.fixture.id}&team=${team}`, 7 * 24 * 3600_000).catch(() => []);
    for (const s of st[0]?.statistics || []) {
      const k = want[s.type]; const v = num(s.value);
      if (!k || v == null || Number.isNaN(v)) continue;
      sums[k] = (sums[k] || 0) + v; counts[k] = (counts[k] || 0) + 1;
    }
  }));
  results.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const avg: Record<string, number | null> = {};
  for (const k of Object.values(want)) avg[k] = counts[k] ? +(sums[k] / counts[k]).toFixed(k === "xg" ? 2 : 1) : null;
  return { games: results, avg };
}

async function teamSeason(team: number, league: number, season: number) {
  const r: any = await api(`/teams/statistics?league=${league}&season=${season}&team=${team}`);
  const s = Array.isArray(r) ? r[0] ?? r : r;
  const fx = s?.fixtures || {}, g = s?.goals || {};
  const ph = fx.played?.home || 0, pa = fx.played?.away || 0;
  return {
    form: String(s?.form || "").slice(-10),
    played: { home: ph, away: pa, total: fx.played?.total || 0 },
    wins: fx.wins || {}, draws: fx.draws || {}, loses: fx.loses || {},
    goalsFor: { home: per(g.for?.total?.home ?? null, ph), away: per(g.for?.total?.away ?? null, pa), total: num(g.for?.average?.total) },
    goalsAgainst: { home: per(g.against?.total?.home ?? null, ph), away: per(g.against?.total?.away ?? null, pa), total: num(g.against?.average?.total) },
    cleanSheets: s?.clean_sheet || {}, failedToScore: s?.failed_to_score || {},
    over25: null as number | null,
  };
}

// ---------------------------------------------------------------- the model

const fact = (n: number) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
const pois = (k: number, l: number) => Math.exp(-l) * l ** k / fact(k);

export function model(lh: number, la: number) {
  const N = 10;
  const grid: number[][] = [];
  let pH = 0, pD = 0, pA = 0, btts = 0;
  const over: Record<string, number> = { "0.5": 0, "1.5": 0, "2.5": 0, "3.5": 0, "4.5": 0 };
  const scores: { s: string; p: number }[] = [];
  for (let h = 0; h <= N; h++) {
    grid[h] = [];
    for (let a = 0; a <= N; a++) {
      const p = pois(h, lh) * pois(a, la);
      grid[h][a] = p;
      if (h > a) pH += p; else if (h === a) pD += p; else pA += p;
      if (h > 0 && a > 0) btts += p;
      for (const line of Object.keys(over)) if (h + a > Number(line)) over[line] += p;
      scores.push({ s: `${h}-${a}`, p });
    }
  }
  scores.sort((x, y) => y.p - x.p);
  const pct = (x: number) => +(x * 100).toFixed(1);
  // Every common bet, priced from the same score grid; the 10 likeliest come back with their fair odds (1 ÷ chance).
  const sum = (f: (h: number, a: number) => boolean) => { let t = 0; for (let h = 0; h <= N; h++) for (let a = 0; a <= N; a++) if (f(h, a)) t += grid[h][a]; return t; };
  const markets: [string, number][] = [
    ["Home win (1)", pH], ["Draw (X)", pD], ["Away win (2)", pA],
    ["Home or draw (1X)", pH + pD], ["Away or draw (X2)", pA + pD], ["Home or away (12)", pH + pA],
    ["Both teams score: Yes", btts], ["Both teams score: No", 1 - btts],
    ...(["0.5", "1.5", "2.5", "3.5"] as const).flatMap((l) => [[`Over ${l} goals`, over[l]], [`Under ${l} goals`, 1 - over[l]]] as [string, number][]),
    ["Under 4.5 goals", 1 - over["4.5"]], ["Under 5.5 goals", sum((h, a) => h + a <= 5)],
    ["Home team scores", 1 - pois(0, lh)], ["Away team scores", 1 - pois(0, la)],
    ["Home team over 1.5 goals", sum((h) => h >= 2)], ["Away team over 1.5 goals", sum((_, a) => a >= 2)],
    ["Home team under 2.5 goals", sum((h) => h <= 2)], ["Away team under 2.5 goals", sum((_, a) => a <= 2)],
    ["Home win to nil", sum((h, a) => h > a && a === 0)], ["Away win to nil", sum((h, a) => a > h && h === 0)],
    ["Home win & over 1.5", sum((h, a) => h > a && h + a >= 2)], ["Away win & over 1.5", sum((h, a) => a > h && h + a >= 2)],
    ["Home or draw & under 3.5", sum((h, a) => h >= a && h + a <= 3)], ["Away or draw & under 3.5", sum((h, a) => a >= h && h + a <= 3)],
    ["Home win & both score", sum((h, a) => h > a && a > 0)], ["Away win & both score", sum((h, a) => a > h && h > 0)],
    ["Home -1.5 handicap (win by 2+)", sum((h, a) => h - a >= 2)], ["Away -1.5 handicap (win by 2+)", sum((h, a) => a - h >= 2)],
    ["Home +1.5 handicap (lose by 1 at most)", sum((h, a) => a - h <= 1)], ["Away +1.5 handicap (lose by 1 at most)", sum((h, a) => h - a <= 1)],
    ["Total goals 1-3", sum((h, a) => h + a >= 1 && h + a <= 3)], ["Total goals 2-4", sum((h, a) => h + a >= 2 && h + a <= 4)],
  ];
  const ranked = markets
    .map(([name, p]) => ({ name, p: pct(p), fair: p > 0 ? +(1 / p).toFixed(2) : null }))
    .filter((x) => x.p < 99)
    .sort((a, b) => b.p - a.p);
  // Four quick picks for the match screen:
  // 1) lowest probability in the 80–90% band,
  // 2) third green pick counting upward from the bottom,
  // 3) second green pick counting upward from the bottom,
  // 4) last yellow selection in the analysis order.
  const highBand = ranked.filter((x) => x.p >= 80 && x.p <= 90);
  const greenBand = ranked.filter((x) => x.p >= 65 && x.p < 80);
  const yellowBand = ranked.filter((x) => x.p >= 45 && x.p < 65);
  const top10 = [
    { pick: highBand[highBand.length - 1], quickLabel: "80–90% high pick" },
    { pick: greenBand.length >= 3 ? greenBand[greenBand.length - 3] : undefined, quickLabel: "Third green from bottom" },
    { pick: greenBand.length >= 2 ? greenBand[greenBand.length - 2] : undefined, quickLabel: "Second green from bottom" },
    { pick: yellowBand[yellowBand.length - 1], quickLabel: "Last yellow in analysis" },
  ].filter((entry) => entry.pick).map((entry) => ({ ...entry.pick, quickLabel: entry.quickLabel }));
  return {
    xg: { home: +lh.toFixed(2), away: +la.toFixed(2) },
    home: pct(pH), draw: pct(pD), away: pct(pA),
    homeOrDraw: pct(pH + pD), awayOrDraw: pct(pA + pD), noDraw: pct(pH + pA),
    btts: pct(btts), over: Object.fromEntries(Object.entries(over).map(([k, v]) => [k, pct(v)])),
    homeScores: pct(1 - pois(0, lh)), awayScores: pct(1 - pois(0, la)),
    scores: scores.slice(0, 5).map((x) => ({ score: x.s, p: pct(x.p) })),
    top10, markets: ranked,
  };
}

const formPts = (f: string) => { const last = f.slice(-5); let p = 0; for (const c of last) p += c === "W" ? 3 : c === "D" ? 1 : 0; return last.length ? p / (last.length * 3) : 0.5; };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Full analysis of home vs away. */
export async function analyse(homeId: number, awayId: number) {
  const [hl, al] = await Promise.all([homeLeague(homeId), homeLeague(awayId)]);
  const [hAvg, aAvg, hs, as_, h5, a5, h2h] = await Promise.all([
    leagueAverages(hl.id, hl.season), leagueAverages(al.id, al.season),
    teamSeason(homeId, hl.id, hl.season), teamSeason(awayId, al.id, al.season),
    lastFive(homeId), lastFive(awayId),
    api(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=6`, 24 * 3600_000).catch(() => []),
  ]);
  // Strengths relative to each team's own league (so teams from different leagues can be compared).
  const hAtt = (hs.goalsFor.home ?? hAvg.home) / hAvg.home;
  const hDef = (hs.goalsAgainst.home ?? hAvg.away) / hAvg.away;
  const aAtt = (as_.goalsFor.away ?? aAvg.away) / aAvg.away;
  const aDef = (as_.goalsAgainst.away ?? aAvg.home) / aAvg.home;
  const base = { home: (hAvg.home + aAvg.home) / 2, away: (hAvg.away + aAvg.away) / 2 };
  let lh = hAtt * aDef * base.home;
  let la = aAtt * hDef * base.away;
  // Recent form (last 5 results) and chance quality (last-5 xG, else shots on target) nudge it by up to ±15%.
  const fH = formPts(hs.form), fA = formPts(as_.form);
  lh *= 1 + clamp((fH - fA) * 0.15, -0.1, 0.1);
  la *= 1 + clamp((fA - fH) * 0.15, -0.1, 0.1);
  const q = (x: any) => x.avg.xg ?? (x.avg.onTarget != null ? x.avg.onTarget * 0.32 : null);
  const qH = q(h5), qA = q(a5);
  if (qH != null) lh = lh * 0.8 + qH * 0.2;
  if (qA != null) la = la * 0.8 + qA * 0.2;
  lh = clamp(lh, 0.2, 4.5); la = clamp(la, 0.15, 4);
  const m = model(lh, la);

  const h2hRows = (h2h as any[]).map((f: any) => ({ date: f.fixture.date, home: f.teams.home.name, away: f.teams.away.name, score: `${f.goals.home ?? "-"}-${f.goals.away ?? "-"}`, comp: f.league?.name }));
  const verdict: string[] = [];
  const fav = m.home >= m.away ? { side: "home", p: m.home } : { side: "away", p: m.away };
  verdict.push(fav.p >= 60 ? `Clear favourite: ${fav.side === "home" ? "home" : "away"} win (${fav.p}%).` : fav.p >= 45 ? `Leaning ${fav.side === "home" ? "home" : "away"} (${fav.p}%), but not safe: double chance ${fav.side === "home" ? m.homeOrDraw : m.awayOrDraw}%.` : `Close game: home ${m.home}% / draw ${m.draw}% / away ${m.away}%.`);
  verdict.push(m.over["1.5"] >= 75 ? `Goals likely: over 1.5 at ${m.over["1.5"]}%.` : `Tight game expected: over 1.5 only ${m.over["1.5"]}%.`);
  verdict.push(m.over["2.5"] >= 58 ? `Over 2.5 leans yes (${m.over["2.5"]}%).` : m.over["2.5"] <= 42 ? `Under 2.5 leans yes (${(100 - m.over["2.5"]).toFixed(1)}%).` : `Over/under 2.5 is a coin flip (${m.over["2.5"]}%).`);
  verdict.push(m.btts >= 58 ? `Both teams to score: yes (${m.btts}%).` : m.btts <= 42 ? `Both teams to score: no (${(100 - m.btts).toFixed(1)}%).` : `Both teams to score: 50/50 (${m.btts}%).`);
  verdict.push(`Likeliest score: ${m.scores[0].score} (${m.scores[0].p}%).`);

  return {
    leagues: { home: hl, away: al }, averages: { home: hAvg, away: aAvg },
    teams: { home: { season: hs, last5: h5 }, away: { season: as_, last5: a5 } },
    strengths: { homeAttack: +hAtt.toFixed(2), homeDefence: +hDef.toFixed(2), awayAttack: +aAtt.toFixed(2), awayDefence: +aDef.toFixed(2) },
    model: m, h2h: h2hRows, verdict,
  };
}

export async function savePrediction(row: Record<string, unknown>) {
  await sb().from("sport_predictions").insert(row);
}
export async function history() {
  const { data } = await sb().from("sport_predictions").select("*").order("id", { ascending: false }).limit(30);
  return data || [];
}
export async function setResult(id: number, result: string) {
  await sb().from("sport_predictions").update({ result: result.slice(0, 20) }).eq("id", id);
}
