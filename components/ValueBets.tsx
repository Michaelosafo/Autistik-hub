"use client";
import { useEffect, useRef, useState } from "react";

type Props = { endpoint: "/api/admin/sport" | "/api/admin/super" };
type LeagueResult = { rows:any[]; diagnostics:any[]; scannedAt:string };
export default function ValueBets({ endpoint }: Props) {
  const [fixtures,setFixtures]=useState<any[]>([]);
  const [leagues,setLeagues]=useState<any[]>([]);
  const [selectedClubs,setSelectedClubs]=useState<any[]>([]);
  const [selectedLeagueId,setSelectedLeagueId]=useState<number|null>(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [progress,setProgress]=useState("");
  const [error,setError]=useState("");
  const [search,setSearch]=useState("");
  const [selectedLeague,setSelectedLeague]=useState("");
  const [results,setResults]=useState<Record<string,LeagueResult>>({});
  const [superRows,setSuperRows]=useState<any[]>([]);
  const [diagnostics,setDiagnostics]=useState<any[]>([]);
  const [feedStatus,setFeedStatus]=useState<any>(null);
  const [fixtureSource,setFixtureSource]=useState<any>(null);
  const [checkingFeed,setCheckingFeed]=useState(false);
  const started=useRef(false);

  async function post(action:string,body:any={}) {
    const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...body})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data.error) throw new Error(data.error || "Request failed (HTTP "+response.status+").");
    return data;
  }
  async function refreshFixtures() {
    setLoading(true);setError("");
    try {
      if(endpoint==="/api/admin/sport") {
        const data=await post("leagues");
        const list=Array.isArray(data.leagues)?data.leagues:[];
        setLeagues(list);
        if(!list.length)setError("football-data.org returned no competitions available on your current plan.");
      } else {
        const data=await post("todayMatches");
        const now=Date.now();
        const upcoming=(Array.isArray(data.matches)?data.matches:[])
          .filter((f:any)=>f?.home?.name&&f?.away?.name&&f?.date&&f.status!=="FINISHED"&&Date.parse(f.date)>=now)
          .sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
        setFixtures(upcoming);
      }
    } catch(e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  async function openLeague(league:any) {
    setSelectedLeagueId(Number(league.id));setFixtures([]);setSelectedClubs([]);setError("");setLoading(true);
    try {
      const seasons=Array.isArray(league.seasons)?league.seasons.map(Number).filter(Number.isFinite):[];
      const season=seasons.length?Math.max(...seasons):undefined;
      const data=await post("leagueFixtures",{leagueCode:String(league.code || ""),leagueName:String(league.name || "")});
      setFixtureSource({...data.providers,fixtureProvider:data.fixtureProvider,statisticsProvider:data.statisticsProvider});
      const now=Date.now();
      const upcoming=(Array.isArray(data.fixtures)?data.fixtures:[])
        .filter((f:any)=>f?.home?.name&&f?.away?.name&&f?.date&&Date.parse(f.date)>=now)
        .sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
      setFixtures(upcoming);
      setSelectedClubs(Array.isArray(data.clubs)?data.clubs:[]);
      if(!upcoming.length)setError("No upcoming fixtures found in "+league.name+" during the next 30 days. The league club list can still be viewed if standings are available.");
    } catch(e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  async function checkFeed() {
    setCheckingFeed(true);
    try { setFeedStatus(await post("oddsStatus")); }
    catch(e) { setFeedStatus({error:(e as Error).message}); }
    finally { setCheckingFeed(false); }
  }
  const fixtureKey=(f:any)=>String(f?.id || [f?.home?.name,f?.away?.name,f?.date].join("|"));
  const sortRows=(items:any[])=>[...items].sort((a:any,b:any)=>
    (Number(b.modelSupported)-Number(a.modelSupported)) ||
    ((Number.isFinite(Number(b.ev))?Number(b.ev):-Infinity)-(Number.isFinite(Number(a.ev))?Number(a.ev):-Infinity))
  );
  async function scanLeague(leagueKey:string,leagueName:string,leagueFixtures:any[]) {
    if(!leagueFixtures.length)return;
    setBusy(true);setError("");setProgress("");
    let allRows:any[]=[];let allDiagnostics:any[]=[];
    try {
      // Scan in small batches to respect football-data.org and bookmaker provider limits.
      for(let i=0;i<leagueFixtures.length;i+=2) {
        const batch=leagueFixtures.slice(i,i+2);
        setProgress("Scanning "+leagueName+" · "+Math.min(i+batch.length,leagueFixtures.length)+" of "+leagueFixtures.length+" fixtures");
        const data=await post("valueScan",{fixtures:batch});
        allRows=allRows.concat(Array.isArray(data.rows)?data.rows:[]);
        allDiagnostics=allDiagnostics.concat(Array.isArray(data.diagnostics)?data.diagnostics:[]);
        setResults(prev=>({...prev,[leagueKey]:{rows:sortRows(allRows),diagnostics:[...allDiagnostics],scannedAt:new Date().toISOString()}}));
        if(i+2<leagueFixtures.length)await new Promise(resolve=>setTimeout(resolve,1200));
      }
      if(!allRows.length)setError("No bookmaker prices were returned for "+leagueName+". Open scan diagnostics to see why.");
    } catch(e) { setError((e as Error).message); }
    finally { setProgress("");setBusy(false); }
  }
  async function scanSuper() {
    setBusy(true);setError("");let all:any[]=[];
    try {
      for(let i=0;i<fixtures.length;i++) {
        const f=fixtures[i];setProgress("Scanning "+(i+1)+" of "+fixtures.length+" · "+f.home.name+" vs "+f.away.name);
        const data=await post("valueScan",{fixtures:[f]});
        all=all.concat(Array.isArray(data.rows)?data.rows:[]);
        setSuperRows(sortRows(all));
        setDiagnostics(prev=>prev.concat(Array.isArray(data.diagnostics)?data.diagnostics:[]));
      }
    } catch(e) { setError((e as Error).message); }
    finally {setProgress("");setBusy(false);}
  }
  useEffect(()=>{if(!started.current){started.current=true;void refreshFixtures();}},[endpoint]);

  const countries=Object.entries(leagues.reduce((acc:any,league:any)=>{
    const country=String(league.country||"International");
    (acc[country] ||= []).push(league);return acc;
  },{} as Record<string,any[]>)).sort((a:any,b:any)=>a[0].localeCompare(b[0]));
  const filteredCountries=countries.map(([country,list]:any)=>[country,list.filter((league:any)=>
    String(league.name).toLowerCase().includes(search.toLowerCase()) ||
    String(league.country).toLowerCase().includes(search.toLowerCase())
  )]).filter(([,list]:any)=>list.length);

  function SelectionCard({row,index}:{row:any;index:number}) {
    const supported=!!row.modelSupported;
    const ev=Number(row.ev);
    return <div key={row.key||index} className="sb-top-r hi" style={{display:"grid",gap:7,padding:12,minWidth:0,overflowWrap:"anywhere",borderLeft:supported&&ev>0?"4px solid var(--teal)":supported&&ev<0?"4px solid #d69b28":"4px solid var(--line)"}}>
      <b>{index+1}. {row.home} vs {row.away}</b>
      <div><b>{row.selection}</b> · {row.market}</div>
      {row.modelProvider&&<small className="muted">Model: {row.modelProvider}</small>}
      <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:13}}>
        <span>Bookmaker <b>{Number(row.odds).toFixed(2)}</b> · {row.bookmaker}</span>
        <span>Fair odds <b>{supported?Number(row.fairOdds).toFixed(2):"—"}</b></span>
        <span>Model probability <b>{supported?Number(row.probability).toFixed(1)+"%":"—"}</b></span>
      </div>
      <b>{!supported?"ODDS ONLY · NOT MODELLED":ev>0?"OVERPRICED · +"+ev.toFixed(1)+"% EV":ev<0?"UNDERPRICED · "+ev.toFixed(1)+"% EV":"FAIR PRICE"}</b>
      {row.modelContext&&<details><summary>Autistik analysis · team form and goal data</summary><div className="stack" style={{fontSize:13,marginTop:8}}>
        <span>{row.home}: last form <b>{row.modelContext.homeForm||"Not available"}</b> · goals scored/game <b>{row.modelContext.homeGoalsFor??"—"}</b> · conceded/game <b>{row.modelContext.homeGoalsAgainst??"—"}</b></span>
        <span>{row.away}: last form <b>{row.modelContext.awayForm||"Not available"}</b> · goals scored/game <b>{row.modelContext.awayGoalsFor??"—"}</b> · conceded/game <b>{row.modelContext.awayGoalsAgainst??"—"}</b></span>
        {row.modelContext.expectedGoals&&<span>Expected goals: home <b>{row.modelContext.expectedGoals.home}</b> · away <b>{row.modelContext.expectedGoals.away}</b></span>}
        {(row.modelContext.verdict||[]).map((v:string,i:number)=><small key={i}>{v}</small>)}
      </div></details>}
    </div>;
  }

  return <section className="card stack" style={{border:"2px solid var(--teal)"}}>
    <div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}>
      <div><b>📈 {endpoint==="/api/admin/sport"?"SPORT · League scanner":"SUPER · Value scanner"}</b>
        <small className="muted" style={{display:"block"}}>{endpoint==="/api/admin/sport"?"Choose a competition, scan it, review ranked value bets, then close it and move to the next. football-data.org supplies fixtures and team statistics; 5DollarFootballAPI Ultra and OddsRelay supply prices.":"SportMonks fixtures and statistics with OddsPapi bookmaker prices."}</small>
      </div>
      <div className="row" style={{gap:8,flexWrap:"wrap"}}>
        <button className="btn small" type="button" onClick={checkFeed} disabled={checkingFeed}>{checkingFeed?"Checking…":"Check odds feed"}</button>
        <button className="btn small" type="button" onClick={refreshFixtures} disabled={loading||busy}>{loading?"Loading…":"Refresh leagues"}</button>
      </div>
    </div>
    {feedStatus && <div className="notice stack" style={{fontSize:13}}>
      <b>{endpoint==="/api/admin/sport"?"SPORT provider status":"SUPER provider status"}</b>
      {endpoint==="/api/admin/sport"?<>
        <span>SportMonks fixtures: {feedStatus.sportmonks?.active?"Connected":"Not connected"}</span>
        <span>football-data.org analysis: {feedStatus.footballData?.active?"Connected":"Not connected"}</span>
        <span>5DollarFootballAPI odds: {feedStatus.fivedollarfootball?.active?"Connected · "+String(feedStatus.fivedollarfootball.plan||"plan unknown"):"Not connected"}</span>
        <span>OddsRelay: {feedStatus.oddsrelay?.active?"Connected":"Not active / unavailable"}</span>
        <small>football-data.org supplies fixtures and historical team statistics.</small>
      </>:<span>OddsPapi: {feedStatus.active?"Connected":"Check provider configuration"}</span>}
      {feedStatus.error&&<small>{feedStatus.error}</small>}
    </div>}
    {error&&<div className="notice warn">{error}</div>}
    {loading&&<small className="muted">Loading competition and fixture list…</small>}
    {fixtureSource&&endpoint==="/api/admin/sport"&&<small className="muted">Fixture feed: {fixtureSource.fixtureProvider||"Provider not reported"} · analysis: football-data.org (SportMonks fallback) · prices: 5DollarFootballAPI Ultra + OddsRelay</small>}
    {progress&&<small className="muted">{progress}</small>}

    {endpoint==="/api/admin/sport" && <>
      <div className="row" style={{justifyContent:"space-between",flexWrap:"wrap"}}><b>Choose country, then league</b><small className="muted">{leagues.length} competitions · {countries.length} countries</small></div>
      <input className="input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search country or league (e.g. Europa League)…" />
      <div className="stack" style={{gap:8}}>
        {filteredCountries.map(([country,list]:any)=><details key={country} className="sb-country-card" style={{display:"block",width:"100%",minWidth:0,padding:11,borderRadius:12,background:"var(--surface-2)",borderLeft:"4px solid var(--teal)",boxSizing:"border-box"}}>
          <summary style={{cursor:"pointer",display:"flex",width:"100%",minWidth:0,justifyContent:"space-between",alignItems:"center",gap:12,fontWeight:700,listStyle:"none"}}><span style={{display:"block",flex:"1 1 auto",minWidth:0,whiteSpace:"normal",overflowWrap:"break-word"}}>{country}</span><small className="muted" style={{flex:"0 0 auto",whiteSpace:"nowrap"}}>{list.length} {list.length===1?"league":"leagues"}</small></summary>
          <div className="stack" style={{marginTop:10,gap:7}}>
            {list.map((league:any)=><button key={league.id} type="button" className={selectedLeagueId===league.id?"btn primary":"btn"} onClick={()=>void openLeague(league)} style={{width:"100%",textAlign:"left",whiteSpace:"normal",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <span style={{minWidth:0,overflowWrap:"anywhere"}}>{league.name}</span><span style={{whiteSpace:"nowrap",fontSize:12}}>Open ›</span>
            </button>)}
          </div>
        </details>)}
        {!filteredCountries.length&&<small className="muted">No countries or leagues match that search.</small>}
      </div>
      {selectedLeagueId!==null&&(()=>{
        const league=leagues.find((x:any)=>Number(x.id)===selectedLeagueId);
        const leagueKey=String(selectedLeagueId);
        const saved=results[leagueKey];
        const allRows=saved?.rows||[];
        const positive=sortRows(allRows.filter((r:any)=>r.modelSupported&&Number(r.ev)>0));
        const probabilityRank=[...allRows].filter((r:any)=>r.modelSupported).sort((a:any,b:any)=>Number(b.probability)-Number(a.probability));
        const clubs=selectedClubs.map((club:any)=>String(club.name||"")).filter(Boolean).sort();
        return <div className="card stack" style={{padding:14}}>
          <div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}><div><b>{league?.country} · {league?.name}</b><small className="muted" style={{display:"block"}}>Next 30 days · {fixtures.length} fixtures</small></div><button className="btn small" type="button" onClick={()=>{setSelectedLeagueId(null);setFixtures([]);setError("");}}>Close league</button></div>
          {loading?<small className="muted">Loading clubs and fixtures…</small>:<>
            <b>Clubs in this league · {clubs.length}</b><small className="muted">{clubs.join(" · ")||"No club list was returned by football-data.org for this competition."}</small>
            {fixtures.length>0&&<div className="stack" style={{gap:6}}><b>Upcoming fixtures</b>{fixtures.map((f:any)=><div key={fixtureKey(f)} className="sb-top-r hi" style={{padding:9,display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><b>{f.home.name} vs {f.away.name}</b><small className="muted">{new Date(f.date).toLocaleString()}</small></div>)}</div>}
            <button className="btn primary" type="button" disabled={busy||!fixtures.length} onClick={()=>void scanLeague(leagueKey,String(league?.name||"Selected league"),fixtures)}>{busy?"Scanning…":"Scan this league · "+fixtures.length+" fixtures"}</button>
          </>}
          {progress&&<small className="muted">{progress}</small>}
          {saved&&<div className="notice" style={{fontSize:13}}>Last scan: {new Date(saved.scannedAt).toLocaleString()} · {allRows.length} selections · {positive.length} positive-EV value bets.</div>}
          {saved&&<>
            <b>Top value bets · highest EV first</b>
            {positive.length?positive.slice(0,20).map((r:any,i:number)=><SelectionCard key={r.key||i} row={r} index={i}/>):<small className="muted">No positive-EV selections with supported model probabilities. See all prices below; unsupported markets are not labelled as value.</small>}
            <b>Highest model probabilities</b>
            {probabilityRank.slice(0,10).map((r:any,i:number)=><SelectionCard key={"prob-"+(r.key||i)} row={r} index={i}/>)}
            <b>All bookmaker selections · best prices</b>
            {sortRows(allRows).map((r:any,i:number)=><SelectionCard key={"all-"+(r.key||i)} row={r} index={i}/>)}
            {saved.diagnostics.length>0&&<details><summary>Scan diagnostics ({saved.diagnostics.length})</summary><div className="stack">{saved.diagnostics.map((d:any,i:number)=><small key={i} className="muted">{d.fixture}: {d.analysisError||d.error||"Odds lookup completed"} · markets: {(d.markets||[]).join(", ")||"none"}</small>)}</div></details>}
          </>}
        </div>;
      })()}
    </>}
    {endpoint==="/api/admin/super"&&<>
      <small className="muted">{fixtures.length} upcoming fixtures loaded.</small>
      <button className="btn primary" type="button" disabled={busy||!fixtures.length} onClick={()=>void scanSuper()}>{busy?"Scanning…":"Scan all fixtures"}</button>
      {superRows.length>0&&<div className="stack"><b>Ranked selections</b>{sortRows(superRows).map((r:any,i:number)=><SelectionCard key={r.key||i} row={r} index={i}/>)}</div>}
      {diagnostics.length>0&&<details><summary>Scan diagnostics ({diagnostics.length})</summary>{diagnostics.map((d:any,i:number)=><small key={i} className="muted">{d.fixture}: {d.analysisError||d.error||"Completed"}</small>)}</details>}
    </>}
    <small className="muted">{endpoint==="/api/admin/sport"?"Model probabilities are calculated from football-data.org recent form and season statistics. A selection is called value only when its model probability is available and expected value is positive.":"SUPER uses its own fixtures, model and odds providers."}</small>
  </section>;
}
