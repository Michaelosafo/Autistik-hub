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
        setRows([...all].sort((a,b)=>(Number(b.value)-Number(a.value)) || (b.ev-a.ev)));
        setScanned(Math.min(i+batch.length,upcoming.length));
      }
      setProgress("");
      if(!all.length) setError("Fixtures were analysed, but the odds feed returned no matching prices for 1X2, totals or BTTS. Some Ghana bookmakers may not cover these matches or markets.");
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
      {rows.map((x,i)=><div key={x.key} className="sb-top-r hi" style={{display:"flex",flexDirection:"column",alignItems:"stretch",gap:9,padding:14,minWidth:0,overflowWrap:"anywhere",borderLeft:x.value?"5px solid var(--teal)":"5px solid var(--line)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
          <b>#{i+1} · {x.home} vs {x.away}</b>
          <b style={{color:x.value?"var(--teal)":"var(--muted)",whiteSpace:"nowrap"}}>{x.ev>0?"+":""}{x.ev.toFixed(1)}% EV · {x.value?"POTENTIAL VALUE":"NOT VALUE"}</b>
        </div>
        <div style={{borderRadius:10,background:"var(--soft, rgba(20,160,120,.10))",padding:"10px 12px",display:"grid",gap:3}}>
          <small className="muted" style={{fontWeight:700}}>MARKET · {x.market}</small>
          <b style={{fontSize:17}}>{x.market.startsWith("1X2") ? (x.selection === "Draw" ? "DRAW" : x.selection === x.home ? "HOME WIN — "+x.home : "AWAY WIN — "+x.away) : x.selection.toUpperCase()}</b>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(135px,1fr))",gap:10}}>
          <div><small className="muted" style={{display:"block"}}>Autistik fair odds</small><b>{x.modelSupported ? x.fairOdds.toFixed(2) : "Not calculated"}</b></div>
          <div><small className="muted" style={{display:"block"}}>Bookmaker odds · {x.bookmaker}</small><b>{x.odds.toFixed(2)}</b></div>
          <div><small className="muted" style={{display:"block"}}>Model win probability</small><b>{x.modelSupported ? x.probability.toFixed(1)+"%" : "Not modelled yet"}</b></div>
          <div><small className="muted" style={{display:"block"}}>Bookmaker implied probability</small><b>{x.implied.toFixed(1)}%</b></div>
          <div><small className="muted" style={{display:"block"}}>Probability edge vs market</small><b>{x.modelSupported ? (x.edge>0?"+":"")+x.edge.toFixed(1)+" percentage points" : "Not available"}</b></div>
        </div>
        <small className="muted">{!x.modelSupported ? "This bookmaker option is shown, but Autistik does not yet calculate its fair probability. It is not labelled as value." : x.edge>0.05?"Autistik estimates this outcome is more likely than the bookmaker market implies.":x.edge< -0.05?"The bookmaker market implies this outcome is more likely than Autistik estimates.":"Autistik and the bookmaker market are close on this outcome."} {x.modelSupported ? (x.value?"The offered price is above Autistik fair odds: potential value.":"The offered price is below Autistik fair odds: not value.") : ""}</small>
      </div>)}
    </div>}
    <small className="muted">Scans available 1X2, Over/Under goals and Both Teams To Score prices. Markets or matches without bookmaker prices are omitted. Positive expected value is a model estimate, not a guarantee; negative-EV comparisons are shown too so you can see where the market disagrees with Autistik.</small>
  </section>;
}
