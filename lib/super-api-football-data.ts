/**
 * SUPER board data adapter: API-Football (API-Sports), isolated from SPORT.
 * Reads SUPER_API_FOOTBALL_KEY and uses a separate cache/history namespace.
 */
import { supabaseService } from "@/lib/supabase/server";
import { model } from "@/lib/sport";

const BASE = "https://v3.football.api-sports.io";
const TTL = 6 * 60 * 60_000;
const sb = () => supabaseService();
export const superReady = () => !!process.env.SUPER_API_FOOTBALL_KEY;

async function api(path: string, ttl = TTL): Promise<any[]> {
  const key = process.env.SUPER_API_FOOTBALL_KEY;
  if (!key) throw new Error("Add SUPER_API_FOOTBALL_KEY in Vercel, then redeploy.");
  const cacheKey = "super-api-football:" + path;
  const { data: hit } = await sb().from("sport_cache").select("data,at").eq("key", cacheKey).maybeSingle();
  if (hit && Date.now() - Date.parse(hit.at) < ttl) return hit.data as any[];
  const r = await fetch(BASE + path, { headers: { "x-apisports-key": key }, cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  const errors = body?.errors && (Array.isArray(body.errors) ? body.errors : Object.values(body.errors));
  if (!r.ok || (errors && errors.length)) {
    if (hit) return hit.data as any[];
    throw new Error("API-Football: " + String(errors?.[0] || r.statusText || "Provider error").slice(0, 180));
  }
  const data = Array.isArray(body?.response) ? body.response : [];
  await sb().from("sport_cache").upsert({ key: cacheKey, data, at: new Date().toISOString() });
  return data;
}
const finished = (f: any) => ["FT", "AET", "PEN"].includes(String(f?.fixture?.status?.short || ""));
const fixture = (f: any) => ({
  id: f.fixture.id, date: f.fixture.date, status: finished(f) ? "FINISHED" : f.fixture.status?.short || "SCHEDULED",
  competition: f.league?.name || "Football",
  home: { id: f.teams.home.id, name: f.teams.home.name, logo: f.teams.home.logo || "" },
  away: { id: f.teams.away.id, name: f.teams.away.name, logo: f.teams.away.logo || "" },
  score: finished(f) && Number.isFinite(f.goals?.home) && Number.isFinite(f.goals?.away) ? { home: f.goals.home, away: f.goals.away } : null,
});
const dateOK = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z"));

export async function searchTeams(q: string) {
  const s = q.trim(); if (s.length < 3) return [];
  return (await api("/teams?search=" + encodeURIComponent(s), 7 * 86400_000)).slice(0, 15)
    .map((x: any) => ({ id: Number(x.team.id), name: x.team.name, country: x.team.country || "", logo: x.team.logo || "" }));
}
export async function todayCompetitionMatches() {
  const today = new Date().toISOString().slice(0, 10);
  return (await api("/fixtures?date=" + today, 2 * 60_000)).map(fixture)
    .filter((f: any) => f.home.id && f.away.id)
    .sort((a: any,b: any) => Date.parse(a.date)-Date.parse(b.date));
}
export async function matchesOnDate(date: string) {
  if (!dateOK(date)) throw new Error("Choose a valid match date.");
  return (await api("/fixtures?date=" + date, 30 * 60_000)).map(fixture)
    .filter((f: any) => f.score && String(f.date).slice(0,10) === date)
    .sort((a: any,b: any) => Date.parse(a.date)-Date.parse(b.date));
}
export async function teamFixtureChoices(teamId: number) {
  // API-Football requires a season whenever the team filter is used on /fixtures.
  // Resolve the club's current league season, then check it and the previous
  // season so the board can still show the latest completed match near a season turn.
  const leagueRows = await api("/leagues?team="+teamId+"&current=true", 24*3600_000);
  const leaguePick = leagueRows.find((x:any)=>x.league?.type==="League") || leagueRows[0];
  const currentSeason = Number((leaguePick?.seasons || []).find((s:any)=>s.current)?.year || (leaguePick?.seasons || [])[0]?.year);
  if (!Number.isInteger(currentSeason) || currentSeason < 1900) {
    throw new Error("API-Football could not determine this team's current season.");
  }
  const seasons = [currentSeason, currentSeason - 1];
  const results = await Promise.all(seasons.map(async (season) => {
    try {
      return await api("/fixtures?team="+teamId+"&season="+season+"&timezone=UTC", 3*3600_000);
    } catch (error) {
      if (season === currentSeason) throw error;
      return [];
    }
  }));
  const all = results.flat();
  const now=Date.now();
  const last=all.filter((f:any)=>finished(f)&&Date.parse(f.fixture.date)<now).sort((a:any,b:any)=>Date.parse(b.fixture.date)-Date.parse(a.fixture.date))[0];
  const next=all.filter((f:any)=>!finished(f)&&Date.parse(f.fixture.date)>=now).sort((a:any,b:any)=>Date.parse(a.fixture.date)-Date.parse(b.fixture.date))[0];
  return [last,next].filter(Boolean).map(fixture);
}
async function leagueFor(teamId:number) {
  const rows=await api("/leagues?team="+teamId+"&current=true",24*3600_000);
  const pick=rows.find((x:any)=>x.league?.type==="League")||rows[0];
  if(!pick) throw new Error("API-Football could not find a current league for one of these teams.");
  const season=Number((pick.seasons||[]).find((s:any)=>s.current)?.year||(pick.seasons||[])[0]?.year);
  return {id:Number(pick.league.id),name:pick.league.name||"Football",season};
}
const n=(v:any)=>v==null||v===""?null:Number(String(v).replace("%",""));
async function teamStats(team:number, league:number, season:number) {
  const r=await api("/teams/statistics?league="+league+"&season="+season+"&team="+team,12*3600_000);
  const s=r[0]||{}, fx=s.fixtures||{},g=s.goals||{},ph=Number(fx.played?.home||0),pa=Number(fx.played?.away||0);
  const avg=(v:any,played:number)=>v==null||!played?null:+(Number(v)/played).toFixed(2);
  return {
    form:String(s.form||"").slice(-10),
    played:{home:ph,away:pa,total:Number(fx.played?.total||0)},wins:fx.wins||{},draws:fx.draws||{},loses:fx.loses||{},
    goalsFor:{home:avg(g.for?.total?.home,ph),away:avg(g.for?.total?.away,pa),total:n(g.for?.average?.total)},
    goalsAgainst:{home:avg(g.against?.total?.home,ph),away:avg(g.against?.total?.away,pa),total:n(g.against?.average?.total)},
    cleanSheets:s.clean_sheet||{},failedToScore:s.failed_to_score||{},
  };
}
async function recent(team:number, before?:string) {
  const path=before
    ? "/fixtures?team="+team+"&from="+new Date(Date.parse(before+"T00:00:00Z")-700*86400000).toISOString().slice(0,10)+"&to="+before
    : "/fixtures?team="+team+"&last=30";
  return (await api(path,before?12*3600_000:3*3600_000)).filter((f:any)=>finished(f)&&(!before||Date.parse(f.fixture.date)<Date.parse(before+"T00:00:00Z")))
    .sort((a:any,b:any)=>Date.parse(b.fixture.date)-Date.parse(a.fixture.date)).slice(0,30);
}
function summarize(team:number, matches:any[]) {
  const rows=matches.map((f:any)=>{
    const home=f.teams.home.id===team, gf=Number(home?f.goals.home:f.goals.away),ga=Number(home?f.goals.away:f.goals.home);
    return {date:f.fixture.date,vs:home?f.teams.away.name:f.teams.home.name,home,gf,ga,res:gf>ga?"W":gf===ga?"D":"L",comp:f.league?.name||""};
  });
  const all=rows, home=rows.filter(x=>x.home),away=rows.filter(x=>!x.home);
  const mean=(xs:any[],k:"gf"|"ga")=>xs.length?+(xs.reduce((s,x)=>s+x[k],0)/xs.length).toFixed(2):null;
  const season={
    form:rows.slice(0,10).reverse().map(x=>x.res).join(""),
    played:{home:home.length,away:away.length,total:rows.length},
    wins:{home:home.filter(x=>x.res==="W").length,away:away.filter(x=>!x.home&&x.res==="W").length,total:rows.filter(x=>x.res==="W").length},
    draws:{home:home.filter(x=>x.res==="D").length,away:away.filter(x=>!x.home&&x.res==="D").length,total:rows.filter(x=>x.res==="D").length},
    loses:{home:home.filter(x=>x.res==="L").length,away:away.filter(x=>!x.home&&x.res==="L").length,total:rows.filter(x=>x.res==="L").length},
    goalsFor:{home:mean(home,"gf"),away:mean(away,"gf"),total:mean(rows,"gf")},
    goalsAgainst:{home:mean(home,"ga"),away:mean(away,"ga"),total:mean(rows,"ga")},
    cleanSheets:{home:home.filter(x=>x.ga===0).length,away:away.filter(x=>x.ga===0).length,total:rows.filter(x=>x.ga===0).length},
    failedToScore:{home:home.filter(x=>x.gf===0).length,away:away.filter(x=>x.gf===0).length,total:rows.filter(x=>x.gf===0).length},
  };
  return {season,last5:{games:rows.slice(0,5),avg:{}}};
}
export async function analyse(homeId:number,awayId:number,matchDate?:string) {
  if(matchDate&&!dateOK(matchDate)) throw new Error("Choose a valid match date.");
  const cutoff=matchDate?new Date(matchDate+"T00:00:00Z"):new Date();
  const [hl,al]=await Promise.all([leagueFor(homeId),leagueFor(awayId)]);
  const [hmAll,amAll]=await Promise.all([recent(homeId,matchDate),recent(awayId,matchDate)]);
  if(!hmAll.length||!amAll.length) throw new Error("API-Football returned insufficient completed match history for one or both teams.");
  const h=summarize(homeId,hmAll),a=summarize(awayId,amAll);
  const hAvg={home:1.45,away:1.15,teams:0},aAvg={home:1.45,away:1.15,teams:0};
  const hHome=h.season.goalsFor.home??1.45,hCon=h.season.goalsAgainst.home??1.15;
  const aAway=a.season.goalsFor.away??1.15,aCon=a.season.goalsAgainst.away??1.45;
  const lh=Math.max(.2,Math.min(4.5,(hHome+aCon)/2)),la=Math.max(.15,Math.min(4,(aAway+hCon)/2));
  const m=model(lh,la);
  const actual=matchDate?(await matchesOnDate(matchDate)).find((f:any)=>f.home.id===homeId&&f.away.id===awayId):null;
  const h2h=hmAll.filter((f:any)=>f.teams.home.id===awayId||f.teams.away.id===awayId).slice(0,6).map((f:any)=>({date:f.fixture.date,home:f.teams.home.name,away:f.teams.away.name,score:String(f.goals.home)+"-"+String(f.goals.away),comp:f.league?.name||""}));
  const fav=m.home>=m.away?{side:"home",p:m.home}:{side:"away",p:m.away};
  const verdict=[
    fav.p>=60?"Clear favourite: "+fav.side+" win ("+fav.p+"%).":fav.p>=45?"Leaning "+fav.side+" ("+fav.p+"%), but not safe.":"Close game: home "+m.home+"% / draw "+m.draw+"% / away "+m.away+"%.",
    m.over["1.5"]>=75?"Goals likely: over 1.5 at "+m.over["1.5"]+"%.":"Over 1.5 goals: "+m.over["1.5"]+"%.",
    m.over["2.5"]>=58?"Over 2.5 leans yes ("+m.over["2.5"]+"%).":m.over["2.5"]<=42?"Under 2.5 leans yes ("+(100-m.over["2.5"]).toFixed(1)+"%).":"Over/under 2.5 is close ("+m.over["2.5"]+"%).",
    m.btts>=58?"Both teams to score: yes ("+m.btts+"%).":m.btts<=42?"Both teams to score: no ("+(100-m.btts).toFixed(1)+"%).":"Both teams to score: "+m.btts+"%.",
    "Likeliest score: "+m.scores[0].score+" ("+m.scores[0].p+"%)."
  ];
  return {leagues:{home:hl,away:al},averages:{home:hAvg,away:aAvg},teams:{home:h,away:a},strengths:{homeAttack:1,homeDefence:1,awayAttack:1,awayDefence:1},model:m,h2h,verdict,matchDate:matchDate||null,historical:!!matchDate&&cutoff.getTime()<new Date().setUTCHours(0,0,0,0),actual:actual?.score?{date:actual.date,status:"FINISHED",homeGoals:actual.score.home,awayGoals:actual.score.away,competition:actual.competition}:null};
}
export async function savePrediction(row:Record<string,unknown>) {
  const note=(()=>{try{return JSON.parse(String(row.note||"{}"));}catch{return {};}})();
  const {data,error}=await sb().from("sport_predictions").insert({...row,note:JSON.stringify({...note,provider:"super-api-football"})}).select("id").single();
  if(error) throw new Error(error.message);
  return data?.id??null;
}
export async function saveOdds(id:number,selections:unknown,highestChance:unknown) {
  if(!Number.isInteger(id)||id<=0) throw new Error("Missing prediction history ID.");
  const safe=Array.isArray(selections)?selections.slice(0,60):[];
  const {data:existing}=await sb().from("sport_predictions").select("note").eq("id",id).maybeSingle();
  let prior:any={};try{prior=existing?.note?JSON.parse(existing.note):{};}catch{}
  const {error}=await sb().from("sport_predictions").update({note:JSON.stringify({...prior,bookmakerComparison:safe,highestChance})}).eq("id",id);
  if(error) throw new Error(error.message);
}
export async function history() {
  const {data,error}=await sb().from("sport_predictions").select("*").order("id",{ascending:false}).limit(100);
  if(error) throw new Error(error.message);
  return (data||[]).filter((x:any)=>{try{return JSON.parse(x.note||"{}").provider==="super-api-football";}catch{return false;}}).slice(0,30);
}
export async function setResult(id:number,result:string) {
  await sb().from("sport_predictions").update({result:result.slice(0,20)}).eq("id",id);
}
