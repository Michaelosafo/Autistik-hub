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
        return { fixture, best, rating: best ? best.rating : null, diagnostic };
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

  return (
    <section className="card stack" style={{ border: "2px solid var(--teal)" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <b>📈 AUTISTIK · Daily Value Scanner</b>
          <small className="muted" style={{ display: "block" }}>All available fixtures · API-Football match data and statistics · 5DollarFootball bookmaker odds</small>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Scan date" type="date" min={todayDate || undefined} value={selectedDate} onChange={e => setSelectedDate(e.target.value)} disabled={loading || busy} />
          <button className="btn small" type="button" onClick={() => void loadAndScan()} disabled={loading || busy}>Scan selected date</button>
        </div>
      </div>
      <div className="notice">
        <b>Full-day match ratings · {scanDate || "selected date"} · Ghana time</b>
        <small className="muted" style={{ display: "block" }}>
          Every upcoming fixture returned for the selected date is analysed. No Top 25/Top 10 cap, no top-league-only filter and no one-team-only restriction. Each match shows its strongest model-supported market, probability, fair odds, bookmaker odds, expected value, odds edge and a 0–100 rating. A positive rating is not a guarantee.
        </small>
      </div>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <small className="muted">{fixtures.length} fixtures loaded · {scanned} scanned · {ratedCount} rated · {valueCount} positive-EV matches</small>
        {busy && <small className="muted">Full-day scan running</small>}
      </div>
      {progress && <small className="muted">{progress}</small>}
      {error && <div className="notice warn">{error}</div>}
      {visibleMatches.length > 0 && (
        <div className="stack" style={{ gap: 9 }}>
          <b>All match ratings · strongest first ({visibleMatches.length})</b>
          {visibleMatches.map((item, index) => {
            const fixture = item.fixture;
            const row = item.best;
            const ev = row ? Number(row.ev) : null;
            const positive = ev != null && ev > 0;
            return (
              <div key={String(fixture.id)} className={"sb-top-r " + (positive ? "hi" : "mid")} style={{ display: "grid", gap: 7, padding: 12, minWidth: 0, overflowWrap: "anywhere", borderLeft: "4px solid " + (positive ? "var(--teal)" : "var(--sun)") }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <b>#{index + 1} · {fixture.competition || fixture.league?.name || "Football"}</b>
                  <b>{item.rating == null ? "Rating unavailable" : "AI rating " + item.rating + "/100"}</b>
                </div>
                <b>{fixture.home.name} vs {fixture.away.name}</b>
                <small className="muted">{new Date(fixture.date).toLocaleString("en-GB", { timeZone: "Africa/Accra", dateStyle: "medium", timeStyle: "short" })} Ghana time</small>
                {row ? (
                  <>
                    <b style={{ color: positive ? "var(--teal)" : "var(--sun)" }}>{positive ? "POSITIVE VALUE" : "NO POSITIVE VALUE AT CURRENT PRICE"}</b>
                    <div><b>{row.selection}</b> · {row.market}</div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
                      <span>Model chance <b>{Number(row.probability).toFixed(1)}%</b></span>
                      <span>Bookmaker odds <b>{Number(row.odds).toFixed(2)}</b></span>
                      <span>Fair odds <b>{Number(row.fairOdds).toFixed(2)}</b></span>
                      <span>Expected value <b>{ev! >= 0 ? "+" : ""}{ev!.toFixed(1)}%</b></span>
                      <span>Odds edge <b>{Number(row.edge).toFixed(1)} points</b></span>
                    </div>
                    <small className="muted">Best available price: {row.bookmaker}</small>
                  </>
                ) : (
                  <small className="muted">No usable model-supported bookmaker price was returned for this match. {item.diagnostic?.analysisError || item.diagnostic?.oddsError || "Check the scan coverage diagnostics below."}</small>
                )}
              </div>
            );
          })}
        </div>
      )}
      {busy && <small className="muted">The scanner continues through every fixture returned for this date. Matches are not discarded because another match uses the same team.</small>}
      {diagnostics.length > 0 && (
        <details>
          <summary>Scan coverage and diagnostics · {diagnostics.length} fixtures checked</summary>
          <div className="stack" style={{ gap: 7 }}>
            <small className="muted">Fixtures remain visible even when odds or statistics are unavailable; those matches are marked as unrated rather than silently removed.</small>
            {diagnostics.map((d: any, i: number) => (
              <small key={i} className="muted">{d.fixture}: {d.analysisError || d.oddsError || ((d.markets || []).length ? "Analysed · " + d.markets.join(", ") : "No supported bookmaker prices returned")}</small>
            ))}
          </div>
        </details>
      )}
      <small className="muted">SPORT uses the configured API-Football key for fixtures and statistics, plus 5DollarFootballAPI for bookmaker odds. Prices can change; verify the current odds before staking. No prediction is guaranteed.</small>
    </section>
  );
}
