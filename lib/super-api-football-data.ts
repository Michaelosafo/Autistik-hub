/**
 * SUPER board adapter using Highlightly Football API.
 * Isolated key/cache/history namespace; SPORT remains on football-data.org.
 */
import { supabaseService } from "@/lib/supabase/server";
import { model } from "@/lib/sport";

const BASE = "https://soccer.highlightly.net";
const TTL = 5 * 60_000;
const sb = () => supabaseService();
export const superReady = () => !!process.env.SUPER_HIGHLIGHTLY_API_KEY;

async function api(path: string, ttl = TTL): Promise<any> {
  const key = process.env.SUPER_HIGHLIGHTLY_API_KEY;
  if (!key) throw new Error("SUPER_HIGHLIGHTLY_API_KEY is missing in Vercel Production.");
  const cacheKey = "super-highlightly:" + path;
  const { data: hit } = await sb().from("sport_cache").select("data,at").eq("key", cacheKey).maybeSingle();
  if (hit && Date.now() - Date.parse(hit.at) < ttl) {
    if (hit.data?._providerError) throw new Error(String(hit.data._providerError));
    return hit.data;
  }
  const r = await fetch(BASE + path, { headers: { "x-rapidapi-key": key }, cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const message = "Highlightly (" + r.status + "): " + String(body?.message || body?.error || r.statusText || "Provider error").slice(0, 200);
    if (r.status === 429) await sb().from("sport_cache").upsert({ key: cacheKey, data: { _providerError: message }, at: new Date().toISOString() });
    throw new Error(message);
  }
  await sb().from("sport_cache").upsert({ key: cacheKey, data: body, at: new Date().toISOString() });
  return body;
}
const rows = (v:any):any[] => Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : [];
const finished = (m:any) => /^(finished|finished after|awarded)/i.test(String(m?.state?.description || ""));
const scoreParts = (m:any) => String(m?.state?.score?.current || "").split("-").map((x:string)=>Number(x.trim()));
const fixture = (m:any) => {
  const [hg,ag]=scoreParts(m);
  return {
    id:m.id, provider:"highlightly", date:m.date, status:finished(m)?"FINISHED":m?.state?.description||"SCHEDULED",
    competition:m?.league?.name||"Football",
    home:{id:m?.homeTeam?.id,name:m?.homeTeam?.name,logo:m?.homeTeam?.logo||""},
    away:{id:m?.awayTeam?.id,name:m?.awayTeam?.name,logo:m?.awayTeam?.logo||""},
    score:finished(m)&&Number.isFinite(hg)&&Number.isFinite(ag)?{home:hg,away:ag}:null,
  };
};
const dateOK=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+"T00:00:00Z"));

export async function searchTeams(q:string) {
  const s=q.trim(); if(s.length<2)return [];
  const body=await api("/teams?name="+encodeURIComponent(s)+"&limit=100",7*86400_000);
  return rows(body).filter((x:any)=>x?.id&&x?.name).slice(0,15).map((x:any)=>({
    id:Number(x.id),name:x.name,country:x.country?.name||"",logo:x.logo||""
  }));
}

/** Resolve third-party fixture names to Highlightly's own team IDs. */
export async function resolveFixtureTeamIds(names: string[]) {
  const normalize = (value: string) => String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(football club|fc|afc|cf|sc|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const result: Record<string, number> = {};
  const unique = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
  await Promise.all(unique.map(async (name) => {
    const candidates = await searchTeams(name).catch(() => []);
    const target = normalize(name);
    const exact = candidates.filter((team: any) => normalize(team.name) === target);
    const pool = exact.length ? exact : candidates.filter((team: any) => {
      const candidate = normalize(team.name);
      return candidate && (candidate.startsWith(target) || target.startsWith(candidate));
    });
    if (pool.length === 1 && Number(pool[0].id) > 0) result[target] = Number(pool[0].id);
  }));
  return result;
}

const leagueCatalogueCache = new Map<string,{expiresAt:number;value:any[]}>();
export async function getLeagueCatalogue() {
  const cached=leagueCatalogueCache.get("all");
  if(cached&&cached.expiresAt>Date.now())return cached.value;
  const all:any[]=[];
  for(let offset=0;offset<2000;offset+=100) {
    const body=await api("/leagues?limit=100&offset="+offset,12*3600_000);
    const page=rows(body);
    all.push(...page);
    const total=Number(body?.pagination?.totalCount||0);
    if(!page.length || page.length<100 || (total>0 && offset+page.length>=total))break;
  }
  const result=all.filter((x:any)=>x?.id&&x?.name).map((x:any)=>({
    id:Number(x.id),name:String(x.name),country:String(x.country?.name||"International"),
    countryCode:String(x.country?.code||""),logo:String(x.logo||""),
    seasons:Array.isArray(x.seasons)?x.seasons.map((s:any)=>Number(s.season)).filter(Number.isFinite):[]
  })).sort((a:any,b:any)=>a.country.localeCompare(b.country)||a.name.localeCompare(b.name));
  leagueCatalogueCache.set("all",{expiresAt:Date.now()+12*3600_000,value:result});
  return result;
}

/** Upcoming fixtures for one selected league, fetched on demand for the next seven local days. */
export async function getLeagueUpcomingFixtures(leagueId:number,season?:number) {
  if(!Number.isInteger(leagueId)||leagueId<=0)throw new Error("Choose a valid competition.");
  const now=new Date();
  const localDate=(d:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Accra",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
  const dates=Array.from({length:7},(_,i)=>localDate(new Date(now.getTime()+i*24*60*60_000)));
  const bodies=await Promise.all(dates.map(async date=>{
    try{return await api("/matches?date="+date+"&leagueId="+leagueId+"&timezone=Africa%2FAccra&limit=100",5*60_000);}
    catch(error){return {_requestError:error instanceof Error?error.message:String(error),data:[]};}
  }));
  const successful=bodies.filter((body:any)=>!body?._requestError);
  if(!successful.length)throw new Error("Highlightly could not load fixtures for this league: "+String((bodies.find((body:any)=>body?._requestError)?._requestError)||"Provider unavailable"));
  const unique=new Map<string,any>();
  for(const body of successful)for(const raw of rows(body)){
    const item=fixture(raw);
    const kickoff=Date.parse(item.date);
    if(item.home.id&&item.away.id&&item.date&&item.status!=="FINISHED"&&Number.isFinite(kickoff)&&kickoff>=now.getTime())unique.set(String(item.id),item);
  }
  const fixtures=[...unique.values()].sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
  let clubs:any[]=[];
  if(Number.isInteger(Number(season))&&Number(season)>0) {
    try {
      const table=await api("/standings?leagueId="+leagueId+"&season="+Number(season),60*60_000);
      const groups=Array.isArray(table?.groups)?table.groups:Array.isArray(table)?table:[];
      clubs=groups.flatMap((group:any)=>Array.isArray(group?.standings)?group.standings:[])
        .map((entry:any)=>({id:Number(entry?.team?.id)||null,name:String(entry?.team?.name||""),logo:String(entry?.team?.logo||"")}))
        .filter((team:any)=>team.name);
    } catch { /* The league may not publish standings; fixture clubs remain available. */ }
  }
  if(!clubs.length)clubs=[...new Map(fixtures.flatMap((f:any)=>[f.home,f.away]).filter((t:any)=>t?.name).map((t:any)=>[String(t.id||t.name),t])).values()];
  return {fixtures,clubs};
}

export async function todayCompetitionMatches() {
  // Scan both calendar days in Ghana time so Europa League and Conference League
  // fixtures tomorrow are included without waiting for the date to roll over.
  const now = new Date();
  const dayInAccra = (d: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
  const today = dayInAccra(now);
  const tomorrow = dayInAccra(new Date(now.getTime() + 24 * 60 * 60_000));
  const [todayBody, tomorrowBody] = await Promise.all([
    api("/matches?date="+today+"&timezone=Africa%2FAccra&limit=100",10*60_000),
    api("/matches?date="+tomorrow+"&timezone=Africa%2FAccra&limit=100",10*60_000)
  ]);
  const unique = new Map<string, any>();
  for (const raw of [...rows(todayBody), ...rows(tomorrowBody)]) {
    const item = fixture(raw);
    const kickoff = Date.parse(item.date);
    if (item.home.id && item.away.id && item.date && item.status !== "FINISHED" &&
      Number.isFinite(kickoff) && kickoff >= now.getTime()) unique.set(String(item.id), item);
  }
  return [...unique.values()].sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
}
export async function matchesOnDate(date:string) {
  if(!dateOK(date))throw new Error("Choose a valid match date.");
  const body=await api("/matches?date="+date+"&timezone=Etc%2FUTC&limit=100",5*60_000);
  return rows(body).map(fixture).filter((x:any)=>x.home.id&&x.away.id&&x.score).sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date));
}
export async function teamFixtureChoices(teamId:number) {
  const today=new Date().toISOString().slice(0,10);
  const [recentBody,futureBody]=await Promise.all([
    api("/last-five-games?teamId="+teamId,24*60*60_000),
    api("/matches?date="+today+"&homeTeamId="+teamId+"&limit=100",60_000).catch(()=>({data:[]})),
  ]);
  const recent=rows(recentBody);
  const future=rows(futureBody);
  const candidates=[...recent,...future].filter((m:any)=>m.homeTeam?.id===teamId||m.awayTeam?.id===teamId);
  const unique=Array.from(new Map(candidates.map((m:any)=>[m.id,m])).values());
  const now=Date.now();
  const last=unique.filter((m:any)=>finished(m)&&Date.parse(m.date)<now).sort((a:any,b:any)=>Date.parse(b.date)-Date.parse(a.date))[0];
  const next=unique.filter((m:any)=>!finished(m)&&Date.parse(m.date)>=now).sort((a:any,b:any)=>Date.parse(a.date)-Date.parse(b.date))[0];
  return [last,next].filter(Boolean).map(fixture);
}
function summarize(teamId:number,games:any[],seasonRows:any[] = []) {
  const matches=games.map((m:any)=>{
    const isHome=m.homeTeam?.id===teamId;
    const [h,a]=scoreParts(m);
    const gf=isHome?h:a,ga=isHome?a:h;
    return {date:m.date,vs:isHome?m.awayTeam?.name:m.homeTeam?.name,home:isHome,gf,ga,res:gf>ga?"W":gf===ga?"D":"L",comp:m.league?.name||""};
  }).filter((x:any)=>Number.isFinite(x.gf)&&Number.isFinite(x.ga)).sort((a:any,b:any)=>Date.parse(b.date)-Date.parse(a.date));
  const home=matches.filter((x:any)=>x.home),away=matches.filter((x:any)=>!x.home);
  const mean=(xs:any[],k:"gf"|"ga")=>xs.length?+(xs.reduce((s:number,x:any)=>s+x[k],0)/xs.length).toFixed(2):null;
  const count=(xs:any[],r:string)=>xs.filter((x:any)=>x.res===r).length;
  const seasonRow=[...seasonRows].sort((a:any,b:any)=>Number(b.season||0)-Number(a.season||0))[0];
  const avg=(side:any,kind:"scored"|"received")=>Number(side?.games?.played)>0?+(Number(side?.goals?.[kind]||0)/Number(side.games.played)).toFixed(2):null;
  const sh=seasonRow?.home,sa=seasonRow?.away,st=seasonRow?.total;
  return {season:{
    form:matches.slice(0,10).reverse().map((x:any)=>x.res).join(""),
    played:{home:Number(sh?.games?.played)||home.length,away:Number(sa?.games?.played)||away.length,total:Number(st?.games?.played)||matches.length},
    wins:{home:Number(sh?.games?.wins)||count(home,"W"),away:Number(sa?.games?.wins)||count(away,"W"),total:Number(st?.games?.wins)||count(matches,"W")},
    draws:{home:Number(sh?.games?.draws)||count(home,"D"),away:Number(sa?.games?.draws)||count(away,"D"),total:Number(st?.games?.draws)||count(matches,"D")},
    loses:{home:Number(sh?.games?.loses)||count(home,"L"),away:Number(sa?.games?.loses)||count(away,"L"),total:Number(st?.games?.loses)||count(matches,"L")},
    goalsFor:{home:avg(sh,"scored")??mean(home,"gf"),away:avg(sa,"scored")??mean(away,"gf"),total:avg(st,"scored")??mean(matches,"gf")},
    goalsAgainst:{home:avg(sh,"received")??mean(home,"ga"),away:avg(sa,"received")??mean(away,"ga"),total:avg(st,"received")??mean(matches,"ga")},
    cleanSheets:{home:home.filter((x:any)=>x.ga===0).length,away:away.filter((x:any)=>x.ga===0).length,total:matches.filter((x:any)=>x.ga===0).length},
    failedToScore:{home:home.filter((x:any)=>x.gf===0).length,away:away.filter((x:any)=>x.gf===0).length,total:matches.filter((x:any)=>x.gf===0).length}
  },last5:{games:matches.slice(0,5),avg:{goalsFor:mean(matches,"gf"),goalsAgainst:mean(matches,"ga")}}};
}
export async function analyse(homeId:number,awayId:number,matchDate?:string) {
  if(matchDate&&!dateOK(matchDate))throw new Error("Choose a valid match date.");
  const fromDate = new Date(Date.now()-365*24*60*60_000).toISOString().slice(0,10);
  const [hBody,aBody,hStatsBody,aStatsBody]=await Promise.all([
    api("/last-five-games?teamId="+homeId,24*60*60_000),
    api("/last-five-games?teamId="+awayId,24*60*60_000),
    api("/teams/statistics/"+homeId+"?fromDate="+fromDate,6*3600_000).catch(()=>[]),
    api("/teams/statistics/"+awayId+"?fromDate="+fromDate,6*3600_000).catch(()=>[])
  ]);
  const hGames=rows(hBody).filter((m:any)=>!matchDate||Date.parse(m.date)<Date.parse(matchDate+"T00:00:00Z"));
  const aGames=rows(aBody).filter((m:any)=>!matchDate||Date.parse(m.date)<Date.parse(matchDate+"T00:00:00Z"));
  const hSeasonRows=rows(hStatsBody), aSeasonRows=rows(aStatsBody);
  // Prefer recent form, but do not discard a valid season-statistics dataset
  // just because a newly promoted/youth/women's side has fewer than two recent games.
  if ((hGames.length < 2 && !hSeasonRows.length) || (aGames.length < 2 && !aSeasonRows.length)) {
    throw new Error("Highlightly has insufficient recent-match and season-statistics coverage for one or both teams. This fixture remains odds-only; no probabilities are invented.");
  }
  const h=summarize(homeId,hGames,hSeasonRows),a=summarize(awayId,aGames,aSeasonRows);
  const hHome=h.season.goalsFor.home??h.season.goalsFor.total??1.35;
  const hCon=h.season.goalsAgainst.home??h.season.goalsAgainst.total??1.2;
  const aAway=a.season.goalsFor.away??a.season.goalsFor.total??1.1;
  const aCon=a.season.goalsAgainst.away??a.season.goalsAgainst.total??1.35;
  const lh=Math.max(.2,Math.min(4.5,(hHome+aCon)/2));
  const la=Math.max(.15,Math.min(4,(aAway+hCon)/2));
  const m=model(lh,la);
  const h2h:any[]=[]; // Skip the extra H2H request to conserve daily Highlightly quota.
  const fav=m.home>=m.away?{side:"home",p:m.home}:{side:"away",p:m.away};
  const verdict=[
    fav.p>=60?"Clear favourite: "+fav.side+" win ("+fav.p+"%).":fav.p>=45?"Leaning "+fav.side+" ("+fav.p+"%), but not safe.":"Close game: home "+m.home+"% / draw "+m.draw+"% / away "+m.away+"%.",
    m.over["1.5"]>=75?"Goals likely: over 1.5 at "+m.over["1.5"]+"%.":"Over 1.5 goals: "+m.over["1.5"]+"%.",
    m.over["2.5"]>=58?"Over 2.5 leans yes ("+m.over["2.5"]+"%).":m.over["2.5"]<=42?"Under 2.5 leans yes ("+(100-m.over["2.5"]).toFixed(1)+"%).":"Over/under 2.5 is close ("+m.over["2.5"]+"%).",
    m.btts>=58?"Both teams to score: yes ("+m.btts+"%).":m.btts<=42?"Both teams to score: no ("+(100-m.btts).toFixed(1)+"%).":"Both teams to score: "+m.btts+"%.",
    "Likeliest score: "+m.scores[0].score+" ("+m.scores[0].p+"%)."
  ];
  const historical=!!matchDate&&Date.parse(matchDate+"T00:00:00Z")<Date.now();
  const actualBody=historical&&matchDate?await api("/matches?date="+matchDate+"&homeTeamId="+homeId+"&awayTeamId="+awayId+"&limit=100",24*60*60_000).catch(()=>({data:[]})):[];
  const actualMatch=rows(actualBody).find((x:any)=>x.homeTeam?.id===homeId&&x.awayTeam?.id===awayId);
  const actualScore=actualMatch?String(actualMatch.state?.score?.current||"").split("-").map((x:string)=>Number(x.trim())):[];
  return {
    leagues:{home:{id:0,name:hGames[0]?.league?.name||"Football"},away:{id:0,name:aGames[0]?.league?.name||"Football"}},
    averages:{home:{},away:{}},teams:{home:h,away:a},
    strengths:{homeAttack:1,homeDefence:1,awayAttack:1,awayDefence:1},model:m,h2h,verdict,
    matchDate:matchDate||null,historical,
    actual:actualMatch&&finished(actualMatch)&&actualScore.length===2?{date:actualMatch.date,status:"FINISHED",homeGoals:actualScore[0],awayGoals:actualScore[1],competition:actualMatch.league?.name||"Football"}:null
  };
}
export async function savePrediction(row:Record<string,unknown>) {
  const note=(()=>{try{return JSON.parse(String(row.note||"{}"));}catch{return {};}})();
  const {data,error}=await sb().from("sport_predictions").insert({...row,note:JSON.stringify({...note,provider:"super-highlightly"})}).select("id").single();
  if(error)throw new Error(error.message);return data?.id??null;
}
export async function saveOdds(id:number,selections:unknown,highestChance:unknown) {
  if(!Number.isInteger(id)||id<=0)throw new Error("Missing prediction history ID.");
  const safe=Array.isArray(selections)?selections.slice(0,60):[];
  const {data:existing}=await sb().from("sport_predictions").select("note").eq("id",id).maybeSingle();
  let prior:any={};try{prior=existing?.note?JSON.parse(existing.note):{};}catch{}
  const {error}=await sb().from("sport_predictions").update({note:JSON.stringify({...prior,bookmakerComparison:safe,highestChance})}).eq("id",id);
  if(error)throw new Error(error.message);
}
export async function history() {
  const {data,error}=await sb().from("sport_predictions").select("*").order("id",{ascending:false}).limit(150);
  if(error)throw new Error(error.message);
  return (data||[]).filter((x:any)=>{try{return JSON.parse(x.note||"{}").provider==="super-highlightly";}catch{return false;}}).slice(0,30);
}
export async function setResult(id:number,result:string) {
  const {error}=await sb().from("sport_predictions").update({result:result.slice(0,20)}).eq("id",id);
  if(error)throw new Error(error.message);
}
