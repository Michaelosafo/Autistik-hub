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
    id:m.id, date:m.date, status:finished(m)?"FINISHED":m?.state?.description||"SCHEDULED",
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
function summarize(teamId:number,games:any[]) {
  const matches=games.map((m:any)=>{
    const isHome=m.homeTeam?.id===teamId;
    const [h,a]=scoreParts(m);
    const gf=isHome?h:a,ga=isHome?a:h;
    return {date:m.date,vs:isHome?m.awayTeam?.name:m.homeTeam?.name,home:isHome,gf,ga,res:gf>ga?"W":gf===ga?"D":"L",comp:m.league?.name||""};
  }).filter((x:any)=>Number.isFinite(x.gf)&&Number.isFinite(x.ga)).sort((a:any,b:any)=>Date.parse(b.date)-Date.parse(a.date));
  const home=matches.filter((x:any)=>x.home),away=matches.filter((x:any)=>!x.home);
  const mean=(xs:any[],k:"gf"|"ga")=>xs.length?+(xs.reduce((s:number,x:any)=>s+x[k],0)/xs.length).toFixed(2):null;
  const count=(xs:any[],r:string)=>xs.filter((x:any)=>x.res===r).length;
  return {season:{
    form:matches.slice(0,10).reverse().map((x:any)=>x.res).join(""),
    played:{home:home.length,away:away.length,total:matches.length},
    wins:{home:count(home,"W"),away:count(away,"W"),total:count(matches,"W")},
    draws:{home:count(home,"D"),away:count(away,"D"),total:count(matches,"D")},
    loses:{home:count(home,"L"),away:count(away,"L"),total:count(matches,"L")},
    goalsFor:{home:mean(home,"gf"),away:mean(away,"gf"),total:mean(matches,"gf")},
    goalsAgainst:{home:mean(home,"ga"),away:mean(away,"ga"),total:mean(matches,"ga")},
    cleanSheets:{home:home.filter((x:any)=>x.ga===0).length,away:away.filter((x:any)=>x.ga===0).length,total:matches.filter((x:any)=>x.ga===0).length},
    failedToScore:{home:home.filter((x:any)=>x.gf===0).length,away:away.filter((x:any)=>x.gf===0).length,total:matches.filter((x:any)=>x.gf===0).length}
  },last5:{games:matches.slice(0,5),avg:{}}};
}
export async function analyse(homeId:number,awayId:number,matchDate?:string) {
  if(matchDate&&!dateOK(matchDate))throw new Error("Choose a valid match date.");
  const [hBody,aBody]=await Promise.all([
    api("/last-five-games?teamId="+homeId,24*60*60_000),
    api("/last-five-games?teamId="+awayId,24*60*60_000)
  ]);
  const hGames=rows(hBody).filter((m:any)=>!matchDate||Date.parse(m.date)<Date.parse(matchDate+"T00:00:00Z"));
  const aGames=rows(aBody).filter((m:any)=>!matchDate||Date.parse(m.date)<Date.parse(matchDate+"T00:00:00Z"));
  if(hGames.length<2||aGames.length<2)throw new Error("Highlightly returned too few completed matches for this team. Try another competition or match.");
  const h=summarize(homeId,hGames),a=summarize(awayId,aGames);
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
