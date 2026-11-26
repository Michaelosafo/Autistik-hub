"use client";

import { useEffect, useRef, useState } from "react";

type Fixture = { id:number; date:string; status:string; competition?:string; league?:{name?:string}; home:{id:number;name:string}; away:{id:number;name:string} };
const TOP_COMPETITION = /(?:champions league|europa league|conference league|premier league|la liga|serie a|bundesliga|ligue 1|eredivisie|primeira liga)/i;

type Pick = { key:string; home:string; away:string; competition:string; selection:string; market:string; probability:number; fairOdds:number; odds:number; bookmaker:string; ev:number; edge:number; date:string; autistikRank:number };

export default function DailyValueBets() {
  const [fixtures,setFixtures]=useState<Fixture[]>([]);
  const [picks,setPicks]=useState<Pick[]>([]);
  const [diagnostics,setDiagnostics]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState("");
  const [error,setError]=useState("");
  const [scanDate,setScanDate]=useState("");
  const [selectedDate,setSelectedDate]=useState("");
  const [todayDate,setTodayDate]=useState("");
  const [redPicks,setRedPicks]=useState<any[]>([]);
  const [scanned,setScanned]=useState(0);
  const started=useRef(false);

  async function post(action:string,body:any={}) {
    const response=await fetch("/api/admin/sport",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...body})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.error)throw new Error(data.error||"Request failed (HTTP "+response.status+").");
    return data;
  }

  function randomBestRows(rows:any[], limit=25):Pick[] {
    // Keep every genuinely model-supported positive-EV selection; do not impose an
    // arbitrary minimum probability. Randomise the shortlist, but weight the draw
    // toward stronger probabilities and larger positive expected value.
    const eligible=rows.filter((r:any)=>
      r.modelSupported &&
      Number.isFinite(Number(r.probability)) &&
      Number(r.probability)>0 &&
      Number.isFinite(Number(r.ev)) &&
      Number(r.ev)>0 &&
      Number.isFinite(Number(r.odds)) &&
      Number(r.odds)>1
    );
    const best=new Map<string,any>();
    for(const r of eligible) {
      const key=[r.home,r.away,r.market,r.selection].join("|");
      const old=best.get(key);
      if(!old||Number(r.odds)>Number(old.odds))best.set(key,r);
    }
    const pool=[...best.values()].map((r:any)=>{
      const probability=Math.max(0,Math.min(100,Number(r.probability)));
      const ev=Math.max(0,Number(r.ev));
      const edge=Math.max(0,Number(r.edge)||0);
      const quality=0.60*(probability/100)+0.25*Math.min(ev,50)/50+0.15*Math.min(edge,20)/20;
      return {...r,autistikRank:Math.round(quality*100)};
    });
    const selected: any[]=[];
    const usedTeams=new Set<string>();
    // Weighted random sampling without replacement. Higher-quality picks are
    // more likely, while the final order remains shuffled rather than rank-sorted.
    while(pool.length && selected.length<limit) {
      const available=pool.filter((r:any)=>
        !usedTeams.has(String(r.home).toLowerCase()) &&
        !usedTeams.has(String(r.away).toLowerCase())
      );
      if(!available.length)break;
      const weights=available.map((r:any)=>Math.max(0.01,
        (Number(r.probability)/100) *
        (1+Math.min(Number(r.ev),50)/50) *
        (1+Math.min(Math.max(0,Number(r.edge)||0),20)/40)
      ));
      const total=weights.reduce((sum:number,w:number)=>sum+w,0);
      let draw=Math.random()*total, chosen=available[available.length-1];
      for(let i=0;i<available.length;i++){draw-=weights[i];if(draw<=0){chosen=available[i];break;}}
      selected.push(chosen);
      usedTeams.add(String(chosen.home).toLowerCase());
      usedTeams.add(String(chosen.away).toLowerCase());
      const index=pool.indexOf(chosen);
      if(index>=0)pool.splice(index,1);
    }
    return selected;
  }

  async function runDailyScan(dayFixtures:Fixture[]) {
    setBusy(true);setError("");setPicks([]);setRedPicks([]);setDiagnostics([]);setScanned(0);
    let allRows:any[]=[];let allDiagnostics:any[]=[];
    try {
      for(let i=0;i<dayFixtures.length;i+=2) {
        const batch=dayFixtures.slice(i,i+2);
        setProgress("Scanning every league · "+Math.min(i+batch.length,dayFixtures.length)+" / "+dayFixtures.length+" fixtures");
        const data=await post("valueScan",{fixtures:batch});
        allRows=allRows.concat(Array.isArray(data.rows)?data.rows:[]);
        allDiagnostics=allDiagnostics.concat(Array.isArray(data.diagnostics)?data.diagnostics:[]);
        const randomised=randomBestRows(allRows);
        setPicks(randomised);
        setRedPicks([]);
        setDiagnostics([...allDiagnostics]);
        setScanned(Math.min(i+batch.length,dayFixtures.length));
        if(i+2<dayFixtures.length)await new Promise(resolve=>setTimeout(resolve,650));
      }
      const randomised=randomBestRows(allRows);
      setPicks(randomised);
      setRedPicks([]);
      if(!randomised.length)setError("The selected date was scanned, but no model-supported positive-value selections qualified. Check scan coverage below.");
    } catch(e) { setError(e instanceof Error?e.message:String(e)); }
    finally {setBusy(false);setProgress("");}
  }

  async function loadAndScan() {
    setLoading(true);setError("");setPicks([]);setDiagnostics([]);setScanned(0);
    try {
      const data=await post("dailyFixtures",{date:selectedDate||undefined});
      const isPast=String(data.date||"")<String(data.today||"");
      const now=Date.now();
      const matches=(Array.isArray(data.matches)?data.matches:[]).filter((f:any)=>
        f?.id&&f?.home?.name&&f?.away?.name&&f?.date&&TOP_COMPETITION.test(String(f.competition||f.league?.name||""))&&(isPast||Date.parse(f.date)>=now)
      ).sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
      setScanDate(String(data.date||""));
      setSelectedDate(String(data.date||""));setTodayDate(String(data.today||""));
      setFixtures(matches);
      if(!matches.length)setError("API-Football returned no fixtures for the selected date.");
      else {
        setLoading(false);
        await runDailyScan(matches);
      }
    } catch(e) {setError(e instanceof Error?e.message:String(e));}
    finally {setLoading(false);}
  }

  useEffect(()=>{if(!started.current){started.current=true;void loadAndScan();}},[]);

  return <section className="card stack" style={{border:"2px solid var(--teal)"}}>
    <div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}>
      <div><b>📈 AUTISTIK · Daily Value Scanner</b><small className="muted" style={{display:"block"}}>Top competitions only · API-Football statistics · 5DollarFootballAPI odds</small></div>
      <div className="row" style={{gap:8,flexWrap:"wrap"}}><input aria-label="Scan date" type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} disabled={loading||busy}/><button className="btn small" type="button" onClick={()=>void loadAndScan()} disabled={loading||busy}>Scan selected date</button></div>
    </div>
    <div className="notice">
      <b>Best value selections for {scanDate||"selected date"} · Ghana time</b>
      <small className="muted" style={{display:"block"}}>All supported markets are considered. Qualifying positive-EV selections are weighted by model probability, expected value and price edge, then randomly shuffled into a shortlist of up to 25 picks. A team can appear only once in the shortlist.</small>
    </div>
    <div className="row" style={{justifyContent:"space-between",flexWrap:"wrap"}}>
      <small className="muted">{fixtures.length} fixtures found · {scanned} scanned · {picks.length} qualifying picks</small>
      {busy&&<small className="muted">Automatic scan running</small>}
    </div>
    {progress&&<small className="muted">{progress}</small>}
    {error&&<div className="notice warn">{error}</div>}
    {picks.length>0&&<div className="stack" style={{gap:9}}>
      <b>Randomised best {picks.length} · weighted by value</b>
      {picks.map((r,i)=><div key={r.key||i} className="sb-top-r hi" style={{display:"grid",gap:7,padding:12,minWidth:0,overflowWrap:"anywhere",borderLeft:"4px solid var(--teal)"}}>
        <div className="row" style={{justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><b>#{i+1} · {r.competition||"Football"}</b><b>{Math.round(r.autistikRank)}/100 quality score</b></div>
        <b>{r.home} vs {r.away}</b>
        <div><b>{r.selection}</b> · {r.market}</div>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:13}}>
          <span>Model <b>{Number(r.probability).toFixed(1)}%</b></span>
          <span>Odds <b>{Number(r.odds).toFixed(2)}</b></span>
          <span>Fair <b>{Number(r.fairOdds).toFixed(2)}</b></span>
          <span>EV <b>+{Number(r.ev).toFixed(1)}%</b></span>
          <span>Edge <b>{Number(r.edge).toFixed(1)}pp</b></span>
        </div>
        <small className="muted">Best available Ghana bookmaker price: {r.bookmaker} · kick-off {r.date?new Date(r.date).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"not supplied"}</small>
      </div>)}
    </div>}
    {busy&&!picks.length&&<small className="muted">Scanning fixtures. The shortlist will appear as soon as qualified selections are found.</small>}
    {false&&redPicks.length>0&&<div className="stack" style={{gap:8}}>
      <b>🔴 Red / underpriced · Top {redPicks.length}</b>
      <small className="muted">Lower model-probability selections with positive estimated value. These are higher-risk options, not part of the high-conviction Top 25.</small>
      {redPicks.map((r:any,i:number)=><div key={"red-"+(r.key||i)} className="sb-top-r" style={{display:"grid",gap:6,padding:11,borderLeft:"4px solid var(--danger)",overflowWrap:"anywhere"}}>
        <b>#{i+1} · {r.competition||"Football"} · {r.home} vs {r.away}</b>
        <div><b>{r.selection}</b> · {r.market}</div>
        <small>Model {Number(r.probability).toFixed(1)}% · Odds {Number(r.odds).toFixed(2)} · Fair {Number(r.fairOdds).toFixed(2)} · EV +{Number(r.ev).toFixed(1)}% · Edge {Number(r.edge).toFixed(1)}pp</small>
        <small className="muted">{r.bookmaker}</small>
      </div>)}
    </div>}
    {scanDate&&scanDate<todayDate&&<div className="notice warn"><b>Retrospective date selected.</b> Historical fixtures and available odds are scanned, but the current team-statistics model is not a true pre-kickoff historical model. Do not treat these estimates as predictions that were knowable before the match.</div>}
    {diagnostics.length>0&&<details><summary>Scan coverage and diagnostics · {diagnostics.length} fixtures checked</summary><div className="stack" style={{gap:7}}>
      <small className="muted">Matches without supported odds or a usable model probability are excluded from the shortlist.</small>
      {diagnostics.map((d:any,i:number)=><small key={i} className="muted">{d.fixture}: {d.error||d.analysisError||((d.markets||[]).length?"Analysed · "+d.markets.join(", "):"No supported prices returned")}</small>)}
    </div></details>}
    <small className="muted">Only model-supported positive-EV selections are eligible; the shortlist is randomised and each team appears at most once. Odds can change; verify the current price before placing a bet. No pick is guaranteed.</small>
  </section>;
}
