"use client";

import { useEffect, useRef, useState } from "react";

type Fixture = { id:number; date:string; status:string; competition?:string; league?:{name?:string}; home:{id:number;name:string}; away:{id:number;name:string} };
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
  const [scanned,setScanned]=useState(0);
  const started=useRef(false);

  async function post(action:string,body:any={}) {
    const response=await fetch("/api/admin/sport",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...body})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.error)throw new Error(data.error||"Request failed (HTTP "+response.status+").");
    return data;
  }

  function rankRows(rows:any[]):Pick[] {
    const eligible=rows.filter((r:any)=>r.modelSupported&&Number.isFinite(Number(r.probability))&&Number(r.probability)>=45&&Number(r.ev)>0&&Number(r.edge)>0);
    const best=new Map<string,any>();
    for(const r of eligible) {
      const key=[r.home,r.away,r.market,r.selection].join("|");
      const old=best.get(key);
      if(!old||Number(r.odds)>Number(old.odds))best.set(key,r);
    }
    return [...best.values()].map((r:any)=>{
      const probability=Math.max(0,Math.min(100,Number(r.probability)));
      const edge=Math.max(0,Math.min(20,Number(r.edge)||0));
      const ev=Math.max(0,Math.min(30,Number(r.ev)||0));
      return {...r,autistikRank:0.55*probability+0.25*(edge/20*100)+0.20*(ev/30*100)};
    }).sort((a:any,b:any)=>b.autistikRank-a.autistikRank||Number(b.ev)-Number(a.ev));
  }

  async function runDailyScan(dayFixtures:Fixture[]) {
    setBusy(true);setError("");setPicks([]);setDiagnostics([]);setScanned(0);
    let allRows:any[]=[];let allDiagnostics:any[]=[];
    try {
      for(let i=0;i<dayFixtures.length;i+=2) {
        const batch=dayFixtures.slice(i,i+2);
        setProgress("Scanning every league · "+Math.min(i+batch.length,dayFixtures.length)+" / "+dayFixtures.length+" fixtures");
        const data=await post("valueScan",{fixtures:batch});
        allRows=allRows.concat(Array.isArray(data.rows)?data.rows:[]);
        allDiagnostics=allDiagnostics.concat(Array.isArray(data.diagnostics)?data.diagnostics:[]);
        setPicks(rankRows(allRows).slice(0,25));
        setDiagnostics([...allDiagnostics]);
        setScanned(Math.min(i+batch.length,dayFixtures.length));
        if(i+2<dayFixtures.length)await new Promise(resolve=>setTimeout(resolve,650));
      }
      const ranked=rankRows(allRows);
      setPicks(ranked.slice(0,25));
      if(!ranked.length)setError("All remaining fixtures were scanned, but no model-supported positive-value selections qualified today. Check scan coverage below.");
    } catch(e) { setError(e instanceof Error?e.message:String(e)); }
    finally {setBusy(false);setProgress("");}
  }

  async function loadAndScan() {
    setLoading(true);setError("");setPicks([]);setDiagnostics([]);setScanned(0);
    try {
      const data=await post("dailyFixtures");
      const now=Date.now();
      const matches=(Array.isArray(data.matches)?data.matches:[]).filter((f:any)=>
        f?.id&&f?.home?.name&&f?.away?.name&&f?.date&&Date.parse(f.date)>=now
      ).sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
      setScanDate(String(data.date||""));
      setFixtures(matches);
      if(!matches.length)setError("API-Football returned no remaining scheduled fixtures for today in Ghana time.");
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
      <div><b>📈 AUTISTIK · Daily Top 25 Value Bets</b><small className="muted" style={{display:"block"}}>Automatic all-league scan · API-Football statistics · 5DollarFootballAPI odds</small></div>
      <button className="btn small" type="button" onClick={()=>void loadAndScan()} disabled={loading||busy}>{loading||busy?"Scanning…":"Refresh today's scan"}</button>
    </div>
    <div className="notice">
      <b>Best value selections for {scanDate||"today"} · Ghana time</b>
      <small className="muted" style={{display:"block"}}>Every remaining fixture returned by your API-Football subscription is checked. Results are ranked by model probability, price edge and expected value. The AUTISTIK rank is a comparison score, not a guarantee or a calibrated chance of winning.</small>
    </div>
    <div className="row" style={{justifyContent:"space-between",flexWrap:"wrap"}}>
      <small className="muted">{fixtures.length} fixtures found · {scanned} scanned · {picks.length} qualifying picks</small>
      {busy&&<small className="muted">Automatic scan running</small>}
    </div>
    {progress&&<small className="muted">{progress}</small>}
    {error&&<div className="notice warn">{error}</div>}
    {picks.length>0&&<div className="stack" style={{gap:9}}>
      <b>Top {picks.length} · highest conviction and value</b>
      {picks.map((r,i)=><div key={r.key||i} className="sb-top-r hi" style={{display:"grid",gap:7,padding:12,minWidth:0,overflowWrap:"anywhere",borderLeft:"4px solid var(--teal)"}}>
        <div className="row" style={{justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><b>#{i+1} · {r.competition||"Football"}</b><b>{Math.round(r.autistikRank)}/100 rank</b></div>
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
    {diagnostics.length>0&&<details><summary>Scan coverage and diagnostics · {diagnostics.length} fixtures checked</summary><div className="stack" style={{gap:7}}>
      <small className="muted">Matches without supported odds or a usable model probability are excluded from the shortlist.</small>
      {diagnostics.map((d:any,i:number)=><small key={i} className="muted">{d.fixture}: {d.error||d.analysisError||((d.markets||[]).length?"Analysed · "+d.markets.join(", "):"No supported prices returned")}</small>)}
    </div></details>}
    <small className="muted">Only model-supported positive-EV selections are listed. Odds can change; verify the current price before placing a bet. No pick is guaranteed.</small>
  </section>;
}
