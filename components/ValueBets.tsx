"use client";
import { useEffect, useRef, useState } from "react";
import DailyValueBets from "@/components/DailyValueBets";

type Props = { endpoint: "/api/admin/sport" | "/api/admin/super" };
type LeagueResult = { rows:any[]; diagnostics:any[]; scannedAt:string };
const TOP_COMPETITION = /(?:champions league|europa league|conference league|premier league|la liga|serie a|bundesliga|ligue 1|eredivisie|primeira liga)/i;

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
  const [superPerformance,setSuperPerformance]=useState<any[]>([]);
  const [selectedDisagreementBand,setSelectedDisagreementBand]=useState("all");
  const ghanaDate=(value:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Accra",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);
  const [superScanDate,setSuperScanDate]=useState(ghanaDate(new Date()));
  const [activeSession,setActiveSession]=useState<"scanner"|"top25"|"expectedValue">("scanner");
  const [performanceLoading,setPerformanceLoading]=useState(false);
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
      const [data,matchData]=await Promise.all([post("leagues"),post("todayMatches")]);
      const list=(Array.isArray(data.leagues)?data.leagues:[]).filter((league:any)=>TOP_COMPETITION.test(String(league.name||"")));
      const now=Date.now();
      const seen=new Set<string>();
      const upcoming=(Array.isArray(matchData.matches)?matchData.matches:[])
        .filter((fixture:any)=>{
          const kickoff=Date.parse(String(fixture?.date||""));
          const status=String(fixture?.status||"").toUpperCase();
          const key=String(fixture?.id||[fixture?.home?.name,fixture?.away?.name,fixture?.date].join("|"));
          if(!fixture?.home?.name||!fixture?.away?.name||!Number.isFinite(kickoff)||kickoff<now||
            (status && !["SCHEDULED","TIMED"].includes(status))||!TOP_COMPETITION.test(String(fixture.competition||""))||seen.has(key)) return false;
          seen.add(key); return true;
        })
        .sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
      setLeagues(list);
      // SUPER is a same-day board in Ghana time: keep every eligible
      // upcoming fixture from the subscribed top competitions, not just 20.
      const todayAccra=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Accra",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
      const todayOnly=upcoming.filter((fixture:any)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Accra",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(fixture.date))===todayAccra);
      setFixtures(todayOnly);
      if(!list.length)setError("football-data.org returned no subscribed top competitions. Check FOOTBALL_DATA_TOKEN and your plan coverage.");
      return todayOnly;
    } catch(e) { setError((e as Error).message); return []; }
    finally { setLoading(false); }
  }
  async function openLeague(league:any) {
    setSelectedLeagueId(Number(league.id));setFixtures([]);setSelectedClubs([]);setError("");setLoading(true);
    try {
      const leagueCode=String(league.code || "").toUpperCase();
      const leagueName=String(league.name || "");
      const isEuropaOrConference=leagueCode==="EL"||leagueCode==="ECL"||/europa league|conference league/i.test(leagueName);
      const data=await post("leagueFixtures",{leagueId:Number(league.id),season:Number(league.season),leagueCode,leagueName});
      setFixtureSource({...data.providers,fixtureProvider:data.fixtureProvider,statisticsProvider:data.statisticsProvider});
      const now=Date.now();
      const upcoming=(Array.isArray(data.fixtures)?data.fixtures:[])
        .filter((f:any)=>f?.home?.name&&f?.away?.name&&f?.date&&Date.parse(f.date)>=now)
        .sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
      setFixtures(upcoming);
      setSelectedClubs(Array.isArray(data.clubs)?data.clubs:[]);
      if(!upcoming.length)setError(isEuropaOrConference
        ? "No upcoming "+leagueName+" fixtures found in the next 30 days."
        : "No upcoming fixtures found in "+leagueName+" during the next 30 days. The league club list can still be viewed if standings are available.");
      // Europa League and Conference League open directly on today's full fixture list
      // and automatically calculate the available model-vs-bookmaker value selections.
      if(isEuropaOrConference&&upcoming.length){
        setProgress("Loading today's "+leagueName+" fixtures and calculating value…");
        setLoading(false);
        await scanLeague(String(league.id),leagueName,upcoming);
      }
    } catch(e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  async function checkFeed() {
    setCheckingFeed(true);
    try { setFeedStatus(await post("oddsStatus")); }
    catch(e) { setFeedStatus({error:(e as Error).message}); }
    finally { setCheckingFeed(false); }
  }
  async function refreshSuperPerformance() {
    setPerformanceLoading(true);
    try { const data=await post("superPerformance"); setSuperPerformance(Array.isArray(data.performance)?data.performance:[]); }
    catch(e) { setError((e as Error).message); }
    finally { setPerformanceLoading(false); }
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
      // Scan in small batches to respect API-Football and 5DollarFootballAPI limits.
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
  async function scanSuper(sourceFixtures:any[]=fixtures, scanDate:string=ghanaDate(new Date()), replaceResults=false) {
    setBusy(true);setError("");setProgress("");
    // Preserve the visible board while refreshing so it never flashes empty.
    let all:any[]=replaceResults?[]:[...superRows.filter((row:any)=>Date.parse(String(row?.date||""))>Date.now() && ghanaDate(new Date(row.date))===scanDate)];
    if(replaceResults){setSuperRows([]);setDiagnostics([]);}
    try {
      const now=Date.now();
      const eligible=sourceFixtures.filter((f:any)=>{
        const kickoff=Date.parse(String(f?.date||""));
        const status=String(f?.status||"").toUpperCase();
        const matchDay=Number.isFinite(kickoff)?new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Accra",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(kickoff)):"";
        return Number.isFinite(kickoff)&&kickoff>=now&&matchDay===scanDate&&f?.home?.name&&f?.away?.name&&
          (!status||["SCHEDULED","TIMED"].includes(status));
      });
      const unique=[...new Map(eligible.map((f:any)=>[String(f.id||[f.home.name,f.away.name,f.date].join("|")),f])).values()];
      if(!unique.length){if(!all.length)setError("No upcoming top-competition fixtures remain for today in Ghana time.");return;}
      // Small two-fixture server batches stay comfortably inside Vercel's
      // request window while sharing the odds-provider fixture catalogue cache.
      for(let i=0;i<unique.length;i+=2) {
        const batch=unique.slice(i,i+2);
        setProgress("Analysing today's matches · "+Math.min(i+batch.length,unique.length)+" of "+unique.length+" fixtures");
        const data=await post("valueScan",{fixtures:batch});
        const incoming=Array.isArray(data.rows)?data.rows:[];
        const merged=new Map<string,any>();
        for(const row of [...all,...incoming]) merged.set(String(row.key||[row.home,row.away,row.selection,row.bookmaker].join("|")),row);
        all=sortRows([...merged.values()]);
        // Merge into the latest React state too, so four-hour refreshes keep
        // successful earlier picks even when a later odds request is empty.
        setSuperRows(prev=>{
          const current=new Map<string,any>();
          for(const row of [...prev,...incoming]) current.set(String(row.key||[row.home,row.away,row.selection,row.bookmaker].join("|")),row);
          return sortRows([...current.values()]);
        });
        if(Array.isArray(data.diagnostics)&&data.diagnostics.length)setDiagnostics(prev=>[...prev,...data.diagnostics].slice(-200));
        if(Array.isArray(data.performance))setSuperPerformance(data.performance);
        if(i+2<unique.length) await new Promise(resolve=>setTimeout(resolve,900));
      }
      if(!all.length)setError("Today's fixtures were checked, but no supported bookmaker selections were returned. Open Scan diagnostics for provider details.");
    } catch(e) { setError((e as Error).message); }
    finally {setProgress("");setBusy(false);}
  }
  useEffect(()=>{
    if(endpoint==="/api/admin/sport"||started.current)return;
    started.current=true;
    let active=true;
    const refreshAndScan=async()=>{
      const fresh=await refreshFixtures();
      if(!active)return;
      if(fresh.length) await scanSuper(fresh);
      else { setSuperRows([]); setDiagnostics([]); }
    };
    void refreshAndScan();
    // Refresh the live fixture/odds board every four hours in the app.
    // This is client-side polling, not a system cron or server scheduler.
    const interval=window.setInterval(()=>{void refreshAndScan();},4*60*60*1000);
    // Do not rescan on every tab focus: that used to clear/rebuild the board
    // repeatedly and made the results appear to blink or disappear.
    return ()=>{active=false;window.clearInterval(interval);};
  },[endpoint]);
  useEffect(()=>{
    // Hide a fixture as soon as its scheduled kickoff time is reached,
    // even between the four-hour feed refreshes.
    const timer=window.setInterval(()=>{
      const now=Date.now();
      setFixtures(prev=>prev.filter((f:any)=>Date.parse(String(f?.date||""))>now));
      setSuperRows(prev=>prev.filter((row:any)=>Date.parse(String(row?.date||""))>now));
    },30_000);
    return ()=>window.clearInterval(timer);
  },[]);
  if(endpoint==="/api/admin/sport") return <DailyValueBets />;

  const countries=Object.entries(leagues.reduce((acc:any,league:any)=>{
    const country=String(league.country||"International");
    (acc[country] ||= []).push(league);return acc;
  },{} as Record<string,any[]>)).sort((a:any,b:any)=>a[0].localeCompare(b[0]));
  const filteredCountries=countries.map(([country,list]:any)=>[country,list.filter((league:any)=>
    String(league.name).toLowerCase().includes(search.toLowerCase()) ||
    String(league.country).toLowerCase().includes(search.toLowerCase())
  )]).filter(([,list]:any)=>list.length);
  const superSupported=superRows.filter((r:any)=>r.modelSupported&&Number.isFinite(Number(r.probability)));
  const superValueRows=superSupported.filter((r:any)=>Number(r.ev)>0).sort((a:any,b:any)=>Number(b.ev)-Number(a.ev));
  const superOverpricedRows=superSupported.filter((r:any)=>Number(r.ev)<0).sort((a:any,b:any)=>Number(a.ev)-Number(b.ev));
  const superProbabilityRows=[...superSupported].sort((a:any,b:any)=>Number(b.probability)-Number(a.probability));
  const sportScannedRows=Object.values(results).flatMap((saved:any)=>Array.isArray(saved?.rows)?saved.rows:[]);
  const top25SourceRows=endpoint==="/api/admin/super"?superRows:sportScannedRows;
  function buildTop25(rows:any[]) {
    const eligible=rows.filter((r:any)=>{
      if(!r?.modelSupported||!Number.isFinite(Number(r.probability))||!r.home||!r.away) return false;
      const market=String(r.market||"").toLowerCase();
      const selection=String(r.selection||"").toLowerCase();
      if(/draw|double chance|both teams|btts|yes\/no|correct score|corners|cards/.test(market+" "+selection)) return false;
      return /straight win|h2h|moneyline|asian handicap|over\/under|goals|totals/.test(market);
    });
    // Compare probability, expected value and odds edge by their relative ranks.
    const rankMap=new Map<string,number>();
    const metrics=[(r:any)=>Number(r.probability),(r:any)=>Number.isFinite(Number(r.ev))?Number(r.ev):-Infinity,(r:any)=>Number.isFinite(Number(r.edge))?Number(r.edge):-Infinity];
    for(const metric of metrics) [...eligible].sort((a:any,b:any)=>metric(b)-metric(a)).forEach((r:any,i:number)=>rankMap.set(String(r.key||[r.home,r.away,r.selection,r.bookmaker].join("|")),(rankMap.get(String(r.key||[r.home,r.away,r.selection,r.bookmaker].join("|")))||0)+i));
    const ranked=[...eligible].sort((a:any,b:any)=>{
      const ak=String(a.key||[a.home,a.away,a.selection,a.bookmaker].join("|"));
      const bk=String(b.key||[b.home,b.away,b.selection,b.bookmaker].join("|"));
      return (rankMap.get(ak)||0)-(rankMap.get(bk)||0)||Number(b.probability)-Number(a.probability)||Number(b.ev)-Number(a.ev);
    });
    const usedTeams=new Set<string>(),usedSelections=new Set<string>(),picked:any[]=[];
    for(const row of ranked){
      const home=String(row.home).trim().toLowerCase(),away=String(row.away).trim().toLowerCase();
      const selectionKey=[home,away,String(row.selection).toLowerCase(),String(row.market).toLowerCase()].join("|");
      if(!home||!away||usedTeams.has(home)||usedTeams.has(away)||usedSelections.has(selectionKey))continue;
      picked.push(row);usedTeams.add(home);usedTeams.add(away);usedSelections.add(selectionKey);
      if(picked.length===25)break;
    }
    return picked;
  }
  const top25Rows=buildTop25(top25SourceRows);
  // Dedicated positive expected-value board, using only this section's own scan data.
  const expectedValueRows=top25SourceRows
    .filter((row:any)=>row?.modelSupported&&Number.isFinite(Number(row.probability))&&Number(row.ev)>0&&Number(row.odds)>1)
    .sort((a:any,b:any)=>Number(b.ev)-Number(a.ev));


  // Build one counter-market group per fixture. Multiple bookmaker/market
  // rows can point to the same model counter-selection, so retain the
  // strongest disagreement for each distinct counter outcome.
  const counterGroups=new Map<string,{home:string;away:string;date:string;items:any[]}>();
  for(const row of superSupported) {
    const analysis=row.counterMarketAnalysis;
    if(!analysis||!analysis.counterSelection||
      !(Number(analysis.counterProbability)>0)||!Number.isFinite(Number(analysis.gapPoints))) continue;
    const fixtureKey=[row.home,row.away,String(row.date||"").slice(0,16)].join("|");
    const group=counterGroups.get(fixtureKey)||{home:String(row.home||""),away:String(row.away||""),date:String(row.date||""),items:[]};
    const item={selection:String(analysis.counterSelection),probability:Number(analysis.counterProbability),
      fairOdds:Number(analysis.counterFairOdds),gapPoints:Number(analysis.gapPoints),
      sourceSelection:String(row.selection||""),bookmaker:String(row.bookmaker||"Bookmaker"),
      bookmakerOdds:Number(row.odds),market:String(row.market||"")};
    const previous=group.items.find((x:any)=>x.selection===item.selection);
    if(!previous)group.items.push(item);
    else if(item.gapPoints>previous.gapPoints)group.items[group.items.indexOf(previous)]=item;
    counterGroups.set(fixtureKey,group);
  }
  const multiCounterGroups=[...counterGroups.entries()]
    .map(([key,group])=>({key,...group,items:group.items.sort((a:any,b:any)=>b.gapPoints-a.gapPoints)}))
    .map((group:any)=>({...group,maxGap:Number(group.items[0]?.gapPoints||0)}));
  const disagreementSections=[
    {key:"under20",title:"Disagreement below 20%",description:"Smaller price disagreements · under 20 percentage points",min:0,max:20},
    {key:"20to30",title:"Disagreement 20%–29.9%",description:"Moderate price disagreements · 20 to under 30 percentage points",min:20,max:30},
    {key:"30to40",title:"Disagreement 30%–39.9%",description:"Strong price disagreements · 30 to under 40 percentage points",min:30,max:40},
    {key:"40plus",title:"Disagreement 40% and above",description:"Largest price disagreements · 40 percentage points or more",min:40,max:Infinity}
  ].map((section:any)=>({
    ...section,
    // Show only the single strongest counter-outcome per fixture.
    // Choose the highest disagreement first, then place that one selection
    // into its matching disagreement band. Never show weaker alternatives.
    groups:multiCounterGroups.map((group:any)=>{
      const best=group.items[0];
      if(!best||best.gapPoints<section.min||best.gapPoints>=section.max)return null;
      return {...group,items:[best],maxGap:Number(best.gapPoints||0)};
    }).filter(Boolean).sort((a:any,b:any)=>b.maxGap-a.maxGap)
  }));
  const groupedCounterFixtureKeys=new Set(multiCounterGroups.map((group:any)=>group.key));
  const primaryValueRows=superValueRows.filter((row:any)=>!groupedCounterFixtureKeys.has([row.home,row.away,String(row.date||"").slice(0,16)].join("|")));
  const oddsBand=(odds:number)=>odds<1.5?"1.01–1.49":odds<2?"1.50–1.99":odds<2.5?"2.00–2.49":odds<3.5?"2.50–3.49":"3.50+";

  function CounterMatchCard({group,index}:{group:any;index:number}) {
    return <div className="stack" style={{gap:7,minWidth:0}}>
      <div className="stack" style={{gap:2,padding:"2px 2px 5px"}}>
        <b style={{fontSize:15}}>{group.home} vs {group.away}</b>
        {group.date&&<small className="muted">{new Date(group.date).toLocaleString()}</small>}
      </div>
      {group.items.map((item:any,i:number)=><div key={item.selection} className="notice stack" style={{fontSize:13,gap:4,padding:"9px 11px",borderLeft:"3px solid var(--warning, #d69b28)"}}>
        <b>Possible counter-outcome: {item.selection}</b>
        <span>Counter-outcome rank: <b>{i+1}</b> · disagreement: <b>{item.gapPoints.toFixed(1)} percentage points</b></span>
        <span>Autistik estimated chance of {item.selection}: <b>{item.probability.toFixed(1)}%</b> · fair odds: <b>{Number.isFinite(item.fairOdds)?item.fairOdds.toFixed(2):"—"}</b></span>
        <small className="muted">Signal from {item.sourceSelection} · {item.market} · {item.bookmaker} (odds {Number.isFinite(item.bookmakerOdds)?item.bookmakerOdds.toFixed(2):"—"})</small>
      </div>)}
    </div>;
  }

  function SelectionCard({row,index}:{row:any;index:number}) {
    const supported=!!row.modelSupported;
    const ev=Number(row.ev);
    const historyGroup=String(row.market||"Other")+" · "+String(row.bookmaker||"Bookmaker")+" · "+oddsBand(Number(row.odds));
    const historical=superPerformance.find((p:any)=>p.group===historyGroup);
    const breakEven=Number(row.odds)>1?100/Number(row.odds):null;
    const winChance=supported?Math.max(0,Math.min(100,Number(row.probability))):null;
    const loseChance=supported?100-winChance:null;
    const isStraightWin=/straight win/i.test(String(row.market||""));
    const outcomeNoun=isStraightWin?"chance "+String(row.selection||"this team")+" wins":"chance "+String(row.selection||"this selection")+" lands";
    const priceVerdict=supported&&Number(row.odds)>Number(row.fairOdds)
      ?"The bookmaker is offering a bigger price than Autistik's fair odds. This outcome is priced generously."
      :supported&&Number(row.odds)<Number(row.fairOdds)
      ?"The bookmaker is offering a shorter price than Autistik's fair odds. This outcome is priced too short."
      :"The bookmaker price is equal to Autistik's fair odds.";
    return <div key={row.key||index} className="sb-top-r hi" style={{display:"grid",gridTemplateColumns:"minmax(0,1fr)",width:"100%",boxSizing:"border-box",alignItems:"start",gap:9,padding:12,minWidth:0,overflowWrap:"break-word",borderLeft:supported&&ev>0?"4px solid var(--teal)":supported&&ev<0?"4px solid #d69b28":"4px solid var(--line)"}}>
      <b style={{display:"block",minWidth:0,overflowWrap:"break-word",wordBreak:"normal"}}>{index+1}. {row.home} vs {row.away}</b>
      <div style={{minWidth:0,overflowWrap:"break-word"}}><b>{row.selection}</b> · {row.market}</div>
      {row.modelProvider&&<small className="muted">Model: {row.modelProvider}</small>}
      <div style={{display:"flex",minWidth:0,gap:12,flexWrap:"wrap",fontSize:13}}>
        <span style={{minWidth:0,overflowWrap:"break-word"}}>Bookmaker <b>{Number(row.odds).toFixed(2)}</b> · {row.bookmaker}</span>
        <span>Autistik fair odds <b>{supported?Number(row.fairOdds).toFixed(2):"—"}</b></span>
        <span>Autistik estimated chance <b>{supported?Number(row.probability).toFixed(1)+"%":"—"}</b></span><span>Opening odds <b>{row.openingOdds?Number(row.openingOdds).toFixed(2):"—"}</b></span><span>Latest odds <b>{row.closingOdds?Number(row.closingOdds).toFixed(2):Number(row.odds).toFixed(2)}</b></span>
      </div>
      <b style={{minWidth:0,overflowWrap:"break-word",color:!supported?"var(--muted)":ev>0?"var(--success, #16834a)":ev<0?"var(--danger, #b42318)":"inherit"}}>{!supported?"MODEL UNAVAILABLE · NOT A VALUE PICK":ev>0?"BOOKMAKER ODDS OVERPRICED VS AUTISTIK · VALUE +"+ev.toFixed(1)+"% EV":ev<0?"BOOKMAKER ODDS UNDERPRICED VS AUTISTIK · AVOID ("+Math.abs(ev).toFixed(1)+"% NEGATIVE EV)":"FAIR PRICE · MATCHES AUTISTIK"}</b>
      {supported&&<div className="notice stack" style={{fontSize:13}}>
        <b>Autistik outcome estimate</b>
        <span>{outcomeNoun}: <b style={{color:"var(--success, #16834a)"}}>{winChance!.toFixed(1)}%</b></span>
        <span>{isStraightWin?"Chance this team does not win (draw or opponent wins)":"Chance this selection loses"}: <b style={{color:"var(--danger, #b42318)"}}>{loseChance!.toFixed(1)}%</b></span>
        <span>Autistik fair odds: <b>{Number(row.fairOdds).toFixed(2)}</b> · bookmaker odds: <b>{Number(row.odds).toFixed(2)}</b></span>
        <span>Bookmaker break-even chance: <b>{breakEven?.toFixed(1)}%</b></span>
        <span>{priceVerdict}</span>
        <b>{Number(row.odds)>Number(row.fairOdds)?"VALUE SIGNAL: bookmaker price is above Autistik fair odds.":Number(row.odds)<Number(row.fairOdds)?"AVOID SIGNAL: bookmaker price is below Autistik fair odds.":"FAIR PRICE: bookmaker and Autistik prices match."}</b>
      </div>}
      {supported&&row.counterMarketAnalysis?.counterSelection&&row.counterMarketAnalysis?.counterProbability!=null&&<div className="notice stack" style={{fontSize:13,gap:4,padding:"9px 11px",borderLeft:"3px solid var(--warning, #d69b28)"}}>
        <b>Possible counter-outcome: {row.counterMarketAnalysis.counterSelection}</b>
        <span>Counter-outcome rank: <b>1</b> · disagreement: <b>{Number(row.counterMarketAnalysis.gapPoints).toFixed(1)} percentage points</b></span>
        <span>Autistik estimated chance of {row.counterMarketAnalysis.counterSelection}: <b>{Number(row.counterMarketAnalysis.counterProbability).toFixed(1)}%</b> · fair odds: <b>{Number(row.counterMarketAnalysis.counterFairOdds).toFixed(2)}</b></span>
        <small className="muted">Signal from {row.selection} · {row.market} · {row.bookmaker} (odds {Number(row.odds).toFixed(2)})</small>
      </div>}
      {supported&&<small className="muted">{historical?("Historical results for "+historyGroup+": "+historical.winRate+"% wins · "+historical.wins+" wins / "+historical.losses+" losses / "+historical.pushes+" pushes ("+historical.settled+" settled samples)."):"Historical result for this bookmaker and odds range: no settled samples yet. SUPER will show the actual win rate as tracked matches finish."}</small>}
      {supported&&<b style={{fontSize:13,color:Number(row.probability)>=65?"var(--success, #16834a)":Number(row.probability)<40?"var(--danger, #b42318)":"inherit"}}>{Number(row.probability)>=75?"HIGH CHANCE · MODEL EXPECTS THIS OUTCOME":Number(row.probability)>=60?"LIKELY · MODEL FAVOURS THIS OUTCOME":Number(row.probability)>=45?"UNCERTAIN · CLOSE PROBABILITY":"LOW CHANCE · MODEL DOES NOT FAVOUR THIS OUTCOME"} ({Number(row.probability).toFixed(1)}%)</b>}
      {supported&&Number(row.oddsMovementPct)>=3&&Number(row.probability)>=60&&<small className="muted">SIGNAL CONFLICT: Autistik gives this outcome a strong probability, but the bookmaker price has drifted. Review before treating it as a pick.</small>}
      {supported&&Number(row.oddsMovementPct)>=3&&Number(row.probability)<45&&<small className="muted">CAUTION ALIGNMENT: Autistik probability is low and the bookmaker price has drifted longer.</small>}
      {supported&&<small className="muted">Market implied {Number(row.implied).toFixed(1)}% · no-vig {Number(row.noVig).toFixed(1)}% · model edge {Number(row.edge).toFixed(1)} percentage points</small>}{row.oddsMovementPct!==null&&row.oddsMovementPct!==undefined&&<small className="muted">{Number(row.oddsMovementPct)>0?"Market drift: odds lengthened by ":Number(row.oddsMovementPct)<0?"Market shortening: odds shortened by ":"Odds unchanged: "}<b>{Math.abs(Number(row.oddsMovementPct)).toFixed(1)}%</b> from opening price. {Number(row.oddsMovementPct)>=3?"Warning: price drift may indicate reduced market confidence.":Number(row.oddsMovementPct)<=-3?"Market price has shortened, indicating increased market support.":"No material opening-to-latest movement."}</small>}
      {Array.isArray(row.bookmakerQuotes)&&row.bookmakerQuotes.length>1&&<details><summary>Compare all bookmaker quotes ({row.bookmakerQuotes.length})</summary><div className="stack" style={{fontSize:13,marginTop:8}}>{row.bookmakerQuotes.map((q:any,i:number)=><small key={i}>{q.bookmaker}: <b>{Number(q.odds).toFixed(2)}</b> {q.openingOdds?"(open "+Number(q.openingOdds).toFixed(2)+")":""} {q.oddsMovementPct!==null&&q.oddsMovementPct!==undefined?"· "+(q.oddsMovementPct>0?"+":"")+q.oddsMovementPct+"%":""}</small>)}</div></details>}
      {!supported&&row.modelError&&<small className="muted">Why no model: {row.modelError}</small>}
      {row.modelContext&&<details><summary>View / hide Autistik analysis · team form and goal data</summary><div className="stack" style={{fontSize:13,marginTop:8}}>
        <span>{row.home}: last form <b>{row.modelContext.homeForm||"Not available"}</b> · goals scored/game <b>{row.modelContext.homeGoalsFor??"—"}</b> · conceded/game <b>{row.modelContext.homeGoalsAgainst??"—"}</b></span>
        <span>{row.away}: last form <b>{row.modelContext.awayForm||"Not available"}</b> · goals scored/game <b>{row.modelContext.awayGoalsFor??"—"}</b> · conceded/game <b>{row.modelContext.awayGoalsAgainst??"—"}</b></span>
        {row.modelContext.homeMatches!=null&&<span>Sample: home team <b>{row.modelContext.homeMatches}</b> matches · away team <b>{row.modelContext.awayMatches}</b> matches</span>}
        {row.modelContext.expectedGoals&&<span>Expected goals: home <b>{row.modelContext.expectedGoals.home}</b> · away <b>{row.modelContext.expectedGoals.away}</b></span>}
        {(row.modelContext.verdict||[]).map((v:string,i:number)=><small key={i}>{v}</small>)}
      </div></details>}
    </div>;
  }

  return <section className="card stack" style={{border:"2px solid var(--teal)"}}>
    <div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}>
      <div><b>📈 {endpoint==="/api/admin/sport"?"SPORT · League scanner":"SUPER · football-data.org league scanner"}</b>
        <small className="muted" style={{display:"block"}}>{endpoint==="/api/admin/sport"?"Choose a competition and scan its fixtures.":"Top competitions only · Champions League, Europa League and leading domestic leagues."}</small>
      </div>
      <div className="row" style={{gap:8,flexWrap:"wrap"}}>
        <button className="btn small" type="button" onClick={checkFeed} disabled={checkingFeed}>{checkingFeed?"Checking…":"Check odds feed"}</button>
        <button className="btn small" type="button" onClick={refreshFixtures} disabled={loading||busy}>{loading?"Loading…":"Refresh leagues"}</button>
      </div>
    </div>
    {feedStatus && <div className="notice stack" style={{fontSize:13}}>
      <b>{endpoint==="/api/admin/sport"?"SPORT provider status":"SUPER provider status"}</b>
      {endpoint==="/api/admin/sport"?<>
        <span>API-Football fixtures &amp; statistics: {feedStatus.apiFootball?.active?"Connected":"Not connected"}</span>
        <span>5DollarFootballAPI odds: {feedStatus.fiveDollarFootball?.active?"Connected · "+String(feedStatus.fiveDollarFootball.plan||"plan unknown"):"Not connected"}</span>
        <small>API-Football supplies fixtures and team statistics; 5DollarFootballAPI supplies bookmaker prices.</small>
      </>:<><span>5DollarFootballAPI odds: {feedStatus.active?"Connected · "+String(feedStatus.plan||"plan unknown"):"Not connected"}</span><small>football-data.org supplies fixtures and statistics; 5DollarFootballAPI supplies bookmaker prices.</small></>}
      {feedStatus.error&&<small>{feedStatus.error}</small>}
    </div>}
    {error&&<div className="notice warn">{error}</div>}
    {loading&&<small className="muted">Loading competition and fixture list…</small>}
    {fixtureSource&&endpoint==="/api/admin/sport"&&<small className="muted">Fixture feed: {fixtureSource.fixtureProvider||"Provider not reported"} · statistics: API-Football · prices: 5DollarFootballAPI</small>}
    {progress&&<small className="muted">{progress}</small>}

    <div className="row" style={{gap:8,flexWrap:"wrap"}}>
      <button className={activeSession==="scanner"?"btn primary":"btn"} type="button" onClick={()=>setActiveSession("scanner")}>Open scanner</button>
      <button className={activeSession==="top25"?"btn primary":"btn"} type="button" onClick={()=>setActiveSession("top25")}>AI Top 25 · {top25Rows.length}</button>
      <button className={activeSession==="expectedValue"?"btn primary":"btn"} type="button" onClick={()=>setActiveSession("expectedValue")}>Expected Value · {expectedValueRows.length}</button>
    </div>
    {activeSession==="expectedValue"&&<div className="card stack" style={{padding:14}}>
      <div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}><b>{endpoint==="/api/admin/super"?"SUPER":"SPORT"} · Positive Expected Value</b><button className="btn small" type="button" onClick={()=>setActiveSession("scanner")}>Back to scanner</button></div>
      <small className="muted">All model-supported selections with positive expected value from this section's own completed scans, ranked from highest to lowest EV. This is a price-versus-model calculation, not a guarantee of profit. Scan fixtures or leagues first to populate this session.</small>
      {expectedValueRows.length?expectedValueRows.map((row:any,i:number)=><SelectionCard key={"expected-value-"+(row.key||i)} row={row} index={i}/>):<small className="muted">No positive expected-value selections in the current scan data. Run the {endpoint==="/api/admin/super"?"SUPER":"SPORT"} scanner first.</small>}
    </div>}
    {activeSession==="top25"&&<div className="card stack" style={{padding:14}}>
      <div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}><b>{endpoint==="/api/admin/super"?"SUPER":"SPORT"} · AI Top 25</b><button className="btn small" type="button" onClick={()=>setActiveSession("scanner")}>Back to scanner</button></div>
      <small className="muted">Top recommendations from the data already scanned in this section. Ranked by relative model probability, expected value and odds edge. Each match's two teams can appear only once in this Top 25. Draws, double chance and BTTS are excluded. No fixed probability or edge cutoff is applied.</small>
      {top25Rows.length?top25Rows.map((row:any,i:number)=><SelectionCard key={"top25-"+(row.key||i)} row={row} index={i}/>):<small className="muted">No eligible scanned selections yet. Run the {endpoint==="/api/admin/super"?"SUPER":"SPORT"} scanner first; the Top 25 will be built from its results.</small>}
    </div>}
    {activeSession==="scanner"&&<>
    {endpoint==="/api/admin/sport" && <>
      <div className="row" style={{justifyContent:"space-between",flexWrap:"wrap"}}><b>Choose country, then league</b><small className="muted">{leagues.length} top competitions · {countries.length} countries</small></div>
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
          <div className="row" style={{justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}><div><b>{league?.country} · {league?.name}</b><small className="muted" style={{display:"block"}}>{(league?.code==="EL"||league?.code==="ECL"||/europa league|conference league/i.test(String(league?.name||"")))?"Next 30 days":"Next 30 days"} · {fixtures.length} fixtures</small></div><button className="btn small" type="button" onClick={()=>{setSelectedLeagueId(null);setFixtures([]);setError("");}}>Close league</button></div>
          {loading?<small className="muted">Loading clubs and fixtures…</small>:<>
            <b>Clubs in this league · {clubs.length}</b><small className="muted">{clubs.join(" · ")||"Club list is supplied with the API-Football fixtures."}</small>
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
      <div className="card stack" style={{padding:12}}>
        <b>SUPER · Scan by match date</b>
        <small className="muted">Choose a Ghana-time date to load its upcoming fixtures from football-data.org and calculate bookmaker value, model probabilities, expected value and disagreement information.</small>
        <label className="stack" style={{gap:4}}><b>Choose match date</b><input type="date" value={superScanDate} min={ghanaDate(new Date())} onChange={e=>setSuperScanDate(e.target.value)} /></label>
        <button className="btn primary" type="button" disabled={busy||loading||!superScanDate} onClick={async()=>{
          setLoading(true);setError("");setSuperRows([]);setDiagnostics([]);
          try{
            const data=await post("todayMatches");
            const now=Date.now();
            const chosen=(Array.isArray(data.matches)?data.matches:[]).filter((f:any)=>{
              const kickoff=Date.parse(String(f?.date||""));
              const status=String(f?.status||"").toUpperCase();
              return f?.home?.name&&f?.away?.name&&Number.isFinite(kickoff)&&kickoff>=now&&
                ghanaDate(new Date(kickoff))===superScanDate&&
                (!status||["SCHEDULED","TIMED"].includes(status))&&TOP_COMPETITION.test(String(f.competition||""));
            }).sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
            setFixtures(chosen);
            if(!chosen.length){setError("No upcoming fixtures from SUPER subscribed top competitions were returned for "+superScanDate+".");}
            else{setLoading(false);await scanSuper(chosen,superScanDate,true);}
          }catch(e){setError((e as Error).message);}
          finally{setLoading(false);}
        }}>{loading?"Loading fixtures…":busy?"Scanning…":"Load date and scan matches"}</button>
        <small className="muted">{fixtures.length} fixtures currently loaded in the board.</small>
      </div>
      <small className="muted">{fixtures.length} upcoming fixtures loaded.</small>
      <div className="row" style={{gap:8,flexWrap:"wrap"}}>
        <button className="btn primary" type="button" disabled={busy||!fixtures.length} onClick={()=>void scanSuper()}>{busy?"Scanning…":"Scan all fixtures"}</button>
        <button className="btn" type="button" disabled={performanceLoading} onClick={()=>void refreshSuperPerformance()}>{performanceLoading?"Checking results…":"Refresh tracked results"}</button>
      </div>
      <small className="muted">Opening-to-latest price movement is shown per bookmaker. A rising price is a market-drift warning, not proof of insider information. SUPER records each scan and checks completed match outcomes so its own odds-band record builds over time.</small>
      {superPerformance.length>0&&<div className="notice stack"><b>SUPER historical results by bookmaker odds band</b>{superPerformance.map((p:any)=><small key={p.group}>{p.group}: <b>{p.winRate===null?"—":p.winRate+"% wins"}</b> · {p.wins} wins / {p.losses} losses / {p.pushes} pushes · {p.settled} settled outcomes</small>)}</div>}{superPerformance.length===0&&<small className="muted">No settled SUPER odds-history samples yet. Each scan is now archived; after fixtures finish, refresh tracked results to see actual win rates by market, bookmaker and odds range.</small>}
      {superRows.length>0&&<div className="stack">
        <b>Best underpriced odds · positive expected value ({superValueRows.length})</b>
        <small className="muted">These are the prices where Autistik estimates a higher chance than the bookmaker's odds imply. Highest estimated EV first.</small>
        <div className="notice stack" style={{gap:8,padding:12}}>
          <label htmlFor="super-disagreement-filter" style={{fontWeight:700}}>Choose disagreement range</label>
          <select id="super-disagreement-filter" value={selectedDisagreementBand} onChange={(event)=>setSelectedDisagreementBand(event.target.value)} style={{width:"100%",minHeight:48,padding:"10px 12px",borderRadius:10,border:"1px solid var(--border, #cbd5e1)",background:"var(--card, #fff)",color:"inherit",fontSize:15}}>
            <option value="all">All disagreement ranges</option>
            <option value="under20">Below 20%</option>
            <option value="20to30">20% to below 30%</option>
            <option value="30to40">30% to below 40%</option>
            <option value="40plus">Above 40%</option>
          </select>
          <small className="muted">Each match appears once, using only its single highest-disagreement counter-outcome. A match appears in a range only when that strongest disagreement falls inside the selected range.</small>
        </div>
        {disagreementSections.filter((section:any)=>selectedDisagreementBand==="all"||section.key===selectedDisagreementBand).map((section:any)=><section key={section.key} className="stack">
          <b>{section.title} ({section.groups.length})</b>
          <small className="muted">{section.description}</small>
          {section.groups.map((group:any,i:number)=><CounterMatchCard key={"counter-"+group.key} group={group} index={i}/>)}
          {!section.groups.length&&<small className="muted">No matches in this disagreement range.</small>}
        </section>)}
        {primaryValueRows.map((r:any,i:number)=><SelectionCard key={"value-"+(r.key||i)} row={r} index={i+multiCounterGroups.length}/>)}
        {!superValueRows.length&&<small className="muted">No positive-EV selections with a supported model probability yet.</small>}
        <details><summary>Other overpriced selections · avoid ({superOverpricedRows.length})</summary>
          <small className="muted">Negative-EV selections are kept here for reference, so they do not repeat the same matches in the main value list.</small>
          {superOverpricedRows.length?superOverpricedRows.map((r:any,i:number)=><SelectionCard key={"overpriced-"+(r.key||i)} row={r} index={i}/>):<small className="muted">No overpriced model-supported selections in this scan.</small>}
        </details>
        <details><summary>Highest estimated chances · all selections ({superProbabilityRows.length})</summary>
          <small className="muted">Expanded only when you want to compare every model-supported outcome.</small>
          {superProbabilityRows.map((r:any,i:number)=><SelectionCard key={"chance-"+(r.key||i)} row={r} index={i}/>)}
        </details>
        <details><summary>All bookmaker selections and model coverage ({superRows.length})</summary>{sortRows(superRows).map((r:any,i:number)=><SelectionCard key={"all-"+(r.key||i)} row={r} index={i}/>)}</details>
      </div>}
      {diagnostics.length>0&&<details><summary>Scan diagnostics ({diagnostics.length})</summary><div className="stack" style={{gap:8,marginTop:8}}>{diagnostics.map((d:any,i:number)=><div key={i} className="notice" style={{fontSize:12,overflowWrap:"anywhere"}}><b>{d.fixture}</b><span>Odds provider: {d.oddsProvider||"5DollarFootballAPI"} · events checked: {d.oddsEvents??d.eventsReturned??0} · matched events: {d.matchedEvents??d.matched??0}</span><span>Bookmakers: {(d.bookmakers||[]).join(", ")||"None returned"} · markets: {(d.markets||[]).join(", ")||"None returned"}</span>{d.oddsError&&<span style={{color:"var(--danger, #b42318)"}}>Odds error: {d.oddsError}</span>}{d.analysisError&&<span style={{color:"var(--danger, #b42318)"}}>Model error: {d.analysisError}</span>}{d.feedExamples?.length>0&&<span>Provider fixture examples: {d.feedExamples.join(" · ")}</span>}{d.providers&&<span>Provider diagnostics: {JSON.stringify(d.providers)}</span>}</div>)}</div></details>}
    </>}
    </>}
    <small className="muted">{endpoint==="/api/admin/sport"?"Model probabilities are calculated from API-Football recent form and season statistics.":"SUPER uses football-data.org fixtures and pre-match team history with 5DollarFootball bookmaker prices. Positive EV means the offered odds are generous versus Autistik's fair odds; negative EV means the price is too short. Odds imply a break-even probability of 100 ÷ decimal odds, before bookmaker margin. Probabilities are estimates, not guarantees."}</small>
  </section>;
}
