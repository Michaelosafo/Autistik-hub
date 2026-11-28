"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * Sport board (owner only): pick the home and the away team, and it compares both (home record for the home side,
 * away record for the away side, goals, clean sheets, last-5 shots, long shots, passes, possession, xG, head to head)
 * and predicts the match: 1X2, double chance, both teams to score, overs, likeliest scores. Every analysis is saved,
 * and you can mark the real result to see how the board does over time.
 */
type Team = { id: number; name: string; country?: string; logo?: string };

async function api<T = any>(action: string, body: object = {}): Promise<T> {
  const r = await fetch("/api/admin/sport", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

function TeamPick({ label, team, setTeam, onChoose }: { label: string; team: Team | null; setTeam: (t: Team | null) => void; onChoose?: (t: Team) => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Team[]>([]);
  const [busy, setBusy] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(t.current);
    if (q.trim().length < 3) { setList([]); return; }
    t.current = setTimeout(() => { setBusy(true); api<{ teams: Team[] }>("search", { q }).then((d) => setList(d.teams)).catch(() => setList([])).finally(() => setBusy(false)); }, 450);
  }, [q]);
  if (team) return (
    <div className="sb-team">
      {team.logo && <img src={team.logo} alt="" width={36} height={36} />}
      <div><small className="muted">{label}</small><b>{team.name}</b>{team.country && <small className="muted"> · {team.country}</small>}</div>
      <button type="button" className="btn small ghost" onClick={() => { setTeam(null); setQ(""); }}>Change</button>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="stack" style={{ gap: 4 }}><b>{label}</b>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a team name (3+ letters)" />
      </label>
      {busy && <small className="muted">Searching…</small>}
      {list.map((x) => (
        <button key={x.id} type="button" className="sb-opt" onClick={() => { setTeam(x); setList([]); onChoose?.(x); }}>
          {x.logo && <img src={x.logo} alt="" width={22} height={22} />}<span>{x.name}</span><small className="muted">{x.country}</small>
        </button>
      ))}
    </div>
  );
}

const pctCls = (p: number) => (p >= 65 ? "hi" : p >= 45 ? "mid" : "lo");
const Bar = ({ label, p }: { label: string; p: number }) => (
  <div className={`sb-bar ${pctCls(p)}`}><span>{label}</span><i style={{ width: `${Math.max(2, p)}%` }} /><b>{p}%</b></div>
);
const v = (x: any, d = "–") => (x == null || Number.isNaN(x) ? d : x);

export default function SportBoard() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [home, setHome] = useState<Team | null>(null);
  const [away, setAway] = useState<Team | null>(null);
  const [teamFixtures, setTeamFixtures] = useState<any[]>([]);
  const [fixturesBusy, setFixturesBusy] = useState(false);
  const [fixturesError, setFixturesError] = useState("");
  const accraDate = (value = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
    return part("year") + "-" + part("month") + "-" + part("day");
  };
  const [matchDate, setMatchDate] = useState(accraDate());
  const [res, setRes] = useState<any>(null);
  const [quickPicksOpen, setQuickPicksOpen] = useState(false);
  const [activeFixtureIndex, setActiveFixtureIndex] = useState(-1);
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);
  const getValidQuickPicks = (model: any) => {
    // The server builds top10 from the same complete ranked analysis. Prefer that
    // canonical shortlist so the quick modal and full analysis cannot disagree.
    const supplied = Array.isArray(model?.top10)
      ? model.top10.filter((o: any) => o && o.name && Number.isFinite(Number(o.p)))
      : [];
    if (supplied.length) return supplied;

    // Backward-compatible fallback for older saved/API responses without top10.
    const ranked = Array.isArray(model?.markets) ? model.markets : [];
    const high = ranked.filter((o: any) => Number(o.p) >= 80 && Number(o.p) <= 90);
    const green = ranked.filter((o: any) => Number(o.p) >= 65 && Number(o.p) < 80);
    const yellow = ranked.filter((o: any) => Number(o.p) >= 45 && Number(o.p) < 65);
    const firstRed = ranked.find((o: any) => Number(o.p) < 45);
    const thirdGreen = green.length >= 3 ? green[green.length - 3] : undefined;
    const secondGreen = green.length >= 2 ? green[green.length - 2] : undefined;
    const sameGreen = !!thirdGreen && !!secondGreen && thirdGreen.name === secondGreen.name;
    return [
      high.length ? { ...high[high.length - 1], quickLabel: "80–90% high pick" } : undefined,
      thirdGreen ? { ...thirdGreen, quickLabel: sameGreen ? "Third and second green from bottom — same selection" : "Third green from bottom" } : undefined,
      !sameGreen && secondGreen ? { ...secondGreen, quickLabel: "Second green from bottom" } : undefined,
      yellow.length ? { ...yellow[yellow.length - 1], quickLabel: "Last yellow in analysis" } : undefined,
      firstRed ? { ...firstRed, quickLabel: "First red in analysis" } : undefined,
    ].filter((o: any) => o && o.name);
  };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hist, setHist] = useState<any[]>([]);
  const [marketOdds, setMarketOdds] = useState<Record<string, string>>({});
  const [showValue, setShowValue] = useState(true);
  const [ghanaOdds, setGhanaOdds] = useState<any>(null);
  const [oddsBusy, setOddsBusy] = useState(false);
  const [oddsError, setOddsError] = useState("");
  const [leagueCatalogue, setLeagueCatalogue] = useState<any[]>([]);
  const [leagueSearch, setLeagueSearch] = useState("");
  const [selectedLeague, setSelectedLeague] = useState<any>(null);
  const [selectedLeagueFixtures, setSelectedLeagueFixtures] = useState<any[]>([]);
  const [leagueClubs, setLeagueClubs] = useState<any[]>([]);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [leagueScanBusy, setLeagueScanBusy] = useState(false);
  const [leagueScanProgress, setLeagueScanProgress] = useState("");
  const [leagueScanResults, setLeagueScanResults] = useState<any[]>([]);
  const [leagueValueRows, setLeagueValueRows] = useState<any[]>([]);
  const [leagueValueDiagnostics, setLeagueValueDiagnostics] = useState<any[]>([]);
  const [todayBusy, setTodayBusy] = useState(false);
  const [todayError, setTodayError] = useState("");
  const [dateMatches, setDateMatches] = useState<any[]>([]);
  const [dateMatchesImportedCount, setDateMatchesImportedCount] = useState(0);
  const [dateMatchesBusy, setDateMatchesBusy] = useState(false);
  const [dateMatchesError, setDateMatchesError] = useState("");
  const [dailyValueRows, setDailyValueRows] = useState<any[]>([]);
  const [dailyScanDiagnostics, setDailyScanDiagnostics] = useState<any[]>([]);
  const [dailyScanBusy, setDailyScanBusy] = useState(false);
  const [dailyScanProgress, setDailyScanProgress] = useState("");
  const [dailyScanError, setDailyScanError] = useState("");
  const [selectedSportDisagreementBand, setSelectedSportDisagreementBand] = useState("all");
  async function loadTodayMatches() {
    setTodayBusy(true); setTodayError("");
    try {
      const d = await api<{ leagues: any[] }>("leagues");
      setLeagueCatalogue(Array.isArray(d.leagues) ? d.leagues : []);
      if (!(d.leagues || []).length) setTodayError("No leagues were returned by the football data provider. Check your API-Football plan and key.");
    } catch (e) { setTodayError((e as Error).message); }
    finally { setTodayBusy(false); }
  }
  async function openLeague(league: any) {
    setSelectedLeague(league); setSelectedLeagueFixtures([]); setLeagueClubs([]);
    setLeagueScanResults([]); setLeagueValueRows([]); setLeagueValueDiagnostics([]);
    setTodayError(""); setLeagueLoading(true);
    try {
      const d = await api<{ fixtures: any[]; clubs: any[] }>("leagueFixtures", { leagueId: Number(league.id), season: Number(league.season) });
      const fixtures = Array.isArray(d.fixtures) ? d.fixtures : [];
      setSelectedLeagueFixtures(fixtures);
      setLeagueClubs([]);
      if (!fixtures.length) {
        setTodayError("No upcoming fixtures were returned for this competition and season.");
      } else {
        // Opening a competition automatically starts its odds/value scan.
        await scanLeagueFixtures(fixtures, league);
      }
    } catch (e) { setTodayError((e as Error).message); }
    finally { setLeagueLoading(false); }
  }
  async function scanLeagueFixtures(fixtures: any[], league: any) {
    if (!fixtures.length) return;
    setLeagueScanBusy(true); setLeagueValueRows([]); setLeagueValueDiagnostics([]);
    setLeagueScanResults([]); setTodayError("");
    const rows: any[] = [], diagnostics: any[] = [];
    try {
      // Send up to 10 fixtures per request to reduce network round-trips without
      // exceeding the server route's 20-fixture limit or creating oversized requests.
      for (let i = 0; i < fixtures.length; i += 10) {
        const batch = fixtures.slice(i, i + 10);
        setLeagueScanProgress("Scanning " + league.name + " · " + Math.min(i + batch.length, fixtures.length) + " of " + fixtures.length + " matches");
        const result = await api<{ rows: any[]; diagnostics: any[] }>("valueScan", { fixtures: batch });
        rows.push(...(Array.isArray(result.rows) ? result.rows : []));
        diagnostics.push(...(Array.isArray(result.diagnostics) ? result.diagnostics : []));
        setLeagueValueRows([...rows].sort((a: any, b: any) => Number(b.ev || 0) - Number(a.ev || 0)));
        setLeagueValueDiagnostics([...diagnostics]);
      }
      if (!rows.some((row: any) => row.modelSupported && Number.isFinite(Number(row.ev)))) {
        setTodayError("No supported Ghana bookmaker prices with matching AUTISTIK probabilities were found in this competition.");
      }
    } catch (error) {
      setTodayError(error instanceof Error ? error.message : String(error));
    } finally {
      setLeagueScanProgress("");
      setLeagueScanBusy(false);
    }
  }
  async function scanSelectedLeague() {
    if (!selectedLeague || !selectedLeagueFixtures.length || leagueScanBusy) return;
    await scanLeagueFixtures(selectedLeagueFixtures, selectedLeague);
  }
  async function scanDateMatches(fixtures: any[], dateToScan: string) {
    setDailyValueRows([]); setDailyScanDiagnostics([]); setDailyScanError("");
    if (!fixtures.length) return;
    setDailyScanBusy(true);
    const allRows: any[] = [];
    const allDiagnostics: any[] = [];
    try {
      // Larger bounded batches reduce hundreds of sequential browser requests.
      // The API route accepts up to 20 fixtures; use 10 to keep request duration manageable.
      for (let i = 0; i < fixtures.length; i += 10) {
        const batch = fixtures.slice(i, i + 10);
        setDailyScanProgress("Comparing odds · " + Math.min(i + batch.length, fixtures.length) + " of " + fixtures.length + " matches");
        const result = await api<{ rows: any[]; diagnostics: any[] }>("valueScan", { fixtures: batch });
        allRows.push(...(Array.isArray(result.rows) ? result.rows : []));
        allDiagnostics.push(...(Array.isArray(result.diagnostics) ? result.diagnostics : []));
        setDailyValueRows([...allRows].sort((a: any, b: any) => Math.abs(Number(b.ev) || 0) - Math.abs(Number(a.ev) || 0)));
        setDailyScanDiagnostics([...allDiagnostics]);
      }
      if (!allRows.some((row: any) => row.modelSupported && Number.isFinite(Number(row.ev)))) {
        setDailyScanError("No qualifying prices were found yet. Open Odds-feed diagnostics below to see which bookmakers the provider returned, the detected plan, and any odds or model-matching errors.");
      }
    } catch (e) {
      setDailyScanError((e as Error).message);
    } finally {
      setDailyScanProgress("");
      setDailyScanBusy(false);
    }
  }
  async function searchMatchesByDate(dateToLoad = matchDate) {
    if (!dateToLoad) return;
    setDateMatchesBusy(true); setDateMatchesError(""); setDateMatches([]);
    setDailyValueRows([]); setDailyScanDiagnostics([]); setDailyScanError("");
    try {
      const d = await api<{ matches: any[]; importedCount?: number; fixtureProvider?: string }>("dateMatches", { date: dateToLoad });
      const matches = (Array.isArray(d.matches) ? d.matches : []).sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date));
      setDateMatches(matches);
      setDateMatchesImportedCount(Number(d.importedCount ?? matches.length));
      if (!matches.length) setDateMatchesError("No matches were returned by API-Football for this date.");
      else void scanDateMatches(matches, dateToLoad);
    } catch (e) { setDateMatchesError((e as Error).message); }
    finally { setDateMatchesBusy(false); }
  }
  async function fetchGhanaOddsFor(h: Team, a: Team, date: string) {
    setOddsBusy(true); setOddsError(""); setGhanaOdds(null);
    try { setGhanaOdds(await api("odds", { homeName: h.name, awayName: a.name, matchDate: date })); }
    catch (e) { setOddsError((e as Error).message); }
    finally { setOddsBusy(false); }
  }
  async function loadGhanaOdds() {
    if (!home || !away) return;
    await fetchGhanaOddsFor(home, away, matchDate);
  }
  async function loadTeamFixtures(t: Team) {
    setFixturesBusy(true); setFixturesError(""); setTeamFixtures([]);
    try { const d = await api<{ fixtures: any[]; fixtureProvider?: string }>("teamFixtures", { teamId: t.id, teamName: t.name }); setTeamFixtures(d.fixtures || []); }
    catch (e) { setFixturesError((e as Error).message); }
    finally { setFixturesBusy(false); }
  }
  async function chooseFixture(f: any) {
    setActiveFixtureIndex(selectedLeagueFixtures.findIndex((x: any) => String(x.id) === String(f.id)));
    setShowFullAnalysis(false);
    const h: Team = { id: f.home.id, name: f.home.name, logo: f.home.logo };
    const a: Team = { id: f.away.id, name: f.away.name, logo: f.away.logo };
    const date = accraDate(new Date(f.date));
    setHome(h); setAway(a); setMatchDate(date); setRes(null); setErr("");
    setBusy(true);
    setGhanaOdds(null); setOddsError("");
    try {
      const result = await api("analyse", { home: h.id, away: a.id, matchDate: date, homeName: h.name, awayName: a.name, fixtureSource: f.fixtureSource || f.provider });
      setRes(result); setQuickPicksOpen(true); loadHist();
    }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  const loadHist = () => api<{ rows: any[] }>("history").then((d) => setHist(d.rows)).catch(() => {});
  useEffect(() => { api<{ ready: boolean }>("ready").then((d) => setReady(d.ready)).catch(() => setReady(false)); loadHist(); void searchMatchesByDate(accraDate()); }, []);

  async function run() {
    if (!home || !away) return;
    setBusy(true); setErr(""); setRes(null);
    setGhanaOdds(null); setOddsError("");
    try {
      const result = await api("analyse", { home: home.id, away: away.id, matchDate, homeName: home.name, awayName: away.name });
      setRes(result); setQuickPicksOpen(true); loadHist();
    }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  function startNewManualSearch() {
    setRes(null);
    setShowFullAnalysis(false);
    setQuickPicksOpen(false);
    setHome(null);
    setAway(null);
    setTeamFixtures([]);
    setFixturesError("");
    setErr("");
    setActiveFixtureIndex(-1);
    setGhanaOdds(null);
    setOddsError("");
  }

  const H = res?.teams?.home, A = res?.teams?.away, m = res?.model;
  const pricedMarkets = m?.markets?.map((o: any) => {
    const raw = marketOdds[o.name] || "", odds = Number(raw);
    const valid = raw !== "" && Number.isFinite(odds) && odds > 1;
    const implied = valid ? 100 / odds : null, edge = valid ? o.p - implied : null;
    const ev = valid ? (o.p / 100) * odds - 1 : null;
    return { ...o, odds: valid ? odds : null, implied, edge, ev, value: valid && ev! > 0 };
  }) || [];
  const highestChance = [...(m?.markets || [])].sort((a: any, b: any) => b.p - a.p)[0];
  const bestValue = pricedMarkets.filter((o: any) => o.value).sort((a: any, b: any) => b.ev - a.ev)[0];
  const oddsValueRows = (ghanaOdds?.matched || []).flatMap((event: any) => {
    const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
    const selections = [
      { name: home?.name || "Home", p: m?.home, matches: (s: string) => norm(s) === norm(home?.name || "") || norm(s).includes(norm(home?.name || "___")) },
      { name: "Draw", p: m?.draw, matches: (s: string) => ["draw", "the draw", "tie"].includes(norm(s)) },
      { name: away?.name || "Away", p: m?.away, matches: (s: string) => norm(s) === norm(away?.name || "") || norm(s).includes(norm(away?.name || "___")) },
    ];
    const markets = (event.bookmakers || []).filter((book: any) => !/exchange/i.test(String(book.title || book.key || "")))
      .flatMap((book: any) => (book.markets || []).filter((market: any) => market.key === "h2h" && Array.isArray(market.outcomes) && market.outcomes.length >= 3)
        .map((market: any) => ({ book, outcomes: market.outcomes })));
    return selections.map((selection: any) => {
      if (!Number.isFinite(selection.p)) return null;
      const candidates = markets.map(({ book, outcomes }: any) => {
        const outcome = outcomes.find((o: any) => selection.matches(String(o.name || "")) && Number(o.price) > 1);
        const valid = outcomes.filter((o: any) => Number.isFinite(Number(o.price)) && Number(o.price) > 1);
        const overround = valid.reduce((sum: number, o: any) => sum + 100 / Number(o.price), 0);
        if (!outcome || !overround) return null;
        const rawImplied = 100 / Number(outcome.price);
        return { price: Number(outcome.price), bookmaker: book.title || book.key || "Bookmaker", rawImplied,
          noVigProbability: rawImplied / overround * 100 };
      }).filter(Boolean);
      const best = candidates.sort((a: any, b: any) => b.price - a.price)[0];
      if (!best) return { selection: selection.name, probability: selection.p, fairOdds: 100 / selection.p, odds: null, bookmaker: "No bookmaker price returned", implied: null, noVigProbability: null, edge: null, ev: null, disagreement: false };
      const ev = (selection.p / 100) * best.price - 1;
      const edge = selection.p - best.noVigProbability;
      return { selection: selection.name, probability: selection.p, fairOdds: 100 / selection.p, odds: best.price, bookmaker: best.bookmaker,
        implied: best.rawImplied, noVigProbability: best.noVigProbability, edge, ev: ev * 100, disagreement: Math.abs(edge) >= 10 };
    });
  }).filter(Boolean);
  const rankedOddsValueRows = [...oddsValueRows].sort((a: any, b: any) => {
    if (a.ev == null) return 1;
    if (b.ev == null) return -1;
    return b.ev - a.ev;
  });
  const positiveOddsValues = rankedOddsValueRows.filter((x: any) => x.ev > 0);
  if (ghanaOdds && oddsValueRows.length === 0 && m) {
    oddsValueRows.push(
      { selection: home?.name || "Home", probability: m.home, fairOdds: m.home > 0 ? 100 / m.home : 0, odds: null, bookmaker: "No bookmaker price returned", implied: null, noVigProbability: null, edge: null, ev: null, disagreement: false },
      { selection: "Draw", probability: m.draw, fairOdds: m.draw > 0 ? 100 / m.draw : 0, odds: null, bookmaker: "No bookmaker price returned", implied: null, noVigProbability: null, edge: null, ev: null, disagreement: false },
      { selection: away?.name || "Away", probability: m.away, fairOdds: m.away > 0 ? 100 / m.away : 0, odds: null, bookmaker: "No bookmaker price returned", implied: null, noVigProbability: null, edge: null, ev: null, disagreement: false }
    );
  }
  const bestOddsValue = positiveOddsValues[0];
  const highestOddsEV = bestOddsValue;
  // Alternative-market shortlist: probability estimates only. A market is not labelled
  // value until a real bookmaker price for that exact line is available.
  const recommendedMarketRows = (m?.markets || [])
    .filter((x: any) => /handicap|goals|both teams score|team over|team under|double chance|home or draw|away or draw/i.test(String(x.name)))
    .filter((x: any) => Number(x.p) >= 55 && Number(x.p) <= 90)
    .sort((a: any, b: any) => Number(b.p) - Number(a.p))
    .slice(0, 5);
  const crossLeagueEstimate = !!res?.leagues?.home?.name && !!res?.leagues?.away?.name && String(res.leagues.home.name).trim().toLowerCase() !== String(res.leagues.away.name).trim().toLowerCase();
  async function saveOdds() {
    const selections = pricedMarkets.filter((o: any) => o.odds != null).map((o: any) => ({
      name: o.name, probability: o.p, fairOdds: o.fair, bookmakerOdds: o.odds,
      impliedProbability: +o.implied.toFixed(2), edgePercentagePoints: +o.edge.toFixed(2),
      expectedValuePercent: +(o.ev * 100).toFixed(2), value: o.value,
    }));
    await api("saveOdds", { predictionId: res?.predictionId, selections, highestChance: highestChance ? { name: highestChance.name, probability: highestChance.p, fairOdds: highestChance.fair } : null });
    await loadHist();
  }
  const rows: [string, any, any][] = res ? [
    ["League", `${res.leagues.home.name}`, `${res.leagues.away.name}`],
    ["Form (latest last)", H.season.form || "–", A.season.form || "–"],
    ["Record (home / away)", `${v(H.season.wins.home)}W ${v(H.season.draws.home)}D ${v(H.season.loses.home)}L at home`, `${v(A.season.wins.away)}W ${v(A.season.draws.away)}D ${v(A.season.loses.away)}L away`],
    ["Goals scored per game", `${v(H.season.goalsFor.home)} at home`, `${v(A.season.goalsFor.away)} away`],
    ["Goals conceded per game", `${v(H.season.goalsAgainst.home)} at home`, `${v(A.season.goalsAgainst.away)} away`],
    ["Clean sheets", `${v(H.season.cleanSheets.home)} at home`, `${v(A.season.cleanSheets.away)} away`],
    ["Failed to score", `${v(H.season.failedToScore.home)} at home`, `${v(A.season.failedToScore.away)} away`],
    ["Attack strength (1 = league avg)", res.strengths.homeAttack, res.strengths.awayAttack],
    ["Defence (lower = better)", res.strengths.homeDefence, res.strengths.awayDefence],
    ["Last 5: shots", v(H.last5.avg.shots), v(A.last5.avg.shots)],
    ["Last 5: on target", v(H.last5.avg.onTarget), v(A.last5.avg.onTarget)],
    ["Last 5: long shots (outside box)", v(H.last5.avg.longShots), v(A.last5.avg.longShots)],
    ["Last 5: shots in the box", v(H.last5.avg.boxShots), v(A.last5.avg.boxShots)],
    ["Last 5: xG", v(H.last5.avg.xg), v(A.last5.avg.xg)],
    ["Last 5: passes", v(H.last5.avg.passes), v(A.last5.avg.passes)],
    ["Last 5: pass accuracy %", v(H.last5.avg.passPct), v(A.last5.avg.passPct)],
    ["Last 5: possession %", v(H.last5.avg.possession), v(A.last5.avg.possession)],
    ["Last 5: corners", v(H.last5.avg.corners), v(A.last5.avg.corners)],
    ["Last 5: keeper saves", v(H.last5.avg.saves), v(A.last5.avg.saves)],
  ] : [];

  const filteredLeagues = leagueCatalogue.filter((league: any) =>
    String(league.name || "").toLowerCase().includes(leagueSearch.toLowerCase()) ||
    String(league.country || "").toLowerCase().includes(leagueSearch.toLowerCase())
  );
  const groupedLeagues: Record<string, any[]> = {};
  for (const league of filteredLeagues) {
    const country = String(league.country || "International");
    if (!groupedLeagues[country]) groupedLeagues[country] = [];
    groupedLeagues[country].push(league);
  }
  const leaguesByCountry = Object.entries(groupedLeagues).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="sb stack">
      <style>{`
        .sb-team, .sb-opt { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 10px; background: var(--surface-2); }
        .sb-opt { width: 100%; text-align: left; cursor: pointer; border: 1px solid var(--line); }
        .sb-opt:hover { background: var(--surface); }
        .sb-bar { display: grid; grid-template-columns: 1fr 2fr auto; gap: 8px; align-items: center; font-size: .9em; }
        .sb-bar i { height: 10px; background: var(--line); border-radius: 5px; position: relative; overflow: hidden; }
        .sb-bar i::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: inherit; background: var(--violet); }
        .sb-bar.hi i::after { background: var(--teal); }
        .sb-bar.mid i::after { background: var(--sun); }
        .sb-bar.lo i::after { background: var(--coral); }
        .sb-xg { display: flex; align-items: center; gap: 12px; font-size: 1.4em; font-weight: 700; }
        .sb-verdict { margin: 0; padding-left: 18px; }
        .sb-top { display: flex; flex-direction: column; gap: 6px; }
        .sb-top-r { display: grid; grid-template-columns: 30px 1fr auto auto; gap: 8px; align-items: center; padding: 8px; border-radius: 8px; background: var(--surface-2); }
        .sb-top-r.hi { border-left: 4px solid var(--teal); }
        .sb-top-r.mid { border-left: 4px solid var(--sun); }
        .sb-top-r.lo { border-left: 4px solid var(--coral); }
        .sb-rank { font-weight: 800; color: var(--muted); }
        .sb-scores { display: flex; flex-wrap: wrap; gap: 10px; }
        .sb-scores span { background: var(--surface-2); padding: 6px 12px; border-radius: 999px; }
        .sb-table { display: flex; flex-direction: column; gap: 2px; font-size: .9em; }
        .sb-tr { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--line); }
        .sb-th { font-weight: 700; }
        .sb-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .sb-g { padding: 4px 0; font-size: .9em; }
        .sb-g.W { color: var(--teal); }
        .sb-g.L { color: var(--coral); }
        .sb-g.D { color: var(--sun); }
        .sb-hist { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); }
        .sb-ok { color: var(--teal); font-weight: 700; }
        .sb-no { color: var(--coral); font-weight: 700; }
      `}</style>
      <header>
        <div className="dz-kick">OWNER · SPORT</div>
        <h1>⚽ Sport board</h1>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}><Link href="/admin/sport/value-bets" className="btn small">📈 Daily Value Bets analysis →</Link></div>
        <p className="muted">Pick the home team and the away team. The board compares recent results, goals and form, then predicts the match. These are probabilities, not certainties.</p>
      </header>
      {m && <section className="card stack" style={{ border: "2px solid var(--teal)" }}>
        <b>🏆 Value bets · ranked first by expected value</b>
        <small className="muted">All three 1X2 outcomes (home, draw and away) are shown, ranked by expected value. Model fair odds = 1 ÷ model probability. Bookmaker decimal odds are not a percentage: odds 29.00 imply a market probability of 3.45%. EV = (model probability × bookmaker odds − 1) × 100. Positive EV is an estimate, not a guarantee.</small>
        {oddsBusy && <small className="muted">Checking bookmaker odds for {home?.name} vs {away?.name}…</small>}
        {oddsError && <div className="notice warn">Odds feed: {oddsError}</div>}
        {!oddsBusy && !ghanaOdds && !oddsError && <small className="muted">Waiting for bookmaker prices…</small>}
        {ghanaOdds && rankedOddsValueRows.length > 0 && rankedOddsValueRows.map((x: any, i: number) =>
          <div key={x.selection} className={"sb-top-r " + (x.ev == null ? "" : x.ev > 0 ? "hi" : "lo")}>
            <span className="sb-rank">#{i + 1}</span><span className="sb-name"><b>{x.selection}</b><small className="muted" style={{ display: "block" }}>{x.bookmaker}</small></span>
            <b>{x.ev == null ? "Price unavailable" : `EV ${x.ev >= 0 ? "+" : ""}${x.ev.toFixed(1)}%`}</b>
            <small className="muted">Model chance {x.probability.toFixed(1)}% · fair odds {(x.fairOdds == null ? "—" : x.fairOdds.toFixed(2))} · {x.odds == null ? "No bookmaker price to compare" : `bookmaker odds ${x.odds.toFixed(2)} · market implied ${x.implied.toFixed(1)}% · edge ${x.edge >= 0 ? "+" : ""}${x.edge.toFixed(1)}pp`}</small>
          </div>
        )}
        {ghanaOdds && rankedOddsValueRows.length === 0 && <div className="notice warn">No usable 1X2 prices were returned for this fixture.</div>}
        {ghanaOdds && positiveOddsValues.length === 0 && rankedOddsValueRows.length > 0 && <div className="notice warn">No positive-value 1X2 bet at the available prices. All three outcomes are shown above; no pick is forced.</div>}
        {ghanaOdds && <small className="muted">Odds feed updated: {ghanaOdds.processedAt ? new Date(ghanaOdds.processedAt).toLocaleString() : "time not supplied"} · {ghanaOdds.historical ? "Historical snapshot" : "Live prices"}</small>}
      </section>}
      {m && <section className="card stack">
        <b>🎯 Alternative market recommendations</b>
        <small className="muted">The model checks handicap, goal totals, team goals, double chance and BTTS—not only 1X2. These are probability-based leans, not confirmed value bets; only call a selection value after checking its live bookmaker price.</small>
        {crossLeagueEstimate && <div className="notice warn"><b>Cross-league matchup:</b> {res.leagues.home.name} vs {res.leagues.away.name}. The current team-strength model uses each club's domestic-league baselines, so treat its probabilities as lower-confidence and require independent market confirmation.</div>}
        {recommendedMarketRows.length ? recommendedMarketRows.map((x: any, i: number) => <div key={x.name} className="sb-top-r">
          <span className="sb-rank">#{i + 1}</span><span className="sb-name"><b>{x.name}</b><small className="muted" style={{ display: "block" }}>Model lean · fair odds {x.fair?.toFixed?.(2) ?? "—"}</small></span>
          <b>{Number(x.p).toFixed(1)}%</b><small className="muted">Estimated probability</small>
        </div>) : <small className="muted">No alternative market currently clears the 55% probability display threshold.</small>}
      </section>}
      {ready === false && <div className="notice warn">API-Football is not configured. Add <code>APIFOOTBALL_KEY</code> to Vercel Production and redeploy.</div>}

      <section className="card stack">
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div className="stack" style={{ gap: 3 }}>
            <b>⚽ Match date scanner</b>
            <small className="muted">Scanning date: <b>{matchDate ? new Date(matchDate + "T12:00:00").toLocaleDateString("en-GH", { timeZone: "Africa/Accra", dateStyle: "full" }) : "Choose a date"}</b></small>
          </div>
          <small className="muted">API-Football statistics · 5DollarFootball odds · Ghana time</small>
        </div>
        <small className="muted">Choose any date below. As soon as you select it, AUTISTIK loads that date's fixtures and scans available bookmaker odds against API-Football team analysis, filling the value list and all four disagreement ranges.</small>
        <label className="stack" style={{ gap: 4 }}>
          <b>Choose match date</b>
          <input type="date" value={matchDate} onChange={(e) => {
            const nextDate = e.target.value;
            setMatchDate(nextDate); setDateMatches([]); setDateMatchesImportedCount(0);
            setDateMatchesError(""); setDailyValueRows([]); setDailyScanDiagnostics([]); setDailyScanError(""); setRes(null); setQuickPicksOpen(false);
            if (nextDate) void searchMatchesByDate(nextDate);
          }} />
        </label>
        <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn primary" disabled={!matchDate || dateMatchesBusy || dailyScanBusy} onClick={() => void searchMatchesByDate(matchDate)}>
            {dateMatchesBusy || dailyScanBusy ? "Scanning selected date…" : "Scan selected date"}
          </button>
          <small className="muted">{dateMatches.length} matches · {dateMatchesImportedCount} saved to database</small>
        </div>
        {dateMatchesBusy && <small className="muted">Fetching fixtures from API-Football…</small>}
        {dateMatchesError && <div className={dateMatches.length ? "notice" : "notice warn"}>{dateMatchesError}</div>}
        {!dateMatchesBusy && !dateMatchesError && dateMatches.length === 0 && <small className="muted">No matches scheduled or recorded for this date.</small>}
        {dailyScanBusy && <small className="muted">{dailyScanProgress}</small>}
        {dailyScanError && <div className="notice warn">{dailyScanError}</div>}
        {dailyScanDiagnostics.length > 0 && <details>
          <summary>Odds-feed diagnostics · {dailyScanDiagnostics.length} fixtures checked</summary>
          <div className="stack" style={{ gap: 5, paddingTop: 8 }}>
            <small className="muted">This shows whether the odds provider returned any books, which plan was detected, and why a fixture did not produce a comparable price.</small>
            {dailyScanDiagnostics.map((item: any, index: number) => <div key={index} className="stack" style={{ gap: 2, borderBottom: "1px solid var(--line)", padding: "5px 0" }}>
              <b>{item.fixture}</b>
              <small className="muted">Plan: {item.providerPlan || "unknown"} · matched events: {item.matchedEvents ?? 0} · Ghana books matched: {(item.bookmakers || []).join(", ") || "none"}</small>
              {(item.returnedBookmakers || []).length > 0 && <small className="muted">Books returned by provider: {item.returnedBookmakers.join(", ")}</small>}
              {item.oddsRequestError && <small className="sb-no">Odds request: {item.oddsRequestError}</small>}
              {item.error && <small className="muted">{item.error}</small>}
            </div>)}
          </div>
        </details>}
        {(() => {
          // Rank all model-supported priced selections. No hard probability or
          // edge cutoffs: prefer likely outcomes, then positive value and price edge.
          const eligible = dailyValueRows.filter((row: any) =>
            row.modelSupported &&
            Number.isFinite(Number(row.probability)) &&
            Number.isFinite(Number(row.ev)) &&
            Number.isFinite(Number(row.odds)) && Number(row.odds) > 1 &&
            Number.isFinite(Number(row.fairOdds)) && Number(row.fairOdds) > 1
          );
          // Overpriced selections lead: rank by expected-value edge (bookmaker odds
          // versus AUTISTIK fair odds), then no-vig odds edge, then model probability.
          const ranked = [...eligible].sort((a: any, b: any) => {
            const evDiff = Number(b.ev) - Number(a.ev);
            if (Math.abs(evDiff) > 0.0001) return evDiff;
            const edgeDiff = Number(b.edge || 0) - Number(a.edge || 0);
            if (Math.abs(edgeDiff) > 0.0001) return edgeDiff;
            return Number(b.probability) - Number(a.probability);
          });
          const usedTeams = new Set<string>();
          const topPicks: any[] = [];
          for (const row of ranked) {
            const homeKey = String(row.home || "").trim().toLowerCase();
            const awayKey = String(row.away || "").trim().toLowerCase();
            if (!homeKey || !awayKey || usedTeams.has(homeKey) || usedTeams.has(awayKey)) continue;
            topPicks.push(row);
            usedTeams.add(homeKey); usedTeams.add(awayKey);
            if (topPicks.length >= 25) break;
          }
          // SPORT counter-market board: keep only the strongest disagreement per fixture,
          // then place that single counter-selection into its selected percentage band.
          const counterByFixture = new Map<string, any>();
          for (const row of eligible) {
            const analysis = row.counterMarketAnalysis;
            const gap = Number(analysis?.gapPoints);
            if (!analysis?.counterSelection || !Number.isFinite(gap) || gap <= 0) continue;
            const fixtureKey = [row.home, row.away, String(row.date || "").slice(0, 16)].join("|");
            const candidate = { ...row, gapPoints: gap, counterSelection: String(analysis.counterSelection),
              counterProbability: Number(analysis.counterProbability), counterFairOdds: Number(analysis.counterFairOdds) };
            const previous = counterByFixture.get(fixtureKey);
            if (!previous || candidate.gapPoints > previous.gapPoints) counterByFixture.set(fixtureKey, candidate);
          }
          const strongestCounterRows = [...counterByFixture.values()].sort((a: any, b: any) => b.gapPoints - a.gapPoints);
          const disagreementBands: Record<string, (row: any) => boolean> = {
            under20: (row: any) => row.gapPoints < 20,
            "20to30": (row: any) => row.gapPoints >= 20 && row.gapPoints < 30,
            "30to40": (row: any) => row.gapPoints >= 30 && row.gapPoints < 40,
            "40plus": (row: any) => row.gapPoints >= 40,
          };
          const visibleCounterRows = selectedSportDisagreementBand === "all"
            ? strongestCounterRows
            : strongestCounterRows.filter(disagreementBands[selectedSportDisagreementBand] || (() => true));
          const renderRows = (rows: any[]) => rows.map((row: any, index: number) => {
            const positive = Number(row.ev) > 0;
            return (
              <div key={(row.key || [row.home, row.away, row.market, row.selection, row.bookmaker].join("|")) + ":" + index}
                className="sb-top-r" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 5,
                  borderLeft: positive ? "4px solid var(--teal)" : "4px solid var(--coral)" }}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                  <b>#{index + 1} · {row.home} vs {row.away}</b>
                  <b className={positive ? "sb-ok" : "sb-no"}>{positive ? "POSITIVE VALUE" : "LOWER VALUE / PRICE WARNING"}</b>
                </div>
                <span>{row.selection} · {row.market}</span>
                <small className="muted">{row.competition || "Football"} · {new Date(row.date).toLocaleString("en-GH", { timeZone: "Africa/Accra", dateStyle: "medium", timeStyle: "short" })} Ghana time</small>
                <small>Bookmaker odds: <b>{Number(row.odds).toFixed(2)}</b> · AUTISTIK fair odds: <b>{Number(row.fairOdds).toFixed(2)}</b> · Model chance: <b>{Number(row.probability).toFixed(1)}%</b></small>
                <small className={positive ? "sb-ok" : "sb-no"}>Expected value: {Number(row.ev) > 0 ? "+" : ""}{Number(row.ev).toFixed(1)}% · Odds edge: {Number(row.edge || 0).toFixed(1)} points · {row.bookmaker}</small>
              </div>
            );
          });
          return (
            <div className="stack" style={{ gap: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <section className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <b>⚖️ Highest disagreement · one counter-pick per match</b>
                  <small className="muted">{visibleCounterRows.length} matches</small>
                </div>
                <label className="stack" style={{ gap: 4, maxWidth: 340 }}>
                  <b>Filter disagreement range</b>
                  <select value={selectedSportDisagreementBand} onChange={(e) => setSelectedSportDisagreementBand(e.target.value)}>
                    <option value="all">All disagreement ranges</option>
                    <option value="under20">Below 20% · watch small</option>
                    <option value="20to30">20%–29.9%</option>
                    <option value="30to40">30%–39.9%</option>
                    <option value="40plus">40% and above</option>
                  </select>
                </label>
                <small className="muted">For each fixture, SPORT shows only the counter-selection with the largest model-versus-bookmaker probability gap. The range is measured in percentage points, not a guaranteed chance of winning.</small>
                {visibleCounterRows.length ? visibleCounterRows.map((row: any, index: number) => (
                  <div key={"sport-counter-" + (row.key || index)} className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", width: "100%", minWidth: 0, boxSizing: "border-box", gap: 7, overflowWrap: "anywhere" }}>
                    <div className="stack" style={{ gap: 2, padding: "2px 2px 5px", minWidth: 0 }}>
                      <b style={{ fontSize: 15, overflowWrap: "anywhere" }}>{row.home} vs {row.away}</b>
                      <small className="muted">{row.date ? new Date(row.date).toLocaleString("en-GH", { timeZone: "Africa/Accra", dateStyle: "medium", timeStyle: "short" }) + " Ghana time" : "Kickoff time unavailable"}</small>
                    </div>
                    <div className="notice stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", minWidth: 0, gap: 4, padding: "9px 11px", fontSize: 13, overflowWrap: "anywhere", borderLeft: "3px solid var(--warning, #d69b28)" }}>
                      <b style={{ overflowWrap: "anywhere" }}>Possible counter-outcome: {row.counterSelection}</b>
                      <span>Counter-outcome rank: <b>1</b> · disagreement: <b>{Number(row.gapPoints).toFixed(1)} percentage points</b></span>
                      <span>Autistik estimated chance of {row.counterSelection}: <b>{Number.isFinite(row.counterProbability) ? row.counterProbability.toFixed(1) + "%" : "—"}</b> · fair odds: <b>{Number.isFinite(row.counterFairOdds) ? row.counterFairOdds.toFixed(2) : "—"}</b></span>
                      <small className="muted" style={{ overflowWrap: "anywhere" }}>Signal from {row.selection} · {row.market || "Market"} · {row.bookmaker || "Bookmaker"} (odds {Number.isFinite(Number(row.odds)) ? Number(row.odds).toFixed(2) : "—"})</small>
                    </div>
                  </div>
                )) : dailyScanBusy ? <small className="muted">Scanning bookmaker odds and team statistics. Counter-picks will appear here as each match finishes analysis ({dailyScanProgress || "scan in progress"}).</small> : <small className="muted">No priced, model-supported counter-selections matched this disagreement range for the selected date. Check Odds-feed diagnostics to see which fixtures returned bookmaker prices.</small>}
              </section>

              <section className="stack" style={{ gap: 7 }}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <b>🤖 AUTISTIK AI shortlist · Top 25</b><small className="muted">{topPicks.length} selections</small>
                </div>
                <small className="muted">Ranked by model win probability, expected value and odds edge. One selection per team. Fewer than 25 appear when fewer distinct teams have usable, model-supported odds.</small>
                {topPicks.length ? renderRows(topPicks) : <small className="muted">No model-supported bookmaker prices are available for this date yet.</small>}
              </section>
    </section>
            </div>
          );
        })()}
        {busy && <small className="muted">Analysing selected match…</small>}
        {err && <div className="notice warn">{err}</div>}
      </section>

      {m && showFullAnalysis && (
        <>
          <section className="card stack">
            <b>{home?.name} vs {away?.name}</b>
            <small className="muted">Selected match date: {res.matchDate || "Today"} {res.historical ? "· Historical pre-match estimate" : "· Current estimate"}</small>
            {res.actual && <div className="notice"><b>Verified final score:</b> {res.actual.homeGoals}–{res.actual.awayGoals} · {res.actual.competition} · {new Date(res.actual.date).toLocaleString()}<small className="muted" style={{ display: "block" }}>Historical model analysis below uses match data from before kick-off; it does not use this final score to generate the prediction.</small></div>}
            {res.historical && !res.actual && <div className="notice warn">No completed fixture for these teams was found on this date. The historical model estimate is shown without an actual result.</div>}
            {res.historical && <small className="muted">Historical estimates use the available pre-date match results. This data source does not provide archived bookmaker odds or full match event statistics; bookmaker prices must be entered manually if you have them.</small>}
            {res.actual && <div className="stack"><b>Actual goals</b><div className="sb-table"><div className="sb-tr"><span>Home goals</span><b>{res.actual.homeGoals}</b><span>{home?.name}</span></div><div className="sb-tr"><span>Away goals</span><b>{res.actual.awayGoals}</b><span>{away?.name}</span></div><div className="sb-tr"><span>Actual outcome</span><b>{res.actual.homeGoals > res.actual.awayGoals ? "Home" : res.actual.homeGoals < res.actual.awayGoals ? "Away" : "Draw"}</b><span>Final score</span></div></div></div>}
            <details open={quickPicksOpen} onToggle={(e) => setQuickPicksOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary>Quick picks · {getValidQuickPicks(m).length} selections</summary>
              <small className="muted">Automatically selected from this match's analysis: high, green, yellow, plus only the first red pick when available.</small>
              <div className="sb-top">
                {getValidQuickPicks(m).map((o: any, i: number) => (
                  <div key={o.quickLabel + ":" + o.name} className={`sb-top-r ${pctCls(o.p)}`}>
                    <span className="sb-rank">{i + 1}</span>
                    <span className="sb-name">{o.quickLabel || "Selection"} · {o.name}</span>
                    <b>{o.p}%</b>
                    <small className="muted">fair {o.fair}</small>
                  </div>
                ))}
                {getValidQuickPicks(m).length < 5 && <small className="muted">The model did not produce all four selections for this match. Missing probability bands are left empty rather than filled with a different pick.</small>}
              </div>
            </details>
            <div className="sb-xg"><span>Expected goals</span><b>{m.xg.home}</b><span>–</span><b>{m.xg.away}</b></div>
            <ul className="sb-verdict">{res.verdict.map((x: string) => <li key={x}>{x}</li>)}</ul>
          </section>
          <section className="card stack">
            <b>🎯 Predictions ranked by chance</b>
            <div className="notice">
              <b>Highest chance:</b> {highestChance?.name || "–"} — {highestChance?.p ?? "–"}% (fair odds {highestChance?.fair ?? "–"}).
              <br /><b>Best value at the odds you enter:</b> {bestValue ? `${bestValue.name} — EV ${(bestValue.ev * 100).toFixed(1)}%, bookmaker ${bestValue.odds.toFixed(2)} vs fair ${bestValue.fair}` : "No positive expected-value selection entered yet."}
            </div>
            <small className="muted">Generated purely from this board's own model (Poisson expected goals from home/away goal strengths and recent form). Not based on any bookmaker odds.</small>
            <div className="notice">
              <b>Value bet guide:</b> Fair odds = 1 ÷ our probability. Example: if our model gives a team 80% chance (fair odds ~1.25) but a bookmaker offers 1.50, that is good value (bookie underestimates the chance). If the bookie offers lower than fair odds, the option is poor value / more likely to lose relative to the price. Always compare the fair odds shown here to whatever bookmaker you use.
            </div>

            <section className="stack">
              <b>Value checker · compare prices independently</b>
              <small className="muted">Enter the decimal price you can actually get for any selection. The model probability above is calculated without bookmaker odds. Positive expected value is a mathematical edge estimate, not a guarantee; only consider it after enough historical model validation.</small>
              <button type="button" className="btn small ghost" onClick={() => setShowValue(!showValue)}>{showValue ? "Hide value checker" : "Show value checker"}</button>
              {showValue && <><div className="sb-top">
                {m.markets.map((o: any) => {
                  const raw = marketOdds[o.name] || "";
                  const price = Number(raw);
                  const valid = raw !== "" && Number.isFinite(price) && price > 1;
                  const implied = valid ? 100 / price : null;
                  const edge = valid ? o.p - implied! : null;
                  const ev = valid ? (o.p / 100) * price - 1 : null;
                  return <div key={o.name} className="sb-top-r" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <span className="sb-name">{o.name}</span>
                    <b>{o.p}%</b>
                    <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <small className="muted">Odds</small>
                      <input aria-label={o.name + " decimal odds"} inputMode="decimal" type="number" min="1.01" step="0.01" placeholder="e.g. 1.50" value={raw} onChange={(e) => setMarketOdds((s) => ({ ...s, [o.name]: e.target.value }))} style={{ width: 92 }} />
                    </label>
                    <small className="muted">{valid ? `Implied ${implied!.toFixed(1)}% · edge ${edge!.toFixed(1)}pp · EV ${(ev! * 100).toFixed(1)}%` : `Fair ${o.fair ?? "–"}`}</small>
                    {valid && <small className={ev! >= 0.05 ? "sb-ok" : ev! > 0 ? "sb-g D" : "sb-no"}>{ev! >= 0.05 ? "Potential value" : ev! > 0 ? "Small edge" : "No value at this price"}</small>}
                  </div>;
                })}
              </div><button type="button" className="btn primary" disabled={!res?.predictionId || !pricedMarkets.some((o: any) => o.odds != null)} onClick={saveOdds}>Save bookmaker comparison to History</button></>}
            </section>
            <section className="stack">
              <b>Full analysis · all markets</b>
              <small className="muted">All model selections are shown below the three quick picks, in probability order, for detailed review.</small>
              <div className="sb-top">
                {m.markets.map((o: any, i: number) => (
                  <div key={o.name} className={`sb-top-r ${pctCls(o.p)}`}><span className="sb-rank">{i + 1}</span><span className="sb-name">{o.name}</span><b>{o.p}%</b><small className="muted">fair {o.fair ?? "–"}</small></div>
                ))}
              </div>
            </section>
          </section>
          <section className="card stack">
            <b>Result</b>
            <Bar label={`${home?.name} win`} p={m.home} /><Bar label="Draw" p={m.draw} /><Bar label={`${away?.name} win`} p={m.away} />
            <b>Double chance</b>
            <Bar label="Home or draw (1X)" p={m.homeOrDraw} /><Bar label="Away or draw (X2)" p={m.awayOrDraw} /><Bar label="No draw (12)" p={m.noDraw} />
            <b>Goals</b>
            <Bar label="Both teams score" p={m.btts} />
            {Object.entries(m.over).map(([k, p]) => <Bar key={k} label={`Over ${k}`} p={p as number} />)}
            <Bar label={`${home?.name} scores`} p={m.homeScores} /><Bar label={`${away?.name} scores`} p={m.awayScores} />
            <b>Likeliest scores</b>
            <div className="sb-scores">{m.scores.map((s: any) => <span key={s.score}><b>{s.score}</b> {s.p}%</span>)}</div>
          </section>
          <section className="card stack">
            <b>Compare</b>
            <div className="sb-table" role="table">
              <div className="sb-tr sb-th" role="row"><span role="columnheader">Stat</span><span role="columnheader">{home?.name}</span><span role="columnheader">{away?.name}</span></div>
              {rows.map(([k, a, b]) => <div key={k} className="sb-tr" role="row"><span role="cell">{k}</span><span role="cell">{String(a)}</span><span role="cell">{String(b)}</span></div>)}
            </div>
            <small className="muted">Recent goal averages are measured against each team's competition averages. This free data source does not provide the detailed shot and xG fields shown by the previous provider.</small>
          </section>
          <section className="card stack">
            <b>Last 5 matches</b>
            <div className="sb-two">
              {[{ t: home, x: H }, { t: away, x: A }].map(({ t, x }) => (
                <div key={t?.id} className="stack" style={{ gap: 4 }}>
                  <small className="muted">{t?.name}</small>
                  {x.last5.games.map((g: any) => <div key={g.date} className={`sb-g ${g.res}`}><b>{g.res}</b> {g.gf}-{g.ga} {g.home ? "vs" : "at"} {g.vs} <small className="muted">{g.comp}</small></div>)}
                </div>
              ))}
            </div>
            {res.h2h.length > 0 && <>
              <b>Head to head</b>
              {res.h2h.map((g: any) => <div key={g.date} className="sb-g"><b>{g.score}</b> {g.home} vs {g.away} <small className="muted">{new Date(g.date).toLocaleDateString()} · {g.comp}</small></div>)}
            </>}
          </section>
        </>
      )}

      {res?.model && !showFullAnalysis && (
        <div role="dialog" aria-modal="true" aria-label="Quick match predictions" style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(12,10,25,.58)", display: "flex", alignItems: "center", justifyContent: "center", padding: 14 }}>
          <section className="card stack" style={{ width: "100%", maxWidth: 430, maxHeight: "78vh", overflowY: "auto", boxShadow: "0 18px 60px rgba(0,0,0,.28)", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0 }}><b>{home?.name} vs {away?.name}</b><small className="muted" style={{ display: "block" }}>{res.matchDate || matchDate} · Quick predictions</small>{res.actual && <small className="sb-ok" style={{ display: "block" }}>Final score: {res.actual.homeGoals}–{res.actual.awayGoals} · {res.actual.competition}</small>}</div>
              <button type="button" className="btn small ghost" onClick={startNewManualSearch}>Search other teams</button>
            </div>
            <div className="sb-top">
              {getValidQuickPicks(res.model).map((o: any, i: number) => (
                <div key={o.quickLabel + ":" + o.name} className={"sb-top-r " + pctCls(o.p)}>
                  <span className="sb-rank">{i + 1}</span>
                  <span className="sb-name">{(o.quickLabel || "Selection") + " · " + o.name}</span>
                  <b>{o.p}%</b><small className="muted">fair {o.fair}</small>
                </div>
              ))}
              {getValidQuickPicks(res.model).length < 5 && <small className="muted">Only the picks supported by this match's analysis are shown.</small>}
            </div>
            <button type="button" className="btn primary" onClick={() => setShowFullAnalysis(true)}>View full analysis ↓</button>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <button type="button" className="btn small ghost" disabled={activeFixtureIndex <= 0 || busy} onClick={() => chooseFixture(selectedLeagueFixtures[activeFixtureIndex - 1])}>← Previous</button>
              <small className="muted">{activeFixtureIndex >= 0 ? activeFixtureIndex + 1 : "–"} / {selectedLeagueFixtures.length}</small>
              <button type="button" className="btn small ghost" disabled={activeFixtureIndex < 0 || activeFixtureIndex >= selectedLeagueFixtures.length - 1 || busy} onClick={() => chooseFixture(selectedLeagueFixtures[activeFixtureIndex + 1])}>Next →</button>
            </div>
          </section>
        </div>
      )}

      {showFullAnalysis && m && (
        <div style={{ position: "sticky", top: 8, zIndex: 20, display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn small ghost" onClick={() => setShowFullAnalysis(false)}>← Back to quick dashboard</button>
            <button type="button" className="btn small ghost" onClick={startNewManualSearch}>Search other teams</button>
          </div>
        </div>
      )}
      {hist.length > 0 && (
        <section className="card stack sb-history-panel" style={{ minWidth: 0, width: "100%", overflowAnchor: "none" }}>
          <b>Past predictions</b>
          <small className="muted">Mark how each one ended to see how often the board is right.</small>
          {hist.map((h) => (
            <div key={h.id} className="sb-hist" style={{ minWidth: 0, width: "100%", overflowWrap: "anywhere" }}>
              <span><b>{h.home}</b> vs <b>{h.away}</b> <small className="muted">{new Date(h.created_at).toLocaleDateString()}</small></span>
              <small>Pick: <b>{h.pick}</b> · {h.p_home}/{h.p_draw}/{h.p_away}% · BTTS {h.p_btts}% · O2.5 {h.p_o25}%</small>
              {h.note && (() => { try { const saved = JSON.parse(h.note); return <div className="stack" style={{ width: "100%", gap: 4 }}>
                <small className="muted">Highest chance: {saved.highestChance?.name || "–"} ({saved.highestChance?.probability ?? "–"}%) · fair odds {saved.highestChance?.fairOdds ?? "–"}</small>
                {(saved.bookmakerComparison || []).map((x: any) => <small key={x.name} className={x.value ? "sb-ok" : "muted"}>{x.name}: model {x.probability}% · bookie {Number(x.bookmakerOdds).toFixed(2)} · fair {x.fairOdds} · implied {x.impliedProbability}% · edge {x.edgePercentagePoints}pp · EV {x.expectedValuePercent}% {x.value ? "· VALUE" : "· no value"}</small>)}
              </div>; } catch { return null; } })()}
              <select value={h.result || ""} onChange={(e) => api("result", { id: h.id, result: e.target.value }).then(loadHist)} aria-label="Real result">
                <option value="">Result?</option><option>Home</option><option>Draw</option><option>Away</option>
              </select>
              {h.result && <small className={h.result === h.pick ? "sb-ok" : "sb-no"}>{h.result === h.pick ? "✓ right" : "✗ wrong"}</small>}
            </div>
          ))}
          {(() => { const done = hist.filter((h) => h.result); const ok = done.filter((h) => h.result === h.pick).length; return done.length ? <small className="muted">Right {ok} of {done.length} ({Math.round((ok / done.length) * 100)}%).</small> : null; })()}
        </section>
      )}
    </div>
  );
}
