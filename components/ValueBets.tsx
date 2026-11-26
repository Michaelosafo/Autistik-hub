"use client";
import { useEffect, useRef, useState } from "react";

type Props = { endpoint: "/api/admin/sport" | "/api/admin/super" };
export default function ValueBets({ endpoint }: Props) {
  const [rows,setRows]=useState<any[]>([]);
  const [fixtures,setFixtures]=useState<any[]>([]);
  const [selectedFixture,setSelectedFixture]=useState<string>("");
  const [scanningFixture,setScanningFixture]=useState<string>("");
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState("");
  const [error,setError]=useState("");
  const [scanned,setScanned]=useState(0);
  const [dayCounts,setDayCounts]=useState({today:0,tomorrow:0});
  const [diagnostics,setDiagnostics]=useState<any[]>([]);
  const [feedStatus,setFeedStatus]=useState<any>(null);
  const [checkingFeed,setCheckingFeed]=useState(false);
  const autoStarted=useRef(false);
  const autoScanStarted=useRef(false);
  async function post(action:string, body:any={}) {
    const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...body})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok || d.error) throw new Error(d.error || (r.status===504 ? "Server timed out (504). This match could not be completed; you can retry it individually." : "Request failed (HTTP "+r.status+")."));
    return d;
  }
  async function checkFeed() {
    setCheckingFeed(true);
    try { setFeedStatus(await post("oddsStatus")); }
    catch(e) { setFeedStatus({ error: (e as Error).message }); }
    finally { setCheckingFeed(false); }
  }
  const fixtureKey=(f:any)=>String(f?.id || (String(f?.home?.name||"")+"|"+String(f?.away?.name||"")+"|"+String(f?.date||"")));
  async function scan() {
    setBusy(true); if(endpoint==="/api/admin/sport") autoScanStarted.current=false; setError(""); setRows([]); setScanned(0); setDayCounts({today:0,tomorrow:0}); setDiagnostics([]); setSelectedFixture("");
    try {
      if(endpoint==="/api/admin/sport") {
        const matchData=await post("todayMatches");
        const matches=Array.isArray(matchData?.matches)?matchData.matches:[];
        if(matchData?.fixtureDiagnostics?.oddsPapiError) setDiagnostics([{fixture:"Fixture feed",error:matchData.fixtureDiagnostics.oddsPapiError}]);
        const now=Date.now();
        const accraDay=(value:string)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Accra",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
        const today=accraDay(new Date().toISOString());
        const tomorrow=accraDay(new Date(Date.now()+24*60*60_000).toISOString());
        const upcoming=matches.filter((f:any)=>f?.home?.name && f?.away?.name && f?.date && f.status!=="FINISHED" && Date.parse(f.date)>=now).sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
        setFixtures(upcoming);
        setDayCounts({today:upcoming.filter((f:any)=>accraDay(f.date)===today).length,tomorrow:upcoming.filter((f:any)=>accraDay(f.date)===tomorrow).length});
        setScanned(0);
        if(!upcoming.length) setError("No upcoming fixtures were returned by the football API.");
        return;
      }
      // SUPER retains its existing scan flow; SPORT now scans only when a fixture is selected.
      const matchData=await post("todayMatches");
      const matches=Array.isArray(matchData?.matches)?matchData.matches:[];
      const upcoming=matches.filter((f:any)=>f?.home?.name && f?.away?.name && f?.date && f.status!=="FINISHED" && Date.parse(f.date)>=Date.now()).sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
      setFixtures(upcoming);
      setDayCounts({today:upcoming.length,tomorrow:0});
      let all:any[]=[];
      for(let i=0;i<upcoming.length;i+=1){
        const f=upcoming[i];
        setProgress("Analysing "+(i+1)+" of "+upcoming.length+" fixtures…");
        const d=await post("valueScan",{fixtures:[f]});
        all=all.concat(Array.isArray(d?.rows)?d.rows:[]);
        setDiagnostics(prev=>prev.concat(Array.isArray(d?.diagnostics)?d.diagnostics:[]));
        setRows([...all].sort((a,b)=>(Number(b.value)-Number(a.value)) || ((Number.isFinite(Number(b.ev))?Number(b.ev):-Infinity)-(Number.isFinite(Number(a.ev))?Number(a.ev):-Infinity))));
        setScanned(i+1);
      }
      setProgress("");
      if(!all.length) setError("No bookmaker prices were returned by the configured odds feed.");
    } catch(e){setError((e as Error).message);setProgress("");}
    finally{setBusy(false);}
  }
  async function scanFixture(f:any) {
    const key=fixtureKey(f);
    setScanningFixture(key); setSelectedFixture(key); setError(""); setRows([]); setDiagnostics([]);
    try {
      const d=await post("valueScan",{fixtures:[f]});
      const resultRows=Array.isArray(d?.rows)?d.rows:[];
      const resultDiagnostics=Array.isArray(d?.diagnostics)?d.diagnostics:[];
      setRows(resultRows.sort((a:any,b:any)=>(Number(b.value)-Number(a.value)) || ((Number.isFinite(Number(b.ev))?Number(b.ev):-Infinity)-(Number.isFinite(Number(a.ev))?Number(a.ev):-Infinity))));
      setDiagnostics(resultDiagnostics);
      setScanned(n=>n+1);
      if(!resultRows.length) setError("No bookmaker prices were matched for this fixture. Check its diagnostic below; other matches can still be scanned individually.");
    } catch(e) { setError((e as Error).message); }
    finally { setScanningFixture(""); }
  }
  async function scanAllFixtures(sourceFixtures: any[] = fixtures) {
    if (!sourceFixtures.length) { setError("Refresh matches first; no upcoming fixtures are loaded."); return; }
    setBusy(true); setError(""); setRows([]); setDiagnostics([]); setScanned(0); setSelectedFixture("");
    let allRows: any[] = [];
    let allDiagnostics: any[] = [];
    try {
      for (let i = 0; i < sourceFixtures.length; i++) {
        const fixture = sourceFixtures[i];
        setProgress( "Scanning " + (i + 1) + " of " + sourceFixtures.length + ": " + fixture.home.name + " vs " + fixture.away.name);
        try {
          const result = await post("valueScan", { fixtures: [fixture] });
          allRows = allRows.concat(Array.isArray(result?.rows) ? result.rows : []);
          allDiagnostics = allDiagnostics.concat(Array.isArray(result?.diagnostics) ? result.diagnostics : []);
          setRows([...allRows].sort((a:any,b:any)=>(Number(b.value)-Number(a.value)) || ((Number.isFinite(Number(b.ev))?Number(b.ev):-Infinity)-(Number.isFinite(Number(a.ev))?Number(a.ev):-Infinity))));
          setDiagnostics([...allDiagnostics]);
        } catch (e) {
          allDiagnostics.push({ fixture: fixture.home.name + " vs " + fixture.away.name, error: (e as Error).message });
          setDiagnostics([...allDiagnostics]);
        }
        setScanned(i + 1);
        // Ultra allows 40 requests/minute. Space fixture lookups to stay below the limit.
        if (i < sourceFixtures.length - 1) await new Promise(resolve => setTimeout(resolve, 1600));
      }
      if (!allRows.length) setError("The scan completed, but no bookmaker prices were matched. Review the provider diagnostics.");
    } finally {
      setProgress("");
      setBusy(false);
    }
  }
  useEffect(() => {
    // SPORT automatically discovers today's/tomorrow's fixtures on entry.
    if (endpoint === "/api/admin/sport" && !autoStarted.current) {
      autoStarted.current = true;
      void scan();
    }
  }, [endpoint]);
  useEffect(() => {
    // Once fixtures arrive, scan them automatically; no per-match Analyse clicks.
    if (endpoint === "/api/admin/sport" && fixtures.length && !autoScanStarted.current) {
      autoScanStarted.current = true;
      void scanAllFixtures(fixtures);
    }
  }, [endpoint, fixtures]);
  return <section className="card stack" style={{border:"2px solid var(--teal)"}}>
    <div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}>
       <div><b>📈 Value bets · today + tomorrow</b><small className="muted" style={{display:"block"}}>{endpoint === "/api/admin/super" ? "Uses SportMonks for fixtures and match statistics, and OddsPapi for bookmaker prices. Scans today's and tomorrow's fixtures and ranks model-supported positive expected value." : "Loads upcoming fixtures across all competitions covered by 5DollarFootballAPI Ultra, plus existing fixture feeds. Compare available bookmaker prices with SPORT model probabilities."}</small></div>
      <div className="row" style={{gap:8,flexWrap:"wrap"}}><button className="btn small" type="button" onClick={checkFeed} disabled={checkingFeed}>{checkingFeed?"Checking…":"Check odds feed"}</button><button className="btn small" type="button" onClick={scan} disabled={busy}>{busy?"Loading…":endpoint==="/api/admin/sport"?"Refresh matches":"Reload matches"}</button></div>
    </div>
    {progress && <small className="muted">{progress}</small>}
     {feedStatus && <div className="notice stack" style={{fontSize:13}}><b>{endpoint === "/api/admin/super" ? "SUPER odds-provider status" : "SPORT odds-provider status"}</b>{endpoint === "/api/admin/super" ? <><span>OddsPapi: {feedStatus.keyConfigured ? (feedStatus.active ? "active" : "no active bookmaker") : "key missing"}</span><span>Subscribed bookmakers: {(feedStatus.bookmakers || []).join(", ") || "none returned"}</span>{feedStatus.error && <small>{feedStatus.error}</small>}<small>Highlightly Premium supplies fixtures and match statistics; OddsPapi supplies bookmaker prices.</small></> : <><span>5DollarFootballAPI: {feedStatus.fivedollarfootball?.active ? "connected · " + String(feedStatus.fivedollarfootball.plan || "plan unknown") + " plan" : feedStatus.fivedollarfootball?.keyConfigured ? "key found but connection failed" : "API key missing"}</span>{feedStatus.fivedollarfootball?.active && <small>5Dollar usage today: {feedStatus.fivedollarfootball.requestsToday ?? "unknown"} · limit: {feedStatus.fivedollarfootball.rateLimit ?? "unknown"} per {feedStatus.fivedollarfootball.rateWindowSeconds ?? "unknown"} seconds</small>}{feedStatus.fivedollarfootball?.error && <small>5DollarFootballAPI: {feedStatus.fivedollarfootball.error}</small>}<span>OddsRelay: retained as a secondary odds source</span><small>SPORT combines returned 5DollarFootballAPI and OddsRelay prices, then keeps the best price per selection. The model only labels markets it can calculate.</small>{feedStatus.oddsrelay?.errors?.accountCoverage && <small>OddsRelay: {String(feedStatus.oddsrelay.errors.accountCoverage?.message || feedStatus.oddsrelay.errors.accountCoverage)}</small>}</>}</div>}
    {endpoint==="/api/admin/sport" && fixtures.length>0 && <small className="muted">Available fixtures across connected feeds: {fixtures.length} · Today: {dayCounts.today} · Tomorrow: {dayCounts.tomorrow}. Analyse one match or scan the full loaded board.</small>}{endpoint!=="/api/admin/sport" && scanned>0 && <small className="muted">Scanned {scanned} upcoming fixtures</small>}
    {endpoint==="/api/admin/sport" && fixtures.length>0 && <div className="notice" style={{fontSize:13}}>Loaded {fixtures.length} fixtures across {new Set(fixtures.map((f:any)=>String(f.competition?.name || f.competition || f.league?.name || "Other competitions"))).size} competitions. {busy ? "Autistik is checking bookmaker prices and calculating value automatically." : "Open a competition below to see its ranked analysis."}</div>}
    {endpoint==="/api/admin/sport" && scanned>0 && <small className="muted">Automatically analysed {scanned} of {fixtures.length} fixtures.</small>}
    {error && <div className="notice warn">{error}</div>}
    {diagnostics.length>0 && <div className="stack" style={{fontSize:13}}>
      <b>Odds feed diagnostics</b>
      {diagnostics.slice(0,6).map((d,i)=><small key={i} className="muted">{d.fixture}: {d.fixtureCount != null ? d.fixtureCount+" odds-enabled fixture candidates from "+d.source : d.oddsError || d.error || ((d.oddsEvents ?? d.eventsReturned ?? 0)+" events returned · "+(d.matchedEvents ?? d.matched ?? 0)+" matched · "+(d.bookmakers||[]).length+" bookmakers · markets: "+((d.markets||[]).join(", ")||"none"))}{d.analysisError ? " · model: "+d.analysisError : ""}{d.feedExamples?.length ? " · feed examples: "+d.feedExamples.join("; ") : ""}{d.providers?.theOddsApi ? " · The Odds API: "+(d.providers.theOddsApi.ok ? "OK ("+(d.providers.theOddsApi.matched ?? 0)+" matched)" : "ERROR "+(d.providers.theOddsApi.error || "")) : ""}{d.providers?.oddsrelay ? " · OddsRelay: "+(d.providers.oddsrelay.ok ? "OK ("+(d.providers.oddsrelay.matched ?? 0)+" matched)" : "ERROR "+(d.providers.oddsrelay.error || "")) : ""}{d.providers?.fivedollarfootball ? " · 5DollarFootballAPI: "+(d.providers.fivedollarfootball.ok ? "OK ("+(d.providers.fivedollarfootball.matched ?? 0)+" matched · "+(d.providers.fivedollarfootball.returnedBookmakers ?? (d.providers.fivedollarfootball.bookmakers || []).length)+" books · markets: "+((d.providers.fivedollarfootball.markets || []).join(", ") || "none")+")" : "ERROR "+(d.providers.fivedollarfootball.error || ""))+(d.providers.fivedollarfootball.emptyOddsReason ? " · "+d.providers.fivedollarfootball.emptyOddsReason : "")+(d.providers.fivedollarfootball.oddsRequestError ? " · "+d.providers.fivedollarfootball.oddsRequestError : "") : ""}</small>)}
    </div>}
    {rows.length>0 && (() => {
      const sortRows=(items:any[])=>[...items].sort((a,b)=>
        (Number(b.modelSupported)-Number(a.modelSupported)) ||
        ((Number.isFinite(Number(b.ev))?Number(b.ev):-Infinity)-(Number.isFinite(Number(a.ev))?Number(a.ev):-Infinity))
      );
      const ranked=sortRows(rows);
      const groups=Object.entries(ranked.reduce((acc:any,row:any)=>{
        const league=String(row.competition || "Other competitions");
        (acc[league] ||= []).push(row);
        return acc;
      },{} as Record<string,any[]>)).sort((a:any,b:any)=>a[0].localeCompare(b[0]));
      const topValue=ranked.filter((x:any)=>x.modelSupported && Number(x.ev)>0).slice(0,10);
      const topChance=sortRows(ranked.filter((x:any)=>x.modelSupported)).sort((a:any,b:any)=>Number(b.probability)-Number(a.probability)).slice(0,5);
      const card=(x:any,i:number,compact=false)=><div key={x.key} className="sb-top-r hi" style={{display:"grid",gap:6,padding:compact?10:12,minWidth:0,overflowWrap:"anywhere",borderLeft:x.modelSupported && x.ev>0?"4px solid var(--teal)":x.modelSupported && x.ev<0?"4px solid #d69b28":"4px solid var(--line)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><b>{x.home} vs {x.away}</b><small className="muted">{x.date?new Date(x.date).toLocaleString():"Kick-off unavailable"}</small></div>
        <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap",alignItems:"center"}}><b>{x.selection} · {x.market}</b><b style={{color:x.modelSupported?(x.ev>0?"var(--teal)":x.ev<0?"#b7791f":"var(--muted)"):"var(--muted)"}}>{!x.modelSupported?"ODDS ONLY":x.ev>0?"OVERPRICED ODDS · +"+x.ev.toFixed(1)+"% EV":x.ev<0?"UNDERPRICED ODDS · "+x.ev.toFixed(1)+"% EV":"FAIR PRICE"}</b></div>
        <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:13}}><span>Bookmaker <b>{x.odds.toFixed(2)}</b> · {x.bookmaker}</span><span>Autistik fair <b>{x.modelSupported?x.fairOdds.toFixed(2):"—"}</b></span><span>Probability <b>{x.modelSupported?x.probability.toFixed(1)+"%":"—"}</b></span><span>Market implied <b>{x.implied.toFixed(1)}%</b></span></div>
        <small className="muted">{x.modelSupported?(x.ev>0?"Bookmaker price is higher than Autistik's fair price — potential value.":x.ev<0?"Bookmaker price is lower than Autistik's fair price — avoid as a value bet.":"Bookmaker price is close to Autistik's fair price."):"Odds returned, but the fixture has no supported model probability. This is not ranked as value."}</small>
      </div>;
      return <div className="stack">
        <div className="stack"><b>Top value bets · all competitions</b>{topValue.length?topValue.map((x:any,i:number)=>card(x,i,true)):<small className="muted">No positive-EV selections with a supported model yet.</small>}</div>
        <div className="stack"><b>Highest model probabilities</b>{topChance.length?topChance.map((x:any,i:number)=>card(x,i,true)):<small className="muted">No model-supported selections yet.</small>}</div>
        <div className="stack"><b>Competitions · {groups.length}</b>{groups.map(([league,items]:any)=><details key={league} className="sb-top-r hi" style={{padding:12,borderRadius:12}}>
          <summary style={{cursor:"pointer",fontWeight:700,display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",alignItems:"center",gap:10,width:"100%"}}><span style={{minWidth:0,overflowWrap:"anywhere"}}>{league}</span><small className="muted" style={{whiteSpace:"nowrap",textAlign:"right"}}>{items.length} picks · {items.filter((x:any)=>x.modelSupported&&x.ev>0).length} value</small></summary>
          <div className="stack" style={{marginTop:12}}>
            <b>Best value · highest EV first</b>
            {sortRows(items.filter((x:any)=>x.modelSupported&&x.ev>0)).slice(0,10).map(card)}
            <b>All selections · best bookmaker price and EV first</b>
            {sortRows(items).map(card)}
          </div>
        </details>)}</div>
      </div>;
    })()}
     <small className="muted">{endpoint === "/api/admin/super" ? "Uses SportMonks match statistics and The Odds API bookmaker prices, removes duplicate selections, and keeps the best returned price. " : "Uses 5DollarFootballAPI Ultra bookmaker prices, removes duplicate selections, and keeps the best returned price. "}Value is labelled only where the board has a supported probability model; other returned markets are shown as odds-only, not falsely called value.</small>
  </section>;
}
