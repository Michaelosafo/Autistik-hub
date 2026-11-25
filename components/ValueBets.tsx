"use client";
import { useState } from "react";

type Props = { endpoint: "/api/admin/sport" | "/api/admin/super" };
export default function ValueBets({ endpoint }: Props) {
  const [rows,setRows]=useState<any[]>([]);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState("");
  const [error,setError]=useState("");
  const [scanned,setScanned]=useState(0);
  async function post(action:string, body:any={}) {
    const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...body})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok || d.error) throw new Error(d.error || "Request failed");
    return d;
  }
  async function scan() {
    setBusy(true); setError(""); setRows([]); setScanned(0);
    try {
      const {matches=[]}=await post("todayMatches");
      const upcoming=matches.filter((f:any)=>f?.home?.id && f?.away?.id && f?.date && f.status!=="FINISHED");
      if(!upcoming.length){setError("No upcoming fixtures were returned by this board's football API.");return;}
      let all:any[]=[];
      for(let i=0;i<upcoming.length;i+=3){
        const batch=upcoming.slice(i,i+3);
        setProgress("Analysing "+Math.min(i+batch.length,upcoming.length)+" of "+upcoming.length+" fixtures…");
        const d=await post("valueScan",{fixtures:batch});
        all=all.concat(d.rows||[]);
        setRows([...all].sort((a,b)=>b.ev-a.ev));
        setScanned(Math.min(i+batch.length,upcoming.length));
      }
      setProgress("");
      if(!all.length) setError("Fixtures were analysed, but no positive-value 1X2 bets had usable bookmaker prices. Try again later when odds are available.");
    } catch(e){setError((e as Error).message);setProgress("");}
    finally{setBusy(false);}
  }
  return <section className="card stack" style={{border:"2px solid var(--teal)"}}>
    <div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}>
      <div><b>📈 Value bets · all today's fixtures</b><small className="muted" style={{display:"block"}}>Scans each fixture using this board's own model and compares available Ghana bookmaker 1X2 prices.</small></div>
      <button className="btn primary small" type="button" onClick={scan} disabled={busy}>{busy?"Scanning…":"Scan all matches"}</button>
    </div>
    {progress && <small className="muted">{progress}</small>}
    {scanned>0 && <small className="muted">Scanned {scanned} fixtures</small>}
    {error && <div className="notice warn">{error}</div>}
    {rows.length>0 && <div className="stack">
      <b>Positive value · highest EV first</b>
      {rows.map((x,i)=><div key={x.key} className="sb-top-r hi" style={{display:"grid",gap:5}}>
        <div className="row" style={{justifyContent:"space-between",gap:8}}><b>#{i+1} · {x.home} vs {x.away}</b><b>+{x.ev.toFixed(1)}%</b></div>
        <b>{x.selection}</b>
        <small className="muted">Autistik fair odds: {x.fairOdds.toFixed(2)} · Bookmaker odds: {x.odds.toFixed(2)} ({x.bookmaker})</small>
        <small className="muted">Model chance {x.probability.toFixed(1)}% · market implied {x.implied.toFixed(1)}% · edge {x.edge.toFixed(1)} percentage points</small>
      </div>)}
    </div>}
    <small className="muted">Initial version scans 1X2 only. Other markets will be added when the odds feed supplies their prices. Positive EV is an estimate, not a guarantee.</small>
  </section>;
}
