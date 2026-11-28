"use client";

import { useEffect, useRef, useState } from "react";

type Fixture = {
  id: number;
  date: string;
  status: string;
  competition?: string;
  league?: { name?: string; country?: string };
  home: { id: number; name: string; logo?: string };
  away: { id: number; name: string; logo?: string };
};

type RatedMatch = {
  fixture: Fixture;
  best: any | null;
  markets: any[];
  rating: number | null;
  diagnostic: any | null;
};

const normStatus = (value: any) => String(value || "").trim().toLowerCase();
const isUpcoming = (fixture: Fixture, now: number) => {
  const status = normStatus(fixture.status);
  const scheduled = !status || ["not started", "time to be defined", "scheduled", "timed", "ns", "tbd"].includes(status);
  return scheduled && Number.isFinite(Date.parse(fixture.date)) && Date.parse(fixture.date) > now;
};

function ratingFor(row: any) {
  const probability = Math.max(0, Math.min(100, Number(row.probability) || 0));
  const ev = Math.max(0, Math.min(100, Number(row.ev) || 0));
  const edge = Math.max(0, Math.min(40, Number(row.edge) || 0));
  return Math.round(probability * 0.60 + ev * 0.25 + (edge / 40) * 15);
}

export default function DailyValueBets() {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [ratedMatches, setRatedMatches] = useState<RatedMatch[]>([]);
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [scanDate, setScanDate] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [todayDate, setTodayDate] = useState("");
  const [scanned, setScanned] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [activeSession, setActiveSession] = useState<"scanner"|"top25"|"expectedValue">("scanner");
  const started = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  async function post(action: string, body: any = {}) {
    const response = await fetch("/api/admin/sport", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...body })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || "Request failed (HTTP " + response.status + ").");
    return data;
  }

  async function runDailyScan(dayFixtures: Fixture[]) {
    setBusy(true);
    setError("");
    setScanned(0);
    let allRows: any[] = [];
    let allDiagnostics: any[] = [];
    try {
      // Keep requests small for the paid fixture/statistics API, but continue
      // through the complete selected-day fixture list without a Top-N cap.
      for (let i = 0; i < dayFixtures.length; i += 2) {
        const batch = dayFixtures.slice(i, i + 2);
        setProgress("Analysing all selected-day matches · " + Math.min(i + batch.length, dayFixtures.length) + " / " + dayFixtures.length);
        const data = await post("valueScan", { fixtures: batch });
        allRows = allRows.concat(Array.isArray(data.rows) ? data.rows : []);
        allDiagnostics = allDiagnostics.concat(Array.isArray(data.diagnostics) ? data.diagnostics : []);
        setScanned(Math.min(i + batch.length, dayFixtures.length));
        if (i + 2 < dayFixtures.length) await new Promise(resolve => setTimeout(resolve, 350));
      }

      const makeKey = (home: string, away: string, date: string) =>
        [home.trim().toLowerCase(), away.trim().toLowerCase(), String(date || "").slice(0, 16)].join("|");
      const rowsByFixture = new Map<string, any[]>();
      for (const row of allRows) {
        const key = makeKey(row.home, row.away, row.date);
        const list = rowsByFixture.get(key) || [];
        list.push(row);
        rowsByFixture.set(key, list);
      }
      const diagnosticsByFixture = new Map<string, any>();
      for (const diagnostic of allDiagnostics) {
        diagnosticsByFixture.set(String(diagnostic.fixture || "").trim().toLowerCase(), diagnostic);
      }

      const results: RatedMatch[] = dayFixtures.map(fixture => {
        const key = makeKey(fixture.home.name, fixture.away.name, fixture.date);
        const candidates = (rowsByFixture.get(key) || []).filter((row: any) =>
          row.modelSupported &&
          Number.isFinite(Number(row.probability)) &&
          Number(row.probability) > 0 &&
          Number.isFinite(Number(row.odds)) &&
          Number(row.odds) > 1
        ).map((row: any) => ({ ...row, rating: ratingFor(row) }));
        candidates.sort((a: any, b: any) =>
          b.rating - a.rating || Number(b.ev || 0) - Number(a.ev || 0)
        );
        const diagnostic = diagnosticsByFixture.get((fixture.home.name + " vs " + fixture.away.name).trim().toLowerCase()) || null;
        const best = candidates[0] || null;
        return { fixture, best, markets: candidates, rating: best ? best.rating : null, diagnostic };
      });

      // Every fixture returned for the selected day is retained, including
      // matches without a usable price/model rating; no team or match cap.
      results.sort((a, b) => {
        if (a.rating == null && b.rating != null) return 1;
        if (b.rating == null && a.rating != null) return -1;
        return (b.rating ?? -1) - (a.rating ?? -1) || Date.parse(a.fixture.date) - Date.parse(b.fixture.date);
      });
      setRatedMatches(results);
      setDiagnostics(allDiagnostics);
      if (!results.some(item => item.best)) {
        setError("All selected-day fixtures were checked, but no match returned both a supported model probability and usable bookmaker odds. See scan diagnostics for each fixture.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function loadAndScan() {
    setLoading(true);
    setError("");
    setScanned(0);
    try {
      const data = await post("dailyFixtures", { date: selectedDate || undefined });
      const requestedDate = String(data.date || selectedDate || "");
      const matches = (Array.isArray(data.matches) ? data.matches : [])
        .filter((fixture: Fixture) => {
          if (!fixture?.id || !fixture?.home?.id || !fixture?.away?.id || !fixture?.home?.name || !fixture?.away?.name || !fixture?.date) return false;
          if (requestedDate && String(fixture.date).slice(0, 10) !== requestedDate) return false;
          return isUpcoming(fixture, Date.now());
        })
        .sort((a: Fixture, b: Fixture) => Date.parse(a.date) - Date.parse(b.date));
      setSelectedDate(requestedDate);
      setTodayDate(String(data.today || ""));
      setScanDate(requestedDate);
      setFixtures(matches);
      setRatedMatches([]);
      setDiagnostics([]);
      if (!matches.length) {
        setError("API-Football returned no upcoming fixtures for the selected Ghana-time date.");
      } else {
        setLoading(false);
        await runDailyScan(matches);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const visibleMatches = ratedMatches.filter(item => isUpcoming(item.fixture, clockNow));
  const ratedCount = visibleMatches.filter(item => item.best).length;
  const valueCount = visibleMatches.filter(item => item.best && Number(item.best.ev) > 0).length;

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void loadAndScan();
    }
  }, []);

  const allRows = visibleMatches.flatMap(item => item.markets);
  const positiveRows = allRows.filter(row => Number(row.ev) > 0).sort((a,b) => Number(b.ev)-Number(a.ev));
  const top25: any[] = [];
  const usedTeams = new Set<string>();
  for (const row of [...allRows].sort((a,b) => ratingFor(b)-ratingFor(a) || Number(b.ev)-Number(a.ev))) {
    const home=String(row.home||"").toLowerCase(), away=String(row.away||"").toLowerCase();
    if (!home || !away || usedTeams.has(home) || usedTeams.has(away)) continue;
    top25.push(row); usedTeams.add(home); usedTeams.add(away);
    if (top25.length===25) break;
  }
  const shownRows = activeSession==="top25" ? top25 : activeSession==="expectedValue" ? positiveRows : allRows;
  const renderRow = (row:any,index:number) => {
    const ev=Number(row.ev), chance=Number(row.probability), odds=Number(row.odds), fair=Number(row.fairOdds);
    const positive=ev>0;
    return <div key={String(row.key||row.home+row.away+row.selection+index)} className="sb-top-r hi" style={{display:"grid",gridTemplateColumns:"minmax(0,1fr)",gap:8,padding:12,minWidth:0,overflowWrap:"anywhere",borderLeft:positive?"4px solid var(--teal)":"4px solid #d69b28"}}>
      <b>{index+1}. {row.home} vs {row.away}</b>
      <b>{row.selection} · {row.market}</b>
      <small className="muted">{row.competition||"Football"} · {new Date(row.date).toLocaleString("en-GB",{timeZone:"Africa/Accra",dateStyle:"medium",timeStyle:"short"})} Ghana time</small>
      <div className="row" style={{gap:12,flexWrap:"wrap",fontSize:13}}>
        <span>Bookmaker odds <b>{odds.toFixed(2)}</b> · {row.bookmaker}</span>
        <span>Autistik fair odds <b>{fair.toFixed(2)}</b></span>
        <span>Model chance <b>{chance.toFixed(1)}%</b></span>
        <span>Break-even chance <b>{(100/odds).toFixed(1)}%</b></span>
      </div>
      <b style={{color:positive?"var(--success, #16834a)":"var(--danger, #b42318)"}}>{positive?"POSITIVE EXPECTED VALUE · +"+ev.toFixed(1)+"% EV":"NEGATIVE EXPECTED VALUE · AVOID ("+ev.toFixed(1)+"% EV)"}</b>
      <div className="notice stack" style={{fontSize:13,gap:4}}>
        <b>Autistik outcome estimate</b>
        <span>Estimated chance: <b>{chance.toFixed(1)}%</b> · chance it does not land: <b>{(100-chance).toFixed(1)}%</b></span>
        <span>Odds edge: <b>{Number(row.edge||0).toFixed(1)} percentage points</b></span>
        <span>{odds>fair?"Bookmaker price is above Autistik fair odds.":odds<fair?"Bookmaker price is below Autistik fair odds.":"Bookmaker price matches Autistik fair odds."}</span>
      </div>
    </div>;
  };
  return (
    <section className="card stack" style={{border:"2px solid var(--teal)",padding:14}}>
      <div className="stack" style={{gap:4}}>
        <b>⚽ SPORT · Football value scanner</b>
        <small className="muted">API-Football fixtures and statistics · 5DollarFootball bookmaker odds · Ghana time</small>
        <small className="muted">Full selected-day scan, ranked by model probability, expected value and odds edge.</small>
      </div>
      <div className="card stack" style={{padding:12}}>
        <b>Choose match date</b>
        <input aria-label="Scan date" type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} disabled={loading||busy}/>
        <button className="btn primary" type="button" onClick={()=>void loadAndScan()} disabled={loading||busy}>{loading||busy?"Scanning…":"Refresh matches"}</button>
        <b>{scanDate?new Date(scanDate+"T12:00:00").toLocaleDateString("en-GB",{timeZone:"Africa/Accra",dateStyle:"full"}):"Selected date"} · Ghana time</b>
        <small className="muted">{fixtures.length} fixtures · {scanned} scanned · {ratedCount} rated · {valueCount} positive-EV matches</small>
        {(loading||busy)&&<small className="muted">{progress||"Loading fixtures and comparing bookmaker odds…"}</small>}
        {error&&<div className="notice warn">{error}</div>}
      </div>
      <div className="row" style={{gap:8,flexWrap:"wrap"}}>
        <button className={activeSession==="scanner"?"btn primary":"btn"} type="button" onClick={()=>setActiveSession("scanner")}>Open scanner</button>
        <button className={activeSession==="top25"?"btn primary":"btn"} type="button" onClick={()=>setActiveSession("top25")}>AI Top 25 · {top25.length}</button>
        <button className={activeSession==="expectedValue"?"btn primary":"btn"} type="button" onClick={()=>setActiveSession("expectedValue")}>Expected Value · {positiveRows.length}</button>
      </div>
      <div className="stack" style={{gap:8}}>
        <b>{activeSession==="scanner"?"Best selections · highest rated first":activeSession==="top25"?"SPORT · AI Top 25":"SPORT · Positive Expected Value"} ({shownRows.length})</b>
        {shownRows.length?shownRows.map(renderRow):<small className="muted">No eligible selections in the current scan. Run the SPORT scanner first and check scan diagnostics.</small>}
        {activeSession!=="scanner"&&<button className="btn small" type="button" onClick={()=>setActiveSession("scanner")}>Back to scanner</button>}
      </div>
      {diagnostics.length>0&&<details><summary>Scan coverage and diagnostics · {diagnostics.length} fixtures checked</summary>
        <div className="stack" style={{gap:7}}>{diagnostics.map((d:any,i:number)=><small key={i} className="muted">{d.fixture}: {d.analysisError||d.oddsError||((d.markets||[]).length?"Analysed · "+d.markets.join(", "):"No supported bookmaker prices returned")}</small>)}</div>
      </details>}
      <small className="muted">Positive expected value is an estimate, not a guarantee. Verify current bookmaker prices before staking.</small>
    </section>
  );
}
