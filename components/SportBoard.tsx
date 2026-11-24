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
      <header>
        <div className="dz-kick">OWNER · SPORT</div>
        <h1>⚽ Sport board</h1>
        <p className="muted">Pick the home team and the away team. The board compares both sides' stats and predicts the match. These are probabilities, not certainties.</p>
      </header>
      {ready === false && <div className="notice warn">Add <code>APIFOOTBALL_KEY</code> in Vercel (free key at dashboard.api-football.com, 100 requests a day), then redeploy.</div>}

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
            <small className="muted">Season numbers are from each team's own league ({res.leagues.home.name} {res.leagues.home.season}, {res.leagues.away.name} {res.leagues.away.season}); strengths are measured against that league's average so teams from different leagues compare fairly.</small>
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
