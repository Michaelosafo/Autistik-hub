"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Super board (owner only): pick the home and the away team, and it compares both (home record for the home side,
 * away record for the away side, goals, clean sheets, last-5 shots, long shots, passes, possession, xG, head to head)
 * and predicts the match: 1X2, double chance, both teams to score, overs, likeliest scores. Every analysis is saved,
 * and you can mark the real result to see how the board does over time.
 */
type Team = { id: number; name: string; country?: string; logo?: string };

async function api<T = any>(action: string, body: object = {}): Promise<T> {
  const r = await fetch("/api/admin/super", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) });
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
  const [matchDate, setMatchDate] = useState(new Date().toISOString().slice(0, 10));
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
  const [todayMatches, setTodayMatches] = useState<any[]>([]);
  const [todayBusy, setTodayBusy] = useState(false);
  const [todayError, setTodayError] = useState("");
  const [dateMatches, setDateMatches] = useState<any[]>([]);
  const [dateMatchesBusy, setDateMatchesBusy] = useState(false);
  const [dateMatchesError, setDateMatchesError] = useState("");
  async function loadTodayMatches() {
    setTodayBusy(true); setTodayError("");
    try { const d = await api<{ matches: any[] }>("todayMatches"); setTodayMatches(d.matches || []); }
    catch (e) { setTodayError((e as Error).message); }
    finally { setTodayBusy(false); }
  }
  async function searchMatchesByDate() {
    setDateMatchesBusy(true); setDateMatchesError(""); setDateMatches([]);
    try {
      const d = await api<{ matches: any[] }>("dateMatches", { date: matchDate });
      setDateMatches(d.matches || []);
      if (!(d.matches || []).length) setDateMatchesError("Sportmonks returned no completed fixtures with verified full-time scores for this date.");
    } catch (e) { setDateMatchesError((e as Error).message); }
    finally { setDateMatchesBusy(false); }
  }
  async function loadGhanaOdds() {
    if (!home || !away) return;
    setOddsBusy(true); setOddsError(""); setGhanaOdds(null);
    try { setGhanaOdds(await api("odds", { homeName: home.name, awayName: away.name, matchDate })); }
    catch (e) { setOddsError((e as Error).message); }
    finally { setOddsBusy(false); }
  }
  async function loadTeamFixtures(t: Team) {
    setFixturesBusy(true); setFixturesError(""); setTeamFixtures([]);
    try { const d = await api<{ fixtures: any[] }>("teamFixtures", { teamId: t.id }); setTeamFixtures(d.fixtures || []); }
    catch (e) { setFixturesError((e as Error).message); }
    finally { setFixturesBusy(false); }
  }
  async function chooseFixture(f: any) {
    setActiveFixtureIndex(dateMatches.findIndex((x: any) => String(x.id) === String(f.id)));
    setShowFullAnalysis(false);
    const h: Team = { id: f.home.id, name: f.home.name, logo: f.home.logo };
    const a: Team = { id: f.away.id, name: f.away.name, logo: f.away.logo };
    const date = new Date(f.date).toISOString().slice(0, 10);
    setHome(h); setAway(a); setMatchDate(date); setRes(null); setErr("");
    setBusy(true);
    try { setRes(await api("analyse", { home: h.id, away: a.id, matchDate: date, homeName: h.name, awayName: a.name })); setQuickPicksOpen(true); loadHist(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  const loadHist = () => api<{ rows: any[] }>("history").then((d) => setHist(d.rows)).catch(() => {});
  useEffect(() => { api<{ ready: boolean }>("ready").then((d) => setReady(d.ready)).catch(() => setReady(false)); loadHist(); loadTodayMatches(); }, []);

  async function run() {
    if (!home || !away) return;
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await api("analyse", { home: home.id, away: away.id, matchDate, homeName: home.name, awayName: away.name })); setQuickPicksOpen(true); loadHist(); }
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
    const offers = (event.bookmakers || []).flatMap((book: any) =>
      (book.markets || []).filter((x: any) => x.key === "h2h").flatMap((x: any) =>
        (x.outcomes || []).map((outcome: any) => ({ name: String(outcome.name || ""), price: Number(outcome.price), bookmaker: book.title || book.key || "Bookmaker", isExchange: /exchange/i.test(String(book.title || book.key || "")) }))
      )
    ).filter((x: any) => !x.isExchange && Number.isFinite(x.price) && x.price > 1);
    const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
    const selections = [
      { name: home?.name || "Home", p: m?.home, matches: (s: string) => norm(s) === norm(home?.name || "") || norm(s).includes(norm(home?.name || "___")) },
      { name: "Draw", p: m?.draw, matches: (s: string) => ["draw", "the draw", "tie"].includes(norm(s)) },
      { name: away?.name || "Away", p: m?.away, matches: (s: string) => norm(s) === norm(away?.name || "") || norm(s).includes(norm(away?.name || "___")) },
    ];
    return selections.map((selection: any) => {
      const best = offers.filter((o: any) => selection.matches(o.name)).sort((a: any, b: any) => b.price - a.price)[0];
      if (!best || !Number.isFinite(selection.p)) return null;
      const implied = 100 / best.price;
      const ev = (selection.p / 100) * best.price - 1;
      return { selection: selection.name, probability: selection.p, odds: best.price, bookmaker: best.bookmaker, implied, ev: ev * 100 };
    }).filter(Boolean);
  });
  const bestOddsValue = oddsValueRows.filter((x: any) => x.ev >= 3).sort((a: any, b: any) => b.probability - a.probability)[0];
  const highestOddsEV = oddsValueRows.filter((x: any) => x.ev > 0).sort((a: any, b: any) => b.ev - a.ev)[0];
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
        <h1>⚽ Super board</h1>
        <p className="muted">Pick the home team and the away team. Super uses Sportmonks match data to compare recent results, goals and form, then predicts the match. These are probabilities, not certainties.</p>
      </header>
      {ready === false && <div className="notice warn">Add <code>SPORTMONKS_API_TOKEN</code> in Vercel (free token from football-data.org), then redeploy.</div>}

      <section className="card stack">
        <b>Today's matches · all subscribed leagues</b>
        <small className="muted">Fixtures returned by your Sportmonks subscription. Select any match to load its prediction shortlist.</small>
        <button type="button" className="btn small ghost" onClick={loadTodayMatches} disabled={todayBusy}>{todayBusy ? "Refreshing today's fixtures…" : "Refresh today's matches"}</button>
        {todayError && <div className="notice warn">{todayError}</div>}
        {todayBusy && todayMatches.length === 0 && <small className="muted">Loading today's fixtures…</small>}
        {!todayBusy && !todayError && todayMatches.length === 0 && <small className="muted">No fixtures returned for today. Check the leagues included in your Sportmonks subscription.</small>}
        <div className="stack" style={{ gap: 0, marginTop: 8 }}>
          {todayMatches.map((f: any) => <button key={f.id} type="button" onClick={() => chooseFixture(f)} disabled={busy}
            style={{ display: "grid", gridTemplateColumns: "58px minmax(0,1fr) 36px", alignItems: "center", gap: 10, width: "100%", padding: "12px 8px", textAlign: "left", border: 0, borderBottom: "1px solid var(--line)", background: "transparent", color: "inherit", cursor: "pointer" }}>
            <span style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", whiteSpace: "pre-line" }}>{f.status === "IN_PLAY" || f.status === "PAUSED" ? "LIVE" : f.status === "FINISHED" ? "FT" : new Date(f.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{f.score ? "\n" + f.score.home + "–" + f.score.away : ""}</span>
            <span style={{ display: "grid", gap: 5 }}>
              {[f.home, f.away].map((team: any) => <span key={team.id} style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                {team.logo ? <img src={team.logo} alt="" width="23" height="23" style={{ objectFit: "contain" }} /> : <span style={{ width: 23 }} />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team.name}</span>
              </span>)}
              <small className="muted">{f.competition}</small>
            </span>
            <span style={{ fontSize: 22, color: "var(--muted)", textAlign: "center" }}>›</span>
          </button>)}
        </div>
      </section>
      {!res && (
      <section className="card stack">
        <TeamPick label="🏠 Search a team" team={home} setTeam={(t) => { setHome(t); setAway(null); setRes(null); setTeamFixtures([]); }} onChoose={loadTeamFixtures} />
        {home && <div className="stack" style={{ gap: 8 }}><b>Matches for {home.name}</b><small className="muted">Only the last completed match and the next upcoming fixture are shown. Select either one to load its prediction and actual score (if completed).</small>{fixturesBusy && <small className="muted">Loading fixtures…</small>}{fixturesError && <div className="notice warn">{fixturesError}</div>}{!fixturesBusy && teamFixtures.length === 0 && !fixturesError && <small className="muted">No fixtures found for this team.</small>}{teamFixtures.map((f: any) => <button key={f.id} type="button" className="sb-opt" onClick={() => chooseFixture(f)} disabled={busy}><span style={{ flex: 1 }}><b>{f.home.name} vs {f.away.name}</b><small className="muted" style={{ display: "block" }}>{f.competition} · {new Date(f.date).toLocaleString()} · {f.status === "FINISHED" ? `FT ${f.score?.home ?? "-"}–${f.score?.away ?? "-"}` : f.status.replace("_", " ")}</small></span><b>{f.status === "FINISHED" ? "Last match · View" : "Next match · View"}</b></button>)}</div>}
        <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <b>Past matches by date</b>
          <small className="muted">Search all competitions and fixtures available to your Sportmonks subscription for this date. Every returned completed match is listed with its verified score; select a match to load its historical analysis.</small>
          <label className="stack" style={{ gap: 4 }}><b>Match date</b><input type="date" value={matchDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => { setMatchDate(e.target.value); setDateMatches([]); setDateMatchesError(""); setRes(null); }} /></label>
          <button type="button" className="btn primary" disabled={!matchDate || dateMatchesBusy || !ready} onClick={searchMatchesByDate}>{dateMatchesBusy ? "Searching completed matches…" : "Search all available matches"}</button>
          {dateMatchesError && <div className={dateMatches.length ? "notice" : "notice warn"}>{dateMatchesError}</div>}
          {dateMatches.length > 0 && <div className="stack" style={{ gap: 0 }}>
            <b>{dateMatches.length} completed {dateMatches.length === 1 ? "match" : "matches"} returned by the API</b><small className="muted">All competitions available in your API feed are included. Tap any fixture to open its historical predictions and full analysis.</small>
            {dateMatches.map((f: any) => <button key={f.id} type="button" className="sb-opt" onClick={() => chooseFixture(f)} disabled={busy} style={{ justifyContent: "space-between", textAlign: "left" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{f.home.name} vs {f.away.name}</b>
                <small className="muted" style={{ display: "block" }}>{f.competition} · {new Date(f.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
              </span>
              <span style={{ display: "grid", justifyItems: "end", gap: 3, whiteSpace: "nowrap" }}><b>FT {f.score.home}–{f.score.away}</b><small className="muted">View analysis ›</small></span>
              <span style={{ color: "var(--muted)" }}>›</span>
            </button>)}
          </div>}
        </div>
        <small className="muted">Or choose the opponent manually:</small>
        <TeamPick label="✈️ Away team" team={away} setTeam={(t) => { setAway(t); setRes(null); }} />
        <label className="stack" style={{ gap: 4 }}><b>Match date</b><input type="date" value={matchDate} onChange={(e) => { setMatchDate(e.target.value); setRes(null); }} /><small className="muted">Choose today or a past date. For past dates, the model uses matches before the selected date and looks for the actual fixture result.</small></label>
        <button type="button" className="btn primary" disabled={!home || !away || busy || !ready || !matchDate} onClick={run}>{busy ? "Checking both teams…" : "Analyse match"}</button>
        {err && <div className="notice warn">{err}</div>}
      </section>

            )}

      <section className="card stack">\n        <b>🇬🇭 Ghana bookmaker odds · OddsRelay</b>
        <small className="muted">Bookmaker prices are compared with this board's model probabilities. Value calculations use the best bookmaker back price for each 1X2 outcome, not exchange lay prices.</small>
        <button type="button" className="btn primary" disabled={!home || !away || oddsBusy} onClick={loadGhanaOdds}>{oddsBusy ? "Fetching Ghana bookmaker odds…" : "Fetch Ghana bookmaker odds"}</button>
        {oddsError && <div className="notice warn">{oddsError}</div>}
        {ghanaOdds && <>
          <small className="muted">Region: {ghanaOdds.region} · Feed processed: {ghanaOdds.processedAt ? new Date(ghanaOdds.processedAt).toLocaleString() : "not supplied"} · Events scanned: {ghanaOdds.count}{ghanaOdds.historical ? " · Historical odds snapshot" : " · Live odds"}</small>
          {ghanaOdds.matched.length === 0 ? <div className="notice warn">No matching event with odds was returned for these teams and date. Past prices are only available where OddsRelay has archived that region and date. No prices are estimated or invented.</div> :
            ghanaOdds.matched.map((event: any) => <div key={event.id} className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <b>{event.home_team} vs {event.away_team}</b>
              <small className="muted">{event.sport_title || "Football"} · Kick-off {new Date(event.commence_time).toLocaleString()}</small>
              {(event.bookmakers || []).map((book: any) => <div key={book.key} className="stack" style={{ gap: 3 }}>
                <b>{book.title || book.key}</b>
                {(book.markets || []).filter((market: any) => market.key === "h2h").map((market: any) => <div key={market.key} className="sb-scores">
                  {(market.outcomes || []).map((outcome: any) => <span key={outcome.name}>{outcome.name}: <b>{Number(outcome.price).toFixed(2)}</b></span>)}
                </div>)}
                <small className="muted">Last updated: {book.last_update ? new Date(book.last_update).toLocaleString() : "not supplied"}</small>
              </div>)}
            </div>)
          }
          {m && ghanaOdds.matched.length > 0 && <div className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <b>Model vs bookmaker · value check</b>
            <small className="muted">EV = model probability × decimal odds − 1. A positive result means the offered price is above the model's fair price; it is not a guarantee.</small>
            {oddsValueRows.length === 0 ? <div className="notice warn">No usable bookmaker 1X2 prices were returned for comparison.</div> : <>
              {oddsValueRows.map((x: any) => <div key={x.selection} className="sb-top-r">
                <span className="sb-name">{x.selection}</span><b>{x.probability.toFixed(1)}%</b>
                <small className="muted">Best {x.odds.toFixed(2)} · {x.bookmaker}</small>
                <small className={x.ev >= 3 ? "sb-ok" : x.ev > 0 ? "sb-g D" : "sb-no"}>EV {x.ev >= 0 ? "+" : ""}{x.ev.toFixed(1)}%</small>
              </div>)}
              {bestOddsValue ? <div className="notice"><b>Best value with a stronger chance:</b> {bestOddsValue.selection} · model {bestOddsValue.probability.toFixed(1)}% · odds {bestOddsValue.odds.toFixed(2)} at {bestOddsValue.bookmaker} · implied {bestOddsValue.implied.toFixed(1)}% · EV +{bestOddsValue.ev.toFixed(1)}%.<small className="muted" style={{ display: "block" }}>Highest-probability 1X2 pick with at least +3% model EV.</small></div> : highestOddsEV ? <div className="notice warn"><b>No strong value pick yet.</b> Best positive-EV price: {highestOddsEV.selection} at {highestOddsEV.odds.toFixed(2)} ({highestOddsEV.bookmaker}), model {highestOddsEV.probability.toFixed(1)}%, EV +{highestOddsEV.ev.toFixed(1)}%. It does not meet the +3% threshold.</div> : <div className="notice warn"><b>No value bet found.</b> None of the bookmaker prices beat the model's fair price.</div>}
            </>}
          </div>}
        </>}\n      </section>

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
              <button type="button" className="btn small ghost" disabled={activeFixtureIndex <= 0 || busy} onClick={() => chooseFixture(todayMatches[activeFixtureIndex - 1])}>← Previous</button>
              <small className="muted">{activeFixtureIndex >= 0 ? activeFixtureIndex + 1 : "–"} / {todayMatches.length}</small>
              <button type="button" className="btn small ghost" disabled={activeFixtureIndex < 0 || activeFixtureIndex >= todayMatches.length - 1 || busy} onClick={() => chooseFixture(todayMatches[activeFixtureIndex + 1])}>Next →</button>
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
        <section className="card stack">
          <b>Past predictions</b>
          <small className="muted">Mark how each one ended to see how often the board is right.</small>
          {hist.map((h) => (
            <div key={h.id} className="sb-hist">
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
