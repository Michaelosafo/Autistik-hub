/**
 * SUPER board data adapter: Sportmonks Football API v3.
 * Uses its own SPORTMONKS_API_TOKEN and isolated cache namespace while reusing
 * the SPORT Poisson probability model for apples-to-apples comparison.
 */
import { supabaseService } from "@/lib/supabase/server";
import { model } from "@/lib/sport";

const BASE = "https://api.sportmonks.com/v3/football";
const TTL = 6 * 60 * 60_000;
const sb = () => supabaseService();
const includes = "participants;scores;league;state;statistics";

export const superReady = () => !!process.env.SPORTMONKS_API_TOKEN;

async function api(path: string, ttl = TTL): Promise<any> {
  const token = process.env.SPORTMONKS_API_TOKEN;
  if (!token) throw new Error("Add SPORTMONKS_API_TOKEN in Vercel, then redeploy.");
  const key = "sportmonks:" + path;
  const { data: hit } = await sb().from("sport_cache").select("data,at").eq("key", key).maybeSingle();
  if (hit && Date.now() - Date.parse(hit.at) < ttl) return hit.data;
  const r = await fetch(BASE + path, {
    headers: { Authorization: token, Accept: "application/json" },
    cache: "no-store",
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.message === "Unauthenticated." || body?.error) {
    if (hit) return hit.data;
    throw new Error("Sportmonks: " + String(body?.message || body?.error || r.statusText).slice(0, 180));
  }
  await sb().from("sport_cache").upsert({ key, data: body, at: new Date().toISOString() });
  return body;
}

const rows = (body: any) => Array.isArray(body?.data) ? body.data : [];
const participants = (f: any) => {
  const p = Array.isArray(f?.participants) ? f.participants : [];
  const home = p.find((x: any) => x.meta?.location === "home") || p[0];
  const away = p.find((x: any) => x.meta?.location === "away") || p[1];
  return { home, away };
};
const score = (f: any, location: "home" | "away") => {
  const { home, away } = participants(f);
  const id = location === "home" ? home?.id : away?.id;
  const candidates = (f?.scores || []).filter((x: any) => x.participant_id === id);
  const full = candidates.find((x: any) => /CURRENT|FT|FULL/i.test(String(x.description || ""))) || candidates[candidates.length - 1];
  const n = Number(full?.score?.goals);
  return Number.isFinite(n) ? n : null;
};
const status = (f: any) => String(f?.state?.short_name || f?.state?.name || "").toUpperCase();
const finished = (f: any) => ["FT", "AET", "PEN", "FINISHED", "FULL TIME"].some((x) => status(f).includes(x));
const dateOf = (f: any) => String(f?.starting_at || "").replace(" ", "T") + (String(f?.starting_at || "").includes("Z") ? "" : "Z");
function fixture(f: any) {
  const { home, away } = participants(f);
  if (!home?.id || !away?.id) return null;
  const hs = score(f, "home"), as = score(f, "away");
  return {
    id: f.id, date: dateOf(f), status: finished(f) ? "FINISHED" : status(f) || "SCHEDULED",
    competition: f.league?.name || "Football",
    home: { id: home.id, name: home.name, logo: home.image_path || "" },
    away: { id: away.id, name: away.name, logo: away.image_path || "" },
    score: finished(f) && hs != null && as != null ? { home: hs, away: as } : null,
  };
}

export async function searchTeams(q: string) {
  const query = q.trim();
  if (query.length < 3) return [];
  const data = await api("/teams/search/" + encodeURIComponent(query), 7 * 86400_000);
  return rows(data).slice(0, 15).map((t: any) => ({
    id: Number(t.id), name: t.name, country: t.country?.name || t.country_name || "",
    logo: t.image_path || "",
  }));
}

export async function todayCompetitionMatches() {
  const today = new Date().toISOString().slice(0, 10);
  const data = await api("/fixtures/date/" + today + "?include=" + includes, 2 * 60_000);
  return rows(data).map(fixture).filter(Boolean).sort((a: any,b: any) => Date.parse(a.date)-Date.parse(b.date));
}

export async function matchesOnDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z"))) throw new Error("Choose a valid match date.");
  const data = await api("/fixtures/date/" + date + "?include=" + includes, 30 * 60_000);
  return rows(data).map(fixture).filter((f: any) => f?.score && String(f.date).slice(0,10) === date)
    .sort((a: any,b: any) => Date.parse(a.date)-Date.parse(b.date));
}

async function teamFixtures(teamId: number, from: string, to: string) {
  const data = await api("/fixtures/between/" + from + "/" + to + "/" + teamId + "?include=" + includes + "&per_page=50", 3 * 3600_000);
  return rows(data).map(fixture).filter(Boolean);
}

export async function teamFixtureChoices(teamId: number) {
  const from = new Date(Date.now() - 560 * 86400_000).toISOString().slice(0,10);
  const to = new Date(Date.now() + 180 * 86400_000).toISOString().slice(0,10);
  const all = await teamFixtures(teamId, from, to);
  const now = Date.now();
  const last = all.filter((f: any) => f.score && Date.parse(f.date) < now).sort((a: any,b: any) => Date.parse(b.date)-Date.parse(a.date))[0];
  const next = all.filter((f: any) => !f.score && Date.parse(f.date) >= now).sort((a: any,b: any) => Date.parse(a.date)-Date.parse(b.date))[0];
  return [last,next].filter(Boolean);
}

function summarize(teamId: number, matches: any[]) {
  const all = matches.slice(0,30);
  let hGF=0,hGA=0,hN=0,aGF=0,aGA=0,aN=0,w=0,d=0,l=0;
  const form = all.slice(0,10).map((f: any) => {
    const isHome=f.home.id===teamId, gf=isHome?f.score.home:f.score.away, ga=isHome?f.score.away:f.score.home;
    if(isHome){hGF+=gf;hGA+=ga;hN++;}else{aGF+=gf;aGA+=ga;aN++;}
    if(gf>ga){w++;return "W";} if(gf===ga){d++;return "D";} l++;return "L";
  }).reverse().join("");
  const recent=all.slice(0,5).map((f: any) => {
    const isHome=f.home.id===teamId, gf=isHome?f.score.home:f.score.away, ga=isHome?f.score.away:f.score.home;
    return {date:f.date,vs:isHome?f.away.name:f.home.name,home:isHome,gf,ga,res:gf>ga?"W":gf===ga?"D":"L",comp:f.competition};
  });
  const stats = {
    form, played:{home:hN,away:aN,total:hN+aN},
    wins:{home:0,away:0,total:w}, draws:{home:0,away:0,total:d}, loses:{home:0,away:0,total:l},
    goalsFor:{home:hN?+(hGF/hN).toFixed(2):null,away:aN?+(aGF/aN).toFixed(2):null,total:all.length?+((hGF+aGF)/all.length).toFixed(2):null},
    goalsAgainst:{home:hN?+(hGA/hN).toFixed(2):null,away:aN?+(aGA/aN).toFixed(2):null,total:all.length?+((hGA+aGA)/all.length).toFixed(2):null},
    cleanSheets:{home:0,away:0,total:all.filter((f: any)=> (f.home.id===teamId?f.score.away:f.score.home)===0).length},
    failedToScore:{home:0,away:0,total:all.filter((f: any)=> (f.home.id===teamId?f.score.home:f.score.away)===0).length},
  };
  return {season:stats,last5:{games:recent,avg:{shots:null,onTarget:null,longShots:null,boxShots:null,passes:null,passPct:null,possession:null,corners:null,saves:null,xg:null}}};
}

export async function analyse(homeId: number, awayId: number, matchDate?: string) {
  const cutoff = matchDate ? new Date(matchDate + "T00:00:00Z") : new Date();
  if (Number.isNaN(cutoff.getTime())) throw new Error("Invalid match date.");
  const from = new Date(cutoff.getTime()-700*86400_000).toISOString().slice(0,10);
  const to = new Date(cutoff.getTime()+86400_000).toISOString().slice(0,10);
  const [hmAll,amAll] = await Promise.all([teamFixtures(homeId,from,to),teamFixtures(awayId,from,to)]);
  const historical = !!matchDate && cutoff.getTime() < new Date().setUTCHours(0,0,0,0);
  const hm = hmAll.filter((f: any)=>f.score && Date.parse(f.date)<cutoff.getTime()).sort((a: any,b: any)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,30);
  const am = amAll.filter((f: any)=>f.score && Date.parse(f.date)<cutoff.getTime()).sort((a: any,b: any)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,30);
  if(!hm.length || !am.length) throw new Error("Sportmonks returned insufficient completed match history for one or both teams in your subscribed leagues.");
  const h=summarize(homeId,hm), a=summarize(awayId,am);
  const hHome=h.season.goalsFor.home ?? 1.45, hCon=h.season.goalsAgainst.home ?? 1.15;
  const aAway=a.season.goalsFor.away ?? 1.15, aCon=a.season.goalsAgainst.away ?? 1.45;
  const lh=Math.max(0.2,Math.min(4.5,(hHome+aCon)/2));
  const la=Math.max(0.15,Math.min(4,(aAway+hCon)/2));
  const m=model(lh,la);
  const actualFixture = matchDate ? (await matchesOnDate(matchDate)).find((f: any)=>f.home.id===homeId && f.away.id===awayId) : null;
  const h2h=hm.filter((f: any)=>f.home.id===awayId || f.away.id===awayId).slice(0,6).map((f: any)=>({date:f.date,home:f.home.name,away:f.away.name,score:f.score.home+"-"+f.score.away,comp:f.competition}));
  const verdict:string[]=[];
  const fav=m.home>=m.away?{side:"home",p:m.home}:{side:"away",p:m.away};
  verdict.push(fav.p>=60?"Clear favourite: "+fav.side+" win ("+fav.p+"%).":fav.p>=45?"Leaning "+fav.side+" ("+fav.p+"%), but not safe.":"Close game: home "+m.home+"% / draw "+m.draw+"% / away "+m.away+"%.");
  verdict.push(m.over["1.5"]>=75?"Goals likely: over 1.5 at "+m.over["1.5"]+"%.":"Over 1.5 goals: "+m.over["1.5"]+"%.");
  verdict.push(m.over["2.5"]>=58?"Over 2.5 leans yes ("+m.over["2.5"]+"%).":m.over["2.5"]<=42?"Under 2.5 leans yes ("+(100-m.over["2.5"]).toFixed(1)+"%).":"Over/under 2.5 is close ("+m.over["2.5"]+"%).");
  verdict.push(m.btts>=58?"Both teams to score: yes ("+m.btts+"%).":m.btts<=42?"Both teams to score: no ("+(100-m.btts).toFixed(1)+"%).":"Both teams to score: "+m.btts+"%.");
  verdict.push("Likeliest score: "+m.scores[0].score+" ("+m.scores[0].p+"%).");
  return {
    leagues:{home:{name:hm[0]?.competition||"Football",season:new Date().getUTCFullYear()},away:{name:am[0]?.competition||"Football",season:new Date().getUTCFullYear()}},
    averages:{home:{home:1.45,away:1.15,teams:0},away:{home:1.45,away:1.15,teams:0}},
    teams:{home:h,away:a},strengths:{homeAttack:1,homeDefence:1,awayAttack:1,awayDefence:1},
    model:m,h2h,verdict,matchDate:matchDate||null,historical,
    actual:actualFixture?.score?{date:actualFixture.date,status:"FINISHED",homeGoals:actualFixture.score.home,awayGoals:actualFixture.score.away,competition:actualFixture.competition}:null,
  };
}

export async function savePrediction(row: Record<string,unknown>) {
  const note = (()=>{try{return JSON.parse(String(row.note||"{}"));}catch{return {};}})();
  const {data,error}=await sb().from("sport_predictions").insert({...row,note:JSON.stringify({...note,provider:"sportmonks"})}).select("id").single();
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
  return (data||[]).filter((x:any)=>{try{return JSON.parse(x.note||"{}").provider==="sportmonks";}catch{return false;}}).slice(0,30);
}
export async function setResult(id:number,result:string) {
  await sb().from("sport_predictions").update({result:result.slice(0,20)}).eq("id",id);
}
