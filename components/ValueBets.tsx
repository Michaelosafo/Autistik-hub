"use client";
import { useState } from "react";

type Props = { endpoint: "/api/admin/sport" | "/api/admin/super" };
export default function ValueBets({ endpoint }: Props) {
  const [rows,setRows]=useState<any[]>([]);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState("");
  const [error,setError]=useState("");
  const [scanned,setScanned]=useState(0);
  const [dayCounts,setDayCounts]=useState({today:0,tomorrow:0});
  const [diagnostics,setDiagnostics]=useState<any[]>([]);
  const [feedStatus,setFeedStatus]=useState<any>(null);
  const [checkingFeed,setCheckingFeed]=useState(false);
  async function post(action:string, body:any={}) {
    const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...body})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok || d.error) throw new Error(d.error || (r.status===504 ? "Server timed out (504). This batch was not completed; retrying smaller batches can help." : "Request failed (HTTP "+r.status+")."));
    return d;
  }
  async function checkFeed() {
    setCheckingFeed(true);
    try { setFeedStatus(await post("oddsStatus")); }
    catch(e) { setFeedStatus({ error: (e as Error).message }); }
    finally { setCheckingFeed(false); }
  }
  async function scan() {
    setBusy(true); setError(""); setRows([]); setScanned(0); setDayCounts({today:0,tomorrow:0}); setDiagnostics([]);
    try {
      const matchData=await post("todayMatches");
      const matches=Array.isArray(matchData?.matches)?matchData.matches:[];
      if(matchData?.fixtureDiagnostics?.oddsPapiError) {
        setDiagnostics([{fixture:"OddsPapi fixture feed",error:matchData.fixtureDiagnostics.oddsPapiError}]);
      } else if(matchData?.fixtureDiagnostics) {
        setDiagnostics([{fixture:"Fixture candidates",fixtureCount:matchData.fixtureDiagnostics.oddsPapiFixtures,source:"OddsPapi"}]);
      }
      const now=Date.now();
      const accraDay=(value:string)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Accra",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
      const today=accraDay(new Date().toISOString());
      const tomorrow=accraDay(new Date(Date.now()+24*60*60_000).toISOString());
      const upcoming=matches.filter((f:any)=>f?.home?.name && f?.away?.name && f?.date && f.status!=="FINISHED" && Date.parse(f.date)>=now).sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
      setDayCounts({today:upcoming.filter((f:any)=>accraDay(f.date)===today).length,tomorrow:upcoming.filter((f:any)=>accraDay(f.date)===tomorrow).length});
      if(!upcoming.length){setError("No upcoming fixtures were returned by this board's football API.");return;}
      let all:any[]=[];
      // Keep each server request small: match analysis and odds lookups are
      // several upstream calls per fixture and a 20-match request exceeded
      // Vercel's 60-second function limit.
      for(let i=0;i<upcoming.length;i+=1){
        const batch=upcoming.slice(i,i+1);
        setProgress("Analysing "+Math.min(i+batch.length,upcoming.length)+" of "+upcoming.length+" fixtures…");
        const d=await post("valueScan",{fixtures:batch});
        all=all.concat(Array.isArray(d?.rows)?d.rows:[]);
        setDiagnostics(prev=>prev.concat(Array.isArray(d?.diagnostics)?d.diagnostics:[]));
        setRows([...all].sort((a,b)=>(Number(b.value)-Number(a.value)) || ((Number.isFinite(Number(b.ev))?Number(b.ev):-Infinity)-(Number.isFinite(Number(a.ev))?Number(a.ev):-Infinity))));
        setScanned(Math.min(i+batch.length,upcoming.length));
      }
      setProgress("");
      if(!all.length) setError("No bookmaker prices were returned by the configured odds feed. Check the provider diagnostics below.");
    } catch(e){setError((e as Error).message);setProgress("");}
    finally{setBusy(false);}
  }
  return <section className="card stack" style={{border:"2px solid var(--teal)"}}>
    <div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}>
       <div><b>📈 Value bets · today + tomorrow</b><small className="muted" style={{display:"block"}}>{endpoint === "/api/admin/super" ? "Uses SportMonks for fixtures and match statistics, and OddsPapi for bookmaker prices. Scans today's and tomorrow's fixtures and ranks model-supported positive expected value." : "Combines OddsPapi + OddsRelay prices, compares the best available bookmaker odds with SPORT model probabilities, and ranks positive expected value across today's and tomorrow's fixtures."}</small></div>
      <div className="row" style={{gap:8,flexWrap:"wrap"}}><button className="btn small" type="button" onClick={checkFeed} disabled={checkingFeed}>{checkingFeed?"Checking…":"Check odds feed"}</button><button className="btn primary small" type="button" onClick={scan} disabled={busy}>{busy?"Scanning…":"Scan all matches"}</button></div>
    </div>
    {progress && <small className="muted">{progress}</small>}
     {feedStatus && <div className="notice stack" style={{fontSize:13}}><b>{endpoint === "/api/admin/super" ? "SUPER odds-provider status" : "SPORT odds-provider status"}</b>{endpoint === "/api/admin/super" ? <><span>OddsPapi: {feedStatus.keyConfigured ? (feedStatus.active ? "active" : "no active bookmaker") : "key missing"}</span><span>Subscribed bookmakers: {(feedStatus.bookmakers || []).join(", ") || "none returned"}</span>{feedStatus.error && <small>{feedStatus.error}</small>}<small>Highlightly Premium supplies fixtures and match statistics; OddsPapi supplies bookmaker prices.</small></> : <><span>OddsPapi: {feedStatus.oddspapi?.active ? "active" : feedStatus.oddspapi?.keyConfigured ? "no active bookmaker" : "not configured"}</span><span>OddsRelay: {feedStatus.oddsrelay?.keyConfigured ? "API key configured" : "not configured"}</span><small>Both feeds are checked independently. Available prices are combined and the best price is selected for each outcome.</small>{feedStatus.oddspapi?.error && <small>OddsPapi: {feedStatus.oddspapi.error}</small>}{feedStatus.oddsrelay?.errors?.accountCoverage && <small>OddsRelay: {String(feedStatus.oddsrelay.errors.accountCoverage?.message || feedStatus.oddsrelay.errors.accountCoverage)}</small>}</>}</div>}
    {scanned>0 && <small className="muted">Scanned {scanned} upcoming fixtures · Today: {dayCounts.today} · Tomorrow: {dayCounts.tomorrow}</small>}
    {error && <div className="notice warn">{error}</div>}
    {diagnostics.length>0 && <div className="stack" style={{fontSize:13}}>
      <b>Odds feed diagnostics</b>
      {diagnostics.slice(0,6).map((d,i)=><small key={i} className="muted">{d.fixture}: {d.fixtureCount != null ? d.fixtureCount+" odds-enabled fixture candidates from "+d.source : d.oddsError || d.error || ((d.oddsEvents ?? d.eventsReturned ?? 0)+" events returned · "+(d.matchedEvents ?? d.matched ?? 0)+" matched · "+(d.bookmakers||[]).length+" bookmakers · markets: "+((d.markets||[]).join(", ")||"none"))}{d.analysisError ? " · model: "+d.analysisError : ""}{d.feedExamples?.length ? " · feed examples: "+d.feedExamples.join("; ") : ""}{d.providers?.oddspapi ? " · OddsPapi: "+(d.providers.oddspapi.ok ? "OK ("+(d.providers.oddspapi.matched ?? 0)+" matched)" : "ERROR "+(d.providers.oddspapi.error || "")) : ""}{d.providers?.oddsrelay ? " · OddsRelay: "+(d.providers.oddsrelay.ok ? "OK ("+(d.providers.oddsrelay.matched ?? 0)+" matched)" : "ERROR "+(d.providers.oddsrelay.error || "")) : ""}</small>)}
    </div>}
    {rows.length>0 && <div className="stack">
      <b>Positive value · highest EV first</b>
      {rows.map((x,i)=><div key={x.key} className="sb-top-r hi" style={{display:"flex",flexDirection:"column",alignItems:"stretch",gap:9,padding:14,minWidth:0,overflowWrap:"anywhere",borderLeft:x.value?"5px solid var(--teal)":"5px solid var(--line)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
          <b>#{i+1} · {x.home} vs {x.away}</b><small className="muted">{x.date ? new Date(x.date).toLocaleString() : "Kick-off time unavailable"}</small>
          <b style={{color:x.value?"var(--teal)":"var(--muted)",whiteSpace:"nowrap"}}>{x.modelSupported ? (x.ev>0?"+":"")+x.ev.toFixed(1)+"% EV · "+(x.value?"POTENTIAL VALUE":"NOT VALUE") : "ODDS AVAILABLE · MODEL NOT YET SUPPORTED"}</b>
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
     <small className="muted">{endpoint === "/api/admin/super" ? "Uses SportMonks match statistics and OddsPapi bookmaker prices, removes duplicate selections, and keeps the best returned price. " : "Combines OddsPapi and OddsRelay, removes duplicate selections, and keeps the best bookmaker price from either provider. "}Value is labelled only where the board has a supported probability model; other returned markets are shown as odds-only, not falsely called value.</small>
  </section>;
}
