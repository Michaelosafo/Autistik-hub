"use client";
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

function TeamPick({ label, team, setTeam }: { label: string; team: Team | null; setTeam: (t: Team | null) => void }) {
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
        <button key={x.id} type="button" className="sb-opt" onClick={() => { setTeam(x); setList([]); }}>
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
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hist, setHist] = useState<any[]>([]);
  const [marketOdds, setMarketOdds] = useState<Record<string, string>>({});
  const [showValue, setShowValue] = useState(true);
  const loadHist = () => api<{ rows: any[] }>("history").then((d) => setHist(d.rows)).catch(() => {});
  useEffect(() => { api<{ ready: boolean }>("ready").then((d) => setReady(d.ready)).catch(() => setReady(false)); loadHist(); }, []);

  async function run() {
    if (!home || !away) return;
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await api("analyse", { home: home.id, away: away.id, homeName: home.name, awayName: away.name })); loadHist(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
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
        <h1>⚽ Sport board</h1>
        <p className="muted">Pick the home team and the away team. The board compares recent results, goals and form, then predicts the match. These are probabilities, not certainties.</p>
      </header>
      {ready === false && <div className="notice warn">Add <code>FOOTBALL_DATA_TOKEN</code> in Vercel (free token from football-data.org), then redeploy.</div>}

      <section className="card stack">
        <TeamPick label="🏠 Home team" team={home} setTeam={(t) => { setHome(t); setRes(null); }} />
        <TeamPick label="✈️ Away team" team={away} setTeam={(t) => { setAway(t); setRes(null); }} />
        <button type="button" className="btn primary" disabled={!home || !away || busy || !ready} onClick={run}>{busy ? "Checking both teams…" : "Analyse match"}</button>
        {err && <div className="notice warn">{err}</div>}
      </section>

      {m && (
        <>
          <section className="card stack">
            <b>{home?.name} vs {away?.name}</b>
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
            <div className="sb-top">
              {m.top10.map((o: any, i: number) => (
                <div key={o.name} className={`sb-top-r ${pctCls(o.p)}`}>
                  <span className="sb-rank">{i + 1}</span>
                  <span className="sb-name">{o.name}</span>
                  <b>{o.p}%</b>
                  <small className="muted">fair {o.fair}</small>
                </div>
              ))}
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
            <details>
              <summary>All {m.markets.length} options</summary>
              <div className="sb-top">
                {m.markets.map((o: any) => (
                  <div key={o.name} className={`sb-top-r ${pctCls(o.p)}`}><span className="sb-rank" /><span className="sb-name">{o.name}</span><b>{o.p}%</b><small className="muted">fair {o.fair ?? "–"}</small></div>
                ))}
              </div>
            </details>
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
