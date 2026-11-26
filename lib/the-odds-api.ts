type Sport = { key: string; group?: string; title?: string };
const cache = new Map<string,{until:number;value:any}>();
async function get(path:string, ttl=0) {
  const key=process.env.THE_ODDS_API_KEY;
  if(!key) throw new Error("Add THE_ODDS_API_KEY to Vercel Production.");
  const hit=cache.get(path);
  if(hit && hit.until>Date.now()) return hit.value;
  const url=new URL("https://api.the-odds-api.com/v4"+path);
  url.searchParams.set("apiKey",key);
  const res=await fetch(url.toString(),{cache:"no-store",signal:AbortSignal.timeout(12000)});
  const raw=await res.text(); let data:any;
  try{data=raw?JSON.parse(raw):null;}catch{data=null;}
  if(!res.ok) throw new Error("The Odds API ("+res.status+"): "+String(data?.message||data?.error||raw||res.statusText).slice(0,200));
  const out={data,remaining:res.headers.get("x-requests-remaining"),used:res.headers.get("x-requests-used"),last:res.headers.get("x-requests-last")};
  if(ttl) cache.set(path,{until:Date.now()+ttl,value:out});
  return out;
}
const clean=(v:string)=>String(v||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/\b(fc|afc|cf|sc|club)\b/g," ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
const hints:Array<[RegExp,string]>=[
 [/champions league/,"soccer_uefa_champs_league"],[/europa league/,"soccer_uefa_europa_league"],[/conference league/,"soccer_uefa_europa_conference_league"],
 [/premier league/,"soccer_epl"],[/championship/,"soccer_efl_champ"],[/la liga|primera division/,"soccer_spain_la_liga"],
 [/bundesliga/,"soccer_germany_bundesliga"],[/serie a/,"soccer_italy_serie_a"],[/ligue 1/,"soccer_france_ligue_one"],
 [/brasileir|brasil/,"soccer_brazil_campeonato"],[/eredivisie/,"soccer_netherlands_eredivisie"],[/primeira liga/,"soccer_portugal_primeira_liga"],
 [/scottish premiership/,"soccer_spl"],[/mls/,"soccer_usa_mls"],[/saudi pro league/,"soccer_saudi_professional_league"],
 [/super lig/,"soccer_turkey_super_league"],[/argentina|primera nacional/,"soccer_argentina_primera_division"]
];
async function sports():Promise<Sport[]>{
 const r=await get("/sports",21600000);return Array.isArray(r.data)?r.data:[];
}
export async function getTheOddsApiStatus(){
 if(!process.env.THE_ODDS_API_KEY)return {keyConfigured:false,active:false,provider:"The Odds API",error:"Add THE_ODDS_API_KEY to Vercel Production."};
 try{const s=await sports();const soccer=s.filter(x=>/^soccer_/.test(x.key)||/soccer/i.test(x.group||""));return {keyConfigured:true,active:soccer.length>0,provider:"The Odds API",soccerSports:soccer.length,competitions:soccer.map(x=>x.title).slice(0,30)};}
 catch(e){return {keyConfigured:true,active:false,provider:"The Odds API",error:e instanceof Error?e.message:String(e)};}
}
export async function getTheOddsApiMatchOdds(home:string,away:string,date?:string,competition=""){
 const all=await sports();const comp=clean(competition);const hint=hints.find(([re])=>re.test(comp));
 const sportKey=(hint&&all.some(x=>x.key===hint[1])?hint[1]:all.find(x=>clean(x.title||"")===comp)?.key)||"";
 if(!sportKey)throw new Error("The Odds API has no listed soccer feed for "+(competition||"this competition")+".");
 const ev=await get("/sports/"+encodeURIComponent(sportKey)+"/events",90000);
 const events=Array.isArray(ev.data)?ev.data:[];
 const target=date?Date.parse(date):NaN;
 const matches=events.filter((x:any)=>clean(x.home_team)===clean(home)&&clean(x.away_team)===clean(away))
  .map((x:any)=>({x,d:Number.isFinite(target)?Math.abs(Date.parse(x.commence_time)-target):0}))
  .filter((x:any)=>!Number.isFinite(target)||x.d<18*3600000).sort((a:any,b:any)=>a.d-b.d);
 if(!matches.length)return {matched:[],count:0,availableBookmakers:[],diagnostics:{eventsReturned:events.length,matchedEvents:0,sportKey,competition,sampleEvents:events.slice(0,5).map((x:any)=>({home:x.home_team,away:x.away_team})),providers:{theOddsApi:{ok:true,matched:0}}}};
 const event=matches[0].x;const regions=process.env.THE_ODDS_API_REGIONS||"eu";
 const markets=process.env.THE_ODDS_API_MARKETS||"h2h,totals,btts,double_chance";
 const odds=await get("/sports/"+encodeURIComponent(sportKey)+"/events/"+encodeURIComponent(event.id)+"/odds?regions="+encodeURIComponent(regions)+"&markets="+encodeURIComponent(markets)+"&oddsFormat=decimal",30000);
 const books=Array.isArray(odds.data?.bookmakers)?odds.data.bookmakers:[];
 const matched=books.length?[{home:event.home_team,away:event.away_team,commence_time:event.commence_time,bookmakers:books}]:[];
 return {matched,count:matched.length,availableBookmakers:[...new Set(books.map((b:any)=>b.title||b.key))],diagnostics:{eventsReturned:events.length,matchedEvents:matched.length,sportKey,eventId:event.id,remainingCredits:odds.remaining,usedCredits:odds.used,lastRequestCost:odds.last,sampleEvents:[{home:event.home_team,away:event.away_team}],providers:{theOddsApi:{ok:true,matched:matched.length,bookmakers:books.length,regions,markets}}}};
}
