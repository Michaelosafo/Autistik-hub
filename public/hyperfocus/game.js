/* Hyperfocus GP: the 3D race. Built from the game source. */
(function(){
/* ================= constants ================= */
let W=960;const H=540,SEG=200,RUMBLE=3,ROADW=2000,CAMH=1000,DRAW=160,LANES=3,CARW=380;
const camDepth=1/Math.tan(50*Math.PI/180),playerZ=CAMH*camDepth,BASE=SEG*60,STEP=1/30;
const $=s=>document.querySelector(s);
const lerp=(a,b,t)=>a+(b-a)*t, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const easeIn=(a,b,p)=>a+(b-a)*p*p, easeInOut=(a,b,p)=>a+(b-a)*((-Math.cos(p*Math.PI)/2)+0.5);
function mulberry(s){return function(){s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
let trackR=mulberry(2026), wr=mulberry(1);
const wrng=(a,b)=>a+wr()*(b-a);
const wgauss=()=>{let u=0,v=0;while(!u)u=wr();while(!v)v=wr();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
function hash(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
const reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL={night:'#0d0b1f',ink:'#f1edff',dim:'#9890c4',hot:'#ff7a2f',gas:'#ffd23f',up:'#43d18a',down:'#ff5a5a',moon:'#c08bff',line:'#2f2a5a',panel:'#18152f'};
const F_RACE="'Russo One','Arial Black',sans-serif",F_MONO="'IBM Plex Mono',monospace";
function rgba(h,a){const n=parseInt(h.replace('#',''),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtUsd=n=>(n<0?'−$':'$')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtK=n=>n>=1e6?'$'+(n/1e6).toFixed(2)+'M':n>=1e3?'$'+(n/1e3).toFixed(1)+'k':'$'+n.toFixed(0);
const fmtM=m=>m>=10?m.toFixed(0)+'x':m.toFixed(2)+'x';
const fmtAmt=n=>n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e4?(n/1e3).toFixed(1)+'k':n>=100?n.toFixed(0):n>=1?n.toFixed(2):n.toFixed(4);
const PAL=['#ff7a2f','#2fd0c9','#e8d9a8','#ff4fa0','#9be36b','#e0a3ff','#7aa9ff','#f3c623','#a27dff','#ff9f9f','#7de0b0','#ffd9a0'];

/* ================= coins (fun) & tokens ================= */
const COINS=[
  {k:'SOL',color:'#a27dff',p0:150,major:true},{k:'ETH',color:'#7aa9ff',p0:3000,major:true},{k:'BNB',color:'#f3c623',p0:600,major:true},
  {k:'JOLLOF',color:'#ff7a2f',p0:0.0042},{k:'TROTRO',color:'#2fd0c9',p0:0.018},{k:'KENKEY',color:'#e8d9a8',p0:0.0009},
  {k:'AZONTO',color:'#ff4fa0',p0:0.031},{k:'KELEWELE',color:'#9be36b',p0:0.0067},{k:'WAAKYE',color:'#e0a3ff',p0:0.0013}];
const TOK={SOL:{p0:150,evm:false,sfx:'.sol',color:'#a27dff'},ETH:{p0:3000,evm:true,sfx:'.eth',color:'#7aa9ff'},BNB:{p0:600,evm:true,sfx:'.bnb',color:'#f3c623'}};
const NAMES=['ama','kofi','yaw','efua','kwame','akosua','esi','kojo','abena','fiifi','naa','selorm','dede','mawuli'];
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',HEX='0123456789abcdef';
function addr(evm){let s='';if(evm){s='0x';for(let i=0;i<40;i++)s+=HEX[Math.floor(wr()*16)];return s.slice(0,6)+'…'+s.slice(-4);}for(let i=0;i<44;i++)s+=B58[Math.floor(wr()*58)];return s.slice(0,4)+'…'+s.slice(-4);}

/* ================= track ================= */
let segments=[],FIN=0,GATES=[];
const ROAD_L={road:'#34313f',grass:'#14211c',rumble:'#ff7a2f',lane:'#d9d3f0'},ROAD_D={road:'#2d2a37',grass:'#101b17',rumble:'#f1edff',lane:null},ROAD_F={road:'#f1edff',grass:'#14211c',rumble:'#0d0b1f',check:true};
function lastY(){return segments.length?segments[segments.length-1].p2.world.y:0;}
function addSeg(curve,y){const n=segments.length;segments.push({index:n,p1:{world:{y:lastY(),z:n*SEG},camera:{},screen:{}},p2:{world:{y,z:(n+1)*SEG},camera:{},screen:{}},curve,items:[],cars:[],color:Math.floor(n/RUMBLE)%2?ROAD_D:ROAD_L,clip:0});}
function addRoad(e,h,l,curve,height){const sy=lastY(),ey=sy+height*SEG,t=e+h+l;
  for(let n=0;n<e;n++)addSeg(easeIn(0,curve,n/e),easeInOut(sy,ey,n/t));
  for(let n=0;n<h;n++)addSeg(curve,easeInOut(sy,ey,(e+n)/t));
  for(let n=0;n<l;n++)addSeg(lerp(curve,0,n/l),easeInOut(sy,ey,(e+h+n)/t));}
function buildTrack(){
  segments=[];trackR=mulberry(2026);const r=trackR;
  addRoad(0,60,0,0,0);
  // the 3D road heads where the bends point; bends are chosen to lean back toward the main direction,
  // so the course winds forward and never loops back across itself
  const K3=0.0032,head=()=>{let a=0;for(const s of segments)a-=s.curve*K3;return a;};
  while(segments.length<4400){const hill=Math.round((r()-0.5)*70-lastY()/SEG*0.35);
    if(r()<0.22){r();r();addRoad(25,30+Math.floor(r()*40),25,0,hill);}
    else{const e=20+Math.floor(r()*40);let hh=25+Math.floor(r()*70);const l=20+Math.floor(r()*40),c=[2,3,4,5,6][Math.floor(r()*5)],a=head(),q=r();
      const back=Math.abs(a)>1.0||q<0.5+Math.min(0.45,Math.abs(a)/1.4),sg=back?(a>0?1:-1):(a>0?-1:1);
      const maxTurn=Math.max(0.35,1.25-(back?0:Math.abs(a)));hh=Math.max(0,Math.min(hh,Math.floor(maxTurn/(c*K3)-(e+l)/2)));
      addRoad(e,hh,l,c*sg,hill);}}
  addRoad(40,40,40,0,Math.round(-lastY()/SEG));
  FIN=segments.length;addRoad(0,DRAW+80,0,0,0);
  for(let i=FIN;i<FIN+3;i++)segments[i].color=ROAD_F;for(let i=8;i<10;i++)segments[i].color=ROAD_F;
  GATES=[];
  for(let n=12;n<FIN;n++){const s=segments[n];
    if(n%5===0)s.items.push({type:'palm',off:(n%10===0?-1:1)*(1.3+r()*0.9)});
    if(n%9===4&&r()<0.6)s.items.push({type:'lamp',off:(n%18<9?-1:1)*1.15});
    if(n>120&&n%85===40)s.items.push({type:'can',off:(r()-0.5)*1.4,taken:false});}
  for(let n=260,i=0;n<FIN-150;n+=360,i++){const g={type:'gate',n,i,coins:null,frozen:false,freezeT:n*SEG/(BASE*0.95)-4};segments[n].items.push(g);GATES.push(g);}
}
const segAt=z=>segments[clamp(Math.floor(z/SEG),0,segments.length-1)];

/* ================= sky ================= */
const sky={stars:[],city:[]};
(function(){const r=mulberry(7);for(let i=0;i<70;i++)sky.stars.push([r()*W,r()*0.42,r()*1.3+0.3]);let x=0;while(x<2400){const w=30+r()*70,h=20+r()*90;sky.city.push({x,w,h,win:Math.floor(r()*1000)});x+=w+4+r()*14;}})();

/* ================= race state ================= */
let S=null;           // current race
let menuMode='token',menuTok='SOL',menuBuy=25,menuReal=null;
const REAL={},LOADING=new Set(),REAL_RE=/^(bsc|ethereum|base|solana):(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
try{const b=parseFloat(localStorage.getItem('hf-buyin'));if(b>=1&&b<=100000)menuBuy=b;}catch(e){}
const BUYS=[10,25,50,100,250],SWAP_CHAIN={SOL:'solana',ETH:'ethereum',BNB:'bsc'};
let me={nick:'',color:PAL[Math.floor(Math.random()*PAL.length)]};
try{const n=localStorage.getItem('pumprally-nick');if(n)me.nick=n;const c=localStorage.getItem('pumprally-color');if(c)me.color=c;else localStorage.setItem('pumprally-color',me.color);}catch(e){}
const CARS={
  street:{name:'Street GT',speed:1.0,handle:1.0,boost:1.0,off:1.0},
  muscle:{name:'Muscle',speed:1.06,handle:0.86,boost:1.15,off:1.0},
  super:{name:'Supercar',speed:1.1,handle:1.08,boost:0.88,off:1.25},
  rally:{name:'Rally',speed:0.95,handle:1.15,boost:1.0,off:0.45}};
const CAR_KEYS=Object.keys(CARS);
const PAINTS=['#ffd23f','#ff7a2f','#ff3b5c','#2fd0c9','#7aa9ff','#a27dff','#9be36b','#f1edff'];
const HELMS=['#f1edff','#ff3b5c','#2fd0c9','#ffd23f','#111111','#a27dff'];
me.car='street';me.helmet='#f1edff';
try{const ct=localStorage.getItem('pumprally-car');if(CARS[ct])me.car=ct;const hc=localStorage.getItem('pumprally-helmet');if(hc&&/^#[0-9a-f]{6}$/i.test(hc))me.helmet=hc;}catch(e){}
function saveLook(){try{localStorage.setItem('pumprally-color',me.color);localStorage.setItem('pumprally-car',me.car);localStorage.setItem('pumprally-helmet',me.helmet);}catch(e){}}
function statOf(){return CARS[me.car]||CARS.street;}

function newWorld(mode,tok,seedStr){
  buildTrack();
  wr=mulberry(hash(seedStr));
  const startZ=playerZ+SEG*14;
  const W0={mode,tok,wt:0,tickAcc:0,histAcc:0,ai:[],aiFin:[],feed:[],events:[]};
  if(mode==='fun'){
    W0.coins={};COINS.forEach(c=>W0.coins[c.k]={...c,m:1,mom:0,pump:0,rate:0,rugged:false,mooned:false});
    const memes=COINS.filter(c=>!c.major);W0.coins[memes[Math.floor(wr()*memes.length)].k].shot=true;
    COINS.forEach((c,i)=>W0.ai.push({id:'ai'+i,ai:true,type:CAR_KEYS[(i+1)%4],ref:c.k,color:c.color,pos:startZ+(i-3)*SEG*4.5+wr()*SEG,x:[-0.6,0,0.6][i%3],tx:[-0.6,0,0.6][i%3],speed:BASE*0.5,laneT:wrng(2,5),finished:false,ft:0}));
  } else if(mode==='real'){
    const d=REAL[tok],P=d.price||1,mine=(me.wallet||'').toLowerCase();
    W0.mk={P,p0:P,wave:0,waveDir:0,hist:[P],sym:d.symbol||'TOKEN',real:true,chain:d.chain,token:d.token};
    W0.holders=[];W0.byW=new Map();W0.mine=null;
    const tierCol=x=>x==null?null:x>=100?'#c08bff':x>=10?'#43d18a':x>=2?'#2fd0c9':x>=1?'#7aa9ff':'#ff5a5a';
    let k=0;
    d.holders.forEach((r,i)=>{
      const h={label:r.lbl||(r.w.slice(0,6)+'…'+r.w.slice(-4)),w:r.w,x:r.x,est:r.est,dev:r.dev,amt:r.bal,out:!!r.out,boost:0,drag:0,act:null,actT:-9};
      W0.byW.set(r.w.toLowerCase(),h);
      if(mine&&r.w.toLowerCase()===mine){W0.mine=h;return;}
      W0.holders.push(h);
      W0.ai.push({id:'h'+i,ai:true,type:CAR_KEYS[i%4],ref:h,color:tierCol(r.x)||PAL[i%PAL.length],pos:startZ+(k-5)*SEG*3.2+wr()*SEG,x:[-0.6,0,0.6][k%3],tx:[-0.6,0,0.6][k%3],speed:BASE*0.5,laneT:wrng(2,5),finished:false,ft:0});k++;
    });
    const tr=d.trades||[],t0=tr.length?tr[0].at:0,t1=tr.length?tr[tr.length-1].at:1,span=Math.max(1,t1-t0);
    W0.replay=tr.map(t=>({...t,rt:4+(t.at-t0)/span*140}));W0.ri=0;
  } else {
    const T=TOK[tok];W0.mk={P:T.p0,p0:T.p0,wave:0,waveDir:0,hist:[T.p0]};
    W0.holders=[];
    for(let i=0;i<11;i++){
      const named=wr()<0.35,whale=i<2;
      const h={label:named?NAMES[Math.floor(wr()*NAMES.length)]+T.sfx:addr(T.evm),whale,usd0:whale?wrng(15000,40000):wrng(300,6000),boost:0,drag:0,out:false,act:null,actT:-9};
      h.amt=h.usd0/T.p0;W0.holders.push(h);
      W0.ai.push({id:'h'+i,ai:true,type:CAR_KEYS[i%4],ref:h,color:PAL[i%PAL.length],pos:startZ+(i-4)*SEG*4+wr()*SEG,x:[-0.6,0,0.6][i%3],tx:[-0.6,0,0.6][i%3],speed:BASE*0.5,laneT:wrng(2,5),finished:false,ft:0});
    }
  }
  return W0;
}
function wfeed(t){S.w.feed.unshift(t);if(S.w.feed.length>40)S.w.feed.pop();S.feedDirty=true;}
function wtoast(t,c){if(S.me)S.me.toasts.push({txt:t,color:c,t:2.6});}
function coinPrice(k){const c=S.w.coins[k];return c.p0*c.m;}

/* ---------- deterministic world ---------- */
function funTick(){
  const cs=S.w.coins;
  for(const c of COINS){const k=c.k,s=cs[k];if(s.rugged)continue;
    let d;
    if(s.major)d=wgauss()*0.007+0.0004;
    else{d=wgauss()*0.022+0.0008;
      if(s.pump>0){d+=s.rate;s.pump=Math.max(0,s.pump-0.2);}
      else{const pr=s.shot?0.03:0.012;
        if(wr()<pr){s.pump=wrng(3,8);s.rate=wrng(0.03,s.shot?0.085:0.06);if(s.m<20)wfeed(`<b>${k}</b> is pumping.`);}
        else if(wr()<0.009){s.pump=wrng(2,5);s.rate=-wrng(0.03,0.06);}}
      const rugP=s.m>4?0.0006*Math.log(s.m)*(s.shot?0.4:1):0;
      if(wr()<rugP){s.m*=0.02;s.rugged=true;s.mom=-1;wtoast(`${k} RUGGED`,COL.down);wfeed(`<b>${k}</b> rugged. Its car is stalled on the road.`);continue;}}
    s.m=clamp(s.m*Math.exp(d),0.03,140);s.mom=s.mom*0.85+d*0.15;
    if(s.m>=50&&!s.mooned){s.mooned=true;wtoast(`${k} HIT 50x · MOON MODE`,COL.moon);wfeed(`<b>${k}</b> hit 50x. Moon mode.`);}
    if(s.m<35)s.mooned=false;}
}
function tokTick(){
  const w=S.w,mk=w.mk;let flow=0;
  if(mk.wave>0)mk.wave=Math.max(0,mk.wave-0.2);
  else if(wr()<0.012){mk.wave=wrng(5,10);mk.waveDir=wr()<0.55?1:-1;wfeed(mk.waveDir>0?`Buyers are piling into <b>${w.tok}</b>.`:`Sellers are dumping <b>${w.tok}</b>.`);}
  const bm=mk.wave>0?(mk.waveDir>0?3:0.4):1,sm=mk.wave>0?(mk.waveDir<0?3:0.4):1;
  w.holders.forEach(h=>{
    h.boost=Math.max(0,h.boost-0.2);h.drag=Math.max(0,h.drag-0.2);
    if(h.out){if(wr()<0.012*bm){h.out=false;buy(h,wrng(200,1500));}return;}
    if(wr()<0.03*bm)buy(h,h.whale?wrng(2000,9000):wrng(60,900));
    else if(wr()<0.022*sm){const all=wr()<0.18,frac=all?1:wrng(0.2,0.6),usd=h.amt*frac*mk.P;h.amt-=h.amt*frac;flow-=usd;h.drag=3+frac*4;h.boost=0;
      if(all){h.out=true;h.act={t:'SOLD ALL',c:COL.down};}else h.act={t:'SELL '+fmtK(usd),c:COL.down};h.actT=w.wt;
      if(usd>1500||all)wfeed(`<b>${esc(h.label)}</b> ${all?'sold everything':'sold '+fmtK(usd)} of ${w.tok}.`);}
  });
  function buy(h,usd){h.amt+=usd/mk.P;flow+=usd;h.boost=Math.min(4,h.boost+1.5+usd/3000);h.drag=0;h.act={t:'BUY '+fmtK(usd),c:COL.up};h.actT=w.wt;if(usd>1500)wfeed(`<b>${esc(h.label)}</b> bought ${fmtK(usd)} of ${w.tok}.`);}
  const before=mk.P;
  mk.P=clamp(mk.P*Math.exp(flow/70000+wgauss()*0.003),mk.p0*0.3,mk.p0*6);
  const ch=mk.P/mk.p0;
  [1.5,2,3].forEach(lv=>{if(before/mk.p0<lv&&ch>=lv){wtoast(`${w.tok} +${Math.round((lv-1)*100)}% · FIELD SPEEDING UP`,COL.up);wfeed(`<b>${w.tok}</b> is up ${Math.round((lv-1)*100)}%. Every holder is driving faster.`);}});
}
function realTick(){
  const w=S.w,mk=w.mk;
  w.holders.forEach(h=>{h.boost=Math.max(0,h.boost-0.2);h.drag=Math.max(0,h.drag-0.2);});
  while(w.ri<w.replay.length&&w.replay[w.ri].rt<=w.wt){
    const t=w.replay[w.ri++],h=w.byW.get(String(t.w).toLowerCase()),usd=t.amt*mk.P;
    mk.P=clamp(mk.P*(1+t.s*Math.min(0.012,0.0015+usd/2e6)),mk.p0*0.3,mk.p0*6);
    if(!h)continue;
    if(t.s>0){h.amt+=t.amt;h.out=false;h.boost=Math.min(4,h.boost+2+usd/5000);h.drag=0;h.act={t:'BUY '+fmtK(usd),c:COL.up};}
    else{h.amt=t.left!=null?t.left:Math.max(0,h.amt-t.amt);h.drag=3+Math.min(4,usd/3000);h.boost=0;if(h.amt<=0){h.out=true;h.act={t:'SOLD ALL',c:COL.down};}else h.act={t:'SELL '+fmtK(usd),c:COL.down};}
    h.actT=w.wt;
    if(usd>=300||h.out)wfeed(`<b>${esc(h.label)}</b> ${t.s>0?'bought':h.out?'sold everything,':'sold'} ${fmtK(usd)} of $${esc(mk.sym)}.`);
  }
}
const fmtX=x=>x==null?'?':x>=1000?Math.round(x).toLocaleString('en-US')+'x':x>=10?x.toFixed(0)+'x':x.toFixed(x>=1?1:2)+'x';
const fmtPrice=p=>!p?'$0':p>=1?fmtUsd(p):'$'+Number(p.toPrecision(3)).toString();
function tokLabel(){return S&&S.w.mk&&S.w.mk.sym?'$'+S.w.mk.sym:(S?S.tok:'');}
function priceFactor(){const mk=S.w.mk;return clamp(1+1.3*Math.log(mk.P/mk.p0),0.45,1.9);}
function aiTarget(r){
  if(S.w.mode==='fun'){const c=S.w.coins[r.ref];if(c.rugged)return BASE*0.05;return BASE*clamp(0.7+0.11*Math.log(c.m)+c.mom*8,0.32,1.5)*(c.m>=50?1.22:1);}
  const h=r.ref,xf=S.w.mode==='real'?clamp(1+0.2*Math.log10(Math.max(h.x||1,0.02)),0.5,1.65):1;
  return BASE*0.8*xf*priceFactor()*(h.boost>0?1.4:1)*(h.drag>0?0.5:1)*(h.out?0.32:1);
}
function gatePicks(g){
  const cs=S.w.coins,live=COINS.filter(c=>!cs[c.k].rugged);
  const memes=live.filter(c=>!c.major).sort((a,b)=>cs[b.k].mom-cs[a.k].mom||a.k.localeCompare(b.k));
  const majors=live.filter(c=>c.major).sort((a,b)=>cs[b.k].m-cs[a.k].m);
  const p=[(memes[0]||majors[0]).k,(majors[0]||live[0]).k,(memes[1]||majors[1]||live[0]).k];
  const rot=g.i%3;return p.slice(rot).concat(p.slice(0,rot));
}
function worldStep(dt){
  const w=S.w;w.wt+=dt;w.tickAcc+=dt;
  while(w.tickAcc>=0.2-1e-9){w.tickAcc-=0.2;w.mode==='fun'?funTick():w.mode==='real'?realTick():tokTick();}
  w.histAcc+=dt;if(w.histAcc>=1){w.histAcc-=1;if(w.mk){w.mk.hist.push(w.mk.P);if(w.mk.hist.length>60)w.mk.hist.shift();}}
  if(w.mode==='fun')GATES.forEach(g=>{if(!g.frozen&&w.wt>=g.freezeT){g.coins=gatePicks(g);g.frozen=true;}});
  for(const r of w.ai){
    if(r.finished){r.speed=Math.max(BASE*0.3,r.speed-BASE*0.3*dt);r.pos+=r.speed*dt;continue;}
    const stalled=w.mode==='fun'?w.coins[r.ref].rugged:false;
    const tgt=aiTarget(r);r.speed+=(tgt-r.speed)*Math.min(1,dt*(stalled?3:1.4));
    r.laneT-=dt;if(!stalled&&r.laneT<=0){r.laneT=wrng(2.5,6);r.tx=[-0.62,0,0.62][Math.floor(wr()*3)];}
    if(!stalled)for(const o of w.ai){if(o===r)continue;const gap=o.pos-r.pos;
      if(gap>0&&gap<SEG*4&&Math.abs(o.x-r.x)<0.4&&o.speed<r.speed){const opts=[-0.62,0,0.62].filter(l=>Math.abs(l-o.x)>0.5);r.tx=opts.sort((a,b)=>Math.abs(a-r.x)-Math.abs(b-r.x))[0];if(gap<SEG*1.2)r.speed=Math.min(r.speed,o.speed*0.98);break;}}
    r.x+=clamp(r.tx-r.x,-0.9*dt,0.9*dt);r.pos+=r.speed*dt;
    if(r.pos>=FIN*SEG){r.finished=true;r.ft=w.wt;}
  }
}

/* ---------- local driver ---------- */
function myValue(h){return S.w.mode==='fun'?h.amt*coinPrice(h.coin):h.cash+h.amt*S.w.mk.P;}
function engine(h){const st=h.start||100;return S.w.mode==='fun'?clamp(1+0.15*Math.log(Math.max(0.01,myValue(h))/st),0.65,1.4):clamp(1+0.12*Math.log(Math.max(0.01,myValue(h))/st),0.75,1.3);}
function updMe(h,dt){
  h.toasts.forEach(t=>t.t-=dt);h.toasts=h.toasts.filter(t=>t.t>0).slice(-3);h.shake=Math.max(0,h.shake-dt);
  if(h.finished){h.speed=Math.max(0,h.speed-BASE*0.6*dt);h.pos+=h.speed*dt;return;}
  const fun=S.w.mode==='fun',seg=segAt(h.pos),i=h.inp;
  let boosting=false,maxS;
  const st=statOf();
  if(fun){boosting=i.gas&&h.gas>0;if(boosting)h.gas=Math.max(0,h.gas-26*dt);maxS=BASE*engine(h)*st.speed*(boosting?1+0.45*st.boost:1);}
  else{
    const P=S.w.mk.P;h.tradeT-=dt;
    if(i.gas&&h.tradeT<=0){if(h.cash>=1){const u=Math.min(15,h.cash);h.cash-=u;h.amt+=u/P;h.boostT=0.8;h.tradeT=0.35;}else{if(!h.warned){h.toasts.push({txt:'OUT OF CASH · BRAKE SELLS',color:COL.down,t:2});h.warned=true;}}}
    if(i.brake&&h.tradeT<=0&&h.amt*P>=1){const u=Math.min(15,h.amt*P);h.amt-=u/P;h.cash+=u;h.tradeT=0.35;h.warned=false;}
    h.boostT=Math.max(0,h.boostT-dt);boosting=h.boostT>0;
    maxS=BASE*priceFactor()*engine(h)*st.speed*(boosting?1+0.4*st.boost:1)*(h.realX?clamp(1+0.08*Math.log10(Math.max(h.realX,0.1)),0.92,1.2):1);
  }
  h.boosting=boosting;
  if(i.brake)h.speed-=BASE*(fun?1.3:0.9)*dt;
  else if(h.speed<maxS)h.speed=Math.min(maxS,h.speed+BASE/(boosting?2.4:4.2)*dt);
  else h.speed=Math.max(maxS,h.speed-BASE/3*dt);
  // smooth steering: the wheel turns in quickly but not instantly, the car carries sideways momentum,
  // the bend pushes it outward, and the guard rails stop it (with a scrape) instead of letting it through
  const sp=h.speed/BASE,grip=2.1*st.handle*Math.max(0.35,Math.min(1,sp));
  let tgt=(i.left?-1:0)+(i.right?1:0);
  if(!tgt&&tiltOn&&Math.abs(tiltVal)>0.08)tgt=clamp(tiltVal*1.15,-1,1);
  h.steer=(h.steer||0)+(tgt-(h.steer||0))*Math.min(1,dt*(tgt?7:10));
  const want=h.steer*grip-grip*Math.min(1,sp)*seg.curve*0.28;
  h.vx=(h.vx||0)+(want-(h.vx||0))*Math.min(1,dt*(fun?7:8));
  h.x+=h.vx*dt;
  if(Math.abs(h.x)>1.11){h.x=Math.sign(h.x)*1.11;h.vx=-h.vx*0.25;if(h.speed>BASE*0.35){h.speed-=BASE*0.9*dt;h.shake=Math.max(h.shake||0,0.12);h.scrape=0.2;}}
  if(h.scrape>0)h.scrape-=dt;
  if(Math.abs(h.x)>1.0&&h.speed>BASE*0.3)h.speed-=BASE*0.6*st.off*dt;
  h.speed=clamp(h.speed,0,BASE*2.4);
  const prev=Math.floor(h.pos/SEG);h.pos+=h.speed*dt;const cur=Math.floor(h.pos/SEG);
  h.skyOff+=seg.curve*Math.min(1,sp)*dt*30;
  for(let n=prev+1;n<=cur&&n<segments.length;n++)for(const it of segments[n].items){
    if(it.type==='can'&&!it.taken&&Math.abs(it.off-h.x)<0.32){it.taken=true;
      if(fun){h.gas=Math.min(100,h.gas+38);h.toasts.push({txt:'+ GAS',color:COL.gas,t:1.8});}
      else{h.cash+=10;h.toasts.push({txt:'AIRDROP +$10',color:COL.gas,t:1.8});}}
    if(it.type==='gate'&&fun)doGate(h,it);
  }
  for(const r of S.w.ai){const gap=r.pos-h.pos;
    if(gap>0&&gap<SEG*1.1&&Math.abs(r.x-h.x)<0.36&&h.speed>r.speed){h.speed=r.speed*0.8;h.pos=r.pos-SEG*1.1;h.shake=0.25;break;}}
  if(h.pos>=FIN*SEG){h.finished=true;h.ft=S.w.wt;h.toasts.push({txt:'FINISHED',color:COL.gas,t:3});
    S.w.feed.unshift(`<b>${esc(h.name)}</b> crossed the line${fun&&h.swaps?` and settled ${h.swaps} offline swap${h.swaps>1?'s':''}`:''}.`);S.feedDirty=true;}
}
function doGate(h,g){
  if(!g.coins)g.coins=gatePicks(g);
  if(Math.abs(h.x)>1.1){h.toasts.push({txt:'MISSED SWAP GATE',color:COL.dim,t:1.6});return;}
  const to=g.coins[h.x<-0.33?0:h.x>0.33?2:1];
  if(to===h.coin){h.toasts.push({txt:`HOLDING ${to}`,color:COL.dim,t:1.6});return;}
  const val=myValue(h)*0.997,from=h.coin;h.amt=val/coinPrice(to);h.coin=to;h.swaps++;
  h.toasts.push({txt:`SWAPPED ${from} → ${to} · SIGNED OFFLINE`,color:S.w.coins[to].color,t:2.4});
  S.w.feed.unshift(`<b>${esc(h.name)}</b> swapped ${from} → ${to} offline (${fmtUsd(val)}). Settles at the finish.`);S.feedDirty=true;
  if(window.PRWallet)window.PRWallet.logRaceSwap(from,to,val);
}

/* ================= racing session ================= */
function startRace(mode,tok,go,seedStr){
  if(mode==='real'&&!REAL[tok]){loadReal(tok).then(d=>{if(d&&d.tracked)startRace(mode,tok,go,seedStr);});return;}
  lastGo=go;
  const w=newWorld(mode,tok,seedStr);
  const startZ=playerZ+SEG*14;
  const h={me:true,name:me.nick||'You',color:me.color,type:me.car,helmet:me.helmet,pos:startZ+SEG*2+Math.random()*SEG*1.5,x:(Math.random()-0.5)*1.2,speed:0,inp:{left:0,right:0,gas:0,brake:0},toasts:[],shake:0,skyOff:0,finished:false,ft:0,boosting:false};
  const buy=menuBuy;h.buy=buy;
  if(mode==='fun'){h.coin=tok;h.amt=buy/w.coins[tok].p0;h.gas=60;h.swaps=0;h.start=buy;}
  else{h.cash=Math.round(buy*50)/100;h.amt=buy/w.mk.p0;h.tradeT=0;h.boostT=0;h.start=buy+h.cash;}
  if(mode==='real'&&w.mine){h.realX=w.mine.x;h.name=(me.nick||'You');}
  w.feed.unshift(`<b>${esc(h.name)}</b> bought in with ${fmtUsd(buy)} of ${mode==='real'?'$'+esc(w.mk.sym):tok}.`);
  if(mode==='real'&&w.mine)w.feed.unshift(`Your wallet is in this race: up ${fmtX(w.mine.x)} on your real bag. Engine boosted.`);
  S={w,me:h,go,mode,tok,remotes:[],feedDirty:true,endShown:false,pubT:0,steps:0};
  if(G){G.camInit=false;G.lookAt.set(0,0,0);}
  ['homeOv','lobbyOv','endOv'].forEach(id=>$('#'+id).hidden=true);
  if(!immersive())enterImmersive(false);
  document.body.classList.add('racing');
  $('#pads').hidden=false;
  $('#padGas').textContent=mode==='fun'?'GAS':'BUY';$('#padBrake').textContent=mode==='fun'?'BRAKE':'SELL';
  $('#keyHint').innerHTML=mode==='fun'?'<b>← →</b> steer · <b>Space / ↑</b> GAS · <b>↓</b> brake':'<b>← →</b> steer · <b>Space / ↑</b> buy (boost) · <b>↓</b> sell';
  $('#wireH').textContent=mode==='fun'?'Market wire':mode==='real'?`$${w.mk.sym} live trades`:`${tok} onchain wire`;
  state='race';
  publish(true);
}
function stepWorld(){
  if(!S||state!=='race')return;
  const target=Math.floor(Math.max(0,Date.now()-S.go)/1000/STEP);
  let n=0;while(S.steps<target&&n<240){worldStep(STEP);S.steps++;n++;}
}
function racing(){return S&&state==='race'&&Date.now()>=S.go;}

/* ---------- remote friends ---------- */
function readRemotes(){
  if(!S)return;
  if(!nr){S.remotes=[];return;}
  const now=Date.now();
  S.remotes=nr.peers().filter(p=>!p.sameTab&&p.presence&&p.presence.st==='race'&&p.presence.go===S.go&&typeof p.presence.p==='number').map(p=>{
    const q=p.presence,fin=!!q.f;
    const pos=fin?q.p:Math.min(q.p+(q.s||0)*Math.min(1.5,(now-p.updatedAt)/1000),FIN*SEG+SEG*40);
    return {remote:true,id:p.peer,name:String(q.n||'Friend').slice(0,16),color:typeof q.c==='string'&&/^#[0-9a-f]{6}$/i.test(q.c)?q.c:'#ffffff',pos,x:clamp(+q.x||0,-2.3,2.3),speed:+q.s||0,finished:fin,ft:+q.ft||0,value:+q.v||0,boost:!!q.g,coin:q.k,type:CARS[q.t]?q.t:'street',helmet:typeof q.hc==='string'&&/^#[0-9a-f]{6}$/i.test(q.hc)?q.hc:'#f1edff'};
  });
}
function publish(force){
  if(!nr||!S)return;
  const h=S.me;
  nr.presence({n:me.nick||'Friend',c:me.color,st:'race',go:S.go,p:Math.round(h.pos),x:+h.x.toFixed(3),s:Math.round(h.speed),f:h.finished?1:0,ft:+h.ft.toFixed(2),v:+myValue(h).toFixed(2),b:h.buy||0,g:h.boosting?1:0,k:S.mode==='fun'?h.coin:S.mode==='real'?tokLabel():S.tok,t:me.car,hc:me.helmet}).catch(()=>{});
}

/* ---------- standings ---------- */
function allRacers(){return S?[...S.w.ai,S.me,...S.remotes]:[];}
function ranked(){
  return allRacers().slice().sort((a,b)=>{
    if(a.finished&&b.finished)return a.ft-b.ft;if(a.finished)return -1;if(b.finished)return 1;return b.pos-a.pos;});
}
function placeOf(r,list){return list.indexOf(r)+1;}
function disp(r){
  if(r.me||r.remote){
    const sub=r.me?fmtUsd(myValue(r)):fmtUsd(r.value);
    return {label:r.me?(S.remotes.length?r.name:'YOU'):r.name,sub,subCol:COL.gas,color:r.color,boost:r.me?r.boosting:r.boost,human:true};
  }
  if(S.w.mode==='fun'){const c=S.w.coins[r.ref];return {label:r.ref,sub:c.rugged?'RUG':fmtM(c.m),subCol:c.rugged?COL.dim:c.m>=50?COL.moon:c.mom>=0?COL.up:COL.down,color:r.color,moon:c.m>=50,rug:c.rugged};}
  const h=r.ref,recent=h.act&&S.w.wt-h.actT<1.8;
  if(S.w.mode==='real')return {label:h.label,sub:recent?h.act.t:h.out?'SOLD ALL':h.x==null?fmtK(h.amt*S.w.mk.P):fmtX(h.x)+(h.est?'~':''),subCol:recent?h.act.c:h.out?COL.dim:h.x==null?COL.ink:h.x>=100?COL.moon:h.x>=1?COL.up:COL.down,color:r.color,boost:h.boost>0,brake:h.drag>0,rug:h.out,moon:(h.x||0)>=100&&!h.out,mono:true};
  return {label:h.label,sub:recent?h.act.t:h.out?'SOLD OUT':fmtK(h.amt*S.w.mk.P),subCol:recent?h.act.c:h.out?COL.dim:COL.ink,color:r.color,boost:h.boost>0,brake:h.drag>0,rug:h.out,mono:true};
}

/* ================= rendering ================= */
const cv=$('#screen'),dpr=Math.min(2,window.devicePixelRatio||1);const ctx=cv.getContext('2d');
function resize(){
  const r=$('#view').getBoundingClientRect(),cw=Math.max(1,r.width),ch=Math.max(1,r.height),asp=cw/ch;
  W=Math.round(clamp(H*asp,720,1400));
  cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);ctx.setTransform(cv.width/W,0,0,cv.height/H,0,0);
  if(G){G.renderer.setSize(cw,ch,false);G.camera.aspect=asp;G.camera.updateProjectionMatrix();resizeFX(cw,ch);}
}

/* ================= 3D renderer (three.js) ================= */
const SC=0.01,RW=13,KCURVE=0.0032;
let G=null,C3=[];
/* Graphics quality: ULTRA and HIGH add bloom, filmic grading and edge smoothing on top of the scene; LOW keeps phones smooth. */
const COARSE=!!(window.matchMedia&&matchMedia('(pointer:coarse)').matches);
let GFX=COARSE?'low':'high';try{const q=localStorage.getItem('hf-gfx');if(q==='ultra'||q==='high'||q==='low')GFX=q;}catch(e){}
function gfxRatio(){const d=window.devicePixelRatio||1;return GFX==='ultra'?Math.min(2,d):GFX==='high'?Math.min(1.5,d):Math.min(1,d);}
const GradeShader={uniforms:{tDiffuse:{value:null},sat:{value:1.12},vig:{value:0.32},warm:{value:0.02}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'uniform sampler2D tDiffuse;uniform float sat;uniform float vig;uniform float warm;varying vec2 vUv;'+
    'void main(){vec4 c=texture2D(tDiffuse,vUv);float l=dot(c.rgb,vec3(0.2126,0.7152,0.0722));c.rgb=mix(vec3(l),c.rgb,sat);'+
    'c.rgb=c.rgb*c.rgb*(3.0-2.0*c.rgb)*0.35+c.rgb*0.65;c.r+=warm;c.b-=warm*0.6;'+
    'vec2 d=vUv-0.5;c.rgb*=1.0-vig*dot(d,d)*2.2;gl_FragColor=vec4(clamp(c.rgb,0.0,1.0),1.0);}'};
function setupFX(){
  if(!G)return;G.composer=null;
  if(GFX==='low'||!THREE.EffectComposer||!THREE.UnrealBloomPass)return;
  try{const r=G.renderer,sz=r.getSize(new THREE.Vector2()),pr=r.getPixelRatio();
    const comp=new THREE.EffectComposer(r);comp.setPixelRatio(pr);comp.setSize(sz.x,sz.y);
    comp.addPass(new THREE.RenderPass(G.scene,G.camera));
    const bloom=new THREE.UnrealBloomPass(new THREE.Vector2(sz.x/2,sz.y/2),0.5,0.55,0.86);comp.addPass(bloom);
    const grade=new THREE.ShaderPass(GradeShader);comp.addPass(grade);
    const fxaa=new THREE.ShaderPass(THREE.FXAAShader);fxaa.uniforms.resolution.value.set(1/(sz.x*pr),1/(sz.y*pr));comp.addPass(fxaa);
    G.composer=comp;G.bloom=bloom;G.grade=grade;G.fxaa=fxaa;applyFXTheme();
  }catch(e){console.warn('fx off',e);G.composer=null;}
}
function lightGlare(){if(!G||!G.mat.flare)return;G.mat.flare.opacity=G.day?0.18:0.75;G.mat.hglow.opacity=G.day?0.3:1;}
function applyFXTheme(){lightGlare();if(!G||!G.bloom)return;const day=G.day;G.bloom.strength=day?0.42:0.95;G.bloom.threshold=day?0.88:0.74;G.renderer.toneMappingExposure=day?1.0:0.9;G.bloom.radius=day?0.5:0.7;G.grade.uniforms.warm.value=day&&WORLD==='canyon'?0.025:day?0.008:-0.01;G.grade.uniforms.vig.value=day?0.3:0.42;}
function resizeFX(cw,ch){if(!G||!G.composer)return;const pr=G.renderer.getPixelRatio();G.composer.setPixelRatio(pr);G.composer.setSize(cw,ch);G.fxaa.uniforms.resolution.value.set(1/(cw*pr),1/(ch*pr));}
function setGFX(q){GFX=q;try{localStorage.setItem('hf-gfx',q);}catch(e){}if(!G)return;G.renderer.setPixelRatio(gfxRatio());
  const m=q==='ultra'?4096:q==='high'?2048:1024;if(G.sun.shadow.mapSize.x!==m){G.sun.shadow.mapSize.set(m,m);if(G.sun.shadow.map){G.sun.shadow.map.dispose();G.sun.shadow.map=null;}}
  resize();setupFX();}
/* Detail textures drawn in code: a height field turned into colour and a normal map, so rock, sand and asphalt catch the light. */
function detailTex(kind){
  const N=256,h=new Float32Array(N*N),r=mulberry(kind==='strata'?5:kind==='asph'?9:13);
  const oct=(f,a)=>{const g=new Float32Array((f+1)*(f+1));for(let i=0;i<g.length;i++)g[i]=r();
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){const fx=x/N*f,fy=y/N*f,ix=fx|0,iy=fy|0,tx=fx-ix,ty=fy-iy,sx=tx*tx*(3-2*tx),sy=ty*ty*(3-2*ty),w=f+1,
      i0=iy*w+ix,i1=iy*w+(ix+1)%f,i2=((iy+1)%f)*w+ix,i3=((iy+1)%f)*w+(ix+1)%f;h[y*N+x]+=a*((g[i0]*(1-sx)+g[i1]*sx)*(1-sy)+(g[i2]*(1-sx)+g[i3]*sx)*sy);}};
  if(kind==='strata'){oct(4,0.6);oct(16,0.25);oct(64,0.12);const b=[];for(let i=0;i<24;i++)b.push(r());
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){const k=y*N+x,v=(y/N*24+h[k]*3)%24,band=b[v|0];h[k]=band*0.7+h[k]*0.5+(v%1<0.08?-0.25:0);}}
  else if(kind==='asph'){oct(64,0.5);oct(128,0.5);}
  else{oct(8,0.5);oct(32,0.3);oct(128,0.2);}
  let lo=1e9,hi=-1e9;for(const v of h){if(v<lo)lo=v;if(v>hi)hi=v;}
  const cc=document.createElement('canvas');cc.width=cc.height=N;const cx=cc.getContext('2d'),ci=cx.createImageData(N,N);
  const nc=document.createElement('canvas');nc.width=nc.height=N;const nx=nc.getContext('2d'),ni=nx.createImageData(N,N);
  const st=kind==='asph'?2.2:kind==='strata'?5:3;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const k=y*N+x,v=(h[k]-lo)/(hi-lo),c=kind==='asph'?235+v*20:150+v*105;
    ci.data[k*4]=ci.data[k*4+1]=ci.data[k*4+2]=c;ci.data[k*4+3]=255;
    const dx=(h[y*N+(x+1)%N]-h[y*N+(x+N-1)%N])*st,dy=(h[((y+1)%N)*N+x]-h[((y+N-1)%N)*N+x])*st,l=Math.hypot(dx,dy,1);
    ni.data[k*4]=(-dx/l*0.5+0.5)*255;ni.data[k*4+1]=(dy/l*0.5+0.5)*255;ni.data[k*4+2]=(1/l*0.5+0.5)*255;ni.data[k*4+3]=255;}
  cx.putImageData(ci,0,0);nx.putImageData(ni,0,0);
  const mk=c=>{const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(8,G.renderer.capabilities.getMaxAnisotropy());return t;};
  return {map:mk(cc),normal:mk(nc)};
}
function initGL(){
  if(!window.THREE)return null;
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas:$('#gl'),antialias:true,powerPreference:'high-performance'});}catch(e){return null;}
  renderer.setPixelRatio(gfxRatio());
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  // filmic colour like a game engine: highlights roll off softly instead of clipping
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
  _v=new THREE.Vector3();_v2=new THREE.Vector3();
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xa8c6e6);scene.fog=new THREE.FogExp2(0xb9cde2,0.003);
  const camera=new THREE.PerspectiveCamera(62,16/9,0.3,2600);
  const hemi=new THREE.HemisphereLight(0xdfeaff,0x5b5a46,1.0);scene.add(hemi);
  // the sun: casts real shadows from the cars onto the road, and follows the player
  const sun=new THREE.DirectionalLight(0xfff1dc,1.1);sun.castShadow=true;sun.shadow.mapSize.set(GFX==='ultra'?4096:GFX==='high'?2048:1024,GFX==='ultra'?4096:GFX==='high'?2048:1024);
  const shc=sun.shadow.camera;shc.left=-36;shc.right=36;shc.top=36;shc.bottom=-36;shc.near=1;shc.far=260;sun.shadow.bias=-0.0006;sun.shadow.normalBias=0.04;
  scene.add(sun);scene.add(sun.target);
  const amb=new THREE.AmbientLight(0x6e7080,0.35);scene.add(amb);
  const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,
    uniforms:{top:{value:new THREE.Color(0x2d6fd2)},mid:{value:new THREE.Color(0x78ade6)},hz:{value:new THREE.Color(0xcfe0ee)},glow:{value:new THREE.Color(0xf0e2cc)},
      sunDir:{value:new THREE.Vector3(0.35,0.42,0.84).normalize()},sunCol:{value:new THREE.Color(0xfff3dc)},sunAmt:{value:1}},
    vertexShader:'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform vec3 top;uniform vec3 mid;uniform vec3 hz;uniform vec3 glow;uniform vec3 sunDir;uniform vec3 sunCol;uniform float sunAmt;varying vec3 vP;'+
      'void main(){vec3 d=normalize(vP);float h=clamp(d.y,-0.1,1.0);vec3 c=mix(hz,glow,smoothstep(0.0,0.04,h)*(1.0-smoothstep(0.04,0.14,h)));c=mix(c,mid,smoothstep(0.06,0.25,h));c=mix(c,top,smoothstep(0.25,0.75,h));'+
      'float s=max(dot(d,sunDir),0.0);c+=sunCol*(pow(s,900.0)*5.0+pow(s,24.0)*0.28+pow(s,4.0)*0.06)*sunAmt;gl_FragColor=vec4(c,1.0);}'});
  const sky=new THREE.Mesh(new THREE.SphereGeometry(2200,32,16),skyMat);scene.add(sky);
  const sg=new THREE.BufferGeometry(),sp=[],sr=mulberry(11);
  for(let i=0;i<900;i++){const th=sr()*Math.PI*2,ph=Math.acos(0.15+sr()*0.85);sp.push(2000*Math.sin(ph)*Math.cos(th),2000*Math.cos(ph),2000*Math.sin(ph)*Math.sin(th));}
  sg.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));
  const stars=new THREE.Points(sg,new THREE.PointsMaterial({color:0xe9e2ff,size:1.6,sizeAttenuation:false,fog:false,transparent:true,opacity:0.8}));scene.add(stars);
  // soft clouds on a ring around the camera
  const cc=document.createElement('canvas');cc.width=256;cc.height=128;const cx2=cc.getContext('2d'),cr=mulberry(41);
  for(let k=0;k<26;k++){const x=40+cr()*176,y=50+cr()*40,r=18+cr()*34,gr=cx2.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,'rgba(255,255,255,0.55)');gr.addColorStop(1,'rgba(255,255,255,0)');cx2.fillStyle=gr;cx2.beginPath();cx2.arc(x,y,r,0,7);cx2.fill();}
  const cloudMat=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cc),fog:false,transparent:true,depthWrite:false,opacity:0.9});
  const clouds=new THREE.Group();
  for(let k=0;k<28;k++){const a=k/28*Math.PI*2+cr()*0.2,rd=1300+cr()*500,s=new THREE.Sprite(cloudMat);s.position.set(Math.cos(a)*rd,140+cr()*320,Math.sin(a)*rd);s.scale.set(380+cr()*360,130+cr()*90,1);clouds.add(s);}
  scene.add(clouds);
  const moonDisc=new THREE.Mesh(new THREE.CircleGeometry(40,32),new THREE.MeshBasicMaterial({color:0xfff2d6,fog:false}));scene.add(moonDisc);
  const head=new THREE.SpotLight(0xe8efff,0.4,150,0.42,0.55,1);scene.add(head);scene.add(head.target);
  const lampLights=[];for(let i=0;i<4;i++){const l=new THREE.PointLight(0xffa850,0,46,2);scene.add(l);lampLights.push(l);}
  const g={renderer,scene,camera,sky,skyMat,stars,clouds,cloudMat,moonDisc,head,lampLights,hemi,moon:sun,sun,amb,cars:new Map(),labelCache:new Map(),camInit:false,lookAt:new THREE.Vector3(),tmp:{},roll:0,chunks:[],day:true,
    geo:{flame:new THREE.ConeGeometry(0.12,0.9,10),shadow:new THREE.PlaneGeometry(5.2,8.6)},
    mat:{tail:new THREE.MeshBasicMaterial({color:0xff2a3a}),head:new THREE.MeshBasicMaterial({color:0xf4f8ff}),
      flameB:new THREE.MeshBasicMaterial({color:0x7ad7ff,transparent:true,opacity:0.9,blending:THREE.AdditiveBlending,depthWrite:false}),flameM:new THREE.MeshBasicMaterial({color:0xff9a2f,transparent:true,opacity:0.95,blending:THREE.AdditiveBlending,depthWrite:false}),
      shadow:new THREE.MeshBasicMaterial({map:shadowTex(),transparent:true,depthWrite:false,opacity:0.6})}};
  return g;
}
/* The race world follows the page theme: a sunny mountain road in light mode, a moonlit one in dark mode. */
function pageDark(){const t=document.documentElement.getAttribute('data-theme');if(t==='dark')return true;if(t==='light')return false;return !!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);}
function applySceneTheme(){
  if(!G)return;const day=!pageDark(),u=G.skyMat.uniforms;G.day=day;setTimeout(applyFXTheme,0);
  if(day&&WORLD==='canyon'){u.top.value.set(0x3d72c0);u.mid.value.set(0xb8bcc4);u.hz.value.set(0xf0caa0);u.glow.value.set(0xffb470);u.sunAmt.value=1.2;
    G.scene.background.set(0xd9b48c);G.scene.fog.color.set(0xdcb58f);G.scene.fog.density=0.0034;
    G.hemi.color.set(0xffe4c4);G.hemi.groundColor.set(0x7a4a30);G.hemi.intensity=0.85;G.sun.color.set(0xffd6a6);G.sun.intensity=1.25;G.amb.color.set(0x80705e);G.amb.intensity=0.32;
    G.stars.visible=false;G.moonDisc.visible=false;G.cloudMat.color.set(0xffe9d2);G.cloudMat.opacity=0.6;G.lampLights.forEach(l=>l.intensity=0);G.head.intensity=0.4;}
  else if(day){u.top.value.set(0x2d6fd2);u.mid.value.set(0x78ade6);u.hz.value.set(0xcfe0ee);u.glow.value.set(0xf0e2cc);u.sunAmt.value=1;
    G.scene.background.set(0xa8c6e6);G.scene.fog.color.set(0xb9cde2);G.scene.fog.density=0.003;
    G.hemi.color.set(0xdfeaff);G.hemi.groundColor.set(0x4e5a3c);G.hemi.intensity=0.8;G.sun.color.set(0xfff1dc);G.sun.intensity=1.1;G.amb.color.set(0x6e7080);G.amb.intensity=0.35;
    G.stars.visible=false;G.moonDisc.visible=false;G.cloudMat.color.set(0xffffff);G.cloudMat.opacity=0.9;G.lampLights.forEach(l=>l.intensity=0);G.head.intensity=0.4;}
  else{u.top.value.set(0x05061a);u.mid.value.set(0x111536);u.hz.value.set(0x222a4a);u.glow.value.set(0x3a2f48);u.sunAmt.value=0;
    G.scene.background.set(0x0a0c1c);G.scene.fog.color.set(0x1c2238);G.scene.fog.density=0.0042;
    G.hemi.color.set(0x6d7cc0);G.hemi.groundColor.set(0x0b0b12);G.hemi.intensity=0.55;G.sun.color.set(0x9fb2ff);G.sun.intensity=0.35;G.amb.color.set(0x2a3050);G.amb.intensity=0.45;
    G.stars.visible=true;G.moonDisc.visible=true;G.cloudMat.color.set(0x4a5470);G.cloudMat.opacity=0.45;G.lampLights.forEach(l=>l.intensity=1.6);G.head.intensity=2.6;}
}
function applySceneThemeFX(){applySceneTheme();applyFXTheme();}
try{new MutationObserver(applySceneThemeFX).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class']});}catch(e){}
addEventListener('autistik-theme',()=>setTimeout(applySceneThemeFX,0));
try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applySceneThemeFX);}catch(e){}
function shadowTex(){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),gr=x.createRadialGradient(32,32,4,32,32,32);gr.addColorStop(0,'rgba(0,0,0,0.7)');gr.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=gr;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);}
function computeC3(){
  C3=[];let ang=0,px=0,pz=0;
  for(let i=0;i<=segments.length;i++){
    const s=segments[Math.min(i,segments.length-1)];
    const y=(i<segments.length?s.p1.world.y:s.p2.world.y)*SC*0.45;
    C3.push({x:px,y,z:pz,ang});
    if(i<segments.length){ang-=s.curve*KCURVE;px+=Math.sin(ang)*SEG*SC;pz+=Math.cos(ang)*SEG*SC;}
  }
}
function tp(pos,x,o){
  const f=clamp(pos/SEG,0,C3.length-1.001),i=Math.floor(f),t=f-i,a=C3[i],b=C3[i+1];
  const ang=lerp(a.ang,b.ang,t),rx=-Math.cos(ang),rz=Math.sin(ang);
  o.x=lerp(a.x,b.x,t)+rx*x*RW;o.z=lerp(a.z,b.z,t)+rz*x*RW;o.y=lerp(a.y,b.y,t);o.ang=ang;o.pitch=Math.atan2(b.y-a.y,SEG*SC);return o;
}
/* Mountain road: terrain profile across the road (distance from the centre line, height above the road). */
const TOFF=[0,1.8,3.4,7,14,26,44,62,80];
let WORLD='canyon';try{const w=localStorage.getItem('hf-world');if(w==='forest'||w==='canyon')WORLD=w;}catch(e){}
function rebuildWorld(){if(!G||!G.track)return;(G.trackObjs||[]).forEach(o=>G.scene.remove(o));G.chunks=[];G.track=false;buildGLTrack();}
function tnoise(i,s){return Math.sin(i*0.011+s)*0.5+Math.sin(i*0.029+s*2.3)*0.32+Math.sin(i*0.067+s*3.9)*0.18;}
function terrainH(i,side){
  // per segment and side: canyon walls that rise, or now and then a valley dropping away
  const s=side<0?1.3:7.1,a=tnoise(i,s),b=tnoise(i,s+11),valley=tnoise(i,s+23)<(WORLD==='canyon'?-0.62:-0.42);
  const h1=6+6*(a+1),h2=22+24*(b+1);
  if(WORLD==='canyon'&&!valley)return [0,0,0.05,h1*0.35,h1*1.3,h1*2.6,h2*1.25,h2*1.45,h2*1.55];
  return valley?[0,0,0.05,-1.2,-5,-11,-18,-22,-24]:[0,0,0.05,h1*0.16,h1*0.55,h1,h2*0.75,h2*1.1,h2*1.4];
}
function hAt(i,side,off){if(CAP&&off>CAP[side>0?1:0][Math.min(i,CAP[0].length-1)])return -999;const H=terrainH(i,side),o=off-RW;for(let k=1;k<TOFF.length;k++){if(o<=TOFF[k]){const t=(o-TOFF[k-1])/(TOFF[k]-TOFF[k-1]);return lerp(H[k-1],H[k],clamp(t,0,1));}}return H[H.length-1];}
/* Where the track bends back on itself, the land beside one stretch of road must not reach over another stretch.
   CAP holds, per segment and side, how far out the land may go; offRoad() drops scenery that would land on a road. */
let CAP=null,ROADG=null;const RCELL=24;
function roadNear(x,z){let best=1e9,bi=-1;const cx=Math.floor(x/RCELL),cz=Math.floor(z/RCELL);
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const L=ROADG.get((cx+a)*100003+(cz+b));if(L)for(const i of L){const d=Math.hypot(C3[i].x-x,C3[i].z-z);if(d<best){best=d;bi=i;}}}return [best,bi];}
function computeCaps(){
  ROADG=new Map();C3.forEach((c,i)=>{const k=Math.floor(c.x/RCELL)*100003+Math.floor(c.z/RCELL);if(!ROADG.has(k))ROADG.set(k,[]);ROADG.get(k).push(i);});
  const n=C3.length,raw=[new Float32Array(n),new Float32Array(n)];
  for(let i=0;i<n;i++){const c=C3[i],rx=-Math.cos(c.ang),rz=Math.sin(c.ang);
    [-1,1].forEach((sd,si)=>{let cap=RW+TOFF[TOFF.length-1];
      for(let o=RW+1;o<=cap;o+=2){const [d,j]=roadNear(c.x+rx*sd*o,c.z+rz*sd*o);if(Math.abs(j-i)>14&&d<RW+8){cap=o-8;break;}}
      raw[si][i]=Math.max(RW+0.5,cap);});}
  CAP=[new Float32Array(n),new Float32Array(n)];
  for(let si=0;si<2;si++)for(let i=0;i<n;i++){let m=1e9;for(let k=Math.max(0,i-5);k<=Math.min(n-1,i+5);k++)m=Math.min(m,raw[si][k]);CAP[si][i]=m;}
}
function offRoad(x,z,n){if(!ROADG)return true;const [d,j]=roadNear(x,z);return !(d<RW+3&&Math.abs(j-n)>14);}
function addChunked(geo,mat,list,opt){
  list=list.filter(e=>offRoad(e.m.elements[12],e.m.elements[14],e.n));
  // splits instances into stretches of road so only nearby ones are drawn
  const SPAN=260,M=new THREE.Matrix4(),byChunk=new Map();
  list.forEach(e=>{const c=Math.floor(e.n/SPAN);if(!byChunk.has(c))byChunk.set(c,[]);byChunk.get(c).push(e);});
  byChunk.forEach((arr,c)=>{const im=new THREE.InstancedMesh(geo,mat,arr.length);
    arr.forEach((e,i)=>{im.setMatrixAt(i,e.m);if(e.col&&im.setColorAt)im.setColorAt(i,e.col);});
    if(im.instanceColor)im.instanceColor.needsUpdate=true;
    im.frustumCulled=false;im.castShadow=!!(opt&&opt.cast);im.receiveShadow=!!(opt&&opt.recv);G.scene.add(im);
    G.chunks.push({from:c*SPAN,to:(c+1)*SPAN,mesh:im});});
}
function buildGLTrack(){
  if(!G||G.track)return;
  computeC3();computeCaps();
  // remember what the world adds, so switching worlds can take it down again
  const added=[],sceneAdd=G.scene.add.bind(G.scene);G.trackObjs=added;G.scene.add=(...o)=>{added.push(...o);return sceneAdd(...o);};
  try{buildWorld();}finally{G.scene.add=sceneAdd;}
  G.track=true;applySceneTheme();
}
function buildWorld(){
  const n=segments.length,tc=new THREE.Color(),canyon=WORLD==='canyon';
  const lat=(i,o,dy)=>{const c=C3[i],rx=-Math.cos(c.ang),rz=Math.sin(c.ang);return [c.x+rx*o,c.y+dy,c.z+rz*o];};
  // terrain: one grid per side of the road
  const TCOL=canyon?['#8a7560','#937a5e','#a9805a','#b97848','#c0804c','#b46c40','#a8643c','#9c5f3e','#905c42']:['#6c665a','#736c5e','#6f6e4c','#5f6c34','#56662f','#66683f','#6b6a5c','#666662','#616163'];
  const tr=mulberry(77),terrD=detailTex(canyon?'strata':'ground'),rockD=canyon?detailTex('ground'):terrD,asphD=detailTex('asph');
  [-1,1].forEach(side=>{
    const pos=[],col=[],idx=[],uv=[],K=TOFF.length;
    for(let i=0;i<=n;i++){const H=terrainH(Math.min(i,n-1),side);
      const cap=CAP[side>0?1:0][Math.min(i,n-1)];for(let k=0;k<K;k++){const o=Math.min(RW+TOFF[k],cap),p=lat(Math.min(i,n),side*o,(RW+TOFF[k]>cap?Math.min(H[k],H[1]+(cap-RW)*0.6):H[k])-(k<2?0.02:0));pos.push(p[0],p[1],p[2]);uv.push(i*SEG*SC/(canyon?14:9),canyon?H[k]/13:TOFF[k]/9);
        tc.set(TCOL[k]);const j=0.92+tr()*0.16;col.push(tc.r*j,tc.g*j,tc.b*j);}}
    for(let i=0;i<n;i++)for(let k=0;k<K-1;k++){const a=i*K+k,b=a+1,c=a+K,d=c+1;if(side<0)idx.push(a,c,b,b,c,d);else idx.push(a,b,c,b,d,c);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
    const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,map:terrD.map,normalMap:terrD.normal,normalScale:new THREE.Vector2(canyon?0.85:0.9,canyon?0.85:0.9),roughness:0.95,metalness:0,side:THREE.DoubleSide}));m.receiveShadow=true;G.scene.add(m);
  });
  // road surface: fresh, smooth dark asphalt with faint polished tyre lines in each lane
  const ac=document.createElement('canvas');ac.width=512;ac.height=512;const ax=ac.getContext('2d'),ar=mulberry(31);
  ax.fillStyle='#2b2c31';ax.fillRect(0,0,512,512);
  for(let k=0;k<52000;k++){const v=36+ar()*40|0;ax.fillStyle=`rgba(${v},${v},${v+5},${0.18+ar()*0.3})`;ax.fillRect(ar()*512,ar()*512,1,1);}
  for(let k=0;k<900;k++){const v=70+ar()*50|0;ax.fillStyle=`rgba(${v},${v},${v},0.35)`;ax.fillRect(ar()*512,ar()*512,1.5,1.5);}
  [0.2,0.8].forEach(u=>[-34,34].forEach(dx=>{const x0=u*512+dx,gr=ax.createLinearGradient(x0-16,0,x0+16,0);gr.addColorStop(0,'rgba(14,14,18,0)');gr.addColorStop(0.5,'rgba(14,14,18,0.14)');gr.addColorStop(1,'rgba(14,14,18,0)');ax.fillStyle=gr;ax.fillRect(x0-16,0,32,512);}));
  const at=new THREE.CanvasTexture(ac);at.wrapS=at.wrapT=THREE.RepeatWrapping;at.anisotropy=Math.min(8,G.renderer.capabilities.getMaxAnisotropy());
  const apos=[],auv=[],aidx=[],mpos=[],mcol=[],midx=[];
  function mark(i,o1,o2,hex){tc.set(hex);const v=mpos.length/3;[lat(i,o1,0.025),lat(i,o2,0.025),lat(i+1,o2,0.025),lat(i+1,o1,0.025)].forEach(p=>{mpos.push(p[0],p[1],p[2]);mcol.push(tc.r,tc.g,tc.b);});midx.push(v,v+1,v+2,v,v+2,v+3);}
  const spos=[],sidx=[];
  function shoulder(i){[-1,1].forEach(sd=>{const v=spos.length/3;[lat(i,sd*(RW+0.3),-0.005),lat(i,sd*(RW+2.1),-0.03),lat(i+1,sd*(RW+2.1),-0.03),lat(i+1,sd*(RW+0.3),-0.005)].forEach(p=>spos.push(p[0],p[1],p[2]));sidx.push(v,v+1,v+2,v,v+2,v+3);});}
  for(let i=0;i<n;i++){
    const v=apos.length/3;[lat(i,-RW-0.3,0),lat(i,RW+0.3,0),lat(i+1,RW+0.3,0),lat(i+1,-RW-0.3,0)].forEach(p=>apos.push(p[0],p[1],p[2]));
    auv.push(0,i*0.18,LANES,i*0.18,LANES,(i+1)*0.18,0,(i+1)*0.18);aidx.push(v,v+1,v+2,v,v+2,v+3);
    if(segments[i].color.check){for(let k=0;k<8;k++)mark(i,-RW+k*RW/4,-RW+(k+1)*RW/4,(k+i)%2?'#f1edff':'#14121e');continue;}
    if(i%10<6)for(let l=1;l<LANES;l++){const lx=-RW+l*2*RW/LANES;mark(i,lx-0.14,lx+0.14,'#f4f4f0');}
    mark(i,-RW+0.35,-RW+0.65,'#f4f4f0');mark(i,RW-0.65,RW-0.35,'#f4f4f0');
    const bend=Math.abs(segments[i].curve||0)>=3;
    if(bend){const k=Math.floor(i/2)%2?'#d8202a':'#f2f2f2';mark(i,-RW-0.3,-RW+0.3,k);mark(i,RW-0.3,RW+0.3,k);}
    shoulder(i);
  }
  const ag=new THREE.BufferGeometry();ag.setAttribute('position',new THREE.Float32BufferAttribute(apos,3));ag.setAttribute('uv',new THREE.Float32BufferAttribute(auv,2));ag.setIndex(aidx);ag.computeVertexNormals();
  asphD.normal.repeat.set(5,5);const asph=new THREE.Mesh(ag,new THREE.MeshStandardMaterial({map:at,normalMap:asphD.normal,normalScale:new THREE.Vector2(0.22,0.22),roughness:0.62,metalness:0.04,envMap:makeEnvOnce(),envMapIntensity:0.45,side:THREE.DoubleSide}));asph.receiveShadow=true;G.scene.add(asph);
  const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(spos,3));sg.setIndex(sidx);sg.computeVertexNormals();
  const sh=new THREE.Mesh(sg,new THREE.MeshLambertMaterial({color:canyon?0x8a7f74:0x6e6f72,side:THREE.DoubleSide}));sh.receiveShadow=true;G.scene.add(sh);
  const mg=new THREE.BufferGeometry();mg.setAttribute('position',new THREE.Float32BufferAttribute(mpos,3));mg.setAttribute('color',new THREE.Float32BufferAttribute(mcol,3));mg.setIndex(midx);mg.computeVertexNormals();
  const marks=new THREE.Mesh(mg,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));marks.receiveShadow=true;G.scene.add(marks);
  // steel guard rails on wooden posts, both sides
  const M=new THREE.Matrix4(),Q=new THREE.Quaternion(),Y=new THREE.Vector3(0,1,0),P=new THREE.Vector3(),S1=new THREE.Vector3(1,1,1),S=new THREE.Vector3();
  const RAIL=RW+2.6,rails=[],posts=[],refl=[],eyes=[],chev=[[],[]],rocks=[],pines=[],mtns=[],tcol=new THREE.Color();
  for(let i=0;i<n;i++){const c=C3[i],d=C3[i+1],ang=(c.ang+d.ang)/2,rx=-Math.cos(ang),rz=Math.sin(ang),mx=(c.x+d.x)/2,my=(c.y+d.y)/2,mz=(c.z+d.z)/2;
    Q.setFromAxisAngle(Y,ang);
    [-1,1].forEach(sd=>{[0.5,0.86].forEach(h=>{P.set(mx+rx*sd*RAIL,my+h,mz+rz*sd*RAIL);rails.push({n:i,m:new THREE.Matrix4().compose(P,Q,S1)});});
      if(i%2===0){P.set(c.x+rx*sd*(RAIL+0.16),c.y+0.5,c.z+rz*sd*(RAIL+0.16));posts.push({n:i,m:new THREE.Matrix4().compose(P,Q,S1)});}
      if(i%6===0){P.set(c.x+rx*sd*(RAIL-0.07),c.y+0.98,c.z+rz*sd*(RAIL-0.07));refl.push({n:i,m:new THREE.Matrix4().compose(P,Q,S1)});}});
    if(i%5===0&&!segments[i].color.check)for(let l=1;l<LANES;l++){const lx=-RW+l*2*RW/LANES;P.set(c.x+rx*lx,c.y+0.04,c.z+rz*lx);eyes.push({n:i,m:new THREE.Matrix4().compose(P,Q,S1)});}
    const cv=segments[i].curve||0;
    if(Math.abs(cv)>=4&&i%7===0){const sd=cv>0?-1:1;P.set(c.x+rx*sd*(RAIL+0.9),c.y+1.5,c.z+rz*sd*(RAIL+0.9));const q2=new THREE.Quaternion().setFromAxisAngle(Y,ang+(sd>0?0:Math.PI));chev[cv>0?0:1].push({n:i,m:new THREE.Matrix4().compose(P,q2,S1)});}
  }
  addChunked(new THREE.BoxGeometry(0.08,0.26,SEG*SC*1.04),new THREE.MeshStandardMaterial({color:0xd6dae2,metalness:0.85,roughness:0.28,envMap:makeEnvOnce(),envMapIntensity:1.1}),rails,{cast:true});
  addChunked(new THREE.BoxGeometry(0.14,1.0,0.14),new THREE.MeshStandardMaterial({color:0x8a8f98,metalness:0.7,roughness:0.4,envMap:makeEnvOnce(),envMapIntensity:0.7}),posts,{cast:true});
  addChunked(new THREE.BoxGeometry(0.03,0.12,0.22),new THREE.MeshBasicMaterial({color:0xffd060}),refl);
  addChunked(new THREE.BoxGeometry(0.16,0.05,0.24),new THREE.MeshBasicMaterial({color:0xfff2c8}),eyes);
  const chevTex=dir=>{const c=document.createElement('canvas');c.width=256;c.height=128;const x=c.getContext('2d');x.fillStyle='#16161a';x.fillRect(0,0,256,128);x.fillStyle='#ffd21e';
    for(let k=0;k<3;k++){const ox=40+k*64;x.beginPath();if(dir>0){x.moveTo(ox,14);x.lineTo(ox+34,64);x.lineTo(ox,114);x.lineTo(ox+20,114);x.lineTo(ox+54,64);x.lineTo(ox+20,14);}else{x.moveTo(ox+54,14);x.lineTo(ox+20,64);x.lineTo(ox+54,114);x.lineTo(ox+34,114);x.lineTo(ox,64);x.lineTo(ox+34,14);}x.fill();}
    const t=new THREE.CanvasTexture(c);return t;};
  const chevG=new THREE.PlaneGeometry(2.6,1.3);chevG.translate(0,0.4,0);
  [0,1].forEach(k=>addChunked(chevG,new THREE.MeshBasicMaterial({map:chevTex(k?1:-1),side:THREE.DoubleSide}),chev[k]));
  // boulders, pine forest and distant mountains
  const R=mulberry(123);
  for(let i=6;i<n;i+=1){
    if(R()<0.55){const sd=R()<0.5?-1:1,off=canyon?RAIL+1.6+R()*3:RAIL+2+Math.pow(R(),1.6)*34,y=hAt(i,sd,off),c=C3[i],rx=-Math.cos(c.ang),rz=Math.sin(c.ang),s=0.8+Math.pow(R(),2)*4.2;
      Q.setFromEuler(new THREE.Euler(R()*3,R()*3,R()*3));S.set(s*(0.8+R()*0.6),s*(0.6+R()*0.5),s*(0.8+R()*0.6));P.set(c.x+rx*sd*off,c.y+y-s*0.25,c.z+rz*sd*off);
      const v=0.82+R()*0.3;if(canyon)tcol.setRGB(0.7*v,0.46*v,0.32*v);else tcol.setRGB(0.54*v,0.51*v,0.47*v);rocks.push({n:i,m:new THREE.Matrix4().compose(P,Q,S),col:tcol.clone()});}
    const k=canyon?(R()<0.18?1:0):(R()<0.75?(R()<0.5?1:2):0);
    for(let t=0;t<k;t++){const sd=R()<0.5?-1:1,off=RAIL+5+Math.pow(R(),1.2)*55,y=hAt(i,sd,off);if(y<-6)continue;const c=C3[i],rx=-Math.cos(c.ang),rz=Math.sin(c.ang),s=0.8+R()*0.9;
      Q.setFromAxisAngle(Y,R()*6.3);S.set(s,s*(0.9+R()*0.4),s);P.set(c.x+rx*sd*off,c.y+y,c.z+rz*sd*off);
      if(canyon)S.multiplyScalar(0.55);const v=0.85+R()*0.3;if(canyon)tcol.setRGB(0.32*v,0.34*v,0.2*v);else tcol.setRGB(0.19*v,0.3*v,0.18*v);pines.push({n:i,m:new THREE.Matrix4().compose(P,Q,S),col:tcol.clone()});}
    if(i%60===0)[-1,1].forEach(sd=>{const c=C3[i],rx=-Math.cos(c.ang),rz=Math.sin(c.ang),off=480+R()*520,hh=140+R()*260,rr=Math.min(200+R()*260,off-230);
      const mx=c.x+rx*sd*off,mz=c.z+rz*sd*off;let clear=true;for(let q=0;q<C3.length;q+=15){const e=C3[q];if(Math.hypot(e.x-mx,e.z-mz)<rr+70){clear=false;break;}}if(!clear)return;
      Q.setFromAxisAngle(Y,R()*6.3);S.set(rr,hh,rr);P.set(mx,c.y-20,mz);const v=0.85+R()*0.25;tcol.setRGB(0.42*v,0.44*v,0.48*v);mtns.push({n:i,m:new THREE.Matrix4().compose(P,Q,S),col:tcol.clone()});});
  }
  if(canyon){const pil=[],PR=mulberry(321);
    for(let i=40;i<n;i+=9){if(PR()<0.55)continue;const sd=PR()<0.5?-1:1,off=RAIL+30+PR()*42,y=hAt(i,sd,off),c=C3[i],rx=-Math.cos(c.ang),rz=Math.sin(c.ang),rr=2.5+PR()*5,hh=18+PR()*46;
      Q.setFromAxisAngle(Y,PR()*6.3);S.set(rr,hh,rr*(0.8+PR()*0.4));P.set(c.x+rx*sd*off,c.y+y-2,c.z+rz*sd*off);const v=0.85+PR()*0.25;tcol.setRGB(0.74*v,0.44*v,0.28*v);pil.push({n:i,m:new THREE.Matrix4().compose(P,Q,S),col:tcol.clone()});}
    const pg=new THREE.CylinderGeometry(0.7,1,1,7,3);pg.translate(0,0.5,0);
    addChunked(pg,new THREE.MeshStandardMaterial({color:0xffffff,map:terrD.map,normalMap:terrD.normal,normalScale:new THREE.Vector2(1.6,1.6),roughness:0.92,flatShading:true}),pil,{cast:true});}
  const rockG=new THREE.IcosahedronGeometry(1,1);
  addChunked(rockG,new THREE.MeshStandardMaterial({color:0xffffff,map:rockD.map,normalMap:rockD.normal,normalScale:new THREE.Vector2(1.2,1.2),roughness:0.9,flatShading:true}),rocks,{cast:true,recv:true});
  const trunkG=new THREE.CylinderGeometry(0.22,0.34,2.6,6);trunkG.translate(0,1.3,0);
  const coneA=new THREE.ConeGeometry(2.4,5.2,8);coneA.translate(0,4.4,0);const coneB=new THREE.ConeGeometry(1.7,4.2,8);coneB.translate(0,7.2,0);
  addChunked(trunkG,new THREE.MeshLambertMaterial({color:0x4a3626}),pines.map(p=>({n:p.n,m:p.m})),{});
  addChunked(coneA,new THREE.MeshLambertMaterial({color:0xffffff}),pines,{cast:true});
  addChunked(coneB,new THREE.MeshLambertMaterial({color:0xffffff}),pines.map(p=>({n:p.n,m:p.m,col:p.col.clone().multiplyScalar(1.12)})),{});
  const mtG=new THREE.ConeGeometry(1,1,7);mtG.translate(0,0.5,0);
  const mt=new THREE.InstancedMesh(mtG,new THREE.MeshPhongMaterial({color:0xffffff,flatShading:true,shininess:4,specular:0x111111}),mtns.length);
  mtns.forEach((e,i)=>{mt.setMatrixAt(i,e.m);mt.setColorAt(i,e.col);});if(mt.instanceColor)mt.instanceColor.needsUpdate=true;mt.frustumCulled=false;G.scene.add(mt);
  // a few AUTISTIK billboards on the hillsides
  const ADS=[['$AUTISTIK','#ffd23f','#ff7a2f'],['HYPERFOCUS GP','#2fd0c9','#a27dff'],['DIAMOND HANDS ONLY','#7aa9ff','#2fd0c9'],['BUY · HOLD · RACE','#9be36b','#ffd23f'],['AUTISTIK.IO','#ff4fa0','#ffd23f'],['NO PAPER HANDS','#ff7a2f','#ff4fa0'],['LOCK IN','#ffd23f','#9be36b']];
  const bpost=new THREE.BoxGeometry(0.5,9,0.5),bpm=new THREE.MeshStandardMaterial({color:0x3a3a44,metalness:0.6,roughness:0.5});
  for(let k=0,i=120;i<n-60;i+=280,k++){const c=C3[i],sd=k%2?1:-1,rx=-Math.cos(c.ang),rz=Math.sin(c.ang),off=sd*(RAIL+9),y=hAt(i,sd,RAIL+9);if(y<-100||!offRoad(c.x+rx*off,c.z+rz*off,i))continue;
    const cv=document.createElement('canvas');cv.width=512;cv.height=192;const x=cv.getContext('2d'),[t,c1,c2]=ADS[k%ADS.length];
    const gr=x.createLinearGradient(0,0,512,192);gr.addColorStop(0,'#120c26');gr.addColorStop(1,'#1d1238');x.fillStyle=gr;x.fillRect(0,0,512,192);
    x.strokeStyle=c2;x.lineWidth=8;x.strokeRect(8,8,496,176);x.shadowColor=c1;x.shadowBlur=24;x.fillStyle=c1;
    x.font=`${t.length>12?54:72}px 'Russo One', sans-serif`;x.textAlign='center';x.textBaseline='middle';x.fillText(t,256,100);
    const grp=new THREE.Group(),panel=new THREE.Mesh(new THREE.PlaneGeometry(17,6.4),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv)}));
    panel.position.y=11;panel.rotation.y=Math.PI;grp.add(panel);
    [-6,6].forEach(px=>{const pm=new THREE.Mesh(bpost,bpm);pm.position.set(px,4.5,0.3);pm.castShadow=true;grp.add(pm);});
    grp.position.set(c.x+rx*off,c.y+y,c.z+rz*off);grp.rotation.y=c.ang-sd*0.45;G.scene.add(grp);}
  // pickups, swap gates and street lamps from the track
  const lamps=[],o={};G.cans=[];G.gates=[];G.lamps=[];
  const canG=new THREE.CylinderGeometry(0.7,0.7,1.7,14),canM=new THREE.MeshLambertMaterial({color:0xffd23f,emissive:0x8a6a00});
  for(let i=0;i<n;i++)segments[i].items.forEach((it,k)=>{
    if(it.type==='lamp'&&i%2===0)lamps.push({n:i,off:it.off});
    else if(it.type==='can'){tp(i*SEG,it.off,o);const m=new THREE.Mesh(canG,canM);m.position.set(o.x,o.y+1.1,o.z);m.castShadow=true;G.scene.add(m);G.cans.push({m,n:i,k});}
    else if(it.type==='gate'){const g=makeGate(it,i);g.k=k;G.gates.push(g);}
  });
  const poleG=new THREE.CylinderGeometry(0.14,0.18,10,6);poleG.translate(0,5,0);
  const lampList=[],bulbList=[];
  lamps.forEach(l=>{const sd=l.off<0?-1:1;tp(l.n*SEG,sd*(RAIL+0.8)/RW,o);lampList.push({n:l.n,m:new THREE.Matrix4().compose(P.set(o.x,o.y,o.z),Q.set(0,0,0,1),S1)});
    tp(l.n*SEG,sd*(RAIL-0.6)/RW,o);bulbList.push({n:l.n,m:new THREE.Matrix4().compose(P.set(o.x,o.y+9.8,o.z),Q.set(0,0,0,1),S1)});G.lamps.push({n:l.n,x:o.x,y:o.y+9.5,z:o.z});});
  addChunked(poleG,new THREE.MeshLambertMaterial({color:0x50505c}),lampList,{cast:true});
  addChunked(new THREE.SphereGeometry(0.45,10,8),new THREE.MeshBasicMaterial({color:0xffc070}),bulbList,{});
}
function windowTex(){const c=document.createElement('canvas');c.width=64;c.height=128;const x=c.getContext('2d'),r=mulberry(5);x.fillStyle='#000';x.fillRect(0,0,64,128);
  for(let yy=4;yy<124;yy+=8)for(let xx=4;xx<60;xx+=8){if(r()<0.32){x.fillStyle=r()<0.7?'#ffc46b':'#9fb8ff';x.globalAlpha=0.5+r()*0.5;x.fillRect(xx,yy,4,4);}}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(2,3);return t;}
function makeGate(it,n){
  const grp=new THREE.Group(),o=tp(n*SEG,0,{});
  const pm=new THREE.MeshLambertMaterial({color:0x2a2546});
  const span=RW*2.3;
  const poleG=new THREE.BoxGeometry(0.8,15,0.8);
  [-1,1].forEach(sd=>{const p=new THREE.Mesh(poleG,pm);p.position.set(sd*span/2,7.5,0);grp.add(p);});
  const bar=new THREE.Mesh(new THREE.BoxGeometry(span+1,5.4,0.8),new THREE.MeshLambertMaterial({color:0x120f26}));bar.position.set(0,13,0);grp.add(bar);
  const panels=[];
  for(let i=0;i<3;i++){const c=document.createElement('canvas');c.width=256;c.height=128;const t=new THREE.CanvasTexture(c);
    const m=new THREE.Mesh(new THREE.PlaneGeometry(span/3-0.8,4.6),new THREE.MeshBasicMaterial({map:t}));
    m.position.set((1-i)*span/3,13,-0.45);m.rotation.y=Math.PI;grp.add(m);panels.push({c,t,key:''});}
  const sign=document.createElement('canvas');sign.width=512;sign.height=64;const sx=sign.getContext('2d');sx.font="40px 'Russo One', sans-serif";sx.fillStyle='#ffd23f';sx.textAlign='center';sx.fillText('OFFLINE SWAP',256,46);
  const sm=new THREE.Mesh(new THREE.PlaneGeometry(14,1.75),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(sign),transparent:true}));sm.position.set(0,16.6,-0.45);sm.rotation.y=Math.PI;grp.add(sm);
  grp.position.set(o.x,o.y,o.z);grp.rotation.y=o.ang;G.scene.add(grp);
  return {it,n,grp,panels,t:0};
}
function drawGatePanel(p,k){
  const cn=S.w.coins[k],key=k+(cn.rugged?'R':fmtM(cn.m)+(cn.mom>=0?'u':'d'));if(key===p.key)return;p.key=key;
  const x=p.c.getContext('2d');x.fillStyle=cn.color;x.fillRect(0,0,256,128);x.fillStyle='rgba(13,11,31,0.92)';x.textAlign='center';
  x.font="46px 'Russo One', sans-serif";x.fillText(k,128,58);x.font="600 32px 'IBM Plex Mono', monospace";x.fillText(cn.rugged?'RUGGED':fmtM(cn.m)+(cn.mom>=0?' ▲':' ▼'),128,104);p.t.needsUpdate=true;
}
function labelSprite(key,d){
  let e=G.labelCache.get(key);
  if(!e){
    if(G.labelCache.size>300){G.labelCache.forEach(v=>{v.tex.dispose();v.mat.dispose();});G.labelCache.clear();}
    const c=document.createElement('canvas');c.width=512;c.height=112;const x=c.getContext('2d');
    const lf=d.mono?"600 44px 'IBM Plex Mono', monospace":"48px 'Russo One', sans-serif",sf="600 38px 'IBM Plex Mono', monospace";
    x.font=lf;const tw=x.measureText(d.label).width;x.font=sf;const sw=x.measureText(d.sub||'').width;
    const pw=Math.min(500,tw+sw+60),px=(512-pw)/2;
    x.fillStyle=d.human?d.color:'rgba(13,11,31,0.86)';x.beginPath();x.moveTo(px+20,8);x.arcTo(px+pw,8,px+pw,104,20);x.arcTo(px+pw,104,px,104,20);x.arcTo(px,104,px,8,20);x.arcTo(px,8,px+pw,8,20);x.fill();
    if(!d.human){x.strokeStyle=d.color;x.lineWidth=4;x.stroke();}
    x.textBaseline='middle';x.font=lf;x.fillStyle=d.human?'#0d0b1f':d.color;x.fillText(d.label,px+20,58);
    x.font=sf;x.fillStyle=d.human?'#0d0b1f':d.subCol;x.fillText(d.sub||'',px+40+tw,58);
    const tex=new THREE.CanvasTexture(c);tex.minFilter=THREE.LinearFilter;
    e={tex,mat:new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false})};G.labelCache.set(key,e);
  }
  return e.mat;
}
/* Car bodies, side view (front is +x): ground clearance, nose, fender line, windscreen base, roof, rear glass, rear deck. */
const SHAPES={
  street:{L:7.6,bw:3.95,ground:0.28,nose:0.6,fender:1.36,ws:1.25,roofF:0.1,roofR:-1.35,roof:1.98,rw:-2.8,deck:1.32,wr:0.58,wz:2.5,cab:0.74,spoiler:'lip'},
  muscle:{L:8.0,bw:4.0,ground:0.34,nose:0.8,fender:1.5,ws:0.6,roofF:-0.45,roofR:-1.85,roof:2.2,rw:-2.75,deck:1.52,wr:0.64,wz:2.65,cab:0.82,spoiler:'duck',scoop:true,stripes:true},
  super:{L:7.8,bw:4.15,ground:0.24,nose:0.48,fender:1.34,ws:1.6,roofF:0.4,roofR:-0.85,roof:1.8,rw:-3.2,deck:1.26,wr:0.56,wz:2.6,cab:0.68,spoiler:'wing',intakes:true},
  rally:{L:7.0,bw:3.8,ground:0.6,nose:0.95,fender:1.72,ws:1.15,roofF:0.3,roofR:-2.15,roof:2.75,rw:-3.2,deck:1.95,wr:0.72,wz:2.2,cab:0.86,spoiler:'roof',lightbar:true}};
function glowTex(){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),gr=x.createRadialGradient(32,32,2,32,32,32);gr.addColorStop(0,'rgba(255,255,255,0.9)');gr.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=gr;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);}
function flareTex(){const c=document.createElement('canvas');c.width=256;c.height=32;const x=c.getContext('2d'),gr=x.createLinearGradient(0,0,256,0);gr.addColorStop(0,'rgba(160,200,255,0)');gr.addColorStop(0.5,'rgba(220,235,255,0.9)');gr.addColorStop(1,'rgba(160,200,255,0)');x.fillStyle=gr;x.fillRect(0,14,256,4);const g2=x.createRadialGradient(128,16,0,128,16,16);g2.addColorStop(0,'rgba(255,255,255,1)');g2.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g2;x.fillRect(96,0,64,32);return new THREE.CanvasTexture(c);}
const ENV_JPG='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAcFBQYFBAcGBgYIBwcICxILCwoKCxYPEA0SGhYbGhkWGRgcICgiHB4mHhgZIzAkJiorLS4tGyIyNTEsNSgsLSz/2wBDAQcICAsJCxULCxUsHRkdLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCz/wAARCAIABAADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmKKM0Zr3jwgoozRmgAooozQAUcUUUALik4oooAMCjAoooAMClxRmkzQIMD1owKXNJQAYFLikooAXFJxRRQAUuKTNGaBhRgUUUCClxSZozQAuPejHvSUZoAKKKM0AGKXFJmlzQAlFLmkoAKKKKACiiigAopc0ZoAMUYpKUUDDFGKKKADFJTqKAExSU6igQmKSnYoxQMSinYoxQA3FGKdiloAZilx9KdRQA3FGKdRQA3FGBTsUYoAbtFGKdijFADMUYp+OaMUAN20BafijFADdtJtFPxRilcBm2jbT8Uu2i4Ee2jbT8UYouAzbRtp+KMUXAZto20/FGKLgM20bafijFFwGbaNtSbaTFFwGbaNtPxRii4DNtG2n4pdtFwI9tG2n4oxRcBmKNtPxRimAzbSYqTFGKAGYoxT8UYoAZijbT8UmKAG7aNtOxRilcBu2jFOoouA3FG2nUUXAZijFOxRimA3FGKdigigBuKMUuKMUANpaXFFACYoxS0lABijFFFAgxRijpRQFwxRikooGFFFFAhcUlFLmgAxRijNGaAEopc0ZoASijNGaADiijNGaAEooooAKKKKACiiigApaSigBaKSigBaKSigAoooosAUUUUAFFFFAC0ZpKKBBRRRRYdwpaSigAooooAKWkzRQAtJRRQAtFFFABmjNFFABRRRQAUUUUAFFLRQAlLRRQAYoxS0YoASlop1AxuKdRRigBMUtGKXFACUYpcUYoATFLijFLigBMUYpQKWgBuKMU7FGKAE20Yp2KMUgG4oxTsUYoAbilxTsUuKAGYoxTsUu2gBmKNtP20YoAbijFPxRigBmKMU/bS4oAjxRipMUYoAjxRipMUYoAjxRipMUYoAjxRin7aNtADMUYp+2jbQAzFJipNtG2lcCPFGKkxSbaYDMUYp+2jbQBHilxTsUYoAZijFPxSYoAbikxT8UYpgMxRinYoxQA3FGKdikxQAmKMUuKMUANxRinEUmKAExRS4pMUAFFGKKBBTadRQMbijFOpDQA2ilpKBAaSlpKACiiigAooooAKKKKACiiigAoopKAFpKKKACiiigBaSlopkiUUUU7DDFFFFFgClxRRSEGKSlop2GFJS0UCCkpaKAExSUtFACUYpaKAuJRS0UAJRS0UBcSjNLRQMKKKKLAFFFFFgCiiigApaKKQBRRRQAUUUUAFKaSigApaSlFAxcUUUoFIBKdRRQAUUYpcUAJilAoxS4oGJilApaKACkxS4pcUAIBS4pcUuKAG4oAp4FG2gBuKXFOxRtpANxS4p2KNtADdtLinbaNtADcUbafil20AR7aXbUgWjbQBHtpdtSbaNtK4Ee2jbUm2jFK4Ee2jbUu2jbRcCPFGKk20baLgR7aXbUm2jbQUR7PajbUm2jbQSRbaMVLto20ARYoxUm2jbRcCLbRtqXbSFaLgR7aNtSbaMUARYo21LtpCtAEW2jFSFaNtUBHijFPxSbaAGbaMU/bSYoAZijFOxQRQAzFJipMUmKAGYpMU8ikIpgNxSYp+KQigBpFJinYpMUAJijFLikNACYopcUYoEJRRiigAptLiloAYaKWkpiEopcc0UAJRRRQAUUUUWAOaSlooASilopgJS0UUAJRS0YoAXFGKXFGKBDaKdikxTC4lLilxRikA2inYoxQA2inYoxQA2lxS4oxQAmKMUuKTFABijFGKMUAJilxRRigAxRijFGKAExRilxRigBMUYpcUYpgJijFLijFIBMUUuKMUAJRS4pcUANpcUuKMUAJikpaXFAXG0uKXFGKBiYoxS0oFIBMUuKWjFACYpaKUUDDFGKMUCkAYpQKWjFACYpcUYpcUAAFLigCnAUDExS4pcUYoATFKBSgUuKAEApcUoFO20gGYpcU8LRigBu2lC07bTgtSAzbQFqTFLtoAj20u2pNtG32oKGBaNtPC0uKQDNtLtqQLS7aAI9tG2pNgpQtAEW2jbU22jZ7UAQ7fajbU2yjb7UAQ7aNtTbaXb7UAQbPajb7VPto20AQbfajbU+2k2UXAh20bam2+1Gz2oAh20bal25oK0AQlaNtTbaaVoAixSbal2GkK0XJI9tJtqTbQVoAi20m2pStIVpgR7aTbUm2kK0ARYoxUm2kK1QEeKTFSFaTbQBGRRinkUmKYDMUhFPxSEUAMIpMU/FGKBEeKMU8imkUANNJinkUmKAG4oxS4oxQAmKTFLijFAhMUmKdijFMBuKQinUUANpMU7FGKBCYpCKdij8KAG4oxT6bimFxMUYp2BSYFAXExRilooATFJTsUYoAdijFLijFMBMUmKdijFADcUYp2KMUANxRinYoxQA3FGBTsUYoFcbijFOxRigY3FGKdijFADcUYp2KMUCG4oxTsUYoAbijFOxSYoGJijFOxRigQ3FGKdijFAxuKMUuKMUWFcTFGKXFGKAuJijFLijFIYmKMU7FGKAG4oxTsUmKAExRinYoxQAmKAKXFGKADFGKXFGKQCYpcUuKUCgYmKMU7FKBSAbilxTsUAUDEC0oWlC0uKAExQBTwKULQMaBS4p4WjFADQKULTgKULSAaFpQtPC04LUgMC04LTgtKFoAaFo21IFpwWgCLFOC5p4XmnBaQEYWnBakC04LRcohC+1LtqbbRsoAi20u2pQtLsouBFspdntUoSl2UARbaNtTbKNntSAi20bal2UoT2oAh20bfap9ntS7Pai4WK+yjZVjZRsouBX2+1Js9qs7PajZRcLFfbRtqbZ7UbKAINntSban2e1Gyi4FfZSbasFKbsouBAVpNtTlaTZTuBAVpCtTlaQrQSQFabtqcrTStAEJWkK1MVpCtAEJWkxUpWmlaYERWk21KVpCtUBFtpCtSlaaRQBHtpCtSEUmKAIitJipitNK0xEeKQipCtN20AMxRinbaMUAM20mKkxSbaBEeKMU/bRimIjxRin4pCKAGkUmKdikxTC4mKMUuKMUANxRinbaMUAN20Yp22kxQAmKMUuKMU7AJtoxS4pcUCG4o20uKMUAPxRin4pMUANxSYp+KMUAMxRin4oxQAzFG2n4oxQAzbRtqTbRtphcZijFPxS4pCI8UYp+KMUAMxSbakxRtoAjxRtp+2jb7UAR7aXFPx7UYoAjxRtp+KMUDGYoxTsUu2gBmKTFSYpCKAGYoxTsUYoAbijFPxRigYzFGKfijFADMUuKdijFADcUYp2KXFADAKXFOxS4pANxS4pcUuKQDcUoFOAoAoGIBS4pcUoWkMaBS4p+2lxQA0LTsUuKULQAgFKBTgtOAoAYFpwWnBc04LSGMC0oWnhaeFqQIwtOC04LTwtADAtKFqQLShaAIwtPC+1PC04JSAjC04LUgWnBaCiMLTglSBacEpXAhCU4JUwSnBKVx2IQlKEqcJShKLhYgCUoSrASlCUrhYr+XS7ParGylCe1K4WK4jpfLqxs9qBH7UXCxX8ul8urHl+1L5dFx2Kuyl8v2qz5VHlUXFYrbPakMdWvL9qTy/ai47Fby6QpVny6Ty6LisVdlIUq2U9qaUouFiqU9qQp7VaKU3ZTuFisUppSrRT2ppSncRVKUhSrBSkKU7gVitNK1ZK00rTuBXK00rVgrTSlBJXK00rU5WkK0AQFaQrUxWkK0wICtNK1MVpCtUBDt9qQrUxWmlaAIStJtqUrSEUxERWkxUhWmlaAGbaQrTytGKAI9tJipCKTFAiPFGKfikxTENxSYpxFJimA3FGKdijFADMUYp+KMUwGYoxT8UYpCGbaTFSYoxTAjxRipMUmKAGYoxT8UYoAZijFPxRigBdtG2pdtGymTci20bak20baAuR4o21JtpdtAXIttGKl20baAuR7aNtSbaXbQK5FtpdtSbaMUBcj20bakxRigLke2jbUmKNtAXIttG2pcUbaAuRbaTbU22k2UBci20EVJtpMUDuMxRin4pNtAXGYoxT9tG2gdxmKMCn7aTbSsFxuKMU7bSbaAuJijApcUbaAuJijFLijFACYpcUuKNtAxMUYpcUYoC4mKXFLtpcUhiYoxTsUoWkA0CnYpQKULQO4gFKBShacBSC4gWnBaUCnBaBjQtOC04LTgtADQtOApQtPC0gGqtPC0oWnBakdxoWnBaeFpwWkAwLTwtPC04LQAwLShakC09VpXKIglSKlSBKeFqWx2IglOCVKFzTxHSuCRCEpwSpggp4Si5ViAR57U4R1OEpwSpbHYgEdO8v2qcJS+XS5h2K4j9qUJVgR0ojouFiAR0vl1YCUvl0uYdit5dHl1a8ujy6OYLFby6PLq15dGyjmCxU8v2o8urXl0eXRcLFXy6TyqtGOkKUcwWKpjphj9qtlKaUppisVTHTTHVox0hSncOUqGOmmP2q2UppSncXKVClMKVbZPamFKEyWisUphSrJWmlKq4rFUrTStWStNK00xWKxWmlasFaaVqgK5WmlasFaYVouSQFaaVqcrTCtMCErTSKmK00rQBEVpjLUxWmlcU0IhK4pMVKVppWqAjK00rUm2gigCIrSFalIppFMVyMrSbakK00rQK4zFJipMUm2mAzFJipCtJtpiI8Uu2n7aMUCuMxRgU7FGKAuNxRin7aNtADMUYp+2l20CuR7aNtP20YpgR7aXbT8UbaAuSYFG2pAtG2mRcj20bak20BaAI9tG2pcUYoC5FtpdtSYpdtAEW2l21JtpdlAXIttG2pttG2kBFto21Lto20ARbaNtS7aNtAEW2jbUu2k20BcixSbam20hWgLkJWjbUuKTbQBFtpNvtUxWk20DuRYoxUhU0baAI9tJtqXbSFaAuR7aNlP20baAuR7aNtSbaNtIdyPbRtp+KNtAXGbaNtSYoxQO4zbRtp+BS4oGM20bafilApDGbaULT8CjbQMbilApwWlC0gGgU4LTgtOC0gQgWnBaULTwtAxoWnBacFpwWkMaFp4WnBaeFqQGBacFp4WnBaQxAtKFqRVp4WlcCMLT1WpAtOVam5SQxUp4SpFWnqtK40iNUp6p7VKqU9UpNlJESpTwlTBaULU3KSIglPC1KEpwWlcZCEp4SpQlPCVLY7EISlCVMEpQtK47EQSl2CpgtKEouMhCU4JUwSlEdFwsQbKAlWPLpfLouFivso2e1WdlGz2pXHYrbKQpVrZ7UhSncLFbZTSlWTHSGOi4WKxSmFKtlPamlKLisVPL9qCmKslKQpmncVioU9qQpVop7U1kp3FYqMlMZKtslRslUmJoqFPamlKtslRslNMmxVKUxlq0y1Gy00yWisVpjJVllphWquKxWKUwrVorUZWncViuVphWrJWo2WqJICtMK1ZK0wrQBXK00rU5WmFaYiErTStTFaaVqhERFNK1KVppWmBEVpCtSlaQrTERFaTFSlaaVpiIyKTbUm2grTAj20m2pCtJigQwrSbfapMUu2gRFijb7VJijFADdvtSbak20baAI9tLin7aXZQBHtowKk2UbKZJFtox7VLso20AS4oxUm2gLQTcjxS7ak2mjZTC5Hto2VJt9qdtpBch2Uu2pdtLtphch20u2pdlGygLkWKNtTbaXbSFcg20u2pttG2gLkO2jbU22jbQMh24pMVNto20Bcg20bamK0m2mFyErQVqbbSbaQXIdtJtqYrSbaAuQ7aNtS4pNtAXIitJipStG2gLkWKTbU22kxQMi20balxSbaQEeyjZUm2jbQO5HtpNv0qTbRtoKI9tLin7aXbQBGF9qAtSbaXFAXI8UoWnhaULSGhoWnBacFpwWpHcYFpQtSBaULQCEC04LTgtOC0ihoWnhacq08LUgNC04LTgtSKtJlDVWnBaeFp6rU3KQ1Vp4WnqtPVaTYJDQlOC1Iq08LUtlJDFWnqtSKtPC0myrDFWnhaeqU8JUtlJDAtOC1IFp4WpuOxEFp6rUgWnBKB2IwvtTwtSBKcFpXKsRBKUJUwWnBKVwsRBPalCe1TBKeEpXKsQBPalCVYEdOEdTcFEgEftR5dWRHTvLpXK5Sr5ftSeXVvy/ak8v2ouKxVMdN8v2q3s9qTZTuFit5dNMdWilIUouKxUKUhT2q0UphSncLFYpTClWzHTClO4rFYpTCtWilNZKpMVioVpjJVopTGWhMloqslRstWmWmMtUmS0VStRslW2WmMtUmJlRlphWrTLUZWquS0VmWoytWmWo2WmmTYrstMZaslajZaaYiuy1Gy1ZZaYy1SZJXZaYVqdlppWmIgK0wrU5WmFaaAhK00rU5WmFasTIcUhWpStIVoERbaQrUuKTbTERbaTbUpWkxTJI9tJtqTbRtpgR7aMVJto20E3I9tJipdtG2gLke2jbUm2jbQK5HtpdtP20BaYXGYpdtP20baBXGbaNtSbfajFAXJttLtqTbS7KBEW2l21KFp2ylcCHZS7al24pdlFwIdtG2ptlG2i4EW2l2VKFpdtFwIdlLtqXbS7KLgQ7aNtT7BSbKLgQ7KNtTbKNlAEG32pNtWNlIV9qLgQbaQrU22jZ7UXAh20myp9lIVoAgK0m2p9tNKUwICtG2pitJtpXAhK00rU5WkK0wINtG2pttJtoGQ4oxUpWjb7UBch20bal2e1G2kBDtpdtS7aMUDIttG2pcUbaBojxQBUmKAtIobtpduaeFpyrSY0RhTTglSACnbKm4yMLTlWnBaeFpghgWnqtOC08LUXKGhaeq0oWpFWk2NDVWpFWlVakValsY0LT1WnBakValspIaq04LUgWnBaVy7DQtPVacq1Iq1Nx2EVaeq05VpyrUspIRVqQLTlWpFWpbGiMLT1WnqtSKtFykiMJTwlSKtPVam5SRGEpwjqUJTwtTcaRCI6cEqYJTglK5ViJUp4jqVUp6pSbKUSAR1II6mCU4LSuUokGyl2e1ThaXZSuFivs9qNntVjZRsouHKVtntQY6sbKClFw5Sr5ftTTHVorSFKdxWKhjpClWilMKU7iaKpSmlKsslMK07k2KxSmFKtFfamFKdxWKjLTGWrbJUbJVJktFNkpjLVpkpjLVJkNFVlqMrVpkqMrTuS0VmWo2WrTLUbLVJiKzLUbLVplqNlqkyWisVpjLVllqNlppktFZlprLU5WmFaoRXZaYy1YZaYVqkySsy00rVhlphWqTEyArTCtWCtNK00SyArTStTFaaVqgIStG2pStIVpk3IiKQrUpWkK0xEW2jbUm2jbQSR7fajbUm2jbTAj20bak20baBEe2jbUm2lC0CItlLtqTFLtouBHtoxUm2l20xEe2jZUoWl20rgTbaULUu2lCUXAj20oWpdlLtpXAh20u2pttGz2ouBDtoC1NspQlFwIdtLsqbbS7aLgQ7aNtTBaXaKLgQ7KNlTbaNtAEOyk2VPto20XGV9lGyrG2kK0XEVytJsqwUpNlFwINlBWp9lIVouBX2UhWrGykKU7gVilIVqwVppWi4EG2kK1YK00rRcLFfZSbasbKTbRcZBtpMVPto20XCxBto21MVoKUXCxBspNtT7KNtK47EG2jbU+yk2UXAh20oWpdtLs9qVxkQWnAU8LShaRSGbaeFp4WnBaVykRhacFp4Wnham40MVakC04LTwtJspIYFp6rT1WnqtS2MYFqRVpyrT1WpbKSEVakVaFWpVWpbKQwLUirTlWpFWpbKQwLT1Wnhaeq0rlIaq09VqRVp6rUtlJDVWpFWnKlSKtS2UkNVaeFpyrUqrUtlJEYSpAlPVaeq0mykhgSnBKkC08LU3LSIglPCVIFp4WlcaRGq08LTwtPC1NykiMJTgtSBaeFpXHYhC07bUoWlC0rjsQ7aNtT7aTZRcLEOymlKsbKQpRcLFYpSFasFaaVp3FYrlaYUqyVppWncVisUphWrLLTCtUmS0VylMZKslaaVqriaKrLUTJVtkqNlppkNFVkqJo6uMtRMtUmS0U2SmMtW2So2SrTIaKjJUbLVtkqNlppkNFVlqNlq0yVGy1SYmisy1Gy1ZZaYy1VySqy1Gy1aZajZaaZLRWK00rVgrTGWqTE0VmWmMtWWWoytUiWVytIVqcrTStUmS0VytNK1YK00rTuS0QFcU3bVgrTStUmIgK0m2pitJtp3EQ4oxU22jbRckh20bam2UbadxEO2l21LtpdtFwIdtGypttG2i4iLZS7alC0uyncCILS7al20u2i4iILRtqYLRsouBPspwWpgtLtrO5ViELTgtShaULRcLEO2jZ7VNtpdvNFxWIAtLsqfZShKLhYgCU7ZU2yl20XCxBspdlT7aNlK4WIAntS7PaptlGyi4WIdlJsqfb7Umyi4EOyk2VY20baLhYrbKTZVnZSFKdwsVylJtqwV9qTbRcdiuV9qQpVjbSFKLhYrlKaUqwVpCtFxWKxT2pClWCntSFKdwsVytJsqxs9qTZ7UXHYrlDTdlWStIVouFivso21OVpCtK47EGyjZU+2jbRcLEG2jbU+yk2Ci47EO2jbU2yjZSuOxFtoCmpglKFpXKsRBacFqTbTgtDY0iMLTgtSBacFqblIYFpyrUgWnKtJsdhqrT1Wnhacq1LZSQirTgtPC05VqblCKtPVacq09VqWxoaq1Kq0qrTwtS2UhAtSKtCrUyrSbKSEVakVaVVqRVqWzRIaq1Iq05VqRVqGykhqpUgSnKtSBaTZaQxVp6rTlWpFWpbKSGBaeFpwWnham5SQwLTgtPC08LSuVYYFp4WnKtSKtJsaRGFp4WnhaeFpXKsRhaULUoWlC0rhYhCUuyp9lGyi4WK+z2oK1OVpCtFwsVitMK1ZK0wrTuFiuVphWrJWmMtFybFcrTCtWStMK1VybFcrTStWCtNK07iaKzLTGWrLLTCtUmS0VWSo2SrTLUbLVJkNFVkqNkq2y1Ey1SZLRUZKjZatstRstUmQ0VGWomWrbJUTLVJkNFVkpjLVplqNlqkyWiqy1Gy1aZfamMtUmS0VWWmMtWWWmMtUmIrFajK1aZaYUqkyWisVphWrLJTClVckrlaQrU5WkK07ksrlaaVqwVppWmmS0QbaTbU+yk2U7isQ7aNtTbKNlO4rEO2jZU2yjZ7UXFYh2UbKn20baLisQhaNtTbKXbTuFiHbS7al20uyi4rEWylC1Ls5pwSi4WIQtAWpglOCUrisThfanBKmCUoWouaWIdlLsqcJShKOYdiDZ7UoSp9ntShKOYViHZShKm2UoSlcLEASl2VY2UbKOYLFcJS7KsbKNlFwsV9ntRs9qs7KNntSuFits9hRs9qs7Pak2UXCxX2e1JsqzspNlPmCxW2UFKs7PakKe1HMFitspClWClBSjmCxW2U0pVrZSbKOYdiqUppWrRSmlKdxWK2z2ppWrRSm7Pai4WKxWgrVgpTdlFwsQbaaU9qsbKNlFwsVintSbParOyk2Ucw7FfZRsqfbRsouOxX2UFKsbKTZRcLEGyjZU+yjZSuFiDZShamC0uz2ouUkRBaULUwSnBPapuNIhC04LUgWnBaVykhgWnqtSBacFpNlWGBacFqRVpwWlcLDFWnqtSBacFqWykhirTwtPC09UqWy0hqrUirT1SnqtJspIYq1Kq0qrUqrUNlpDFWpFWnKlSKtS2UkIq1Iq0qrT1WpbLSEVakVaVVp4WpbKSEC09VpVWnqtS2WkIFp4WnKtPVam5VhgWnqtPC0oWi47CBaeFpwWnKtK47CBacFp6rTlWlcdhqrTgtSBacFpDI9lGypcUYoAgK0hWpytIVoArstRstWCtMZaYrFcrTCtTlaaVp3FYgK0wrVgrTStO4rEBWmlasFajK0XFYrstMZaslajZapMlorMtMZaslajZapMhorstRslWWWmMtUmJoqslRslWmWmMtNMhopslRsntVtlpjLVJktFNkqNkq4y1Ey1aZDiVGSmMtW2So2SmmQ0VGSmMlWmSmMlUmS4lQrTStWmSmMlWmQ0VSlMKVaK00rTTCxVKU0pVopTSlO5LRVKUm2rJSm7adyWivso2VPso2U7isV9lGyp9lGyncmxBspNlWNlGyncLEAWjZVjZRso5gsQbKXZ7VMFpdtFxWINtLtqcJS7OaLhYgCUoWpglLsouKxCFpdtTbaULRcLFkJTglShKcErK5rykIT2pwSpglKEpXHykOylCe1TBKcE9qfMLlIRHShKnCUuylcfKQBKUR1OEpdlLmDlK/l0eXVjZS7KOYfKV/Lo8urGyjZRzC5Sv5dHl+1WNlGyjmHylbZR5ftVnZSbKOYOUrlKQpVgpSFKOYXKVvLpClWilJso5g5SqUpNlWilNKU7hylYpTCntVopSGOi4cpU2UGOrBjpNlPmJsVilNKVaKUhSnzBYqlKQpVrZSFKOYLFbZSFKsbKNlHMFitspNtWdlGyjmHYrbKNtWClJspXHykG2jZU+z2o2e1Fx2INlAWp9tLspXGkQhfalC1NsoCUuYFEiC+1OC1MEpwSlzFKJEFp6p7VIqVIqVLkUokSpTwvtUipUipS5ilEiVKcqVMsftUipUuRaiQrHUipUqp7U8JUuRSiRKlSKntUip7U8JU3KUSNY6kCVKqe1PVKTkWokSpT1WpQlSKlS5FKJGEpyp7VKqgU8Cp5i1EjCU4JUgWnBam47DQtOC08LTgtFyrDVXFPC0baUCkOwoUU9QKaBTlFIZIuPSnrj0pgp4pDHhRTgooWnqKVxihacFoUU8CmA3bRtp9GKBEZWmFalIprCgZCy0xlqYimMKBEJWmFamYUwii4EJWginkUmKdxWIytMZalIppWncViFlphWpytMK07iaIGWo2WrBWmladybFcrUbLVhlprLTTJaKzLTGWrDLTStVcloqstMZKsstMZapMTiVGSmMlWmWmMtNSIcSoyVGyVbZKayVSkS0VGjqJk9quMlMZKpSJcSoUqNkq4yVGyVSkQ4lQpTClW2SmFKakS4lUpTSlWilIUp3JsVClIVq0UppSq5hOJX2UmyrG2k2U7i5Svto21Y2UmynzE2K+2l21PtpdlFxcpX2UbKsbfagLT5gsQbKXbU+z2oCUcwrEOyjZU+2lC0cwrEGylCVPs9qUJRzBYg2U4JUwSl2UcwWLISnBKmC0u2ubmOrkIQlOCe1ShacFo5g5CILTglShRShaOYfIQhKcEqULShaXMHIRBPal21MFpQtHMPkINlGz2qfbS7RS5g5CDZ7UbKn2ijbRzByEGyjZU+2jaKOYfIV9lGz2qxtpMUcwuQr7KTZVgrSFaOYOQrlKTZVjbTStPmDkIClIVqwVppWlzB7MrlPamlKslaaVp8wezIClNKVYKikK0cxPsyvsppSrBUUhWnzh7MrlKTZVgrSFaOcPZlfZSbKsFaQrRzh7MrlKTZVjbSYo5x+zINlGyp9tJto5x+zINntS7Km20YFLnD2ZDso2e1TYFLgUucfsyEJShKm20baXOUqZGEpQlSBRTlFLnGqY1Y6cqe1SKKcAKTkUoDVSnqlOAp4FLmKURFSnKlOAp6gVLkUoiKlOVKcMU8EVPMVyiKtOVaARTwaLj5RQtOC0gNPBpcxVhyrTgKaKetLmHYcAKcB7Ugp6ipuOwoFPGKAtOC0XHYBj0pw+lKopwpcw7CBc9qcEBpRTgRRzDsAj96UR0oNOBouFhAtPC0A04UrhYFAqRRTRTxRcY5RS00U8GmmIKKKKdxAaY1KTTSaVxjTTCKeaYaLgNIphFPNNNFwGEU0inmmmi4hhFNIqSmmi4DCKYRUhFIRTuKxERTCtTEUwincViErTStTEU0rTuHKQMtMK1OVphWnzE2ICtMZasEUwrTuLlK7LTWWpytNZafMTylYrTStWGWmlafMS4lVlprLVgrTStUpCcSqyUwp7VZZaaVp8xLiVSlMKVaK0xlpqRPKVSlIUqwVppWnzC5CuUo8v/AGhU5WmlafMLkK5QD3pNntVjbRtquYlwK+z2o2VY2Um2jmJ5CDZS7Km2UbafMLkINlLsqbbShaOYOQg2Uuyp9tGyjmFyEGylCVPspdntT5g5CAJS7KnC+1AWjmDkIQntSiP2qYLTgtLmDkH06uWPxD8Ng8XrN7iF/wDCp7bxx4funCJfBWPTejIOmepGK4vax7nfyHQ5+lSKayrLWbW7tvNMiRkMVZWcZUiuL8W/EGW0vjZaa4XadrOACSeRgVEq0Yq7GqZ6XmlBrw5/E3iWOV2u5LqGNum7cgORz1xXSWfxL8nw3ErkS6gjbWLZIZf73HU9BURxUXuN0rHpwNOBrk9N8faLdWEUs95HFMww0e1iVI69B096h17xrCmnhtInMs3mBWZYmOF5zjIx6fnVSxEErtiVJt2OzFLj3rz6L4kOunJJcWEqzAsH+QhT6Yz04qWb4jSf2dbSWmlTzzyAb9w2Kp746k1P1qna9yvZPsd7RXl958StTcKLazjgKAq5cb9zeo5GAKp23xF1yG4uGle2lEjZVWU4j46DBHHTqal4ymuoeyZ65RxXnafE8mUO9iBCFIZVfLbvyAA/xq9dfEjT47Ytb29xNNt3BSoAB7gnOePYVSxVN9Q9kztsikzXlVl8QNZGpTXM0atbSMNtuTwi8ZwcZz16+vSrlx8VSX8u304K+cZlkJGfQYHPaksVTd9QdJo9IyKC1eaf8LK1JpERdPt8hQWDMwycdvb86RfilcFwjaSvJxu84gZ/75prFU+4vZM9LLCmlq86HxRPkMG00eeQSoE3y/iSMihfiezxOy6UGC8g/aAAR/3z1zT+s0+4ezZ6GWpDIBXAP8TYI4t0mnyI+cFRMpx/U9PSo1+Kumv1tbsc9gp4/Omq8HsxcjXQ9BMgppkFcHdfEaw8pzbpNI+wldwC/N2BGenvWZD8TAlmvnWzyy8gsGCqTnj+tDrwva4cj7HppkFIZRXnEPxOs3GJ7K5R84KqQ388Vch+IGkSF/ME8IDAKWXO78iapVodxcr7HcmUU0y+1cQ3xC0cDP8ApBGQPuYwfzpIPiDpsqMzxXCEZIAAbI9evFP20F1DkfY7cy464qNrhV61xX/Cw9JYuNtwuwFjlOw/GkXx/pDqpJnBbnG0H+RpqrHuLlfY7T7UnvQbuP1NcS/j7SVlC7Lgr3baML+Gc0y6+IOkwqpt0muWJA+VCo/M0/aw3uHK+x3H2qP3pftSHsa4FviFGqFk0q8yD91gBxzn17DNOh+IVvNj/iW3uC2MhAcDuT34/wAKn2se5XI+x3n2hT60nnKfWuLXx1bu8YTStTdJBlWWDIP6+4pY/Htk0yo9lqESkH5mgP1HAz1GT+FP2se4cjOz84UeaK5BPHekyEBBdvk9RAxB/So4vH1hJI4NnfIi8hjCeR24/Gk6kV1HyPsdl5vvR5lche+OLKF4EtQ8xkILtsYBVyOvQ5xn8qsP410iNGZ55VC4P+pb/Cj2i7hyHTiSl8yuIm+JOlRoWWK6l+9wsRzx0646/pWSnxXRZts+mOqtyoV/mAz3BFJ1IrqPkPThJS+ZXl958U99pIlpaGG4HKmRgwAB5/HGaWT4pSYj8nTgePmZnwG4HTHTknr6VPtV3GoHp3m809ZRXls3xUaGFHbTSGbg/vOAfy9asH4rWazBFsLgoy7gxZQc/Tnj3pqon1HynpolFPWUV5Q3xWueNmkJ83QG4z6/7NQzfF69gjLHQ1CjjP2jPP020KSezFY9gEopwkFeOQ/GW6cA/wBioRxkicgD/wAdq3D8Xbl1DnRkC4PIuOp/75ocktwSR62sgpwcV4LqPxS8S3TubdlsEB4WONXOPdmznoegFZbfEXxSpy2tTgOOuxOR7cfypXuB9IhxTw4r5ob4h+JpEKnXJ8H+7tU/oKZ/wmviQxbF8Q3oyO8hz+fWncLo+nVYU4MK+Wz4t8SqT/xPNQJIxxct0Hpz7U7/AIS/xKcE67qOBzj7S/X86Lhc+planBh618vr4+8Uqu3+2rwg4GfMz0qSH4i+KoW/5DV0VY5yxDd89x+lLUd0fT4YetPDLXzSvxO8YRkbNZLdsNDGf/Zamj+LXjKAAveRSAZJ3QJz7cAUBdH0mHFPDj1r5vi+NvidB88lm/8AvQf4GrK/HbxAMZi088/88G4/8eoaY+ZH0SGHrT1cV8+Q/HvVwV8yxsHGecI6k/8AjxrRi/aAfHz6LGx9FnK5/wDHTU2YXR7qJB607eK8Si/aCtjG3maDIr/whbgMp+p2jH5GrkPx+0hpMTaVdom3OVdWO70wcce/6UWY+ZHsW8UokFeXW3xv8Mz53JfRED+KNefphq0Yfi34WlyWu5kAxy0LH+WaVx3R6EHp4euCX4reFOP+Ji/P/TB//iasR/FDwo3TVce5gk/+JouO6O3De9PDVyMPxA8MzDK6xAB/tbk/mBV1PF/h9iAutWOT289R/WlcLnRhqUPWTFrNjMMx3kDj1VwamGo2/wDz8R/99CncDTD04PXP3XirRLFmS51eyhdQCVedQwB6cZzWR/wtTwgJCn9sLkd/Jkx+e2lcLHcbqN1ccPiV4T+1Jb/23Bvfo2G2j6tjA/E1ci8beG5iAmuafkjdhp1X+Z/SjmCx0hamFqpR6jbTIrx3ETowyGVgQRTheRN0kQ/RhRcLFktSFqrG6jHJkUf8CFV5tXsbZN097bxLydzyqo469TRcLGgTTTVKHU7S5iWWC6hlRxlWRwysPUEGpftSH+MfnRcLExppNQm4T+8v5003Kf3x+dO4WJiaKrmdf7y/nUR1C3EgQzx7ydoXcM5xnFLmCxbNIaqf2ja/aRb/AGiPziCwTcN2BjJx+IqUzL/eFNSCxIaaaYZl9RUE99bWyF57iKJRyWdgoH50+YLFg001UtdUs79S1pdw3AHB8tw2PyqRp0Dbd43emeaLisSGmmovPQnAZT9DSNOqgksoA9TTuFh5FNIFYV5400Gyl8uXUY2fGf3QZwPbKgjPtVePxtZXEZkgs710JwrFFUP/ALuWGaG7asSV9jomFMYVj2Pi3R9Qm8iG8RZv+ecnyH8M8E+wq+9/bL96eJfqwFPmYrE5qM1F9sgY4WaMn0DClaQetPmCw5qjakaQetRSTrGjOzBFUZLMcACjmFykhphqBb6CRAyTxsrDIKsCCKq3Ws2VpLCk1wqtM21ecjOM8+g9zT5hcpfOKY1MMoIyDkUxpR60+YXKPJFNJFQvOiY3Moz0yetN89f7w/OmpByk/FNxWbda5ZWlz5Esyo+0sSTwv1rK0/xdBMbpZWD+USYipAMo9F9TS9qk7C5Tp6K525udbv0draMWNu8YIMqFpcN328bSOeP5VzcN9rmg6o7z3gvRMPnjePYQRwCME4PXNJVlJ2Q3SaV2ejUYrmIfGVsVRJIZi+PmKqMZ/EitF9ftUtxN8xUjcQMEgce/v2rTntuSqbexrYowKoR6xYyxLIt5CFYbhucKce4PSl/tfT8gfbrbJ6DzV5/WjnJ5S9ijFUG1rTVfa2oWqsOxmUH+dYus+Mra1aa1tB9pnEW4NEwYAngdM5xSdVJXbDkOp3KuMsBnjrTgykZG0j2rwWe+8SG+d4U1HAbeCiueWUDt7DFdL4L8VX+n3rwa20sVq+5t0iNhWJzknH+c1mq6k7PQfs7Hq2PpRx6VzyeOPDkmSNXtwBjliV6+mRzTJvH/AIZtzhtVjc/9M1Z//QQa09ou4uQ6Xilrmo/H2gSqzR3MkgXrtgc/rtpU8c6XJuMcN9IqkKWS1ZgMjPYfX8jS9qu4/ZHSUuK5tfH3hoyGNtTWNwSCssbIRj13KKkXx14baMMNWgII3Y+bOPpjOfan7RdxchXXMozLaxZ6EEAH+tVrrRNL1BWSazjGeMhQD+Y5/WqraiY1AdkBxwSRzTxfOVBBx+IrzWkejYzIvAenxX4drqZ4c5MRYAn2zxx+GfeuisdA0OxlE1vp8Cyjo5XcwOMcE5I/Cs5r5geWyTxwSaPt7FgTn0z1NTZJ3QcqN+WO3ujiZI5FxjDgEfkahktLVhtENuyAABWQEADsPSsk3UjrwzAnv6Uv2hiB85P4mnYZpRWmmrcecLG3ilXgP5agn6EClis9Mt5TJDbW8Urcl0QAn6nGazRKckk9PUk0B8nAyc+3Wi3kKxtG5twOVQn6CnLNb8sI49xHXAyfasQM2eg496eGwM/eI9TwKOUZpbLLzTILO3DnqxQZP44p/mW6IQsECj0CissTZ6DP0pDIc5/TpRygaAmhyQLWLr2QAH9KYTCBgWsAOeBtHHp2qj5zEZOfoaXzGUehNHKhF4AMcrDDkHrsBx+OKJLcSD5obdz3OwEfqKrG5YKAW28dMUguiOhB+tTZDsPlgcAFbeHIGBhAcD8ulU9siPgogVjn5Ylwf0q01wxOcAHGD9KoSoXkJU5ycD3q4pPRid0XUwCCu0kDBwoB/lUoeLbtNuhGOmB/hWQ6SRNkHBz2P+FKl7LHgMdw9DzQ6XVMSkuqNcyWJJDWqk4wcgHAoE9ioAFtGAOMbRxWaL6A8HMZ7jGQakEsTAYZCPfj+dQ01ui1Z7Fs/wBnFyfICkjBIA5FH/EtKkPb+YvoeR/OqZEbdFGRx9fypmwc4xx680kwsaRk0/bxacdcDHFIs9kAB9m4znoCP51kyF05CBvp/wDXNQGadTgIR7EE/wAqpeoWOiF1YKv+pA7cjpR9psCwxEv4LXNG6mB4UA9+MU4XMxPOOnYg07MVkdE9xYE8wgE8HC9RUH2m1SQlIsKT0AwT9eKxDPN1Az/n6U03UgOGXB+v/wBYU1cVkb5vrQLyuPwpkF7bImCDxwBgnisI3eASce3NRG9hDZIGfr/9c0wsjpBq0BIzCdvIqGXUYWlEkaOxAIZDgDr3/nWH9tQr93HBHAz/AEoEyHPJGeoJAGPxosBcutXk8wmOxB5BOJApA9aY2sTtIzfYAqjkEzAk/gOlVxLEAMFTzkEn1+lMeWIvyzMOoAIIP50A0W/7bGSBZSMD1wVwPbrUQ1oyoVexk+YYwGU8evWoi8KoRhQPQ85/Ko/9FdmAYHA5AyCPp/8AWqlYTQsuoBoiiWrlSMD5gMc5Hes7VJri/wBO+zQ28iEkZJxggeuPwrQKxsuFJ9SDzULv86jflTwDkA/himmKxiRadfrgmI8ADA9BV028Ds0kmlpO3GN6AkAe5B461d3K5KpOSQem/n17nNK0cjLtDgKeMBz/AIdaaSQO7MiSC3O5T4etyDkj5QMfjimR2sKxvjRLdTnKnqAPQ5rWNqzsCZJSRwSWyAPz/pTLm3nXayXC5ToCcfngGnpsKxlx2yBMNpFqQecFASP0pot7cOQdGgDHkDaAPrWohOwKZwCDyARgfnigurRnbIxJwCxAPT2HFPQVjMNtH0/saEAdOxJ9uaZJbwE5GjKWxnAAz+prSLpJjcZDg5DBT09uPpUEs/74FCxHGFAAJ/MCqStqS0UJ9PtrliRpPkBhg4ck/oR+lQR6BbxOWId1J6FCQPwz/PNbSSyEnKuYyDgEYP585pNs7ucSkAjGGGMfpRZ9w0fQzF020KApYMDjBBUf0zUL2KoSqaWHBHdQMfgev4VvqjocBh1ySDkD86kDeYVU5yBg44z+NUmxNI5s2sZyG0pGOMjKIR/KnPas6APYqmB0CIMfjmukNuRgCQoqcAE5/PP+NM/s87yxu3YddpIxn04BxTUhOJzB0/DAqbqPJ/gdQB69Dn9KryafOj/JJeMT33A/rmutna1toh58yRgHAJJOfxNU21LS0bCX8Lk9Bux+uCKrmYuVHJy6TqRmJgabJySS4A9uc809NG1mHDLdxoT1O/P58V1jXkJO23ljnz2Qg4/Pk/gKiDzmQbGRR3AGefxFF2x2SMH+zNXRVL3cLZGchFOPzHNQtY6oGPzuR0JWFMH8zXVgysQznJHfYAB+OKa/muNsWoOpPYxq2PxxS1QWRyf9n3hXO6YknODbJ/jThp8yY81JSeo/0aMfzzXTLpl0zhhemQg5O5Ao/QcVaFm6sWuLgKCOMPjP6CnfzFbyOVg05nBP2CSVQcf8swPx+Xj9atx2GyQhNAtzjIwXyCffA/wFdLFHbpgC6cnpwc1MUiI+WRiT7YIpOw7HGtot+8zlLK1jBP3BGpA9uQTSLolyVDSW9smeOYwCPwIrst7DhRPjp1BH6GnLNKFACMPqAP60XCyOYt9F3gE29qw/2cc/iKuDRLc4JsRGB1KsOf0rYfcfvSHBPdiB/OgRIMj7QVHtyR+hpNhYxzocABby4jxwNx/n608aDaIQSoVSOu88n2//AFVsCC3CjMjuQc5I/pgU/wDchTgtn1AAxUtjsjHTQdPcsDPKD3CnH8waUeHNOc4W7vSG4GG6f+O1sLJbwHe7Dg53Oen6U1tXtUbAmhJ/2P5Y5/lS16DsjIfwjaFR5c147ZPJkAA/Mc0jeEJBEVS9ukU4JBfjOO4wM1sjUy4Bjt7uUHgFImI/kBTXu7xCS0NvbEcgzSqP0yTRdjsjGj8EmXBe/cD0OAafL4AjCZGqOhI7pkD8eKvxX1zPLsMklwQfu2yEAn6nJA/Crdro+oT6kskojtEJ4EhErgewYnB9/wBKTbXUEl2OabwRIBmHVVnGQAEhJI+pGQPxNJH4G1GecR285mPOSgyB9SMgfTOa757bTbQqZw11MmSDK5cj3xnA/KoZNXurhSkblV6ADIA/qaSk2HKjm1+H2o2qYl1e3hZhyACSPyxVI+Gb2AlRqRlUEEqA4BHbnOK6OZHaNyGJII3EHJP5ngVH8sqAiXB9cgH8aavuDijAn0m82FHd2UnOHmYgn/JFUDpe9yBL+9XqEIGPwOa64xoIwZZUQHKkkgcfyNUp9MtElKmQhjzkHqPWrTXVEOPYy00l4wCluCcfeJDE0rXN1ZxEI1yqqPuxb+voMcVotYWyIDvkz7cfyxTBZxBiyliRzyST+pxVqdlawnDzMo+IdQwVWPUmHY8jP41Wn1nxBKMQxzRg8ZaUkj68itwWyA8CdOckjPP5GnG1DHBMpHclzg/hU8yHynM241g8S6lLCuc4RyTk/wCfWp4LdYJxMXklkGTvdsnOOv51sSW8YBUI5xyQCeR9KgEUfA+zunHXOM1XMuxLi+5QKK0vmHiQHO8HBz9amjt5HkzJekpjnHb6knH6VK9tCrAuu0Z5y5P8jRLBAiDbD5owTknOPwJptp7IOXuQSvCCFgClR/G3JJ/pTTIAo3SCpoI4pSc28a46fJkn680SI38Fui4z/AP6nNF0tLAl1IBOY3DROQ2OoJBH0oYySsTISc8kt1JqQQuZATbrIMc4YAZ/A8frThbTgEhI4m6gAgn8DT5kFhItHZn8wK6p1yTtB9/WtWOLT9PiAIWSRxg9gPf3P15rJaK7kJMrOw55JJp4gjVRvJJ7joB+NRyp7sabWyLUE1ha5kfM8g6AD5f1qyfEeFQormRGBGcY6cist4YipUEBuo5JwPrioo7Z3zjaMHqcjj8qrli9WxXktEh11c/aLl5QojDHIAPT8aY8sjciRjjsSSKRIGckbgoyQMgg1P8AYA/H2iPP1rRNLqRZvoV0dieorYi13Vz5ajUpkjXAIABJH1Izn8apJpuH/wCPhSScYOf8KspZMq8SKfoKHKDVmJRl2Nga69wwS4klEQAAAIJJ9SeCfoMCq8pO4lSShPDdifx6/hVRLXc5Uso46YPNaECQqqoVZivOSDgfSsW4rY2Sb3Kr+aFIdgMepxWbclpCD5gfjJ6cVuTRRuQQgAU5AIFU3sYpGIBI9Tkc04zXUUovoZct7qJthDDqNzCqjACSEDHp7VXtBqjz7ptXvdmOAtw2c/WtYaSCTmQ4B4wM5FTxaZboc+Y/XocCm3Bu9yVGXY39DuUuUO9NzQKACSTxjrk5OeOSTzRfxeVcRyW6DZI4WSLHBycbh3B+nWqNlL9hLCP5w2AQeKurqIbquCoyMAkA59a52rSutjdXtZkohhS48uQgDJGc4zir8dvboQbeNAf745P51mveRucuRnJIIGSPzqe21CONAh+YZPOcEHHpSd2hrQ1skA55J71mX9jDKC7qCRwDzx9R7dalGpW5T7+D0x3pr3ds6H5ypPPA5HvUJNO6G9VqZLadDE5zGJCRjKDGO+c9uvfninSK4TywhQDKgkZIHqMc/p3qzdm3mhIRlWXBwW6gE9s+tUobNEJWWVncnBfIJA6jA961Um1dkNJbGZc6GkjskjRgEZUuo/qDir+iaXpFokhvbaCOQnCyjLA+oz0HY8+vWkm08z3bFlPlKQoYDJIx1xnt+FV7rTXLjyI2X5QcAkge316n8a0upKzZHLbVI6caZZAKRaQSQkZWRVBP8uR+tOjt44IybdFjDcHYMfmB/WsLSk1GynQGby4CcOjc49wO36V0YuLVlALAt3OMH+VYSSi7J3NY6raxX/fRQNHDO64GRuG8D6k9Pzqlc3lxCq+ZEsxHJMeRnHqOeK0mlhAIDYwRggd6qiJHmMsZJ5OSxGSfp+dCkr6g0+hkz2eh6s4M0MQYjhiuGBx6jjGfX8qZpGlW+jXLTjT47zdyCcEoPY9M8/Wrd1pgllLMygggkoPvcn9c1LbJ/ZxJR3ORzkYx6U5clrkqLb1N201S1vYiI8o4HKMMEfhT2t4zkgHLc9fWsgX7E5yjtgcA4/Q81G2q7JAGJDE+5x7ccVi2r6aGyT6mxNal0K5DZPRgGH0waz00uOKUXCadaeapOCigfjyOv+c1D/aZIIDM2M5AHT/61KL99oySpIzgnoPzouhNFFURc8DPcmpFB2gqoIIyMVVMrR4DFQemAM479R9aeJtxG5mamkx3RZDrt5YA9x3pQ56hSR0zUCsOgwPcDOakE6rgHPt2waGrBcmG4pnoPU9BTiSFPzZPbA71CbjcwPAxznGMZqQTKq5IJIo1EOEhBxjH86V5SBxkD0J5qI3GT9wAUgdXbBzj0ppAS7y4B5Jx2NKpbgZJ9j0FN3IoA4AHbNO8wuMBePehoBzSPwAckdSBxSjOwksTjt1JpmQo4OPwoVHZvvHB560bAPQk5JJAHTNAZ3mAJOKSSQKpQY471HDNhiSCcd/Spd9x+RZAJyWJUZ70jSADKANjv3qpJNvYguCPTtUYkUdDk+1LlfULlwuXJI69BmkglwDGSMnsDVZJOcluntSSFEG9DnPYjpTS7g31LDDLEbunfNQEYY9QPUf1otJC8/z5IIPPoalnUNhhwR19D9au7WhO6uUZAAxzgH16VEZGUjDfiKtkBgQQAR+H5VWkiTqGBrRPuTYRb1hxvwR71ML91HJQ49RVN0UjBAP9KiwVPEmR6Gk4J9AUmjVF9FKAWIXII4oF1ERxIVx0BPX69f0rJeRyMF8r6EcUwPs4BAz2IqfZLoNVH1NvzHwSCrDI5HAH40x3wv7yLnP8Bz+ecVlNMcggkAY6HAP+NO+1zFg288ev+FT7JrYrnXUu+fbgEnIIGfunn2zSGa1cAeYAT2Dgc+lUXuXLAHBA65GSfp0wfemiVzxICBgHC9Aec+/60uVrcLpl10jBICMT/vA5qEnb/q4SxHOCwOPyqILE7FiI8NxyOc9cdBn9KQfu/lGVOADsbgnOMDoPrz6cUAK7TyDJHlgdxn8elAEgILTuB6FBj2OSM0jmfaPnkXnOMAkjpz146e/8qZ5lyxCpLnPzAMOT7jpnGR0qhMsA5XBYH8P/AK9P8qIgZHHXjNUlnuU3F4Ecg4JTI/Pk/wCfpTWvNrACJyueoIB9+D/j+VOz7BdF/wAmEYGAfrQ1vCw4UA467jVT7ejgjEiEEYyu4HB56HvzSteIjcsoBOBnAOfxxx78e2aPUPQseSVGN7Y9npjRELsEp9zuJP8An8aj+0I6AoFdW6EEcj15IwB+ftTHuFRcmIHjd06DHU9hnsDz7VSsJ3HNCWJ3yDGecDJ/XvQVYY+dz37DP4UyaVEjLtGQQASCcEA8DIPTPHvSLMgUExEHG48j5R7ntTVhO5MyuMZlbPuf6AU1o4mzvO7PAyc4+nFRtOoAGGByBg+/Smi5jcFcHIwCAfX2oEDWyqPkZcY+6RwfXr/9apQihRmdwe44x/KmLcJk4U9cZAHWj7SNxwpP1pgRug3EGaQqRjgAfzP0pFWJMArMw9QB/hUjTIRyCM9wKek67SSzYHoelVdCsOVogAQJeD0Jx/SnCOJmB8ogdcnGT+IFQylynyYJPQtmoYZb8MQ3kFeny5B/U/55pCL6wx5z5TKD2aQEE1MiwgZ8oEn1Az+Zqkk0xwN5B4wBQ0jgAtLj6/59qNSi0SpbJhT2JA6/n7n86QqoyWitm46hMmqYndhgOW/DPP1H1prEEYJYknvRYm5fDAqSVgz2JUVC8IkxnySfUA8fhVYXKIeVJHsR0pTeQgjBUnGcEjp3qrNBoy2sUanAkc5GDtIAHH1prb0QBMSjPR3Ax/j+VZ76tBGQSATnOUwT1xmlOs24A2knnHTGaLMNCxc3ckByNOMgxjCKG5/MVm3mragykWmgyA44d1wB+APP509vECEfJEDkH0z+lJ/al5ICYrJhkZBKHH48c/nTV0JlFbzXjgHTghPU7Cf8av2r3T48/T23dzlOf5VILrV2AAsuccEYGT+JqQJrMqAuIoSSc7mAAH4E0NiSLBiMiYCBR6Fz/SmLEYhgBBg8Ekn+pqsY7sHEuqWsPPZgcfyxUDpaAfvtZMnT/VocH6HBpoGahnMYG+eNQT6YFNfULMH5rgMcduazUOkRsSTNcY4ycgk/kAaV9VtIiFt9OgyOhdQx/L/69FguTyatZA7UEkrY6A9vxoN3cugaLTJQvYsSB+oFQ/2hqjQl4g0aA9Y4ggA+ppFtdSveXnnYEDkkkfqQKEguXtuoBA80tnZqecM2Tj6c/wA6qzSQK4MmqzzgZyIk25+hJxVqHQIxl5UkkY9s8fmMfzrSgsrWLBFhEGBzl/m/XNJ6AjBie0kc/ZdMlujjAaVy3PuBgfrWjZ2esyMfs6Q2S9wiAH9Ac/nWzHdyBvKt7VEA6noB9AOamS+eJjHcbQeuQAPpwCf1qW32KSKsHhueYE3+pzy56gPgfrmtCDRtIsxkQLIw5y5yc/iahN5vUkEFR6HNZ8l1vk4GAOoYcmps3ux3R0D6gbeL/RYFIHAAIAH4cVQuL+7nBEoAHU5fH6ZrLNxcM4C5CjocYp481/vAsewxkfqaLJDuE291JIjjZjgDdk/XvzTLgzW8Q8kQByOSDk/0qx5fkoZZHOegIX+VU3xM5lYyMEPAz1+goVgEeSaU4K716nZ0B+lRSxSALkEqDnAPIP071LZzsl0Rs5fqQRhR+Z5/AU6VhcT/ALiQZQgPk4GPeqvYViMkzwBWY+vOAR+maS+hiSNHdScADsMjGOaku4rd2ADbJR0dOn50vm+babLgMSDgn196SYGdHc7yBErrg4ITOB/T9KtApKCQQRnGQcHPelXESkIAy+5xj/P4VUmvnhAZVVQCBng/5/OnvsG25YlVwp8hicH7pBH64qIqxALqcdTjOM/hTjqAKgAhu/HWnpdK/TnPvTsxXK7vGrKDkMemScH8c4qcSgL0AHc5zmmzAn5tgYYwQDg/gargFjhHYH0Yc07CJZdrg85z6A/0qoYmQlowyH2HB+uamMk0WN0QIA6gE/yoS8BbaCue46kUAU3nuXcgIAw6EgDv60CR3X97ExbuQQQD+BrS3h15IAx2GP51Xkt4JDkOoI7g9KE0GpVIUqNj4+pIJ/E1EyOOm/n3yP1q29uHUA7ZAOQRwfz/APrVA1nKr5iVgM8gZFAEW6RZAWHGepycj6//AFqX7VOq5ZRgdcED+dSFJwAWiJPUZFOEqEkGNhjk4HQe9TqNEIvUd9rJkjvgfpxzU6OMghCQDgEDgHPucYpheJiQvBGMZ7nGaI5wk2A+/gkgngD3BHFFk+g07A0UcuOcHk5JPH079asQRqACSHyOAygc/Q803eC2DtBxyM4AH48U8qxPywhhgYAIyT06/nS1tZDLCyIcYEI742j8/wBKUktkAqAOwH+GKiNu+RhX5zkDBxx/np+lOSCVX5V2BAPLAHI/ClYdyaNmBBIXPGSB3qZbh8YBB9TTNpZRhMYHr9O/egKVGMHJ5OBj8aQxQ8pyQAPx60HeMkkfQnNHJUEZGRkAdqZu6AIcn060JAS7mPBOeeMCguQOhPfpURkIcARkg9CQcUBi7ZCYBGMEHHXr707E3JfMJUjccgcHsTQGLEE5AyM49M/4cfjSLjA+TBycdqerAZVlJI6noKTKGqWAUFsnnOBj1x/T8qcXOMA4YjgkZH1P68e9KSB0XkUh7jAPftzU7gDTgYxgHOTnHPPr/PilSVsKBwTnJBHI7YqMnLABBtx1zz+VAIB5RcZ4656U7CuTs5JGG3KTkk9RzwQP/r96RJWJIYkjpxgmmb0PG0dcdTSlkUkhV/E8iiwXHqzEnOVGMAg8nj+fT9akGB/Ex74z1Pc/n/IVCJUyTtA56ZNOEiEZ98D2HNJoaZKHkWMDIZxgEjIByRnvxxShpSYz5hBHUA5AwOBk9aiEwHY5704Skc7SQMdvSjlQ7sspvdcPJgk84Y8ADgA+uefzqwsakkiRgcAY3H+lUluhlRgcnAyQM/8A1804XxK5yFA6nnAI/lRZCuX3gZlO6aTHXGM4/M0x7dlj4A3ZIJ4B/nVUX7+Yw+YBcYGCOTjv7++PenNckq54DDGRnJzyRnGfapaGmMe2uySyMAAc8kAcf5/EVAJCswBDeWowQQSSeuQT26VaeQjO/BQEc98+359e1V0UPGN1w24D+6AAR7DOQR2z3o06oNejJVkSUAggEccnFSMmeCQR1+lVyqPGDuJYnOFyPTjjt1/WhCUUJEpwDgbmJx+f1NTZdCr9yEMSuPu8dPU0iSEHgqRn1zVYsVAJ59MnJzT1f5scAnpgfyraxnctiUAkYI/HGaX7SQcYAx6Dk/jVcOGUnJ4IJx2zx25HWlLYJGcAHHGMH39/0osguyYzuzYHHvR5o55B+tQM6jIAI74A4/x/PNJGQ7EkgduaLIRZEhI7+tOSU5wCc+xxUAAU8En9KcZDu9QOcE8UFF2OcLyxJHXGamF6hyORj1NZZmYnggfpQOV3E5PXrUuKYXZom8G47QTTJLuQDqOegqlvwCSCpHY9SKiMhdiQ2M9s0KKC7Lf2mXOcA+5p6SSG3LnaQTycjIHaqDs5jIBOTxkDOM/jTzkQoqSEjAJDAjH0HNKSWyGmx0lxGTy4GKjN3Co+UEn1pfK+XcSCTxgCmbASSQAPpmhJA2xy3jEjqB65qYTYUDceepNRBSx4AwvsaegLPgbR6EimhEysUYOr7gefrVlZ8kkSYB7HnFUUn2ho2Jc46kAY/WlXHJA/DNLfcZfLgjGQR3AFQyIT86AMO4PWq3mnBAOMfrSR3ZB2PkEcZJppCbFZwxzuwRxgjpUUh4yRkeqinSYk5C4PqOv41GWKqcjIHXBq0+xLGbwMkMf8+1M3gknANOcLJgrgk9QeDmosMOmB9elNSE0P6njIppUn0IoKuME8E9silBI6nGe1UpIVmMO4dCRSDeOhzmpQwIwQDQVDHIOPrRoKzIwccOCe/BxTMp3GBnPAxz659alKlcg8j6ZqJhk57UNXGnYsQzvv/wBbIMnIweB9O4+g4qb7RKYjGRG6kjIIwDjpkdO3pWfhgOuPfmnIzA4J59cVDgmUpNFtZgCSyOhJBIHOT0JzzkDjrn6VAJoEcqXEYHLlwRuJ7D1I46YH9GNKwBQAkevcU0SrjBJ6dCKXsw5iSRAGJjcFVBLAkHkdiRgLjqQCTUXORmIfMCdqqdxPoF5JHucDntQY4X6BVJOcgYIP4Uw2jIr+RcsgcAEZJBAGMc9Pw9KFF9wuuw8Y3AGMI4G8sCCsY/2jwAeOgzUIMM4i3bwJ8mP5T82COeORzg8inxR3CtE4kDGNQqAjgHGCQBxnr649KiInDIVcMwJ8x2PzSexPUDjoMccU0mO6JC8YjLCc7Nw+YyHGeQOScZBz9Ke8/lySLJKpJJZw2Dk+vT+VVmeQM4MEZUHMKA4RWxgEgYBPfJHtTJQkkjqwcJcAi4lz8xHHA7AYH4DgccUW7oV+zJbhTIVKyxoS28gAYY5OD+uKjNvMpyQi4cuQIxyTnr69f196bIYZGNw0RcwKUhhAADjPUkjJJ+noKqmAiGOITMBcPvkY8CPHOABx3x36cDrTXYTLkcE5YZdT+9EpOzBJ5z+eT2p0kE5YEKCN5kPJGW55+mSeP14qkkIXULh8kQQAYj8wgsSOoIOBk4J9BS+bdpYwBbgiVmGTIegIJAJwcE/yBNFrhsWltpiJdylQZd6ENkDrkYPAGSOMfj2pT9pR3ABVHIbIcHac8gAjpQlxObqXc4S3SMEknGCByQCORu4rPOrXX2RZC8Pms4G0MDwQckjORgjv600ribsaIa+kDOqspYggFgQuAOB2IPPpjilH9oMGbaUYkYBx8vTPc5HX35qH+0mN5HCTEiAZd9+QDk5Gc4OAOnWqQvr6W2dzLiVGHyqR0PXA6gd8+3vTSBs0SdVIO0FSTjIIOOeo9j6HnryKHi1ZlBDYJwSCQMfQ44+nP1qst9cecrmciKSM4IAwp5BPQ5APPWoTqN0kLq9yolRiNxGQ5BHA449etOzEWmtdTdiDIFB55c9fXgfpmlNlfBm8yZSCOMMeDjrx/KqZ1KdrjBnLAjLoBgx89B3I/Oo2kuZAUM0rgAsjLggnI4OOCOKa8xGiNOIyXnJJBPI6E96jS0tYAryTsVcEjkAMAcHoM1TFrcHc4hYcgOjPkN15Bxx0z9aBYS7MOg3FsAjkr7A9x9cimBda40lAHeJ3LcAZIz9BkDFK1/YxsPKscNgnJAzx3xyce+KrrYTNgtIFJBHyLwevUdKmt9JQYMh3ccqOhOfQ5xSDUVdcmG4xwxKo4yT19+gA6dyKiOr3rD/WogJ7LgkfUjH5Zq8NKtCQwj3EHOSTmrEelxKhKW6qSOmBg0JoLMwzd303PmzMBkEZwMfh1/Shbee4GGySMAbyc49QCP8A69dCijhCoB6YwcY9KmjiaPoowR0PH8qL9kFjCh0q8YFmKpk9CM5/Gr0WiwgDz55GJHsM+1aiuE4AAA9DTgyMMgUrtgkVo9F08uWMbuTg4LkjPar8NpBbKBFFGhAODjJ/OmKwB4J/GnG5SMZdlUep4pFDyWkO1pQ4x90rxmozEkc4KQqT3IJz+NR/boXOUG7J6jkU0ynqXCg9BRcLFqR2wMEr7Fgcj/PvUSzS4y5UDHOTk/pUPJ+6Sfc85pAilgXfIAxtouFi0kpfPlOBnrznHvnAxTHaOFQzSlj3wMmoJLxRiOIgA+5qqdhl/wCWm48kgcfnQhGiL3KfKMZ4yR29aTzYgM72djz0zVEhmOCxVOgAU5+uakKxKuFJz6dM/wBKGkO7L0cgILEEAj3Ap6y5JG7CjtjOaziC2Dlsg8YYj8OKEuAilQCCOpIxk/WpaGmaE4MzhlLZAwAScfoKrILl3YSoIlU4GG5b3GT/ADFZranO0hjQ5AOCwPGfbFVlluZJyolbAwMMcA/QDg9+aaiwckbwEUEReVyxBJByT+FQw3jStmKAlD/EQf0rKvb2QKYlDHA65yTxUtm7x2sxc4OzaoJJJP8AL8qfLZXYubWxZvw10wJULjjIHIPr0p0duVgy7kggAgHAGO/Ssi1uZYZjFOrBCTgkZwa3rGRJYcj5j06EcflTashJ3Ku8g4wuzpnGcUyW0DjJIKEcDZj+tEyyRXLB4yEPIIBIH44qaN0AJJPPb/6+aVwK0dskQCI8gB5OzHP1JqcxwwgYgL8ZJY9/cdKJFcMCi8E8jOPypvmxsxUvliOVJ5H4U9wJBdBCAsUYHTAAp8kpmXaQhHfjpVYkRt8sUjDrgrn9SRTS87tuSNlGeTIQB/MmiwXFNuFbekjRc8gZIP8ASoZLVtwaVY5AOdwOCPx5H51aSUSZG9SRwcKSPwPel8sHPzE59BgUXCxSgitixCSzAgDhsHFSpbBf4fMB6Hdj/P51K9vH1MbE+oPJ/OokXy3J3s4JwFZDx+J6/hmiyYJsmRoo+iDI9Dkj86eLwZIBBI7A5x+FV/ODuUEUiEccjHH4097c5GV3AcjJwB+B4zSskO99iR5kJyUBPcgDr/OomRXBwpGevf8AnUchKdQyjHXBOT6f5FJ9oIUhSCQOQpGfxJ6UeghDYueUYj3Jwf8AD9Kha0CLgnec5woGPx4py3BlYgtux1C5IH1J4oEyszKrFiDyFGQPbPSquBE8CSEblwox6ncfTryPrUzIB8vzOVwT6Yx0z0H0FTRguSQSSBgDHNWEgCr8xUcZxn+tS2hpMohZVYkuEcjHQjAxjpjk+/tUjOUmDtdhEzkKTksTx6dB6DNXPkCnAznr71E7KcuGwcYz1454HbvUvUrYqi7RUIE5LHJADEkdO2fb2xk9aR7i5JXbKACMAEAkn044/GlNvCyxxBVIByARjJxjn1pwtgzSPwCQQCBwv0FOyRN2wW7YyCMlWycErnA6cfXrT/PZYDLJEwAONgOSeeSPUelAjS3KBAAec88k/wCHWo2ikaV380s3OxTggc8Zx7UWTC7JmmC3IiCMBt3BsjGMZ9eP8aEulYEjcAvdgR+VJ5MiIArqWbJdiv6ClEbBnwVEYB2gg8nHGfb86Vh3FNyFjDM+A3I65xn61OpYsgByXJAA57gc88deprPJlZDKyqWyAQMgAeoJz6dqntmKyfMQUKjBPY55+tDTsCZLcTpaTGC4YxseQSDg9Dweh6+vFSllKqQQd4BGBnIPf6c9agd2kViyAkcKCeSM/TipRKwbIC8jD8n5QOw9f0pWdh3EdkRwHIyV3gAEnBzzxRK6xqZHKkZwcZOc9MU7cFfJwEJwCBye54qGRi0RV9ofsQCQBnv+FJIGyRXDE5bnIJJGM554/rTk3SxiQDAPIBHPuMevB9KrqxGCCDjJbjqc9jU6OUYsM5ckDA5HoTTaYJjRPEhRAWBcAjI45B71O7BSpGWDLkFRkA46HuD2/GopItzYGAAcn0zjv9KYhZFJI4J4BOcfT0FK1wvYsvlFD4JAJJwOcf45qJbguhYrgAAkA5z3x09hQpwdpHykZpTH8p2nGR6Yz9fwot3HfsSpIkiAnCk54HIAx6/UUEyoBhMjGNwPWqbMUcEntjIPP/6qngnyuGbJHUAcflRbqhJ9CVLjLZK5AwMEkHPenBn3bgw64wevekLRuGHGOvHb/OKYAQSRggY5IzgUaFakgdowAwwAckjvTtwABO0jvzz+tMdwRgnB6gio25IKkYI6gZ5/SjRisT+aqgEEjtkikMzsduQc9v8A61RnkEbcd8k8/pTG3EbWc4PQDigGRBtzEFx6grhgfY8gj6/pTg+OGABx8wHIye4JAI/OqySBzljuVxnkYI9s96sI0YABwSDwTwadhXJVbzGBJJwMZJJIpjMVbjOOnI4P4UB2JBxgnggDg0hzySeB2FIY4uSACCw7A06M7GBOSByBnikVgRjBC9fc04ZOMEAHv1x9OMigLCtJuYEAcdAP84/WlMmcj7x7D0qIsScD8T60uAB1P1zgmgCUEggFSTnjtUowpzwGHYDkH8OQarDKjcCSCcA4BGfQ4II+tKZCBjOcevP5Un5Ah7kNwp/AD9elM2MCMn8aVGDdSB7HpSjJfAyB6jk/yP8AI0bBuRXMhj8oASMScjanB9c+vQ1KBKFUyRGMEcFiB/LNJvBkJYsGHGGOTx+FNkm3PlnBPbJFJXHoTY4JJA44wMg/yx+tIGTIAUk+jAZ/LofyqBmJIwQSfTk/lQscjYBBIGSecY/DHP4U3YPQstM7DBY8dscD/D8qjVmDbhg/Uj+pqLcemASO/FKXyAMEnpwuc/h3pWstA9QZnVixJy3JwQev0JpYroo2SCR6Uh2+WxMb5wPmEO0DnjP8qgwAckrjsCMH8jVKz3F6F1XW4zjG7PfNRuQSQSQw/HNQK+GGAQM4OV4q75azxhtpAA7qOfwo0QblXzWVSDwR/n1pEuMsdpGR6HkflUrxADg5BGc4AP4YFV2QDJJyccAk4H5U79hFguMlgRkjBIHX6/8A1qjMrfxAY6DAwKgQkkkZyOpGcD9KcWYuQRxxgg8GjQCb5WBII68561G2RxjHqOaQxEnIyQemO9BBHykEH9aSQ7gpUgliPYAE0m8FsLke54zTC/zAHv0AGSfyp5eMjOADjGVHU1WxI7cw9PoO9NLKT86kH1HFBJUDYc55GeKjLyBgWVcHoeuR+FNMGSFc/dOR6GmlSOo/GlGCRjr69KcQRyAcD1o5hWIjjpkim4POTkGp+CeQPwppVc5Bwad0KzISOwGBnPFBYgYyMD1FSgY7g/pmg9BkZz6UARBsYLgY54HU00kMpwhUj1OM+1LIQcgAjHpTArHPJ59RVCIWaUMCcEDr7e1OWUhsOnA5yR/9apSh6UgiYEHqaljQ7zFZcBBg9Qaeu3+Ej8yP501ixByAPoKaN2R8px2oGK6KoycEfUU0LbhkYqAQOCQKUoSBgYyeaVkCryTz0HqaLBcjaO1O0FAOcggcc9ahlitypBAxk4BBI56/yFSk7gQFIz154OKQpGoHybTng00hNkf2eGQlwm48HODn0696elrbqDtTk56qO/X/AD7UCRkIUHgdPf2p7XDugPOScYJ4FO1xXFWK32kCAAYxjAINK0cTEnyxkjByM5/SkU4Iw3IAzhTTldXBHQgZ5HGaVmPQNwwFCgDAHSlEZyOQBjHHNKUbjAGSMnvSbJC+QCB3HGDQAm1+FHTHU0q7gQSQSTg8U8q4UEk/hzinCMkZyMemMUgGgcg55BqQEDGAD9BTljUAE5zjrT9pA4U4PGc1QgjYHOVOfX1qZG2gAcfrUC/LnPQe/wDjTsrjrjjipGTF1Y9cfQDikLKMDBPoTnNQs6ElRyarzCQAlHwPY8UKw9S6bhEHIAHuOlRtqMABG4ZHUAcj8Kz23SABzgjGMZwR6+lRGFVbIOCeRj/DoaqyJuXZb6QqcKBzwSccVXwjESSuHb0BJ/T/AOtUDTouQQMdwQRj9Kg2tIwIAAzwSMn8DmgDQaZ+BCACR6c+3P8A9amrNK7AOGUEYIYkgn1zx+VQojIOV2Jnlh29zgVZF0scZBIJzglQeP68/wBaLBclEzxqAjhQBwDjj8BimG5LZDuG9Rjk/wBcVUlLXDfKpVTwCSefzoW3w2XkZQMfw/n0NGgE5nBDCNDjIBKjJH4GljidlG+VjjPO3GfqMDmpoggBKIT3BODn8uf5UpYqeVUDsPb6f4UX7AJBviXAkJ6nkYz+VSBgW65bHIC//rNRtKeAwAB78nA+mKlj8llHzLwc8gEE+/NJ26jJo5o1jJIBJHQEjHv0qld3KMpCA5zjAwST6CpZJGERxJGSe6jp+prGlvlEjxuC+QAAo5z+QppXE/MstAPJCByozknGSfbihLuC0XiX5gMcAH8+pz+FVxDc3uPkEaHgswz/AEzUv9kwxnO6R5FwSSoIP0H+OaeltWLXoQLcmeVmWF5z14BbHPckj/Par0FrqjwkhoLdGPSRstj6AH/GiCAOQ0ikgnAzwfyHH6DrVqaUQKiCRYvTJwPp1ApOXRDUerM+7spooQ8spmKcosQKgH1yRW9phhhtVCFizAFmY5Ofz4qlPIJYgHZXAGScfyOcj65qeBvMiRkJCYwBgnOPcipeq1K2ehPePG8ZyVzng55BrMEm08Zyew6fXpWk4BU54/EVUkwRjII9uaSAjWdskHoAevOKaIi7Bw7Rn2IAP4U3a6AblJPOCSAP0FOWRdwIIIPp2piFSQD5SF3dc4OMfWpPKBG7gN2x1/xxTGw3LYJzxk4J/H/ChZiMgglc9cHg/TvQA/kgeaCT2ZQBx6c5I/CpFfC/KCw9c/1qOPDYznHXGMfp2p5ALZGOBjjoP1pFDw6FTjI+gI/pQSMkgYwQMngfh3po4HzHJJ79T+I6UxTgnBPX2x+eKBEo3KcZOPwAJ/Hmo5AZBgqxJ/ukgD64OT9P5UomypIIHqTkmm+YzMQgIHckZJ+mf60xkYVELsBwo5YDkkdQKqTbZgCIsoDn5hjHvk4/lWgWMmAEBA5yeQT7Ck53AgbyOBngD6f480J2JaKQtQyEh3weRg7t30NCIYwF3Izg/cB6D6EipjlQWILyE8BScZ7ewA96SRFaNVlO7c2NqnAJ7k98UaMewJI6xuTEGIPABxn6ggUhmDMRIrA4+bnIHtnNK4jiZRkKrDCqCecdT79ahwyL+7Cg5JLHgfoP60JILsmDxj52LE4wqkYA98Hqffmkf5cDBZjzgnjr61CspLqqwgkHljwAfbqaAQWdhtJA5OAMY/Xr260WsK4PMLdSXOZDxx0H+JqWC4M7EBSAOeQcn04qIDKgAAlz1JK5HfHfPtxUpUxyA7wmR1Hf6dzSGh8gaMKHwzE5wOAKcriNyQCSeOOp+ntUKqozMxYnoARk+3ApTKsLpIxJduAcE9ueBS1HoTs4DCM8uRnAps0yx5Tqc44659qRSFuAwOTjOD156ZqI4e4aXJYITkDBAx/WhBcHLRyKWIUkD5RkmrEbAR5GTzkk1WZ5GcTBQGOBnOR709vMaUHGEGTgngGmwRM8oRwrHDEcKD1HrUy46luF7A9TUDZabJBB7Eds1IwdoweFI5GeB+P4VLKRIWKugxktycDgdqjdwCUABzx0680OwYqdwGepzjPHH8qQ42hdoOOgPrSBhIxWZIzkk4IAHT/Ipv2hoyA6kkkAEeh7/QUhViApJJUHnOSBQDuiDE5wOvcD+tMksGUpKIyMgjIYHgcf400sA4BIAzjPX+VNDAYJGCwOR7+/pmiUqsTMxCADAYjgHPGaRQ0+YksuCTGTlCByvsfXr29KkWRAAH+dW4OO38jnvwahkmCwGQt8owCw5AJxiiSZBEJgcxsQp9ATTs2ToiRlJjCEh8fdYcED0z3H1zTSrMmwAhQeoOG/Mf4U0yYVCCDkkHnkcZoaQmSMqcDB3Ajv2x9f6UJDuTBWIIJBYYGe5/GnhisZctkAZJPBHOOaijLtOShPYgE5wfamqDtZUGNwJIJwPUgUWTC7J3kAK5JIbIG0ZwR6+lMFywLKFwQcAnkGo9oZMhgW44JwCO/0P1p+RhSoYFQcgDIP154oskFyQyFv3hYKoGCccfn+dIQqxiQhmiB4YDcAT646VAX+ZpVIQnkiM8EY9Dx+AxUby7BvSMNnklRtP1wOv0oswGs4UcbSPYYP196kRlIDMQAOx6mmlc52xk+4OT9cdcVEU5ypBI6gggkf5+lVo9Bal5Llc7VIx25p6vuBLHHfp1qiHC4IBBHryKd5uRkAgHrgUuUaZcYh8qv3R2PNIIQCcnHpg1Akm3JDZB7ZqXzGPIB49KmzQ9GPDFPlAYkdOaYJyCM7gucFguQPzGO3eofM3kqBn2LFTn60xnUMWVJEkABZXJOR6gHnoO2R9KLdwv2Jmm8uMKNpJGTs9fpjj8KiWVWBJcnnpnBphCykSEAHHUd6NgyevuMZH/1qasJjzdHBwSB7HNRfaJ0G/wAmSRCcAkMQPUjB4Gfb8R3RgGBRJI1dgQCzBQB65qg8N9bOVuMiIkqrAcNk9c5B+hINPRi1WpoyXyFgqkgnnA5yO5yKak6NMoeVUIIOc4PHpUbaVI4jAnjIj+XBIJHftg4/z7VEYrdJStxJC5AAOAQfz6mmmmrA01qbW5W4DAg9yBj8zQGYZyFAHcMCD+VZVus0c+IpEAXoCd4I9ePToeOD1q1IZlUKFTPUlSCM+wwDU2TehSbS1LG8M53cZP4UYA5Kj6g1R/eg5aRQPTH+NIXIHQMfUH+dPlJUjQTgEiFjjnPnAfpkfpTDN5ROEHOR03f1NU0mjJwY2c+hJAH5Y/nQzjORC+BzkMefYUWAtiWJiAHUtjDAtjH4YwKmSZ4yCF+XoQGyMfhWYtwdpLyMq56FOM/Xp6VMJQy5VS+ehC4/oBStYd7l9juUlVAGOD1Offp/WomVzECAcDkkDj9Kro4VwFCYzySegz6jOT3qcvJ94SArjs2P580ARMSQSQxA7AkUoYMQVUD8Tz+ZzRkuCGYnHqcg0gUg8YAHJOKNwLCYdQudueuT1pxhb7u3jpjoMeuepqqHYMGGFOQAc8/lVuK4xGS6sxJOSxP9OP0zQMjkh7HgZxgZx+vNROuPuDgDAAwBxVh2Vh8rbyfTsPf86h8pnwMYIycYxxQvMQzG7AwGI5JBwAfqadHIRkEAnpg8/wA6Y6kAhmwQeADn+VMG4KMng9gAOfXpRa4XLay7VIQoCTks3P1wOKWVo2YlVJUHgnqap7wOCQCOMAZNHm8HI2hTnkcn60WC5Izcggnp0zTd/XOc9u1N83eud+1TyADzTUUFifwHP+eaYhfUZIpA5HIPGOc8U488nA+gzxSEArkDgdcnrRcLDd5K9RwfzqVTkg4B4xg8VBxkHkY4BJ4oDHJI+YdAemKd2KyLIQMM4BPr6UrKAQpOB6mqonKgnk9+DxS+aTgBsnIzmjUehKQMkg59OaQnGBkZPTmoS4DAg4zkkg/lTc7m2q2QM8+tNCsSnJYjGfxpBuY5PQe3SozuVsnIx6c+2aabgqMnkY6de9O4rE5Ygc8D2NNYlm246dAahebGemQQMCowxHJJJPGfSmIsFGPUZI60KByWwB71AzMFAyfU/WmMecDp069qasBeCqTgFQegx2pqld2S4Hcn1qg0/lFssAT0z3py3KsoBxyM5AJHHOTgHFFhXNMSR4yXyc4HFPEkZIGWJ7isuKcSKWCkBQQQBz+Xpnj8aVLgyAMEIA4KtkEHOMc9c+xqdmUtTR8xCDgMT2BNAlORtCnqenNZj+ccCNeTyRuwevTp6f56igvIJEUFiASTuGCRj1GMnrz+NOwrmo0zknAIx0wOtRmchsZwe4zVRScgknao4Gc/j7GnytGylgMY44PA9/b3qRlgXG5thB65ORwf1qfLOAQVwex5z/hVGO4VwCAA45PQZ/xB65qZbogHA69jkEUmikWTCSeSSD0HQigKEbccE9Dgcn6iojNgKGYgDnOcDGM5/UfnUgiGD5hOCAQSc5HqPX1pagRTTIFO1ckcgcY+nNVik0pJwFTHQZwfzzVsxxodwxgf3j1/DNM86MIdhCk5IB6nt/hVolldbREIPU56MBn8u1OO2IFuq8ZAB4/IU8zBhhFOR1BHIqq8LSyhi6swGQQdpx0PAo3DbYcZ2kC+XyrcA4PX6Y4pojUMWZ85I2gEAg+/H+NRiMsrNFuZlOCoOGHPvjIprRXBkCKEaMjkSAgg/wBMZpiLCleijIHJycY/EjHepR9nRleRsuCQMAEj2yDio7a2eFRuuCDySNxI/AGpjb24yWkwe5LYBpXQ7CG638IyA+nTP402W78qMlioYjAAJHP1ApXAhwQHYEZClQQfxHJ/OpUCO4ycAnIBBA7fiKV0Fn0I7eUsoaRRuB4IO7+gqSSYgHbAzMOgCkZ9s1aZ5Ik4XdnoVOSfzqjLcTOpJOQDgYBRgffJovdhsVZpLuRiptnhJHAJJJH5j+v0p9rYxbiZWUkcMrHGD9cUwGR2IZ1yTkB2LEeoBq3sJQKsrhsZ4JI/L/Gq6CRchjh2/ulRsDHDA4/GiRVCbSq5PAxzx/MfnVWKKTI3n5iM8gDH5Y/lUhUCQ4+Zl5ID4x+AqLF3JQWTABJ+hAA/U1BLKQw/eOp7gAn8iB/SrKDcc7R+OKY5cZChSSckNIynr7UaC1KE2JCSgaQZAJZipB9Qf64pFsoV2M5YKgyAoGR3PP8AhVvZG2QFR0xyC5Yg0qKgU4EeQMcxE/1qk7IVrjo7tBGGXCqePmBzSSTrIAFJYHoMH+uakGFj/wCXcEDP+rI/qajadQwwVyRjCJgH8TUgRMzZAKlceoA/THNQGOQyZeRsdiSq5/AVaMyk4AYnuMEU0yOQdiBc8EsQSP607hYfACgGQ5yOu0809tvUkg+3/wCuq3myiQkvGIh1Z2JJPtnAH61J8rKCG4PQ4wDQMeA2CAdvtnOafkAlSWOOyjiowVU4ByT6UrHKkEhR6Dn/AOtSAcGKkKqHJ5JAwAPrTTIucAByOw5waYMEEEMR7kc/5/GglcDB+UdgcCmA4sVBLkAHBAGBj/GlRtxJIIA5Oeg+tRjIOTtUdgBkmlLLs54HfI4/z+NICYuXAGcDrgHrTTIWwuMDHOeM/wD1qrO4kYDDbVPUAjJI6D1oYgEICF46HnAoC5K04JKIRhcZI5GfQVEXxIQFLuDhjkAD27/ypDkLvX5QOc4Ax70kRWLJQFznJJ7n3OaYhSxEgMjAEjAXHIH060u2SW48wrtUAKuT0Hc49802IMuTIwJJJJPH4DNPQNIxdx8pJCjsBTuFiMkNKwjGY1AUADqe5z1NPYlJzGiAIFBLdCCR2H9af5g3lQMBeN2Op9qVdiEqvJIyc98+tIZEzJHMYwhMhAJYjIGeRk+v4YpAI0nLyEvM43YI5I7Y4wBxUpjG8uzbs44A4AHamPG0twHKBQFAyepoQWEiJVy7svOSeOn4k/1ozIwIGEQ4HQlvrk9/woljjaaIAFjHnGOi5OcmnSRqYAxbaQwJI6kY6fTmgPIcWYsqRABByzE5JPoPSmXDESxRKMIAWbDYDfUYJOPTgVKELIUQhSy4U9ME4wajixheQ2DhiepPfrSQxs4BUyFS5GAsY4A9yTTV+WRp2j3jPyxZzjPYH0460/kOVchmwSBnGBxziiQMXQHBjIBJ6Zb/AAov0E11EtDII2MxDOwOSpyRxxjjr6UsPmTWpil2qGI5J5wDnt9B0pzoxiAUBTu+Ygdu4oAxu2gZI+UnkE+/60MaGSsxI3oFhVspk5bOMZOPoeKdJK7ThoyAigKcjJYjuMdB6VIu1cKy9OSpP9fzqIJtlZi7EMeOeAPT2oBiyvIZIzGSAASxxyxJ4/z70sisyxgZUIxLHpk+n0pHRSVbcCqZ4zxn1pJNlwphfOdwYjGCCAQPr1oQEkitLH5bHCK28nPp2z6c0ir9rhEQOUchiegOBnn6U0uoQYGVkJXA6Ee/4ilMhVG8sYKLkDv+dIBLVlugIyCqBgGDDjIP9KdGAcrKu0AkEH09cfl+VNRdxBwVyOSOD7ZohZjGVlIIBIwf0Ip27Ahy/u9wUcAnk8jH1p8fzA4IYc4z1x9ajCrFJndgHlR1Ix15/KgscmRR0IDAdvc0ATo5BIUlTnoe30peCxySGOT8o7/4/WoFJckg/MDkZHGPT2p2TgqwHJ5x60gJJHC7SOVPBzyQe1NL8+YmcEfMoPQ+oH50jcElCCDwQeajAUMcgr7jtTQEw+Zi8eAT1BHGaVkAYsMqR1CnIP1BzTFkKgjCsOv4UYC5JIQE8gjkUgGADggc9eOlI2Rzkg+h7UzJAOPyzUsY8wZIOB1Bo2DcaAD1BzTkU5JByO4BpwIQnIAUDj1NJ5oC5B/DBpgIWCnBUAf5601klfPlrFIQMhQ5B+gGBk/nSCQ5PCuD1yP6UpiCqJEfbnqpGeeOhHalsCI1khYEMksUiEgqTz+IPv8ASmu4mcl9uCBwBgjj1zmkmLXEhYtkr3Pp9TTd21MAKcnGc/rQtQ2HhwMAHOPUA/0p3nDHGSQQeOePwqDaTgdcnjB4+lWI4LgRlorYTlTkqSAceuOcmhtIEmSKt7GN9uipGGHXngjqVAz6d/wNWpTHKkZYFW+8ECA5I7dMnntTUuvKi3xqwDg7toOFPocDj8RnjjvVdEne5ZZGiaMfMh2gk/TJyBnjnFYNt6mq0LM1tHc2wmW4VZQCNhBO491CggAe/Ofw5pW1mzDDRMVXLOu45BxjcAeQccY7jnjir4ezt5/OllWIbCGBYEcdMA/qAO2KdPBdrGGtizAgEKDklfzAAxzzQpNaA0mQPJbpEYjE2XOVYcFfT5gODj1PPfvSkKVByrH1ZQT+eDTWbcFUpOswPKYBAPrwfQHmmPIHPJwfcGrgiZD1QliRuBHOF4/oaiuIRsBcsRn6f1p4ZVAJb8uRn8f8aSa5jjTcWLEngYPJ9Opq9ehKsU+VO1WwueSMnFIsMZIEt3KASc7VA4/E81YdWkIZkePIzhhtP5VHsyOVzgc5c8frTTE0mLJKqPi3kYADAYjBPr0ohjMkxklnbYeoTBJ/76FCRtjaIyRySVXoOM9P60hWJI8upwTz823Az1JIpNjsNkEcBPzO2TgbiABk8Yx3pwKoVJUsew5JJ+gp5WFI8KASCCdy7gCeOtRJK08rDa2EyGbaQM59fwNSmx2J4nnkJYqIlxkgNuI5PXsOnf1FSeYXwM89OmKrkNnAcgdsHBNPUBUOWIxwTkknnmqEiwZiHB+Y4GCOMfhmmeaSRuUZPPzPk/kM1AXUFdiM7ZHJJwMfkKiQtvOAitjJO3Jz+NOwrl1pCpBVwmPQEH6c9KFmyGViEUYOckkn6Z46Dk1SeYoQFPnOSByNoHpgc/mae8RjG95C5Kg7QDhSfUnGT9KXqNaloupfCNuIAyVXge3vSCZWJK8kHGR2PvVNctAGGUByM8jpwcf5709SViEUaLjHGR7dfr3J70JoLMtoVCFiCWJwPf8AlSG3Cx5LAMDwCckk+3/1qhHyoCCSc9O5/pjtU6uRhnyBjAIxgH+n1ouFiJ0KKC3IPpzSYYv82QBxjoT9T6VPkyOOOAMjJ6j8P8mkk8vzFyVOOORgE01qGxErEEkgleuT/So3uU2sAAWUd+AM0+XqdpIGOeevpj2qA7XYqMYAznGMfT3p2FcXJ3Bs7sjn0U+nNPY7SASSCOg6Zqu67cLuIYHIHUfiaMMgGPXJJ6nj06jvRZhdE+cNgkAdAAOp9KawO7BwADjFRyOyHIBwvJI6/QVG9yIdjuMMwBC9So6DPv8A40AT4G4KcA55A/rUgTcCRhcAjjvVZJgP3hG7cx2+mPcdeufUU5pQCWY8HGAPWj0Ad8xXnI7ge2KiO4KD3xkZHJpzygkBT2yT2PNNydwUAkkZOR2z1/OmiWRuQDkHDAevX/OabwTjBAx0HenYO4h8YwTx646U1siUFGO3rk9R9ce9VcVh4dHHDA4PfjFSLtBznaCQOP8APFVyFL5CjPJIOQcd84puW3gcqQCDnoeP50XAnuIUdgzAKQeCD2pLa3AJlwd4zjB6jpnHQimBy4UnoCDkjp9R6VMJMlTwMH0xj/OaV3sNJbgsARyx4LAg4JwQf/1VNuURbc4wM4znnHrUXnMeMHAPofzqPLcsFBPPPSjcNthZ2BJAYA45wf1pDu2Alwec/hVVpGXJ2k4OAPX1p4fazAAbeCMjnn6cf/rqrMktoSQGHOemP1qQlVBdnUEA5BHUehqrGpwJEIZCegJBUjtn1q0rQmISHaoZtpyQCSRnH61Nh3IvKm2mVAFVRn5gQcd+COKe6XMdtFOZIhFMAcsvAyAeSO3uah+1vBC8LxtJboQAHyCATyMjnHp9Kggu7m3hlWRI2t3UbVyWAGOgBbA6gg9RgVTVkC1ZoXNvcaUVlLOYHIDIBuABHIBPt0zToTDNHut7vcoPCsCpXH1HTms2Tz1iWa1eTawGAzk4HXaRnkdsGke2a4iV4sxMCWC/3TjkDFTZNDu0zSa4hZmiPLheOSM/j1/Kq73qSyrHvSKUcgDo3tk9fp1qrPGtxGjKDHMAOhIAPPTIz29aY8An2/aYUDYO5l4B9zjv+OKdhXLq3IaQiYtbyAEKxOAw6ZBPfrwaak7Gdo5oVVsfLJHggd+f09fpTUUSRmHcZAvK7jn/AD/ntT+U5Y4GACBgr0xwCOKkZIwaVf3riRgcglQp+mRTjKnyscqR354/xphGB94kdeOcfzqKdJvKDxFXHBKnr+HTH40bjeg+e9hgCl3UFjgDgZ9+3FBkYnCnzFb+Er90fpn9ayEtpLu6MhUfLzsK5/AdPStSJVRA3KtnJyM4z+eBTaFe5Yh8tQFBGCfujgA+w7GpvNKgjOGxgEnj/H9KhVgE5II7kdv8R9aXzEYFUmiLdgWGfyJqRkiSSP8AM4BwCA0THn1+tMW43EZk2sjEYZeWH4Hp71DLKhcIwjBYYBBGW9sHp+tNjiVMgRBRnqM5J+uKqwjTSQt8xkwBzjGf0NK9w2PlZWx/D0P+fwqmqKedzAd89P8AP5VMo2nByR1yM/n3paDuRtNKx3DfGQOxyD+v9KbD5jOWk8s+xIJ/nUjBJMgyquOowQT+h/lT1jUAbAhHY55P5Y/lRcW5JG4QE+WV/wB2mxXhkkKbbiPHQnBB/U0ySPAGAwPcKcVXcLGpJM7eoDE/pmhK4XsXWLY5ZhngA8H9DQuBGSVbJ5wZG5/wrEFysJIijnkJ4ChiB+mafHDLLKGaxEYYHlm6/nT5RcxtCWJEJ8sA/wC9kfrUImKEgrI4bjaoBA/Hj/IqvbWsqMQIo0BPTcCfrgE1JcWdy7EmeZe48vGPpwaVkMcZmU4IVMkYU5yB74yKfgEBiM98k8U1IsBWkSZmAyTIR1+gJP504SKeQkhz/s8H8fSgLBlQR0OOQAOM+xpWVlXdJvZjyFyM/X0H5VJlyow20D2//XULlRnJJ5GcnvS3GL5gxkIAfc5NHzNk5XPfmmb15BVSc4Az0p4KhMtIij0A5/CnsCHLhepGfrSF8AEE564H/wBc/wCNR+ZGDwzE44yKCSRk/mev0pBcUtlT5nyj0BJJ+p4/KgtvYNsYkdASTg+lMB5yRkD1OBSNIWACk7QMBVGB+J44oAcMlNzuVXoFXjP6ZpFwqkrGQxPViCf61HJIVIOSxHHHAHoBxk/WpHXAwQSepJOaYDGy5HBc+3QfU04qXAUsUAOSF4J+vehiSB0C9SSelOLYTEQ3NnBJ4x7mkFhQEUghQSOMsP15pSzs4CsAOuQMkfnTVUIN8rEkDhR6+/qaC5YAIpyf1FAxwZYjtyWb1PJJp45OWAAIwBnr9ahUANlvmYc46802QmSXcRn+nsKAJ3w20DBAPc8D8vpSh8A49OKgdiQoAAwOP8aRicYXIJ/z0oAlWQEAZIBI7Ck8wliCeV4xjge/+fSmcKuSOcZAoXLEszc454980APeQjaoOC3OQOgFKpQMcc4GTxUDEyQeWANxOQew/wA4/SnKxEgyTxwT60APSRJSJC2cjA4PT0omZWxCzYBG44HJHtUCgIxCg7ScjJ755/DvT5wDCsnVlyF+np9P/rUCJhKEjJD5CjJ4piSAKW3HJyenSmxkBN2MAjkf0pqAK+1QSO2fXrigZJIwEiqxYlRn2Oc9PWk3Bo3YgnC42jrSMC6Fc7WGCGxnj0pIcKdwGMHn1PTigOoKRsVR0JBz260qyfv3GMZxjnqP89qSQCPDLglm3Een0pxVXj2MOM5OOCD6igEOO4qqqM4bPTkfT/PekWQZ6khuOOxpiOwZhnIPQ98UhYDpwcjJHf60WAe24EAsSBn5v8aecSRswIBwMAdCc9aYj84BBzwfcU1WCk+5ziiwEkfXbIDzyAR0PfmnIxiGTzjjPfFRsckcevT/AD7Uu8gDaQQQR9aQEyvu6elAY7SScHOM+oxUbDEY4IwcAg8g9qfGwMZHBPp9KGMU5Zd0Z3YySucH8Ox/+tQhBBDErxkHHB/zzSoygHnbjnr3qNnOMEZBHbpQA/ecMu0ADjIHOPX2pFkGRgnHowz+FQhhkAkjvShiTg8EdeOvvTEOwRj07Z7VK0gVdq4J9R0qN5AF5wSAcZ7fWofNVkwoyQOQDzmkIeJsttZgCe+M4pssUsSNImyVByQhO4DPUgjn8KjYCcEqFWUDIycBvY9j9cZ96jiuTEC7Iysvpzj8Rn9cUxlqOSJoSZCsi9jk5B9jUBIzwTnoDn0+vWgvuB28gnOR0I7fjUYIPBHOeo9aQExPz7geo5GeKTJJHAxjuKj3bXIJPpyMVIQA3ygbj2yBxjvSBEiqWbaFweOc5GKsK864aIyghjjCqR7g8ZzjuD/hUUMRklAEm0k8ADcSPUY6nvjtzSPaTJO2Zt6soBMmFwR0IA5B6dqh6lrQV7mYSFmiMTtkFmUgH2I6evbvSPew7g4RYnUfw4Az6kY5/wDrUK9wd25nl44UsCPbOcnFItzKylQrl8HajICCB1H0osguSQmzusvPGoIb7rk7XJ7YOSPqOBUm+SGUpaMYUzyrMSuB0Ax0HufWqUGnzXRNzPHhVyEijJyxPckdP54FWkguIsKJWOOQGLbQDjjPA/POaTsgJZHYgB3Qn2IIz+P+HaomyMD5fqOP5cUO207fLA56g5z7803+LAHPYkY/rWkUkhNjw4UHLFSeOAR+oqs/lyIFebcCSTuGMckcHH61O25cExgH3XH6jFVrmbaB5uI1yACMk/h+tMRI95G8p2bRHnCgEkge5PX9KcpBDAKOepYkGq8lxC4RIoxgHGQdx47k5wOfw4qAyzKSeEUnvz+Y70kroL2L4ymcKp4/hNDbdhMiKQMZDDI6859R1rP+1SLz5qHAz0Hfio/7SYqQ8ayEHJZhgDsABn27+3pVKAuZGmtzZxldojjJ4yjEDOeeCcD9KZPcxqjMJmZBlsA5HHfNZlzeSTwhDBlV4UgZC/THH5VXhv5lIQJ5rEj+EkknAx/IflR7MXOkbyFmiDvE8Zbp5nHHrgc1KjQrGQ371yBgk4AOME49KwZZr4zgPFIzMCwjIJYDvx1FXJi8DBJRtYgMVyD1AOOO4/pS5Wh81yzMd4Kg7QRjKnOD9KIWjtg3lQ7mkGC7nJz7Dj8sVVM69snj1zU0Tg5IO09yBk/TNN6CVmyxECwJLBenHT86JBGrb3ZmAbk5AAHrjHNNwAFIA55Izkj8KduJYHb165AHPsOlQykD4ukYxEqCDhgCfyzx7U2WRYUG8MqgBcnJJPfAHvSzTykEGQrGP4mJOD6AHvxWRLqLpKdxEzA5DdOh44/KmoNg5JG2JxbuxYfPjAUgEr/9eoHudwJ7A45Of0rLfzU2XVxKUDtkxg5bH0PTPv2IpI7s3NyyQW7sWJKqGJwOvPTP1NUok8xfl1BmcLu2gjAwMn8fT/69RteMpjRQctgAnHGTimrFjI3Icg8g5HbPI/8A1U5I4XAZ2U8YweRn075pqwtSwzsFLM245wDnqf8AP4UkSsQGYELjJJHXPQflUchDthTkZGD3Hv7U95G8lvmO5jz7nGOOPpSbGki0WU4EYGTgEg4OT79hUZHJYcgH6j/PFVoXlVERVLAEBhnGeeTn6frmphlSzFhgnhV+bv1zjmi49yaQAvuJABIIA5GDj8ahMcTkk7jg7iCO59fQelLNIgYBRkkDPXHPb+tREs8bncqbRkg9cZxz+f8AKmJiyovAXPPTHTGcjH/1vWoHy/yJkkAkZ6CjOwhgpAIKg5659v1qZALePDD5mHQEHntkdc9e9PYWrC2UByjZAjBOMYJ5/nn8qkKrHKVBBDAkEHqMkj/HPXmmxsFmZHAHJxgnJPcZ9fapi0bRu8aBCOCpOSOBjn8P50tx7IhaIo2GPynGD246/wCfagW+1t6tlSOPcYyDinG4BYK5KtwQRxk9f51HPeMkQIXHGNvfI7Z/yKegtRDEi8kMrgkEH0pHCBdyqznOQQR/WmzShtrEfK2QG6Z79/09ajiYxxSEsHdmyAMDgdMdMkimIfAPPdljUEjJ2ngkAZJFWFeNlDRkoc4wT0A6g/lioYXjjXYQAWOSc44I7/571A8yAssbZYEFsdsd8+p6Utx7bl1fmGV5ySCVPHft2pw5RiDluSBjqP8AOf8AJrJGoEk+WVUEkZPQZ5OR/wDXqaGYyIJFbESv8pzk8nkDvgc8Ht9aVmh6MtyKXQleQAAWX19fUU1Y23YK8AcjbkZ4HB9+v51BNdskLHkgEkKM9T6+nSpFdfIQghyy8kHpxyBVXaJaTGzKQGaF2jIOQRlSeeQf8Klk2XERDoMkDDYwSB0OMcfhxVeZfMMYxuTPzAHBI74/z2qUjnAIKkcYGMD/AD/KkxpCoVMQjLFto6Nn09aVHMMIUhWU4AGDnr/Oo1cojJnKk7sEZwTjpj8KUEsDk8E/hQBPkJhVYqx5IBwKqxQkvIszMC7BgyHAyM9cfU0O7ZyeoPBPNQT3RhkDKpIzyMkj8KaQmXygV1cAlgCCc5607BByMHH5mqjagrQkqfm4wpB59s0036CMliDzwM459qVmO6LqlME7dpHBA5xTZpSkJ2srHHGTke1Z13dHy1MI6jIbrjjOMgnnpTPtAvSB88TtgMScrkdweoyT7/WizC6L096IADtYqTg4ydpA+meuKYszyorjcU5zkEHqcAj/APVRbQhEKGQup6hzkj6HqKsRr5cY2nIPAOM9Ox/woskF2xvnoSuCEY8EHofpmncAkyOvIz8xCmmlhnJQHHB2jP6darSSBXASNpEPJKucfkQcUWuLYsbnaVUt503MCQoIbOPQj/PHtVe7keIqCkQkfkEDJx7Hvmqry2xDEQyFlGcZAAzwDkD+lRrIsyoJEZVHGVG4fkTVqJLZetRMwxMmcfdydp/LBFXIRuyWV0I6HIA/Mf1rKWNdpEMpBPUKdpx9OM1fjlfyss4cjjOMEj6dKUkNF0thQwJOevbP6U1ZlyMblJPUYwffIJqorxsSyOoY9cEgk+4PX8qcDMAQCCrDGdoz+mKmwy0VjkfcZ8MOMEgED65p6qN+FZcDrjOfyrMSYQ/LJErg9Sq4I+tTqULB438pD94AD5j9SMj8KLWHdMuncScu6hf4uR/LNG/cMCYyAHoRwPxNJHLMQCoRlP8AeUEn8QR/KpJXIwXIQEc7RnH1pDI3GQyndtYHO04B/UVVeyjZChN0y9AobIH4ZqZ5QvKzx88/e/qBSRNLIWYXSEEcDIP/ANejUWhJaxm3VUVJTx1ZuPyB4p1xcwRY82adGI+6jMf0B4qvudZMve+YO6BRjH4c0kl4m0PCoJXocHb75wRn8jRbUd9B39pxpESkVzNg9CDz+Jp1tdmRN4aRSwB2sQMc9OOP5ms2TVbt+EdRuGAEjII/E96bY3U5dkkmV85O6SRSBjrjn9BTaFc1vOVTnLM56nOfwySKPNZjuLbQOvAH8h/Wq0LNIFZAGBOfTP59Pxp8sM28O9wFUD7oYAD8BxRYLslUls7FyD1JBP8AhSt8xw/P1PB+lLEUwNpyB04/xpxIBwBjkdyfzxQFhiq5JIPA78DA/oKMoTzJk46g8ce9TbQwwCQoGOCOfrSFNgOAMnoW5/HnFIZEGDHCqSBxnrnj1NPIcgDkY4yP5Z7VIYyQA3TjGeB+FJtCkEKSR60rgNRFQE9x1IPP5npx6UF1UcgAdSSOKVjIzDoB7U1lAPLZPvz27elAxilpiG24UEgAjlh6n2+tTsNqYJB9Ao4zUbSAZweRnn86RZWzwOB69/8AP9aAHqmBlhuGe/AB/pTXLshUkAZ5xxn+tMkJLgscgcgD1+n+elIcheDhiOPQDuff/wCvQA/eiKT36hQOuB6UiOpX7wyemeahBGWBO45wSTxz2/X/APXTiyAkKpKjqx4oAdGxmdjyIx3PU/4UskgQrxgtnAx6cfzNNB8tSchSfmyeTxjp+fSgRhpA5yxBIGTnk0ALI75OCcAZJ9B3NAlBj4OVGcn1NNlcZaNsMSM7B6e9Niy20sAFUghQMDj+f/1qBEiEqxU/ezg/T3oJOdxPA55+lMSMJNJISSzDOTzTZR5qBVJVVbJB7nOOf8P8hj6EhYuPcjOf8/54o5ceo/lTEYAM2OACACMZJ6UlqHSMBxjJ6Hjg/wAsUhD0Oc57Yz/Sl3BCODjBOTUcytJNG8ZIVRhiRjPp/UVMVymD3GCAOfemMGJ2/XGKbHIWYqeoGRjp9KWPcsQUqTjjk5H1pHhP2lrgYUYPA65x1peQCyHb8zHHOBnoT6U9Qx5HXGeabIoli2MVG45bPPHt+lKp8tcB8lSCc/hz/n1oAQOrJlR06g/rUTtiRc8gg8jsAeadMUitN/J3HAOM89/600hdoBbA7EjufX9aYDX3BgyEqQQCOx/+v/hUySFmCkDLA4OcjOP0/wDrVWJL4UgAk8kHnHb9CKniwMEYORyfXPv/AJ6UMXUmG4ADGSD09BRsLBguAOMHHPakUsjMWwSc9D196RiOWBJ9v/rdqkBVkOfmJ2nBwOMH/wDXiplC54JGcY7VAnySZK5APfjjHf8Az3FOKAHCk4z0PJHP60aDJHZcHOD3PGMVGSAMcHtzTRkEYxnvj8v6U0kbQcccmhIBxOKchB+UYz2P9KRQGzngjqKcqhXyeo7GmBXjlDAgHBzgE/4GmzRAoGDiOReQy8D8fT/69NlX5A8Rw55Kk8HH8jVM3roCk0Z2j2zjPT8Paj0EW45mDBXGG6qR0b6Gnr+9Y8kEnJGTmqyW65V4vujt1GMen09as7sDYQAB7fyosMaqlT8wJOcnHX6fWk8zapYD5j1PUH8KfIcj1HpxUGXkYKePY0wHtJwDtBHqD0pfPiVC7NjuMnk+vY57dxREyLuZsAqMHI68/iKal3ayT+TGm9gSylcKGyOVOASQc9PUUgHzG7JxbxrcRum4bFKhTk8g5HPt0plrI0u4TIY5AeeOCfXn1xzT7a9u7XMKP5cQ5VBztyckHIyKHlaVzIzbmPGTSARYA7lQyjOcNyP0ANTrbxQR4ebymz977273zn9OKrJ88v7xwFHUKcHP1xgVK88IAxGwI6ndk/j/AIgUmNFmG4+zRlQwlU9GHH5iia5lmC7T8oPAVeOc9AOB/OqyyxzLiQsu0kKGJP8AKmNMA/DDHQc7R9O9Cgtw5i2JCMB1zn+8uD+FOJXncdo7A9BVZbhgOQcfmPzFNMu8YB57HGPy9aqxNy2skZGA8Z7ABtp/WofK8ucShASpznIPYjGSDjrVVwVwSvPcMP5dKekvlIWPUc9cD9KLDvqSfamZcMAjHIxn3/DAqvPFJIeCNo5JAAH5k/ypwmhfO9HJJ4wMgfrx/KpYZY9zBcFiMgYwPT096S0Dco/YVAB3sT0+6T255xioHjKkYkOMcDgDj2Hf8K0nSYgsAq5PU/54prWzOVLiNyF45APpxyfzq1MnlMwCXcXWTkEHJbBz+NSi7vQuVLscAhlySD16irwi42lBj/Zxyfrj+dRlYklCgtuHOBgmjnuHKzMmu7meUF2kdycDqTn0xU1pbajK+6GJxjI+bjp14NaE19LEu1JipXkbgCAfTHP0qm/iC6k3JM+VYY4wP5U7t/ChWV9WWDFOUHm439CoYNjvzg8en4U+NxGB2yOBiso6gy7toADH7qjA/Mc9q0IXvbhhG9sCoGScnaO+c5IGAeh9al3S94pWexbN2I13A7j0IH+RVd7t8bmcIODhQc/mfpSlw+Bsye23p7dRzTWtg5Xecc8gjOB3OB1/+vSVgdyo0jSZKlmA4VTzjJ5Ofz60IZ/NCxt5ZOeFyP5da0XiCIFxuLDgAfl0+nWkjgwSzYjLdQMk/jn2/nVudkLluUksvObdMztk4JyB+pzVh5zYQmKyt0UvwxwWc57E9x9Ks+WroVZmII9ff17dKkyu9EQbOg4zgcYyfTpWblfcrltsUI9NmlUXF7IsCD5vLYkseOBtHY/0NQ3GqxxbUhg2hBsUE59Tn681buY3eYrvCLnYSRkkH+R47+poSGy0zM21ppezSqCF+g7n609OovJDorW5W1Wa4Co0hJRAew6k+n9aVmXf5JZQzEfMTg557Dn1qiZ9R1G4JtRI6khclRtGTjsMDk1rLZW+nPHPNc+bfIrFipyoYjAHoQBmk7rVjTT2GyhV69CcAAEY61GrYDZOBnAqpe3DhA8JV8ggDqfQkYqyimLT4mkYmVwS24YA6DtR01AGbeRz06A9Pr/n3prkKCD82RjmokuEluI4UO+R+ODx65JqaQbXIzkjvTFuiPY7EEyYAGMnkD2x3+lPM6AgqMDGGbPU9j+FM5kzycj07D/OKaq8rxkA5x2OKYDlypMj8kZ2jsAR1we+R1/xp0TSbwxPHPfnn/CmsxYg9TnjH+fakLbR8rD3/nigBLmR1KhCWyfmJAyAeuPy/nTLQOgkklk3K+VAyc/XHpkDFKGAyo60hYtwv4emPXP+etADyyqWRGO3BAAOTknJ5PGOB9M1EqtvWRW+Zc4Hb3BpXPkoZBhieD7epP4VLD5bwqc/MfcE/lS1QwKI6knCknvVdLYwTFo23RvkMpPXg8j0+tWzFjPJBqJo3yMNwOp5z3GD79aaE0VHthuZlTAJwSOBx/U06ONo4/LBO3OcE9M9/apU3xswYEgg5/Dge1NbcUEgyrgEFSAVxjg+x/zmr3J2GqSHIycjj8KkQMEBHTPHQ5+lVo5SjbXADevf+f8AnNWVIRjjueeg7cGhgiwhLkkLxjIA5+tP5QdcY9PwqCPbkSD5fQZ4PtkdKk8wAhSevGepqSkDOp6kg47D1powQCpyT14x/nrTnTYMMAAcfdOBUajfgJ8zjgjI9OP84oAeu5iNuWOOR1NRyNHvVXQqScEggEfgcZpPuNvwd68jtyOnQj0p2EkXerBlJwytzz70ySCeNl4jO4j24/8A1VEyrcgbgY3GQSclWPqPT+VXMMFwuMHgcZ7+o5705SRgOAGHGUAGe3QnmmnYLFKC0kiYkMCGGCBggj8anEbxZ4wPYVZaMMDhiCOvJBFO+fIwQwPYjNLmuCRWMgJZZF2jsxGR+PpSttClg2wH+JDwfyqZmZTzGCMf3sZ/DrVZpoQDvgK5/unj8sentTCwrkuhKzAk4HUgfiDx+NUZbi8hYIs7EHkDcGHH1zx7U+7jAjCpuOecMuOMewwetRCAyqpJICjHzHP/ANeqViWBjnmfzQWbqcqc4Hfp0qdVlQLlA69DgYPPuKsW0MUagqgLD+INkj34+lWsqACASepyev0zRzAoldYAxBCnnoGGD/n6GpI7eQEg4ABzlhn+XX8al81ASrAYPHNJvK8pNn/ZkX+owcVN7jtYTzYlGGRyQSOEyPqOaIyZiWjaSM+3BP0GabLeCFf3oUdhtckZ+hOagFxHNlEAUE/eJOBnr7D8TSGXN0yYEiGQHgllIP5gdfrRIbdI8tFNgDtGDj9RUKzG0QRD5sHgA7vx47VCbq5M3zW7OuOAoOfrjvQMlc2ErKVcqw74K4/z7VMUVCPKkOMZ3HLE+wzTI45XORZCP0LOCfxA6Uz/AE0HaDGwz/CwH9KVwJWiMwypZm6AggD3+tRzW9pFhZRKwA4wuRn6ilhEwk2M8RIHzEnn27c1K7zICI4g49Q9CDoV4F03eALWdyOpYcD8B/UVpnyDEVEQVCOQARx17c/1qgJ77OTbAj2JBz9akElzIB+7KH35oaBDpp7aKPzEjLrnB4OB74P8wO1UkltUnM7RSqm75PLUAcjng8A+uKddXN3GrKEIXGN+0MfyPH61Vj+03KACPeV6EYUj19unpTS0Bmha3BuGkkLlRkhQxGQM5Ge1Tr/pBBjICEAs3Un2BPWqEFqPMDvKV6fIBknrxnj+v4VfjBHyKAqg5OT/APXodgRMmyIYGCcdTxn69Kk3Ng9CPXpj8u1V2RifmfIHYAD+dRgFVIKZxzzk/rzUajLYO47lPGccHI/rTjCH+ZuR7n+tV0mYY/dtkdgOacskknWNlz/ePNGoE7kYwGwM9FPJ/GkO/YQNqt2LZOPwGP51EPlJKgkgdjj9f/1VEyyOu3ftToQuST+J/wAKSQyZWDsWMhfJOM4AH0wP/r0M65wq7vUnIH4VEAEACDBI5LdaaJACF5PPJA/rTESMzuQFTIHc9KcSFUBiM8HANRGUNwc4z0zj86XjGcAAe1MYoBYZHJPckU1twBww69R6f/qNJvYAnOAOn5UFHYbmJRe5P6D1oEHlBRtHABySTk//AFvrUhY4OPoO2PammRNqhcsQck9PX+tMGWHJwM9R9Rz/ADoAc5/fIpOQAeOvbnP0/rUiuI4wwyAucfkcVBkKRgZI64PX0/8A1f8A16XYTkMcY4APofajcBgASZskl35yT+f+FStkoqhiFDbm9Tz/AFApqqA5ZuXxtB/I/wD1v/10FiUwOQDk+xzjk/56UbhsPBHmgMcA9cfhmmu7M/GAmQMfzJ/z2pAuCpJJKjA9+gJP+e1DnGQOh7YpAPdtgY4GdvygjIPPJx144/SgSspGeWHBIP8AnpkVE7k7R1KnPv17+2M/lTxy4A4BGeeOo/yKBkskm2RUU4AGc/0/P+VMNwxYKx+XvjjsOnp/9amSMGG3kYGR69OKi+bBOe1CAmaR8lgcr0xyCM9D+dNd2eFkViCWJBB5xjIH50xGO3joBgn3/wD1UYCLgE4B6egxTELLKxiGxuVPXuPr9eKeGDEuR97sOgP+f5VWOdy84PU/lx/hU33WGDgE8jHt/wDXphcex3qFx93Bwehwe/5/zoGGXkEEeo69aQHdGMDBI69QPb+Q/Clj5fGcEc5/z+FIBR8pGBnaOCOox0p2ecjkH0+v+fzpQAyhs9cjn6f4805gqkAjGMZwf6/Qn8qQyJyScAkjv3FSLkrkE5HHPGP85pBs3ADGenXoe35059u7AIHOB6fT/P4UrgORx5hPdcnp+OPzxQxIONuQcH/P45pgYZyeO+AeRkD+Xp7mmGUA5zkg+hxg9aQEqocYYng9f/r04Mi/JnJPOP8AD9agLgr6AkHIzjj0phIdcK2HB6Hv/hVCLHnjHBBGOnQ0x5W2AlSFHGQc/TmoijNECqgkHpnB69j0z7VFEZEc7ScN2P8AKgBR+8jdgcjHA/8A1/55qORmc5cHjjnn+tTACHkDBzyORn/PFMO2ReCcA9/8/WhDFiKMoCkBvr/WkmLKwZgcgYyP/rUzYqKSDgehOP8A61RG4PAfOO3JNMRMLpTn5gR+X4fnSKrIxcAheucE8f4VEYTKplQBxnnPOPY1EqLBJuKhxjlCxXPt1A9v8aANGO5t/Lcs6uVO3Ksobn2PWluVtZJleNEU4PRFX/D8+tUHgg3h4raSJt27JcED229qn8xlHzLkHgkHP6VLXYaHMsnmBhnpg5wc/wCfxofzAApVWJHYnP4DBNNjvo4m+ZAM9CTg/XIGP61aW6EhWTZvT3wce9F2Mha38hg6scn+HbjP40ssinG8ggDJqTdE0hYnGRxnIFV2U5LBVfHtkUJ9wsWCwaIM8BwPut936Y6VVMlvn78i5/vRgj8xjj8KkM4IAe2RscEHI/lTfJtiflEkR9N24flVIl6jA8Sj/WoQem3P6ggU0upYAbG9skfrSvDH2GT6jio2PlDYHCg9mHH61ehBKr44ZWA9A2cfz/nSAfP8qF89AB9KhDndjZAfcVcgdVxjKsMY/ClLQpa7j8ZC+uMnGQKapK5woXPUjmnmbc2CWIPqM/54pC6bQBnAOCegrLc0FD7jgkk9e9KHGSBIqnGcE80wBgMngZ7/AOefwp6kqdyqTkHJPAPf0o0Ad1cAqDjPUZI96cmxWZzHHnb94jGPpSZUqC2OTxk02RUY4Axgc9vXNK3YBDiRT0cEYAJBHv8A596a0sMDF0tLcvnB+XnrnGAe9PmlxapGpwGHzbentmqTwxzugMrho+dwxn8OneqQmXLvVNpcC3hWRhgkjkgcAYzzWW2tThdrEFBxjGBx2IFWX0a3k2sL0x5+8HXcfwI4oTRtOQfvryR2wMYQ4+tNciE+Yp/2ydqpsxjnirVvK8yFwNoHXufx54q1bvpNi21Q78g4YYyeO/0x71JNc+ezBMLEfuqoxz9e/wCNJy7IaXdkUblS2X68DPQD/P8AnmniTjOcg9/U1AxjhiAyucn8PxNKuwkcnjsTwPw/x5pbj2LKtxg/Meo7YHTH+f6U4yKxCe/y455qoGLSNnt3z+VSRugw4yCeP/rUgHEsZWYnpx6n/P8AnimvEJlLPgrnIXv+I6elKH3Alhgkc8+/NIoLqS2FwcA9/aqFuCzPDbiISbYwM7VGAOpPA69e9V5rYTgBl2MR6kEjPXA6/wD1qsFVVACcA0iuJHJVsqB16D8/yoEOtFjs7IwJEruxJaRwCfTGPT/6/FVZLi5e58lQoXGNzfdUD6fTGKnL5GFOAOox0PpSoChLE44zk/X1zQA1ILfTbgS7fMlHPzHAH4DgUjSpcSMkbkSZyR1IJ/SkmXOQRhvy+lR2KfY/nGGkbkE8gdf8/lTtpcCxbIsCSI2TJKOWPB79unfFU7uV0O2FTuY8Ec/5/wDrVPI3mHeS2R370kICqTJ1P+f6U13EOhV1sVMjK0rddo6DsD27HpUbHcuF67gD24yAfrUNxNLGrOmRkZ45H+c0+3BmjaX7gHTPrQBJIFzlD8vbj+dRq/75dwITvj+ookmCr0GBx6dKfHHvUyRnAPTPSgBDgJ85yMd/61VgKNO6IcsBlRkHJ4J9xx/npU7ElCCmR6de/NMjhi83zFQBgc/Q/wCQaYFkTkQkuOMZwKjguVljdEy7xfePqM8H8zj6YpJpS/ysSfr270hXy4vMQISR6Y+tLSwXEnf5eSQB15x0/wD105J/NiaTIZehHQj8OmD1/P0qvc+W7/JCwHYZx79aeESSPJBBHY89utUIRpgXYRbSxGMHB/yaaJ3hlIkGGVduPX1x6YzkZzULRtH86nkf41aZzcW8TPgPjDHpT2EMtbpGnEbqYwx4b730B6Z9/wCVTyJsOGGJBkD69MHH49areWYiHCgsOM5q4kheQkjr/h1pOw1roSwzpNCVkUpMvJBzyO5qCS3LlXjYq68g9DSSpgbtoIxyT7/yqRWCxjgrgDqM+3X/AApD8iR38wbmUZIwx6DIHegRjBIzyOn5f/roxkk9m6HsaAJAVGcjoMDj/P8AnvSAcr7AMKWHsRn8qkVkfqvUdO+Ppk1BudVO09ex5/rQZgzrnIPTGcfXj/GgCyFhByQD/tYGRjsccioZLdmQtC29SOgxn8PzpIzBIzKJNrjnBxx+NQzlLdy/nEMRglDz/h60gZWfUbu1ZlJDAdnHH+TUwuZbi1LGzCt08xeevX6fn2qVJILq3/eRsD0bPc9qZFai2JeNyoJ7Gr0FqNiZzDiQ7xnGW4+lSptHK7oz6cken4frUwYtjcFcjv0P6U4RoxHTp0PH60rhYh2xkjjawPBHHt25pjKIxnB2sc/d6e/+fwqVlZX/AHZB7YPU/wBaX7TCvExMD+hBI/P/ABouFiCJRI2FZXx0w/PT0ODVh4ZFAITbn1UEfiOlR+ZaSSbgEY9c5ANMP+sJSeRVP8LHK/40XGTsYdqiXY+3kYRR7AY9KZDdxyO4RSCRgjaBkemRx3qJIYlH+saQnn5ic1OjopPGPwx7YpAWI9qAiOHYR3CgD06jpTTJMrYUIynnDKSfzB5qGSRyOCwx3HFU5GvMgLPIR6H/ADzQlcL2L7EvhnjZAR/AxAOfaoTCYgDDuUAcAjI/wHtzTYp7kAeaysfQilmeLJI2gnqSCP8AIpWsFxyPdFAJJoSOhXGfwBHSrCSSbMDylI6/Ln9DVJAAGdTGBnk9RQZZ5BsSfYnoFxTSC5YZLwsStxGVPbYB/LkfnUyeYUzJtJ9mIH65rPRL1JAROWGMfNgj9atK020rM6SD1wFI+opsSEuE3j5U3ZGPmbgH6YqtFbETgPCu0cqVYge/rVwzFUIjjUt71A1xdMT/AKNEPcnP9aEA8RY8xpPJRQpPCcdKhj1KDcI9oc93U7R+R6U93aSLbK6IG6gA1XSJLZTKJImLHDgqBgfQdMYpD1NBZYm6Oy4PTcD/AC6U5UJAIkzn3IqrFe28zYGBkfe4HPuKeLiMnAc88d/8j/69FmBZKSZBUBsdckf41GouyeEiXHv/AEzxTVZSQVGfc9KHDk9dufQkficUACm8MmGmhb2HOPb9P508SytKEXygcDJDA4Pf39v88wLsUHaSc/X+vNMM9vCFyAp7fy/CgC35bN1Yn36n/OaVtifLz64A5/E1TbVrdEGzL+g+7VcX08zEQxbR7ZP/ANenZiuaZbAGdqDqST/nNNMu5tsSFgMZY5GevQdfxpFiKIpkBeQ9TjA69P8AP1pSHI+bk9cdqkoUPyQQSSOOff17c/yodDI+ZWwuchRwOBjPv/8AXo285ZgoH41GZWkbKDgd26fWgCcbVUc9OM/jk/09Ka2Rls7VHvj/AD6VGz7cEncOo/D9KC7Y3PhfqMn8qaETZCkbck44/P8AwpiuGJCnr1x39qiDhyx2/L79KerhDn05x/8AqoAk2kNnOQT36+/tx/SgtkEZwM/Tt+lRtJlTgkE8HvnnH9etAKJkDJPck5/rQA4ZxnGMdefehzhDzgnoB2oDcHk5PHT8P5VE5AyB0Jz6/wCeKQDovlwzcE8AdPqalO1VODnHHr9R9O4qvvDIpJz35/Ifr/Wljdo2OeQTkc/T/P4CmBIc9xj2P+Hr/n0pj5KZ6EDHP6U4yAvn19R/ntUTH92WHTsPz/8ArUhj4lOwkjgnI7cd/wDGh8FQBw3Un+lIk37tgeg/Hv1/yaHy7AqRgjjFMQgU56EEHj/H8xUyopDZbB647dD+X+elQK5BxjBXr/8AX/z3prEtIy55Y8N/j+VDAtYOFKsWZjkn/P4fl+FRlyCcjB29vXJ5/wA+vvUYlZe+ecjP0x+H+NOZwHYEbs9STz/nmgCRJQzDcAd3I2nODj0/T8PanAv5YwxJGQevHJ9/w/D0xVbkyADvwDn/AD/nNHmskuQTtxg8/nSHsTDJUqrAAHPpjuf8O9R+cyt84OOnfn1FIjkqSBkDnGKSRwCWBB3feB79s/8A6qBEgm81Mhsv6g4/Mf8A1+1CsC5UjOecDj8qrXsDwQrcxAmNjgnOdh680+1uFdcsPmHQ5xTtdXQXtoTOwdN4OSe4459PrSMvnQggOsg4YAg5PHOMfy/pStLGQy4AJHXOP8//AF6RZtkeJFcYHy9/x9/84xSAkGYomL5GB3HTtVVrhlkwchTnnGceh6U5pWeEkNlgecH9PpTox5nUD29M0wIS+8NjO5fU5FKJyo5x+NJuUP8AIuOe4zmmCQByGGN3SgB0s4AIKnPqKgLITyDzxilucQgNkFfUc/pVd7uCQsrPIgHQbQapK4mC3AtpC8EssbHtgEHnvzVqHU2llZnWPa3Vl/dt/Pnip0itbqzLJFIc4ByoGPxqrLYKinayZP8ACv1pXi9ws0Wg24FlbIPQmgSGN854798/0qrHEVRWJ2/Q1MHwBjkEYO7vSsNMkW0eVt0KsATyAPlNL5UatiVDGx9D/Oo1keMEKvXrTGuz/Er/AI0rMNCzHcBFKFhIo6ZNPVsDcikn/YGMVRNxB1cSJ/2zzUsby7fNWNxAP43XGfwp2C5bMq8Algx5+b/Gk5OMkEUm8MoIKe3YUm4Z4H4DmiwCOFAJDYzTY5Zk4ST8KeR3BHBz1xSGRgwDor54ww5/OgEBnc8NBEffYP6YqMyMrk+UEz1xTzNGp+5tI/uk0yRlcYwW9mOaYDvPTuvA55GfamvIrAc5xxxUGdv/ACyIqSNixwqL/OlYLj15+8pwOeR+mKlyybT+h61Fh2wGPy+metTB9qqmDtHfOKze5QRiVyMLGCCMkkmnySEHC4J9qjWb720bF68nJpSfl3kLk8jFUg2Y0KxwS24jt1Hr3pxm8vaGPPr933FNI3g5DAE96cvlFVYqCU4BPX8qLXEQTzMFIAIb6Vnie8dzFGsjOOMAHjNaTKWOF2KwI57+9LHLLDL8szDdwWPFXexNmzMubTUPL86aB9oHXj/Iqa00fWJSnlwvGrc7mOB6c5/PpWm2oXZwGkJAPAwD0ptxqt8AG812A6joaXNJqwcqEu/Dl0fLj+0iSRyeT90Ac/r7UsNjbWVqI5R5tyOpViRUUF/PdMGy5PT5z0/yKfIpePDyhS3J2VHvbMvTceXjG0bAoJ6VH5oJUIox7UqLBGo2q0ko43OakzyMbSB07f0+lADWAVevzHrTvMUDC5A9ajJXbwM/T86jRSwbPyqv5CiwyQlNhO7rx6UJtSHylGAv5ntTGK7gSpYLyAeQfwpXlBJd+CfWhiHbRtyTwO9TKfNtlJBKuc88Y/Cq3yGIF23Z9KcZCyY3549aYMe5VnIDY469gKAyuuIVwn3QccVFuDnB69TToGWJWCDOeMDofemIdIvOV+XHXv8A56U1o1yVVi7+i800t8+d2SCc1CPMW7Dkbo2OCBwfU0xEsqYHAyCPrTFULGDnbjIx1/zn/GpZyC7BDwScEjmqVwJCB5fY/dIzmhAWCm5TgZUevPt/WlQ/JtU7VUd6kjkVrVWwVx8rIexpmOSM9RSAYwO09M9P8/hTlXBCY5PU0yNmR/3gJDcgjn86sHAYkHJBpjRXI3EDpg9MflUgj2oVI246mmyq/DRkZXkjpU28OmMY56etAio8WMgHIapI490W4dD15z6illAIwTyO9Ni3REhXJU9QafQQyRNo+vUfp/SnR7dqcEY4Bznmh+Wz2Y/U0zcBhWFMWxK65DKadF8gGDux+NRNKQ2RhlPcdBSCXcqgfK+ehOP89KQ/MtAArt6Ejp19e1KsWBuKglRniq0kiBd+dynswwRT0lWaMBCDt7Z/OlsPcn3gADIwexpP3qDOd4HIz+dVirxjaVK8EkUy21IIxiliJ9COf0peg7loziOHzW+UenWjzrO5gJ3Hng7ev5Us6blG1WAI5yMH1qkkKxEEx7s9dxpoWwSqiOzRoWKdGP51OXjmChkMLLzkDp/jTk8iRsHKOeMHnNKpXlQuRnBBpisKI9mSGyrdDQHKfdcFe4NLCVUcAoDxz0pWgAG4Eg+g5pDG+cFf+LB6YqRZUYHD7WPX+n8qjVGK4ByPTHNNDlch4w47lev5UxA1xIrYmhJA/jjOf0ppmhZci4Xg8q4x+lKZ7UoMybG6entUU1tFKS3m5J5z1zQrAJKkMgVsqWHXbxT43kCYbG31fr9M00W5QcShhjjPy09Yst1Un86YDwVLZWQH/ZNTbSVzswOx61W8uTaAu3+lRFLtJA0UhU9sH/PrSsLYubcKQFAx360uDIP3sZI6fL1qsReYJaUMR2xmkQXBIDzbB7LQMfJDCc7pHj9DgkfzpgsYeSZ8Lnjr/WpY7FXbLzFuxp5sExtjnUOPoPelzBYg+wBTkSCTv1NSr9p3YVgij8TUP2e8gbox985pvnXpBATJz3x/WmBZbeuDLNuJOBxSq+OHcMAPTmqYN3jlF59eakheRRh0THcCiwFpZExnaSfrUJnbdhYCM9t2f1xUwlG7G3GPakkughBELtjuCBQBAss7Fj5ChSO5JqN7Oa5D+a7EAYG3j9KfJqm0cWrD6v8A0xVWaWW7t9xXaA3JDBQPSh3GFysdhcGJNocr1Bz+dTRI8THbOJjtwBGM+1R29kJQJHClSQS7HP1q5JO0c2xtsKjpGDg0r20C3URry6CYFlI3HB64I+lSoblkG4eT2IJ5Hp16VTF98/l4yueOScVfjb90WJAXO6gBDFuIUyDHcZ/woWxgPzMAePTH41JkZDBjjH4VE0TSSh3lZscBTgUgJlgso1/1asRyd3+eKUXConHlhR/dUAVX8s5PyjkdOtNKc87Tj8KWo9CRrqSZlcS4jHRRjFTKzEcEFj/+qquNhG50Xv6e9ND54L7VPQDg0wLMjopTfKuX6Ac0MSSQCADj2/z/APqqqwC4LZ9OvWljmVn2jJ4yeKYiwG25VCWbOSRTHR3XbwGbqetMuZmEYSILHuPPcmmLM7gAAqcYJ65oC5MOAFHAH/6qi3s7FE4Gefc/WrbICiuWCoB94/SqUVykkrIqnYOKEBK8ixoFQZfoTjp2p7HylG4lnPbPfvRlcnjGTx3pjKfvOOVPGaAI2kZpQo6Dr7/56U9Vd2JI+6cZ6U5Su5sjJ7gc/Wh3VYSQQE9SaAFGCzc8Kec8fpTZZAirj5iB17U0nEYTPXkUigbc9TnjNACzMRGFJ+Zv09aWMkqwPIPagqJJE2nds/HNEQCuUzuPp1oAeRtBPA9BTInLSLg846fpRISFORnFPSLZExzzjhRwaQxYACxVvvY7/WmSZJI3YJ5Hb8KdF1DYwW980rR7irEg8/WgCONgZMN97OT/ADptwDuXHY9On1/wp4VVdmfoecA/1/GkHkljsctjr0OKEIRzjAP3WHTp/KkDGZAuenc8cVNHEssgQsBuPBP8/wBKqTyvFLs8vGRketNAXNu6FSGKleOD174qNysaklRgDkmoGkaJQ2Mg/wB39aS5maRQrAjIzwPf/GgCxHqClTFnO/06f4VUcAKwh+UnsR0/z/SmLCX5IIz6CnksQWyCQOtPbYNxIlKsTjnrjP8An/P0qypLH5srnjj0piPlSSuCBzgZpyyKxI7dQOlAloTJGF5HP+0OtOdgF2lQ3r2qMDngsCR2pSWVs4BXqe1IZEEy5B+YHkcVDOyJlir4XnJTIzTUdwSTMjkKDjdx17VNPdYt1ikDOjHP3AKLgOjngvLfZcSCBgOGzwfr6VX+zwOoyElIb+E9vrTmZzEdk3I4+ZjmocADlV554NCB2JxH824ZXjGCc0vzAkk9faoQfTK/XvTlkZckAH6U7CuSBgcDaAe1OA/dg54HoKj8wk44+lTbvlwGAJ6jNA0RGZc8gEdc0ZjcjJ2fU0xwdxyTnPds1F5aMhBbH0NAi39kkBHG8Hpt/wAajG+NysbMrDjJYDFVVk+z8R3UoA52rzTxqFzKwxcMSOP9WB/KizC6JJAyNly2f7wOaEuXIGCpBpCX6naT/s0ZDZJP51VxWJvtDjhkOPejz1HQlfx/xqLy4sYEskZ9juFOWHpi5jP+8uKWgakgmGScgn35pDdDeVAG724pRDx1jOPQ0/yF2YClvbNK6HqNEwxjaD9TS+dg8DFOXy1HzfKRRuiUfKF69yaTGKrsw5B5/Cl+Y8gAevNItwoYgFcdgKRpgVG52PfjNQUPAIHzYPTpSMHK4jwCe+aYJbbGOTzk4Wl8+NfugkijUCVIZIgQwLP3JOaYwPHzHPXNMNxlgwXGPQ04XALZIYY96eohShX+JsHvmmSEqo2t/XFDtHIRukfA/hzio2it3AXy2O48fvKYegkjou0i4VyB0FJFdIx5ZQ3Tr1qWIWkWMRKOc/32p730MUmUhRCOAxFO/kIjWfdJsjjdiD0C9qeVmL4Ee364FRtqJwQGwOuBxmq8l8eQAOO45ppMV7Fz7pOWUA8ZA7UHYWzvPOM+/wCFUoZ7m5fEcDSA8ZAOKuvaTqoz5Qz239P0pPQa1JUG1MADGcjigSbUwzKq9z0qusa7HWS4JGeqL3oRbZWH7p5veRs/pS0AR2lkH7gbtx+8elOgsgG3SMGOPT9Kma5ztU7VBPAUVG8xQDJIyMUbjGzYSUFSCV/SjcnkYU5wOFBqutsbg/xfM2OeKmSzaBVAm5V+d3QD6UWSC7YsCsA7tj6U6Py9pUElnOanLIzYCqAKoM+1uQFbse1JJsbsWJDhP7uTTmOINxOMg49qhQyOA8iMR/Ce1SOqyRFQ2G4560AKzjAAIBHFRmUCTBOAKiMwhGS3mfSkyJXVyCFHQVRJPGxZiuPlHOKcW565x1oclhHImCfr1phIQF5PlUDpUpjFVw5bn5hSmYIBv4BqqkvmkyqQFBx+NWJQSFkXa3Y1QiSUlD05zgg03dv2sMgj7y/5+tRuT8xPA9zUKTrNdZi654HrQBcYnyue5POMZqDO0thvlPUHmo5GaSF/KfaR1OKY06xuC7oyr1QA8n60bhsOjfzIXiDjkjaSvSl+0A7UlxnPEg7elVYJBK5KxgsTnaDTrguXdXiYuOBt60dQ6E80wXHz/vCcEDmpRyD5o4bqxWqM0ErLljuXGclcU+wvRYh45I2kVugH9Kpx0uhKXQnmBDZD7lI4xUFpO63PljBQnOCQK0JrMLcblkyhUHhcVDJZwnPY9c4pKwPQtzxOkrvgeUVwA3Y+uRVB7I7twIX3B71JbTtbXAhnffC/HPNXJdocrxzxS2HuV4rl0XybnlRwGPOKssgKLkYA7mod/wAmAA5HUHjNMWYKNkhCI3T/AGaARMEDDBIyOcdaQjncrKG6EHvTz6E4I5Rgcg0x9roUJPPfuKLgLu5xIhJHGRTSshAMcwSQduuaiNxLbDbMnnxj7rA8ipFubWflZdp9JOMUxA9y0ZAngK5PLoeKd5sLj5Z1dTwQ9DlkQ7mzxnjmmgxSxHEa8dPSkPUZJFGfvrGw9VNEZWI7UDbfTP8AjTTFGCMfuz+lKSDy3PvmmBPjcODjNJ0JOwAnvUPyg4Bx9TT1EeMqADSAViSPlIx3GM5pVlYDaxOfc0qgepzTJHKD5hgHoTQBKWVwBnp0NRsSODz9aj3fKCrjP504THOxwOnfjNIA5B3qvT3qRZ3bkr09cGozujfgKB9aVXTdlgRjv1FAD/tcqnHlIw9zTmuQV+aPHsDSB4WGPMUEepxSFNh4KbffmnoBA88Oc+XLn/epgbzCQiSY9c5/wqwSo6tEv1pN4JwJY+P9qmBGIjj5jg+9TJCowSy5qMmQn5RkY7EUg85jyMe1ICR1jwQCT71Wm+xFDH5LGXpnGKeUlJ5jGAPvdRTpIfLXcyD8BSGQtLdRsscEKOqDjd1H0INQwxt5m+eDkk7ypOT+dTTTmONVKqAf9sdfoKV7uO2wcSs7epyBQBOsNnaJukt1DAE7Wbdj/GootRMcuZeAOQnoKqXF1PqT/KhGcAAnp+FQvpl1tLs2EBwTn/CqS7ifkab6pbooy3P91ajOsq/7uNhk9zVVNKgW3M012u1cZCDcTTUgs3ThkABxu5z/ADp2iLU01kmZFJI5FPXBwNxcn+7VaG3aMEq7ujc7GTdt9KtRxqoZMge3TNRexQhRxJuCcD14pphmJJLqu7qRkkmnFiG6Fs/rTHkcsQI2A7ZNADzBFG29suwGPmbHFJuXaSm3b6LzmmeUwO/y9zHgCmOshYZV9gxxnFFgHhtwJ559KQyBAf3eSD3pTG4Rk8wID6dqaYo/LxksTzx1JpiI5bi4nfy1bEfTg0RQ+Uw8vO4nGO1LEyozFfvYPQ5I+lPSN1AAYLkU7hYsGVFYgPgLycDJ+lVbm4kuJRGikoT0pyxRpw2Wwe9NeYpuSMBPcUkDLKEJEQ4HT0prXEe8uVBwM1BteSMgkruJ3Z70x/JijA+9t5AoAsXkmALgMuTjI9KrW03nzhBwp6nFRSFrlizHGQAPer9kv2ZFdtuevNVshbskS4S3cqRhiMjPFZxeU32VO0sfzpL5xLcBtzMB8oHWgAtcAjgdjnNEdNRNmnb4uc5O3HXPr2FAcpIykNv61Dbk7nJ45/OpJZG2EowD9CTWb3NFsRzhrdyylXRueOCPemPdnIBOOnPr60mTJb4YfKtRMuTycVSJZdeZp4lRAPLzyT1qjfQmK7YJGFDDA2ZFWUBZQPugdcd6LgAlSW2lenehaMHqELt9nVSNrRnnnOfelcAKvHy5+lIoIUYX73NPRSqAOxIXpSY+hEmWA2nnPpmnbQFHFIeZRtG0L3pXIAyOf1oEDuf4cDHpTQMJ67u9G35eD09aVlwOnSgdhuCpBH404bcKR1P400sAfvDJ60Bvm4AP15qhWHiQ5VOoFOWTf0Bx/Oq0zGMg4IHfimtNGqf60Rv/AHGBo3EJFBCxzGQwHX60jIgVRjkeopImCDaQKVBvUj5cjsDQBJjjbgYpM7lIBx+HSkZNpBJ59KcgVicnGaAF24Ubhz396bweFpwQ7umfxp7EKpCrj1oCw3YUPzZxQQQCCuR7UbuoyePXrTRJJECTkj2bGKBkbICeeaXajJkKxx6DNTIUuF27Tzx0qvd20sS7Q+xT1HrTTE0EduzuDJCxiP8AF6e9TNBEi4RkJ/2WzVGKA8Yc/lVoLtHIBpsSHjcBjcaQlmHVT/vcUzgDqV/Gm9DgOrH2pDJfKfAzAxHqpphYKOdw+opFmaM/cb8DUi30gOcPRqIRZh2yfwp4l9AfyoN6X6kj/gIo84P/AAKT+VAxivIWyVKj1zVhVBAyeaiDbTxx9KPM7Z5NJsaRPtwcnOKCqN1I49agBJPINOJJ7ZFSPceSgG4/Nio3QzZ8phD6Bu9IO/zYP8qOMNkkn1NMAa2kK4+1ISPwpwiZUwbqLPbg0w5C43KeKaBg80CJ9qqOXVvXGaYzjBAwze3AFNVu3NSZB7GgCNVYtuL7Pomf5mmParK+952JPU7QKn4zwp+maUAA5PSi4CW9hZfK80jHb/ADy31qx51vEpFvbIgI6sM5qqd5HyFVzwex/SnbfMAzMgY9gOvvSd+o15D5r93jxuIUcdcfkKry30S7lPOTn5eKDp8LNxP9S1SxWllbtkhpj1wRxT0QtSul085KW8DSH/ZFW1iuwMSLHCevzHJP4UouwigIDECMsF4zUJuAzNngD3ouFiUwoDh5Wb6cZoXYgzHChb+83JqnJfxxhtoyafaNc6g7CFAgQfexkfSiz6hdFxpXdFG48DgdMUwuFyW4wO9OSFYmw8zSMDkBegNIdm8bVB7/AFqSg2u4JQDBHDHpTRbgOHmcyAfeXFK7EhsN06e9I86qu5mC5HNPURJMTIcnqB8tQlvlDA4B65pI2ad9qo7AnaMDgD604xHyhuI+g7U9gKgE92dqkDBwM/xVpFUSCNFOXA+dvU1AsgiG1ML/AFpu9tuQSc/x9KHqJEjIryHpx1yaq3aqEO2QnHbPapHGEw7ZOeKja1SV8tGF7ELTQmS2AjktSpw+OuecdhTGtxt4yPTnrU6gQxeVHwoGOPXrUZJMWc9RzSQzPlRlyCM1LYECVdwypbn2pbgKV+Yjf29TU8ED2kYR1+dsdf4RVt6Epakt1DEC0aH5M546VQmtfL5FXJJNr8HnGKjIOCT060ouw2rmfETFco3oc10Vywd0f++ufwrHKxS3SRDG5mABBq6d6zFXHTjiiQRHS7CuGG6qE0Pz74h93kVaZSM9+OahnkKxZC8twaEwZeM4mt4JMAH7uM8U2QfN97ae1V9PlQw+VIRGrfdYno3r9KsOGXKMuD/Op2KQ1yDbn5c47Zp9tL9qt0X/AJa9PTd/9eoWbDY6g98VTlhZcvCxHt0p7iNNcMM4IbvTJ4xJEFPTr9KitL4zKUuE3kDqD82P61a2xsmFfg8DtU7D3KcTXFn94eZFnOO1Wop4rgArlHHYjNRbiP3eSGBwKb5SNIPmCkj5hjnNNiRcdfL4/hHXnNVHVPmaMDaewFPWWRZCkjZ92HUU1kBfgg++aSY7CiUPHgKysvQ7aYDITlDsPfaeDS7GUcNgjpzQEbAEj5B6jFO4ATvYk8nrSq67jhMH060OGQbgSVA/Kq3mHdyVf8eaALxCtGGKr+NRqfl3IOPpQHDALjA29qY8Xk8gdf4qAH+Y4+ZORT1kDI20c90PeqgZPN5DxMO6jFSs3GRJkeopWAkMcUikj903X1pmJYz8snmD/dxSBi5Hznd785pTkdc5oARWIY5Qjv0qTZ5gBAYVHvfHDYx68Um98+nuBimIf5Ww5IOe2RT1znjtUYkbvKw/ChmGBlzz+NAEmw5JIIoPH9786QMNuVk/I0eac/fP4GgBwPJILZpcuOMt+dRhpASfMJBpfNcepx3pDQ4CSRT94j/PrTHgDqQyA/lSea7HtR5j9v6UWAckAGBsBHvilESkkiLgfKKYZZCeOP8AgNRsbhzzJJ+GBRqA/wAqFXEhjwoPP1qndXEstzLvlTyDwqqv/wBepvJz95jjsCxpwhQPkANxjknij1AoJawpayOZC0gIwg7g1YtYoZZ03LJwMkAr/I1cWPzWw4A/3c1D5KxTq7HyyvTYetDkFiaaZZD9qE9xHHt/1Xr26VUkvIA0pgOcNuVnyP0p0oMgOyWXb0+9UI0+QruRODTj5gx8eqBn+ZGHHrVuK7jkJwSuPfmqxsljUDKlu+O1PijdIpA2QH9MZ/M0NoSTLTRk5IJyf5U1opMbhuz0A96rXV5ICjJ5o2KFGW60waggjCO8uGHLrkkGkMm8iSVzvYjuVJqVbWMupkJYgdAcCsj7eEk/dvKfZ/8AHvSvqUxXrjH4VfKybmyZEQbYolQN1IGM1GZcnBXJ6nFUo9Ri5JE7nbxjA5qxHcSOvzQtgjpkYNTaw9yQBm+8QgPvSfKMsoPH40Bn24KcHj/6xodBEc7EjVhwW7GgYrO2Djv61CxDEnktio9+T/rSenapidqBtgwOM07EkkcXy7mIC06VztyDtGKa7MNoB47Ed6btDhlA5AzQPYiMYb5jyR0p4yV+Y45JyKYX2Pscg4/Snn7m4dR69/amSTwHf/wHnOaUZfHBGD+NQRTBHUkfL6nvUjuJI8ZyN2ePWpsVccJFJ7fL1AoaEtGHHIzyPQdqYADIxK5VQcd6NzBM4IcnHPekMlCGNiFYBT681GEWRjyxB6dqep2qCec9KQOqkg/wjkL2oAljIjUeg49qgEglmITOPr0pJUmlUKp5z0XrU0YFlGsbJxL8vTB/CgCOWbyiY2OJG7DmnIpY8fn0xTrSyzIQQxYcjd/jVW8u57VhtgdY1/iK/wCHFG+iDYseWeRg7j0FMed4QRIcgdfkqPT71J5XSSFpC/I8ttpWpY4baa+eGWec8YCSgrj/ABo23D0IYryFpB5hOAfTinSiMSfuJMoR1z0qgtsJJJF3iML0y2c1f00z6fc4c+YjD5tjGqdlsSr9SpLcs0hxll4zsOcfpTZpxOikyEsOCrKBircsNs9xJMImkjPUbvmH61DiNJfMRQgPGCM4ppoLMlMPyhWIye54pTCIQGZ1XPfIqA20jrvVuKjltQqbjISfcYxS+Yy8sDyYaI7lx2Ip3ksFLKV+m7mqEUM8ecTbf+A5q0t1OyBWKEqPvYxn9KTuBJuaPuQR3xSEhs5OV9cZpgkLryM/SmAFE5XPPXmmIlIYE5QEDHOM08JHnrgj2qESN3XI7YpguJWl/dqFYfnRYZJuX7QwWOVuOqjmmxXV1Eyo29UPKh161KlzLGPlGD685pzt5x3P5e71C4pXCwyR95yyJn2+Wo889DUnl+mKUIP4mC++KAGq/wA3OKcPKccpG31FJ5ZDcAN9DTHAPVWBoAk8qDoFeP8A3Wo+z7h+7uCP95ajBwOM/kaVZju/pTAY1tdgkoEkH++opUguVAaSLZ2GTjNSGfjG3H41DJsdxu+UD0xRcRYO4dVOfrSHIX7pI/2ajV89HFPErAfeB/SpHcUMhODlf50Lyfl5/GnB/MHI6+1LhQmAce5NAxvfpiomJB6ipBHx80gOfY8UmzHRwc/hTFqR7x/GTx6UmRngED3NPK8YP5ZpcBc4U/nQMjaRkAxjnpQsx7kAU8gdeG+vNRmUAYwoH0piJfNQ8FvrQCMfeqDz9o+VR+VBkkbqMCgRNngbQCfalJKqe2fQ1Fv4AXPuVpd2ecNgHHJoAlEjYUbvu04yAFQCWPfPeoMqw/r605T2GR689KRV2EiSSlgrY9hTPsMRO53Y57CpDIVBycn6UmeeueOuBRdisi3AlpbNvCAnbgjrk0r3rSIyr8seeQvANU9/WjeSOppWHckafKHI2Lnn3pguECbnkXd0xSbA4+fkc8GkEECjcI1z9aFYWoklw/8AyyTB6ZPWrMdoI4BLdnL4yF6n2p0NwsSgrGMjjd3qJ5GkkMrke3tRdhYm845C5wBjGKiZt5OT0H0waiYvhjuyc5qGWRo4sgge2OtNIGydpFhjy5GahR7ifAjUBSfvGokhZpN05z3xmtOPy9qKgyityfw7027AlcV0jt0V8l3xjnr9agMuXBXl/vE4/SnzSCaRgeD1xmoi6sdxO0nt6UkAhkAyxb2qvNOAoQZyfepJHGeRwe+MjNV44g83zfdH45NWiWXNNtlYickOw52+lSzSuZySc56E0W0qwEbV+bf9QKWZQQ0qnAI+7np9azb1K6FYM2CCRxzn/GmTqGGScGnkbW2bMHkn3qKQsyYUbgatCZFbIGuB1+U5zW1PEG2yAjB6juKwlibdvAI7cVbgvp94VmB9d3FKXdBEsb96kjGOmR0qJ41YEtjFStLDI+2QEN6hqrSPPE5CbJE68sAaSGyORDCTt6GtGC6zGqzMMEYyeR+FUi3mploRj0Pb8ajMZVCUkx6Bl/wpvUS0NGV4thO5cDn0xUSMCNzKdh6NjpVdY5GjyZQCevbNORJUfmVv93FSVctLCrfOEy4pWjaOTcCy+qnpUG7HdlfP3h3qQTS7vlbOetGoDJTNEQ6kNk45pyTSbwHixn3pucZ+bb3NMLHf97kU7CuWXAY4JO3GMH/9VNQKnODgf7RqMvuH0/lTMhZOmBjt60rDJ2IUcdKaG3jrz9aTcV/3aa65G5QQe1MGWFmZMl9p96juI4pwD9xhzuHINQrKQuHXn3pyyqBjfj8KBDiHHDliR0YCjzDz+8LZ/Sl3jGQ2abNDiPzFOPWgBjc9JenUfMKNrqfvqc+/WkEjjg4P1FPLqeqr+DYpgR5mQ5UYx23Zp63LqeVHuOtS+VkAoWxns2cU0xDPzA/j/wDqouFhyXFu3zMu1vania3xlVI+vNRLFGPuoppQgXsBQLUkMsZBwwz7rQGzwCPzqMNtHBqMTXAzt28nowzS1HclaNGOdpz7Gk2KDyp/E1H9snC82yN9Dij7bz80Mi/TmizC6JSOMc03KnjbnFAnbOREDnu1LvmLZzjPp2piEY54+6D3oV1Azkt9B/jR5Zb/AOvzQysv0/KkMPN2g4Ufic/yppuHP/LMikye4wPUmgMpHJYf8CA/rTsA4SdMqTTxIAPljBpnmQpyz49s5pHu4EAALFvUnFKwE/nTFCu3b70zywz5c7iPWoPtKP8Ax8e+aUOhwM4HelZjuifyowcb1AHO3NSSln5ZsgVUVYkXjjJ7GlaWNn2oWZvalYLkhkXJw3IqKWdlGAQT6Zpi22+QuSxHpnvU6RMpyFA9vWndC1ILcS3DNsjY+47fjT2s2YFV2qe9WHLhcHDZ6KDUZeTGDGAM8YoGZlzYtA3B3MefpUAj2D94CFPetVrgRk5BDVXlmWUYA5960TZDGRxRySFItzDr2q3Daw7vnmGVHzbWHBqrHpzSx8jZg4GB1q7CWtVVVlOO3Q4qZPsUl3JhtSIursD3bJqltSeQYZyDx0JB/GpnCO/myMzN23c8/SpUuUS0Ea578+hqU2h2uQrp3lZeQqF6c+9LLFHDGUeXYOqoe9VllcsN0o3jkP3pyzM0wklO845GMZ/Knr1FoaP2U+QrkMxIyFzUZRmLr90Djkct9DUrFliV8Ebhxu7A0l4FKJ5n7wjopG4VFyrFOf8AdIXAaT+Hd/WoBfxqwLQsxHT5qS9u1y6KpwcfdbAP4VSwzLxnPp1zW0dtTN76Fy5voplV1Uo6jBAHH86rC4ZSGVyMdMdqjdGX7waNvcVGS46nNWkiWWFvJYhhHxT49QmA+ZqpbifWnxKrfM3PtTshXNNdRaQjauce9ON9liNu32z0qlEUQfKCKvIkUsSh4MP0znn69azdkWrsvWV2kYZpMMNvzL61WeT7RcNJ5xTjAjKmqn2E7iVYlfX3p0cRjkyCGxyM1Fl0KuzVW5eKBduzeOTtbGf0qO5uzPblHTazHBzzx9RVbOVwVKueef4qkLKCMHPHb1qbFXEt7eG3+aNir/wkdqkMsofIkYtnuaYx2NgnDdcGmM5dSRn39qBDnnG/5y/UZwetNGxlfBJDc4OOKi3I6/p+NCRjfhTn096oVyVYfK3bCRTODuy21j04yDUhjnUDdC2M8sMYpjRowJ+cMDzuXGP1oAbHeSMdu3G35sdM1IZlfLtn3HpSpHcRIBGAykdCMH8+9JLE7ctasmP4lak4od2EcaSYZWO0HPDf/XpWIQK28sD2Garys0PPz4PqP601LwqBzux/eGaqzJui35cfDblXvnkVJHbgZzICD/tdPzqgLjn2qzE4UDqM9aGmCaJ3t9q5Ev61A8bjncp9fm6VIHHuPwpQwYH1pXGMTgfeUt7mjcwJ4/XNKybm5zkehFDgJyWIz+lAEgKk4wfwxTXQoN26ozjcNrqfXBqQS7eOcfTikMYWLdcUB2HTdQcdiMfSnLz90igA3v3J/L/61HmDPzY/Kjnsc+1KEzQAxnU9BQMEdMU5sjoaj4J4UE/WgBzKV4ApvzE9VX8qdu2dVK/SjzA3qPrxQA3aQDktg++KRYweOc/WnmVe+78KPMHYmncQ0RY65xTjHx0HNHme4oMnsDQAq8jsPwpdnbK896Z5h/uik3HHSgCUIcELzSbcYB4qMtnr/OmfLnqeKAJyIf4gCfpTNsZPygiog3PGKC3I+YD8aAJHCryeW9+1ROCxHBx6inZOflYUq7yfvdfagAULjAR8juaTPIyMevfFLtkxt3/hinpbk8ZwPfNK4xozgZxil25I3MKcy7IyV6+vFREM2SSTnnp1oAkKEths8UHg8naB6npUeHIHPB9sZp6RnAJx7ZIpgLuT5SxPrjnmkR4y5znp704nBOGViD2ponAPQnnjFCQXFEgY+p+lG9T0BBHrSh5MkEKN3vQZGbtlj1GKBWI2Dbc5yp7+tRt8p3HauOmO9TeZwQccUBgx56EdRzQAR8jJG046nrSKztJhjx/DgUshIXjP48VHtLJ/d/DrRYLiurN988jpk05Vyw+bp0BPH4UzypA2Tye1PKs+3cRzQMUSIkoDcg/w1HCAu7cM/Nwf/r094wAFBUgdB1pg27jyfwFAiUfOc9B7j880KCyk44I5/wA+lHnBAFU7iO+KSOQA7nOBg9+f1oGRkfNjOGpyqvLMMDtUh/eOWOV+vem7QW28MfQ0XEGNzE/dpEVfNIBALdhTTFyCGOfT1+lOJ2sPm3H69PpTQh3kjzNrLzjr6Ux48McnNL83ckEZ+tSRsNuDgk8ZPJpXGQ52554BzzRyegIJ56cYpQm+QgEcDPNRqAA+Vye1VuSOPONuQM9j0oHyEbW6etM3jLDDbT3ApNjIodXHJPP8X0pgSebjhuCfQVIDsGc4yKrE4PVc98nkVE0xV8ODj1FKwXNEFXXDDrUU0RC9+KgEw+XneB/tdanSUO6gA5P6UthjAWCZPJ9MU1mIULjj1q15aM53jIP8SmozbbSWHQ/w9KLoLEK3AVcEfQ5qaOXcSAAMfrULxSA/6smoXAAG1GX6inYLl8qsi4xn6VDt2rg5zjpmoBNg56/SpvtAI5UsMdjS1GHCHB3Ad8c1LDJtBAkBDf7VMQLn5Wb6HBxThEGY5YcUmBIQjElkGfX1qNokySrsKcI+PlKMfrS84I24OehoGNEZGCHOKcRIuNrgH+dAXj7vPoDilO8jG3g/7VFxD8v3GfXANNZ8D5vlFNHHGB+dBBAxhqQwLKF3bgR69aVfKdQyzwknsWxTWjJQ/Llaie3jYfdK/SmiS39mbZxyPYiozGq9cjHX5hVdbeJQCDJ+FShA2PnOR69aYD1TdwuGpxj29SFpnlkn/WnNPw5XEjkj/a70AMMO484YepxTfKAPyhVPsak2Qgjcp/IGn70RQUB/KgCBkIPzEfX/AOvQyptGRx/OleTnO0Co1fc2Ap+p6UAAjj67RnsOSKaYYycbST/sgYFTbVB+Zxu9zSAgEnIY98Gi4EXkohAG4fWpBDub5SPwpec7vuqPwpHLOOW2r2oGKIVHLYP51JlYgANo+gqEpjKlmGf1/CmiNWcZ3E+7ZpWvuFybzfmxvOPbikfB/hOR6tSKhwcDb2600xk/xDI9KLILj0XAy+Ao9CabLMIh8v8APNJ5eRjcSfaphaPtyUO09zS0HqUPKaaQl2Yr6etWhEMYiBXsCeakdFjyRg+w5NRgvIDgMF9MYou2FkOdHKYa52/U9KjKY2iObdj+LGMilkiiLLkZPtjigNkkEAds0ARPBKyn5w69vWopYpo1yykj1FWAMOyr26ECldoo0AOGbHNUmyWkZwO9sc/hV+3UPLjy94QZPzYIqHaqMDtUt9OlWUQqNxLDPOPaiTuEUSvqBlufJAwehzwKjklZFxsyuPrj8abtUsfMVQPfnPvUcpmMe2IDaDnCjioRRE7BmzIhK9iaa0mO2B+lSQvNIcSgIqj+6c04mZsmN0cDvs5/nV3JIJrtJFIMase/oajhiEv3gAgOM1bSCF0Ky58ztsx/jUTxrAAygtt42setF+iC3cjNlFIzGJyUHc8VLFHbRkLtaQ+m6mLJHn7i/L0GOlSqVkcjyuSevf60rvqVZDt6tN8sflEdGI4ponVHbcB9Qae42QsqYIP3iF/rVX7MZE47DPGcmhNMTTRZNzgZDZzSRXojOXBb696hEzKuwIFJPVVAx+VS/ZYpYwVkOSMkN1qrIVy3Dd2l1gOzQsB3PFNmjUfIyEkLkZXr+NVYo1iDbZJIXPHHT+VSBCqhtwkJ6Fv89ai3YodCrZKMD0wOmKcbaTOI3Ur3IqDc4/1mPb0p8TuCV2hVzn5SBQ7hoNaPD7SGz/u9aiZPm4zG+e9Wo2K3IYgHI6YI4+tNmB8wqoCr1wrZNNMTRHF50TjLfKezL8rflUguJQMbOB/dpu9oXCkHn+8P61I6HIZwfm+6U6D9KdkIkMskTDJZSe4NTrNcMMF8cfxYzVEtKH3na49m6fypXkMjBmHHqcHH5UrDuWftswbHU+pTP8qruivLv8pGYnnI61IBkcAH3oGV4KAZ6Y4oQCbDhh9mB4/hBzUUIjKZAwwODuBqUSP93aM+tKkmD9zJH4U7gNCIBxIuOuc81LgEoWxtPQgmomdnbB3D23f/AF6C4BA2Fj60CFkjm8wFQjL9MGn4l38KfwIwaRXIYHDKPpTfOHmZCqceooAlKyDO5SPqwqASYB/dlSTjBHWpGlDHBUYpgzu4OfQY6Uhji6fxKvHqKXAUB8ZHqBxSb9rhXyp7Gg4bqwJHrSAUdjuyPanZKg9Dn1ppx/8AqIpBuI+Xf+YoGPVieT/Olyjtl4xn1DVCeOAHB9OtHmbV+cSADuUNMVyULED0zntQY4eoz+NRLPE3uPdaFmh+7kAfXH9aLBcdhQeOfag8dFP6UjFTyCMeu8H+dIDu/ijP1OKLBck2tjjH4kUoC7/nwR6A0zbGeMIPwz/OmbQp4A+oxSGSuVDcfKPxpmf9oGgcH/69GOeTxQAYIOeD+FIVIGWUY9xUhiPBVVYHuKTBX/CgBoIzyP5U4bMZx+VB57Ck28dT+dADl8sHlSRT9yE5xtx2HFR45yTzSbgTzj64oAe23IIbj3NMZ4xkCQZ7UxiSflP6Ux4WIyWyfyp2ESiUE/NIiL9c0jTwKcLKzH2FQm3J9CKdFb85DY9s4p2QXYpuFUfdkYfXimfayewH5mrXkxZy6bs9y+aa9kpb5Y1+mc0k0FmVftLI+N35AGnNcByNokA/U/pU4ikj/wCWcIz6insGiG5JUBPXC8U7oLEMbPOQuxie3Ip5gnQ/NhSeo+8TRI8zDKyqw9QMYpoMhxucLnuT0pagL5G1cvKw5x/9al4VDhW29qWXy1xuk3n0NRNcPKy7gwx/d6Utxk+8D/VqQ/r6Uwyup+dcP6lutRuWY4Vgq4/i4qMKyrjcP+AmmhFoncSSyhfc1EZzGAAcgelQNvI4U/lQU+Uhjz2GKYiVJc5cn5vT1pC3zghc+tIVDJjaM+uSaaNqjG7B/SgCRXXZtLDPbHT/AOtTizhNmOh+lRKSxwGQA9cU8ACXG5z9QKQyWM4JLMQp6BaCyljsTaPXpUvkkKpCjHXr0pGQupUYJPPAzilcZWMjr2P1B607fG8gYkBj2C4pVhJYk7s+o4pyLEJMGPj8zTuKw8AFwoJJPrS4YP8ANgjPrg01nWPhVPoSKZ57dkLL+tSUSsqkt5hJHYAYNN2hkOOFznbnr9KRZVP3zke1SF0LAKTgetFxWKkkrAjaVKqPXBpTmTAZSnpjoaskxsCqMMk80v2ZGUZx+B6VXMhWKRzHLtU7X7Z+b8qibeCd4Dexq41q8bna5/EUwxSLk7kkP+0tUmKxWZIlXGMMe4pwbC7I34J+6am2eZwY0GB/CcUzyYwcEEv/ALwxTuKwwGeJ/kJwO3WpY72f5laMsD/dGMUeUEPyZG70FNML5JOee9LQeqLMV7kbZYiR/ujP9Ke00EjdCrfSqYWTGC+MdOtPHmAclTmpsO5I6Qtxge+Ki+zJ2kwPcU5JZAfujP1p6Tdd6Akegp6hoRNasMFXH8qXZKBztapxcJ0KkUechPTI9qLhYhVMHmP8jS7U3dPzqXfFuzu/Ck3Qg8uATSuAKSB7UuM9Pl/ClCYXIfP4Um1j359qAEyynghhT96DGY2B9uaQI+M4x+NNKgHJyPwoAfvQHI2/jkGo3uFjQFol69QetPADdz+ANBiJOOSfqBRcBftNsV3KJB7BTigXFucgOB/vCkaOQEHYvvgZprRk87Vz7rT0DUl3x9fMTnpzTPtCA4MRYH0//VTVVgeBGPqlSZcDkofoKNAG+YP4VA+tKGccEhfTuKeN7cq2R9RxSbivO/8ArRcBuTngq/4/4VIWYDdsRR781GZT/eY/iRSGSQ9GcfRqAHBWkfJ/kKUxhV5DcdgKjIkJ5OT7tQ0Py8x/mRj+dFwAkOABnryOKaw5wwCjtlqUrgYKKB9KPKVsEbM+poENKKoOcHPfHFHAPAAPt3p5iAXL7VHsDzUSPC+dssQ2/wB84/SgY/PHYkdcHmnGRdm4rIxHoCKjYh/+WsTD6ilQoScOvP8AcGcUWC437a8bZRCpPYDFMluZ5870JHfgVYWERjcqs59wP8aNjk/d2Z6jGQaNA1KaLc5IUFfpThFMSxaQ/X1qwyndkgj64FKMI+FOc9xTuKxW8tgOWIHpT0U8kdR6irKRKMkttzTSpL5B6f3hSuOxEiucncfwp2zamdh+hp5ZUHv7nNJvJOGwQetK4AgPl7f0HQVOluNpkdlAx371XdwCNgwPen/aA33kyB70hjo2RAwBLqOgHA/lRgSS7i5C4zszULNnncMenWkZjIOW2+w60xXGTzorEIcfQYqNZVC9MkdCalEccJ5Af0zz/wDXpVTvH8uOoxmqEQiYZyf15p2VZD8pYn2qVFXdkgj0zzT2IVeeMn1pNhYrrAhUkxkEds0GIk5Jyv8AdzVsf6vjJP0oRd8e7AJ6Y60hkCu3l+Usar7gU/yQ65Zwh9DmnOGHygcd+KGA4GT9KkYR2kLMrb1DDpT3thboWRA75yCoGajLrjDjGOhFHVsrkf7QNPUCGWYyKflPXPK1B8xKNksB78VfIcPu3BifWgDCbPLQfhVJisVd7luRH9CM0KjEbgwU9CAKmVFThkD496bIVZQpDE+nBx+NFxWERCpI3lh696cY0dd3GaI/vbBETxjPWpFtzzl93s2BSGRtH/tfTNJjLD5cHpxThaSAkmTr2Yf/AF6d5LRLu3qD79KLAO3SZPyhh9AajKRdSoB91xUeLtvvBj/wMf4UGO4I+6fzH+FOwrkm/PCuePSgKc8H8SKh8q5XpEPyFLu1BRhY8D2xRYdybkfxL+VKFz0YD8agBvO8bfhQy3B/gk/KlYLlkptHU/hTQyg8qWHtmqxW7HQSf9803N6ONj/9807BcvbgeVBFNMe7kBjVTFyfvRn/AL5NOVJR1iP/AHyf8KLBcs7COMN+IpfKOOOlRAv/AM8f0/8ArU0+cekI/KlYLk2092z7YNAQ5+6PyFVysp6wk/Sj98vSF/zosFyxtwMbW/IUYPQZFQb5/wDn3b86A0ne3f8ABqdhXLACDjFKVTsXPtmqxaXtFIP+BCkDSj/lnIfxFFh3LXy7NuxvrzUYEYPEIP4n/Goy8neKT8xTfMl/55yfpS5QuWQVHWJf0pTKg6xL+f8A9eqvmS/885Pzo82XvHJRyhcm3ox+5j6UvyHofzJqDeT1hb8hS7m7QvRYLljhhzIopu0Z4b8qgy3/ADwJ/AUbmH/LA/pRYLk4yRje30BNNIXpzUW5/wDni36Uu5z/AMspP0osFyTjszUbkHVz+dR8/wDPKT9KDk/8s5h+IosFyXKHuT+NLv8AY4qEbh/yzlP1Ip3P/PF/xNFgJs5HAz9aC2f4ahwf+eRp2Tj/AFbf5/GgY/nsg+tKG2jHyfyqLJH/ACzf9KDI2P8AVMfrQIk3t/z0OPSgkFgcH8TUYmkHSIikMrk8xMfxoAm5J4Ix6CgouM8H68VD5jkY8s/nQGf+4RQA8ru9PwzQyjuBTNzf3T+lG5j2b9KAHAKxPAFOVDj7hNRjj+E07d/sGgAkjbHzQke/FN3EDaq8e4p25uwNJuf3FFwsIobv+WcU51GRgjPvTcMf/wBml2Me4H/AaLgJhAfmIz9aTCEdVP1AqRYx3wfrTyoIxtUfQii47FfZGepP0qUfKPk607y2xgcfiKYYHzkc/iP8aVwIWcs/zM2R6ik86ZGygJ/DNWBE4/hB/H/69KVkI+5+op3FYhjaeQ5kSRj6CpBIrPtMJU+pOKXy5P7h/OmmKQ/wkfiaVxk6bUbJdcf99Us0tsRxKM/hiqvkt3Vvyp3lDuj/AJUgFLoo4ljI9jSq29flKAe9KsSdlcfiaXyz2x+NFwGngbUxn1waQKR96QfTNO8mTP3l/Sgwyf30pgNMrrwCce1CzAt3P4Uvkyjo0f5UeU38QjP4gf0o0ARjzkID9eKVh5hyx5+tLtYdFQfRv/rUu055/RqLhYjAUcYYflSjb0G7+dOIPoT+NNw3ofzouFgYgdz+lNyOuce2adsB6g/zpSo/u/pRcA3NjGMj8KRQN2SwHsaQg9kP4A0AHujfkaAHFFBJ4P0o2qR/EDTdq5+435GlAUfwt+RouAmwZ/1h/HFI0bE/ep/ToG/WkIbsSPw/+tRcVhVdx/Hj8B/hSl27zH8h/hTct3bP1H/1qMse/wCn/wBai47DS7t/y8IP+AinLNIp5ux+BAoBYfxf5/Kl3k9T/n8qLisO86f+G4V/YgH+VIWkPLeWT/utTcj0B/z9KMj+6Pz/APrUXGO3nb/D+ANCtLzuTcD/ALWP6U04Pt/wI/4UmB/e/wDHv/rUXAf1/gX/AL6/+tRu2nOwn6GmYP8Ae/X/AOtS8+o/P/61AEm5GILBvpjH8jT2lXHCH/vqoOf7woO7+8PyouBIZiPuhfzJpvnP6oPqDUe1v7w/L/61Jtb1X8v/AK1AEpmJ/uH6E0Kx7RqP+B4/pUW1v9n/AL5o2v2I/KgCQsS3zRj8DmnoY+rYH/ASf6VX8uT1H5U4I/8As/lRcLExkhz0jP1jNBmjThIV+oGP61F5bH+7/wB80nlH1/8AHaLhYnEsZHMPJ9CD/WjzYx0Dj8v8ah8sjv8ApQYyR0/8d/8ArU7hYJZ5DwhYD2bFIm3OWLZ/36BER2Y/hTtjdlei4rC8NxtOPzpUhVeQi/j1pAsg/wCWbH60pE54EePwpDsEgbHy5H0x/hTFBH/LRs+4FL5M5/hP6UfZp/f9KYhfNx1Tn14qLcXb5mCj2Gaf9ln/ALufxo+yyd4v1/8Ar09A1E3RAck5HTioxOm4BVJP0qUWhB/1P5n/AOvT/Jkx/q0o0DUZlSeu0+5AoKc53N+X/wBenG3c9FC/QAUw2bHqM/U//XpXQajt275dxH0p0doACQcZ7n/69IIJFGAP/H6PKlznav8A32KAHFFQ4MoJ9BzUbMQcAHHqak2zd1j/AO+hShGHVIvzFAxiyxqOZQD6DNBbdyo3j1Ip/lnP8A+hFOA291/MUrisNWR9uDkD35o3BTlmA9wuKfvx6H8RTSY/7gz/ALxoGNYq4JXH1H/66TG0YGPwxTi3pgfiaAf9pf1oAhKEPkjHvkZp5l2jADMfoTTzk/xp+VM8vnPmKD7UxCCSXbyir9R/jTGbvuI/3TUpiD/emY/iab9kgx94n8aNA1IwV24OSPzqVCrDAX/vpaY1vt+4f/HsVGYZx90f+RB/hT0EWHRT2H4GhDg/KxH0aq2y7HRW/wC/o/wpy/bR0DD/AIGKLBc//9k=';
function loadPhotoEnv(){
  // swaps the drawn reflection map for a real outdoor photo once it has decoded
  const img=new Image();img.onload=()=>{try{if(!G)return;const t=new THREE.Texture(img);t.needsUpdate=true;t.mapping=THREE.EquirectangularReflectionMapping;
    const pm=new THREE.PMREMGenerator(G.renderer),env=pm.fromEquirectangular(t).texture;pm.dispose();t.dispose();
    const old=makeEnvOnce();G.env=env;const swap=m=>{if(m&&m.envMap===old){m.envMap=env;m.needsUpdate=true;}};
    Object.values(G.mat).forEach(swap);G.scene.traverse(o=>{if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(swap);});}catch(e){}};
  img.src=ENV_JPG;
}
function makeEnvOnce(){if(!G.env)G.env=makeEnv();return G.env;}
function makeEnv(){
  // an outdoor reflection map: bright sky, sun, hazy mountains and a dark road, so paint and chrome look real
  const c=document.createElement('canvas');c.width=1024;c.height=512;const x=c.getContext('2d'),r=mulberry(21);
  const g=x.createLinearGradient(0,0,0,512);g.addColorStop(0,'#3a76c8');g.addColorStop(0.38,'#a9cbea');g.addColorStop(0.5,'#e6eef4');g.addColorStop(0.505,'#5d5a52');g.addColorStop(0.7,'#2a2a2e');g.addColorStop(1,'#141416');
  x.fillStyle=g;x.fillRect(0,0,1024,512);
  x.fillStyle='#7d8590';for(let k=0;k<14;k++){const px=r()*1024,w=80+r()*160,hh=20+r()*40;x.beginPath();x.moveTo(px-w,256);x.lineTo(px,256-hh);x.lineTo(px+w,256);x.fill();}
  x.fillStyle='#3f4c33';for(let k=0;k<260;k++){x.fillRect(r()*1024,240+r()*16,2+r()*3,4+r()*8);}
  const sg=x.createRadialGradient(700,110,0,700,110,60);sg.addColorStop(0,'rgba(255,255,245,1)');sg.addColorStop(1,'rgba(255,255,245,0)');x.fillStyle=sg;x.fillRect(600,40,200,140);
  x.fillStyle='rgba(255,255,255,0.7)';for(let k=0;k<8;k++)x.fillRect(r()*1024,300+r()*40,60+r()*120,3);
  const t=new THREE.CanvasTexture(c);t.mapping=THREE.EquirectangularReflectionMapping;
  try{const pm=new THREE.PMREMGenerator(G.renderer);const e=pm.fromEquirectangular(t).texture;pm.dispose();return e;}catch(e){return t;}
}
function carve(geo,p,shoulder,ends){
  // pulls the sides in toward the top (rounded shoulders) and toward the nose and tail (rounded corners from above)
  const a=geo.attributes.position,h=p.L/2,top=p.roof;
  for(let i=0;i<a.count;i++){const x=a.getX(i),y=a.getY(i),z=a.getZ(i);
    const ty=clamp((y-p.ground-0.35)/(top-p.ground-0.35),0,1),tz=clamp((Math.abs(z)-(h-1.3))/1.3,0,1);
    a.setX(i,x*(1-shoulder*ty*ty)*(1-ends*tz*tz));}
  a.needsUpdate=true;
}
function bodyGeo(type){
  const k='body_'+type;if(G.geo[k])return G.geo[k];
  const p=SHAPES[type],h=p.L/2,ar=p.wr+0.18,s=new THREE.Shape();
  // lower body with real wheel arches
  s.moveTo(-h,p.deck-0.32);
  s.lineTo(-h+0.02,p.ground+0.26);
  s.quadraticCurveTo(-h+0.02,p.ground,Math.min(-h+0.3,-p.wz-ar-0.04),p.ground);
  s.lineTo(-p.wz-ar,p.ground);s.absarc(-p.wz,p.wr,ar,Math.PI,0,true);
  s.lineTo(p.wz-ar,p.ground);s.absarc(p.wz,p.wr,ar,Math.PI,0,true);
  s.lineTo(Math.max(h-0.45,p.wz+ar+0.04),p.ground);
  s.quadraticCurveTo(h+0.05,p.ground+0.02,h+0.06,p.nose-0.16);
  s.lineTo(h,p.nose);
  s.quadraticCurveTo(h-0.35,p.fender+0.02,p.wz-0.2,p.fender);
  s.lineTo(p.ws,p.fender-0.03);
  s.lineTo(p.rw,p.deck+0.02);
  s.lineTo(-h+0.42,p.deck);
  s.quadraticCurveTo(-h+0.04,p.deck-0.02,-h,p.deck-0.32);
  const depth=p.bw-0.3;
  const body=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelThickness:0.15,bevelSize:0.12,bevelSegments:3,curveSegments:18,steps:1});
  body.translate(0,0,-depth/2);body.rotateY(-Math.PI/2);carve(body,p,0.13,0.11);body.computeVertexNormals();
  // the cabin: narrower than the body, dark glass all round
  const c=new THREE.Shape(),base=p.fender-0.08,rb=Math.max(p.deck-0.02,base-0.3);
  c.moveTo(p.ws,base);c.quadraticCurveTo(p.ws-0.55,p.roof-0.12,p.roofF,p.roof);c.lineTo(p.roofR,p.roof);c.quadraticCurveTo(p.rw+0.55,p.roof-0.14,p.rw+0.05,rb);c.lineTo(p.ws,base);
  const cd=p.bw*p.cab-0.36,cabin=new THREE.ExtrudeGeometry(c,{depth:cd,bevelEnabled:true,bevelThickness:0.18,bevelSize:0.16,bevelSegments:3,curveSegments:14});
  cabin.translate(0,0,-cd/2);cabin.rotateY(-Math.PI/2);carve(cabin,p,0.3,0.04);cabin.computeVertexNormals();
  // body-coloured roof panel and pillars over the glass
  const rf=new THREE.Shape(),rt=p.roof+0.17;
  rf.moveTo(p.roofF+0.12,rt);rf.lineTo(p.roofR-0.16,rt);rf.lineTo(p.roofR-0.1,rt-0.2);rf.lineTo(p.roofF+0.04,rt-0.2);rf.lineTo(p.roofF+0.12,rt);
  const rd=p.bw*p.cab-0.2,roof=new THREE.ExtrudeGeometry(rf,{depth:rd,bevelEnabled:true,bevelThickness:0.05,bevelSize:0.05,bevelSegments:2});
  roof.translate(0,0,-rd/2);roof.rotateY(-Math.PI/2);carve(roof,p,0.3,0.04);roof.computeVertexNormals();
  G.geo[k]={body,cabin,roof};return G.geo[k];
}
let _glowT=null,_flareT=null;
function carMats(){
  if(G.mat.chrome)return;
  makeEnvOnce();_glowT=glowTex();_flareT=flareTex();
  G.mat.chrome=new THREE.MeshStandardMaterial({color:0xdadbe6,metalness:1,roughness:0.16,envMap:G.env,envMapIntensity:1.3});
  G.mat.dark=new THREE.MeshStandardMaterial({color:0x111018,metalness:0.4,roughness:0.5,envMap:G.env,envMapIntensity:0.6});
  G.mat.carbon=new THREE.MeshStandardMaterial({color:0x17171c,metalness:0.55,roughness:0.32,envMap:G.env,envMapIntensity:0.8});
  G.mat.white=new THREE.MeshStandardMaterial({color:0xf4f2ee,metalness:0.2,roughness:0.3,envMap:G.env});
  G.mat.glassP=new THREE.MeshPhysicalMaterial({color:0x0b0d14,metalness:0.35,roughness:0.04,envMap:G.env,envMapIntensity:1.8,clearcoat:1,clearcoatRoughness:0.02,transparent:true,opacity:0.9});
  G.mat.tireS=new THREE.MeshStandardMaterial({color:0x0b0b0e,roughness:0.9,metalness:0});
  G.mat.amber=new THREE.MeshBasicMaterial({color:0xffb347});
  G.mat.led=new THREE.MeshBasicMaterial({color:0xff1f3a});
  G.mat.mesh=new THREE.MeshStandardMaterial({color:0x0c0c10,metalness:0.6,roughness:0.6});
  G.mat.lens=new THREE.MeshStandardMaterial({color:0x2a2e38,metalness:0.9,roughness:0.1,envMap:G.env,envMapIntensity:1.4});
}
function tireMats(){
  if(G.mat.tread)return;
  const tc=document.createElement('canvas');tc.width=256;tc.height=64;const tx=tc.getContext('2d');
  tx.fillStyle='#15151a';tx.fillRect(0,0,256,64);
  for(let i=0;i<32;i++){const x=i*8;tx.fillStyle='#08080b';tx.beginPath();tx.moveTo(x,0);tx.lineTo(x+5,0);tx.lineTo(x+2,32);tx.lineTo(x+5,64);tx.lineTo(x,64);tx.lineTo(x-3,32);tx.fill();}
  tx.fillStyle='#0a0a0e';tx.fillRect(0,28,256,8);
  const tt=new THREE.CanvasTexture(tc);tt.wrapS=tt.wrapT=THREE.RepeatWrapping;tt.repeat.set(5,1);
  G.mat.tread=new THREE.MeshStandardMaterial({map:tt,roughness:0.95,metalness:0,side:THREE.DoubleSide});
  const wc=document.createElement('canvas');wc.width=wc.height=256;const wx=wc.getContext('2d');
  wx.fillStyle='#111116';wx.fillRect(0,0,256,256);
  wx.strokeStyle='#1d1d24';wx.lineWidth=3;wx.beginPath();wx.arc(128,128,122,0,7);wx.stroke();
  const txt=' HYPERFOCUS · AUTISTIK RACING · HYPERFOCUS · AUTISTIK RACING ·';wx.fillStyle='#e9e6f2';wx.font="bold 15px 'Russo One', sans-serif";wx.textAlign='center';wx.textBaseline='middle';
  for(let i=0;i<txt.length;i++){const a=i/txt.length*Math.PI*2;wx.save();wx.translate(128+Math.cos(a)*104,128+Math.sin(a)*104);wx.rotate(a+Math.PI/2);wx.fillText(txt[i],0,0);wx.restore();}
  G.mat.wall=new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(wc),roughness:0.85,metalness:0,side:THREE.DoubleSide});
  G.mat.barrel=new THREE.MeshStandardMaterial({color:0x1c1c24,metalness:0.85,roughness:0.4,envMap:G.env,side:THREE.DoubleSide});
  G.mat.disc=new THREE.MeshStandardMaterial({color:0x8a8a94,metalness:0.9,roughness:0.45,envMap:G.env});
  G.mat.caliper=new THREE.MeshStandardMaterial({color:0xe3263a,metalness:0.3,roughness:0.35,emissive:0x3a0006});
  G.mat.hglow=new THREE.SpriteMaterial({map:_glowT,color:0xe6efff,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true});
  G.mat.flare=new THREE.SpriteMaterial({map:_flareT,color:0xdfe9ff,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:0.75});lightGlare();
  G.mat.tglow=new THREE.SpriteMaterial({map:_glowT,color:0xff2236,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:0.75});
  G.mat.beam=new THREE.MeshBasicMaterial({color:0xfff0c8,transparent:true,opacity:0.07,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
  G.geo.beam=new THREE.ConeGeometry(2.1,12,18,1,true);
  const pc=document.createElement('canvas');pc.width=256;pc.height=64;const px=pc.getContext('2d');
  px.fillStyle='#f4f2ea';px.fillRect(0,0,256,64);px.fillStyle='#1a1a22';px.fillRect(0,0,256,4);px.fillRect(0,60,256,4);
  px.fillStyle='#ff7a2f';px.fillRect(0,0,26,64);px.fillStyle='#14121e';px.font="40px 'Russo One', sans-serif";px.textAlign='center';px.textBaseline='middle';px.fillText('AUTISTIK',142,34);
  G.mat.plate=new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(pc),roughness:0.4,metalness:0.2});
  G.geo.plate=new THREE.PlaneGeometry(1.5,0.38);
}
function makeCar(color,type,helmet,human){
  carMats();tireMats();
  type=SHAPES[type]?type:'street';
  const p=SHAPES[type],g=new THREE.Group(),col=new THREE.Color(color),h=p.L/2;
  const B=(w,hh,d,m,x,y,z,rx,ry)=>{const k='b'+w+'|'+hh+'|'+d;let gg=G.geo[k];if(!gg)gg=G.geo[k]=new THREE.BoxGeometry(w,hh,d);const me=new THREE.Mesh(gg,m);me.position.set(x,y,z);if(rx)me.rotation.x=rx;if(ry)me.rotation.y=ry;g.add(me);return me;};
  const bodyM=new THREE.MeshPhysicalMaterial({color:col,metalness:0.55,roughness:0.28,clearcoat:1,clearcoatRoughness:0.03,envMap:G.env,envMapIntensity:1.0,emissive:col.clone().multiplyScalar(0.04)});
  const bg=bodyGeo(type);
  const body=new THREE.Mesh(bg.body,bodyM);body.castShadow=true;g.add(body);
  const cab=new THREE.Mesh(bg.cabin,G.mat.glassP);cab.castShadow=true;g.add(cab);
  const roof=new THREE.Mesh(bg.roof,bodyM);roof.castShadow=true;g.add(roof);
  // splitter, side skirts, diffuser, quad exhausts, mirrors, side intakes
  B(p.bw*0.94,0.07,0.7,G.mat.carbon,0,p.ground+0.03,h-0.15);
  [-1,1].forEach(sd=>B(0.14,0.18,p.wz*2-1.5,G.mat.carbon,sd*(p.bw/2+0.02),p.ground+0.1,0));
  B(p.bw*0.78,0.26,0.55,G.mat.carbon,0,p.ground+0.12,-h+0.12);
  for(let k=0;k<5;k++)B(0.05,0.24,0.5,G.mat.dark,-0.9+k*0.45,p.ground+0.2,-h+0.1);
  if(!G.geo.exh){G.geo.exh=new THREE.CylinderGeometry(0.13,0.13,0.4,14);G.geo.exh.rotateX(Math.PI/2);}
  [-0.95,-0.62,0.62,0.95].forEach(x=>{const e=new THREE.Mesh(G.geo.exh,G.mat.chrome);e.position.set(x,p.ground+0.24,-h-0.1);g.add(e);});
  [-1,1].forEach(sd=>{B(0.14,0.06,0.3,G.mat.carbon,sd*(p.bw*p.cab/2+0.12),p.fender+0.05,p.ws-0.3);B(0.3,0.22,0.38,bodyM,sd*(p.bw*p.cab/2+0.3),p.fender+0.12,p.ws-0.32);});
  B(p.bw*0.62,p.nose*0.38,0.08,G.mat.dark,0,p.ground+p.nose*0.32,h+0.02);
  [-1,1].forEach(sd=>B(p.bw*0.16,p.nose*0.3,0.08,G.mat.dark,sd*p.bw*0.34,p.ground+p.nose*0.28,h+0.01));
  // two-tone: a dark carbon lower band, side scallops, rear grille and LED running lights
  [-1,1].forEach(sd=>{B(0.06,0.34,p.L*0.62,G.mat.carbon,sd*(p.bw/2+0.035),p.ground+0.36,0.1);
    B(0.06,p.fender*0.42,0.9,G.mat.carbon,sd*(p.bw/2+0.03),p.ground+p.fender*0.36,p.wz-1.05,0,sd*0.22);});
  B(p.bw*0.66,0.3,0.06,G.mat.mesh,0,p.deck-0.5,-h-0.03);
  [-1,1].forEach(sd=>B(p.bw*0.2,0.035,0.05,G.mat.head,sd*p.bw*0.3,(p.nose+p.fender)/2-0.22,h+0.06,0,sd*0.25));
  if(type==='super'){B(0.05,0.32,2.2,bodyM,0,p.deck+0.14,p.roofR-1.0);B(0.7,0.16,0.9,G.mat.carbon,0,p.roof+0.2,p.roofR+0.25);}
  if(p.scoop)B(1.3,0.3,1.6,G.mat.carbon,0,p.fender+0.12,h*0.42);
  if(p.stripes)[-0.42,0.42].forEach(x=>{B(0.4,0.03,h*0.95,G.mat.white,x,p.fender+0.1,h*0.5);B(0.4,0.03,p.roofF-p.roofR+0.2,G.mat.white,x,p.roof+0.24,(p.roofF+p.roofR)/2);});
  if(p.intakes)[-1,1].forEach(sd=>B(0.1,p.fender*0.38,1.4,G.mat.carbon,sd*(p.bw/2+0.08),p.ground+p.fender*0.42,-1.0));
  if(p.spoiler==='wing'){B(4.0,0.09,0.9,G.mat.carbon,0,p.deck+0.78,-h+0.55);[-1,1].forEach(sd=>{B(0.08,0.72,0.3,G.mat.carbon,sd*1.2,p.deck+0.4,-h+0.55);B(0.05,0.45,0.95,G.mat.carbon,sd*2.0,p.deck+0.76,-h+0.55);});}
  else if(p.spoiler==='lip')B(p.bw*0.84,0.07,0.45,G.mat.carbon,0,p.deck+0.06,-h+0.35,-0.25);
  else if(p.spoiler==='duck')B(p.bw*0.86,0.16,0.42,bodyM,0,p.deck+0.14,-h+0.3,0.35);
  if(p.lightbar){B(2.6,0.24,0.4,G.mat.dark,0,p.roof+0.42,p.roofF-0.25);[-0.9,-0.3,0.3,0.9].forEach(x=>B(0.42,0.2,0.08,G.mat.amber,x,p.roof+0.42,p.roofF-0.03));
    B(2.9,0.08,2.2,G.mat.chrome,0,p.roof+0.3,(p.roofF+p.roofR)/2);[-1,1].forEach(sd=>B(0.9,0.7,0.06,G.mat.dark,sd*1.3,p.ground+0.25,-h+0.8));}
  // wheels: tyre with tread and lettered sidewalls, dark barrel, chrome spokes, disc and caliper
  const wr=p.wr,wk='w'+wr;
  if(!G.geo[wk]){G.geo[wk]=new THREE.CylinderGeometry(wr,wr,0.62,30,1,true);G.geo['wall'+wr]=new THREE.RingGeometry(wr*0.66,wr,30,1);G.geo['r'+wr]=new THREE.CylinderGeometry(wr*0.66,wr*0.66,0.5,22,1,true);
    G.geo['s'+wr]=new THREE.BoxGeometry(0.1,wr*1.26,0.12);G.geo['c'+wr]=new THREE.CylinderGeometry(wr*0.17,wr*0.17,0.12,12);G.geo['d'+wr]=new THREE.CylinderGeometry(wr*0.56,wr*0.56,0.06,22);G.geo['k'+wr]=new THREE.BoxGeometry(0.2,wr*0.42,wr*0.5);G.geo['hub'+wr]=new THREE.CircleGeometry(wr*0.66,22);}
  const wheels=[];
  [[-1,1],[1,1],[-1,-1],[1,-1]].forEach(([sx,sz])=>{
    const steer=new THREE.Group();steer.position.set(sx*(p.bw/2-0.28),wr,sz*p.wz);g.add(steer);
    const spin=new THREE.Group();steer.add(spin);
    const t=new THREE.Mesh(G.geo[wk],G.mat.tread);t.rotation.z=Math.PI/2;t.castShadow=true;spin.add(t);
    [-1,1].forEach(side=>{const w=new THREE.Mesh(G.geo['wall'+wr],G.mat.wall);w.rotation.y=side*Math.PI/2;w.position.x=side*0.31;spin.add(w);});
    const barrel=new THREE.Mesh(G.geo['r'+wr],G.mat.barrel);barrel.rotation.z=Math.PI/2;spin.add(barrel);
    const back=new THREE.Mesh(G.geo['hub'+wr],G.mat.barrel);back.rotation.y=-sx*Math.PI/2;back.position.x=-sx*0.2;spin.add(back);
    for(let i=0;i<5;i++){const sp=new THREE.Mesh(G.geo['s'+wr],G.mat.chrome);sp.position.x=sx*0.26;sp.rotation.x=i*Math.PI*2/5;spin.add(sp);}
    const cap=new THREE.Mesh(G.geo['c'+wr],G.mat.chrome);cap.rotation.z=Math.PI/2;cap.position.x=sx*0.28;spin.add(cap);
    const disc=new THREE.Mesh(G.geo['d'+wr],G.mat.disc);disc.rotation.z=Math.PI/2;disc.position.x=sx*0.02;steer.add(disc);
    const cal=new THREE.Mesh(G.geo['k'+wr],G.mat.caliper);cal.position.set(sx*0.1,wr*0.3,-wr*0.18);steer.add(cal);
    wheels.push({steer,spin,front:sz>0});});
  // lights: slim angled xenon headlights with a blue-white flare, a full-width LED tail bar
  const tails=[];
  tails.push(B(p.bw*0.82,0.1,0.08,G.mat.led,0,p.deck-0.16,-h-0.03));
  [-1,1].forEach(sd=>tails.push(B(p.bw*0.2,0.2,0.1,G.mat.tail,sd*p.bw*0.34,p.deck-0.28,-h-0.04)));
  const tglow=[],hglow=[],beams=[];
  const hy=(p.nose+p.fender)/2-0.05,hz=h-0.18;
  [-1,1].forEach(sd=>{B(p.bw*0.24,0.13,0.5,G.mat.lens,sd*p.bw*0.31,hy,hz,0,sd*0.18);B(p.bw*0.2,0.05,0.06,G.mat.head,sd*p.bw*0.31,hy+0.03,hz+0.26,0,sd*0.18);
    const hg=new THREE.Sprite(G.mat.hglow);hg.position.set(sd*p.bw*0.31,hy,h+0.35);hg.scale.set(1.3,0.7,1);g.add(hg);hglow.push(hg);
    const fl=new THREE.Sprite(G.mat.flare);fl.position.set(sd*p.bw*0.31,hy,h+0.4);fl.scale.set(4.5,0.55,1);g.add(fl);hglow.push(fl);
    const beam=new THREE.Mesh(G.geo.beam,G.mat.beam);beam.rotation.x=-Math.PI/2;beam.position.set(sd*p.bw*0.31,hy-0.15,h+6.2);g.add(beam);beams.push(beam);
    const tg=new THREE.Sprite(G.mat.tglow);tg.position.set(sd*p.bw*0.34,p.deck-0.28,-h-0.3);tg.scale.set(1.3,0.8,1);g.add(tg);tglow.push(tg);});
  const plate=new THREE.Mesh(G.geo.plate,G.mat.plate);plate.position.set(0,p.ground+0.55,-h-0.1);plate.rotation.y=Math.PI;g.add(plate);
  // the driver, seen through the glass
  const hm=new THREE.MeshStandardMaterial({color:new THREE.Color(helmet||'#f1edff'),metalness:0.3,roughness:0.2,envMap:G.env});
  if(!G.geo.helm){G.geo.helm=new THREE.SphereGeometry(0.42,18,14);}
  const head=new THREE.Mesh(G.geo.helm,hm);head.position.set(0.62,p.roof-0.58,(p.roofF+p.roofR)/2+0.25);g.add(head);
  // boost flames from the exhausts, soft contact shadow, night underglow, name tag
  const flames=[-0.78,0.78].map(x=>{const f=new THREE.Mesh(G.geo.flame,G.mat.flameB);f.rotation.x=-Math.PI/2;f.position.set(x,p.ground+0.24,-h-0.95);f.visible=false;g.add(f);return f;});
  const shd=new THREE.Mesh(G.geo.shadow,G.mat.shadow);shd.rotation.x=-Math.PI/2;shd.position.y=0.03;shd.scale.set(p.bw/4.2,p.L/8.2,1);g.add(shd);
  let glow=null;
  if(human){const gm=new THREE.MeshBasicMaterial({map:_glowT,color:col,transparent:true,opacity:0.7,blending:THREE.AdditiveBlending,depthWrite:false});
    glow=new THREE.Mesh(G.geo.glow||(G.geo.glow=new THREE.PlaneGeometry(6.4,10.4)),gm);glow.rotation.x=-Math.PI/2;glow.position.y=0.05;g.add(glow);}
  const label=new THREE.Sprite();label.position.set(0,p.roof+2.2,0);label.scale.set(9.2,2,1);g.add(label);
  g.userData={bodyM,flames,tails,tglow,hglow,beams,glow,wheels,label,key:'',baseColor:color,look:color+'|'+type+'|'+helmet,rug:false};
  G.scene.add(g);return g;
}
function smoke(car,p,amt){
  if(!G.smoke){G.smoke=[];const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),gr=x.createRadialGradient(32,32,2,32,32,30);gr.addColorStop(0,'rgba(235,235,240,0.75)');gr.addColorStop(1,'rgba(235,235,240,0)');x.fillStyle=gr;x.fillRect(0,0,64,64);
    G.smokeMat=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false,opacity:0.5});
    for(let i=0;i<48;i++){const sp=new THREE.Sprite(G.smokeMat.clone());sp.visible=false;G.scene.add(sp);G.smoke.push({sp,life:0});}}
  if(Math.random()>0.35+amt)return;
  [-1,1].forEach(sd=>{const f=G.smoke.find(q=>q.life<=0);if(!f)return;const v=new THREE.Vector3(sd*(p.bw/2-0.3),0.35,-p.wz);car.localToWorld(v);
    f.sp.position.copy(v);f.life=1;f.sp.visible=true;f.sp.scale.set(1.2,1.2,1);});
}
function smokeTick(dt){if(!G.smoke)return;for(const q of G.smoke){if(q.life<=0)continue;q.life-=dt*0.9;const s=1.2+(1-q.life)*4.5;q.sp.scale.set(s,s,1);q.sp.position.y+=dt*0.6;q.sp.material.opacity=Math.max(0,q.life)*0.45;if(q.life<=0)q.sp.visible=false;}}
function placeCar(g,r,d,o){
  tp(r.pos,r.x,o);g.position.set(o.x,o.y,o.z);g.rotation.set(-o.pitch,o.ang,0,'YXZ');
  const u=g.userData,night=!G.day;
  if(!!d.rug!==u.rug){u.rug=!!d.rug;u.bodyM.color.set(d.rug?'#5d5a6b':u.baseColor);u.bodyM.emissive.set(d.rug?'#000000':u.baseColor).multiplyScalar(d.rug?0:0.04);}
  const fl=d.moon||d.boost;u.flames.forEach(f=>{f.visible=!!fl&&!reduce;f.material=d.moon?G.mat.flameM:G.mat.flameB;f.scale.y=0.6+Math.random()*0.5;});
  u.tails.forEach(t=>t.scale.set(d.brake?1.15:1,d.brake?1.5:1,1));
  u.tglow.forEach(t=>{t.visible=night||!!d.brake;t.scale.set(d.brake?2.2:1.6,d.brake?1.3:1,1);});
  u.beams.forEach(b=>b.visible=night);if(u.glow)u.glow.visible=night;
  if(u.wheels){const roll=Math.min(((r.speed||0)*SC)*(G.dt||0)/0.6,1.15),st=clamp(d.steer!=null?d.steer:(r.tx!=null?-(r.tx-r.x)*2.5:0),-1,1)*0.55;
    u.wheels.forEach(w=>{w.spin.rotation.x+=roll;if(w.front)w.steer.rotation.y+=(st-w.steer.rotation.y)*0.25;});}
  if(d.label){const key=d.label+'|'+d.sub+'|'+d.color+'|'+d.subCol+'|'+(d.human?1:0);if(key!==u.key){u.key=key;u.label.material=labelSprite(key,d);}u.label.visible=true;}else u.label.visible=false;
}
const _o={},_o2={};let _v=null,_v2=null;
function renderGL(pl,others,dt,showMe){
  G.dt=dt;buildGLTrack();
  const fun=S&&S.w.mode==='fun',plSeg=Math.floor(pl.pos/SEG);
  // only the stretches of scenery near the player are drawn
  for(const c of G.chunks)c.mesh.visible=c.to>plSeg-40&&c.from<plSeg+DRAW+90;
  const look=me.color+'|'+me.car+'|'+me.helmet;
  if(!G.me||G.me.userData.look!==look){if(G.me)G.scene.remove(G.me);G.me=makeCar(me.color,me.car,me.helmet,true);}
  G.me.visible=showMe;
  const stv=pl.steer!=null?-pl.steer:pl.inp&&pl.inp.left?1:pl.inp&&pl.inp.right?-1:(tiltOn&&S?-tiltVal:0);
  const spd=clamp((pl.speed||0)/BASE,0,2),cv0=segAt(pl.pos).curve;
  G.yaw=(G.yaw||0)+(((stv*0.26)-(pl.vx||0)*0.06+cv0*0.03)*Math.min(1,spd)-(G.yaw||0))*Math.min(1,dt*5);
  if(showMe){placeCar(G.me,pl,{boost:pl.boosting&&!pl.finished,brake:pl.inp&&pl.inp.brake,steer:stv},_o);G.me.rotation.y+=G.yaw;G.me.rotation.z=-G.yaw*0.14;
    if(Math.abs(G.yaw)>0.13&&spd>0.45&&!reduce)smoke(G.me,SHAPES[me.car]||SHAPES.street,Math.abs(G.yaw));}
  smokeTick(dt);
  const seen=new Set();
  for(const r of others){const gap=r.pos-pl.pos;if(gap<-SEG*30||gap>SEG*DRAW)continue;seen.add(r.id);
    const lk=r.color+'|'+(r.type||'street')+'|'+(r.helmet||'#f1edff');let g=G.cars.get(r.id);if(!g||g.userData.look!==lk){if(g)G.scene.remove(g);g=makeCar(r.color,r.type||'street',r.helmet||'#f1edff',!!r.remote);G.cars.set(r.id,g);}
    g.visible=true;placeCar(g,r,r.d||{color:r.color},_o2);if(r.tx!=null)g.rotation.y+=clamp(-(r.tx-r.x)*0.5,-0.18,0.18);}
  G.cars.forEach((g,id)=>{if(!seen.has(id))g.visible=false;});
  G.cans.forEach(c=>{const it=segments[c.n]&&segments[c.n].items[c.k];c.m.visible=!!S&&!!it&&!it.taken&&c.n>plSeg-5&&c.n<plSeg+DRAW;c.m.rotation.y+=dt*2;});
  G.gates.forEach(g=>{const vis=fun&&g.n>plSeg-10&&g.n<plSeg+DRAW;g.grp.visible=vis;
    if(vis){g.t-=dt;if(g.t<=0){g.t=0.3;const it=segments[g.n].items[g.k];const coins=(it&&it.coins)||gatePicks(it||g.it);coins.forEach((k,i)=>drawGatePanel(g.panels[i],k));}}});
  let li=0;for(const l of G.lamps){if(l.n<plSeg-4)continue;if(li>=G.lampLights.length||l.n>plSeg+70)break;G.lampLights[li].position.set(l.x,l.y,l.z);li++;}
  for(;li<G.lampLights.length;li++)G.lampLights[li].position.set(0,-999,0);
  // low chase camera: pulls back and widens with speed, leans into turns
  tp(pl.pos,pl.x,_o);const fx=Math.sin(_o.ang),fz=Math.cos(_o.ang);
  const sp=clamp((pl.speed||0)/BASE,0,2);
  const cm=S?camMode:0;
  let back=10.2+sp*1.4,height=3.25+sp*0.3,ahead=15,lookY=1.25;
  if(cm===1){back=6.8+sp*0.8;height=2.2+sp*0.15;ahead=12;lookY=1.1;}
  else if(cm===2){back=-0.6;height=1.95;ahead=20;lookY=1.6;}
  else if(cm===3){back=-9.5;height=1.5;ahead=-1;lookY=0.9;}
  _v.set(_o.x-fx*back,_o.y+height,_o.z-fz*back);
  const k=G.camInit?1-Math.exp(-dt*(cm===2?20:7)):1;G.camInit=true;
  G.camera.position.lerp(_v,k);
  const minY=tp(Math.max(0,pl.pos-back/SC),pl.x,_o2).y+(cm>=2?0.8:1.4);if(G.camera.position.y<minY)G.camera.position.y=minY;
  _v2.set(_o.x+fx*ahead,_o.y+lookY,_o.z+fz*ahead);G.lookAt.lerp(_v2,G.lookAt.lengthSq()?k:1);G.camera.lookAt(G.lookAt);
  const seg=segAt(pl.pos);G.roll+=((stv*0.6+seg.curve*0.12*Math.min(1,sp))*0.03-G.roll)*Math.min(1,dt*4);G.camera.rotateZ(G.roll);
  if(pl.shake>0&&!reduce){G.camera.position.x+=(Math.random()-0.5)*0.5;G.camera.position.y+=(Math.random()-0.5)*0.3;}
  if(pl.boosting&&!reduce){G.camera.position.x+=(Math.random()-0.5)*0.06;G.camera.position.y+=(Math.random()-0.5)*0.05;}
  const fov=60+sp*13+(pl.boosting?9:0);G.camera.fov+=(fov-G.camera.fov)*Math.min(1,dt*4);G.camera.updateProjectionMatrix();
  // sun follows the player so the shadows stay sharp around the cars
  G.sun.position.set(_o.x+46,_o.y+82,_o.z+30);G.sun.target.position.set(_o.x+fx*8,_o.y,_o.z+fz*8);
  G.head.position.set(_o.x+fx*3.5,_o.y+1.4,_o.z+fz*3.5);G.head.target.position.set(_o.x+fx*40,_o.y,_o.z+fz*40);
  G.sky.position.copy(G.camera.position);G.stars.position.copy(G.camera.position);
  G.clouds.position.set(G.camera.position.x,0,G.camera.position.z);
  const sd=G.skyMat.uniforms.sunDir.value.copy(G.sun.position).sub(G.sun.target.position).normalize();
  G.moonDisc.position.set(G.camera.position.x+sd.x*1800,G.camera.position.y+sd.y*1800,G.camera.position.z+sd.z*1800);G.moonDisc.lookAt(G.camera.position);
  G.speedFx=sp;if(G.composer)G.composer.render();else G.renderer.render(G.scene,G.camera);
}
function project(p,cx,cy,cz){p.camera.x=-cx;p.camera.y=p.world.y-cy;p.camera.z=p.world.z-cz;p.screen.scale=camDepth/p.camera.z;p.screen.x=Math.round(W/2+p.screen.scale*p.camera.x*W/2);p.screen.y=Math.round(H/2-p.screen.scale*p.camera.y*H/2);p.screen.w=Math.round(p.screen.scale*ROADW*W/2);}
function poly(c,x1,y1,x2,y2,x3,y3,x4,y4,col){c.fillStyle=col;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.lineTo(x3,y3);c.lineTo(x4,y4);c.closePath();c.fill();}
function drawSegment(c,s,fog){
  const a=s.p1.screen,b=s.p2.screen,col=s.color,r1=a.w/6,r2=b.w/6,l1=a.w/32,l2=b.w/32;
  c.fillStyle=col.grass;c.fillRect(0,b.y,W,a.y-b.y);
  poly(c,a.x-a.w-r1,a.y,a.x-a.w,a.y,b.x-b.w,b.y,b.x-b.w-r2,b.y,col.rumble);poly(c,a.x+a.w+r1,a.y,a.x+a.w,a.y,b.x+b.w,b.y,b.x+b.w+r2,b.y,col.rumble);
  if(col.check){for(let i=0;i<8;i++)poly(c,lerp(a.x-a.w,a.x+a.w,i/8),a.y,lerp(a.x-a.w,a.x+a.w,(i+1)/8),a.y,lerp(b.x-b.w,b.x+b.w,(i+1)/8),b.y,lerp(b.x-b.w,b.x+b.w,i/8),b.y,(i+s.index)%2?COL.ink:COL.night);}
  else poly(c,a.x-a.w,a.y,a.x+a.w,a.y,b.x+b.w,b.y,b.x-b.w,b.y,col.road);
  if(col.lane){const lw1=a.w*2/LANES,lw2=b.w*2/LANES;let lx1=a.x-a.w+lw1,lx2=b.x-b.w+lw2;for(let l=1;l<LANES;l++,lx1+=lw1,lx2+=lw2)poly(c,lx1-l1/2,a.y,lx1+l1/2,a.y,lx2+l2/2,b.y,lx2-l2/2,b.y,col.lane);}
  if(fog>0.01){c.fillStyle=`rgba(26,16,48,${fog})`;c.fillRect(0,b.y,W,a.y-b.y);}
}
let tClock=0;
function drawSky(c,skyOff){
  const g=c.createLinearGradient(0,0,0,H*0.55);g.addColorStop(0,'#07061a');g.addColorStop(0.7,'#1f1240');g.addColorStop(1,'#4a1f3a');c.fillStyle=g;c.fillRect(0,0,W,H);
  c.fillStyle='#e9e2ff';sky.stars.forEach(([x,y,s])=>{c.globalAlpha=0.35+0.4*Math.sin(x+tClock*1.3)**2;c.fillRect(((x-skyOff*0.2)%W+W)%W,y*H,s,s);});c.globalAlpha=1;
  const hz=H*0.5+6,off=((skyOff*0.6)%2400+2400)%2400;
  for(const b of sky.city){let x=b.x-off;if(x<-120)x+=2400;if(x>W)continue;c.fillStyle='#120d26';c.fillRect(x,hz-b.h,b.w,b.h);c.fillStyle=rgba(COL.gas,0.5);
    for(let yy=hz-b.h+5;yy<hz-4;yy+=8)for(let xx=x+4;xx<x+b.w-4;xx+=8){if(((b.win+yy*7+xx*13)|0)%7<2)c.fillRect(xx,yy,2,3);}}
  const gl=c.createLinearGradient(0,hz-30,0,hz);gl.addColorStop(0,'rgba(255,122,47,0)');gl.addColorStop(1,'rgba(255,122,47,0.22)');c.fillStyle=gl;c.fillRect(0,hz-30,W,30);
}
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function drawCar(c,x,y,w,o){
  if(w<3)return;const h=w*0.48;
  c.fillStyle='rgba(0,0,0,0.35)';c.beginPath();c.ellipse(x,y,w*0.56,h*0.12,0,0,7);c.fill();
  if(o.moon&&!reduce)for(let k=0;k<3;k++){const fl=h*(0.35+Math.random()*0.5),bx=x-w*0.22+k*w*0.22;c.fillStyle=k%2?COL.gas:COL.hot;c.beginPath();c.moveTo(bx-w*0.06,y-h*0.12);c.lineTo(bx,y+fl*0.6);c.lineTo(bx+w*0.06,y-h*0.12);c.fill();}
  c.fillStyle='#0a0914';c.fillRect(x-w*0.47,y-h*0.22,w*0.17,h*0.22);c.fillRect(x+w*0.3,y-h*0.22,w*0.17,h*0.22);
  const body=o.rug?'#5d5a6b':o.color;
  c.fillStyle=body;rr(c,x-w/2,y-h*0.66,w,h*0.5,h*0.12);c.fill();
  c.beginPath();c.moveTo(x-w*0.34,y-h*0.64);c.lineTo(x-w*0.25,y-h);c.lineTo(x+w*0.25,y-h);c.lineTo(x+w*0.34,y-h*0.64);c.fill();
  c.fillStyle='rgba(10,8,24,0.75)';c.beginPath();c.moveTo(x-w*0.29,y-h*0.67);c.lineTo(x-w*0.22,y-h*0.95);c.lineTo(x+w*0.22,y-h*0.95);c.lineTo(x+w*0.29,y-h*0.67);c.fill();
  c.fillStyle=o.brake?'#ff2a2a':'#c41f2b';c.fillRect(x-w*0.46,y-h*0.6,w*0.2,h*0.12);c.fillRect(x+w*0.26,y-h*0.6,w*0.2,h*0.12);
  if(o.brake){c.fillStyle='rgba(255,42,42,0.25)';c.fillRect(x-w*0.5,y-h*0.66,w,h*0.24);}
  c.fillStyle='rgba(0,0,0,0.35)';c.fillRect(x-w*0.5,y-h*0.3,w,h*0.07);
  if(o.boost&&!reduce){c.fillStyle=Math.random()<0.5?'#7ad7ff':'#ffffff';[-1,1].forEach(sd=>{c.beginPath();c.moveTo(x+sd*w*0.14,y-h*0.2);c.lineTo(x+sd*w*0.1,y+h*(0.3+Math.random()*0.35));c.lineTo(x+sd*w*0.06,y-h*0.2);c.fill();});}
  if(o.rug&&!reduce){c.fillStyle='rgba(180,175,200,0.3)';for(let k=0;k<3;k++){const t=(tClock*0.8+k/3)%1;c.beginPath();c.arc(x+Math.sin(k*2+tClock)*w*0.15,y-h-t*h*1.4,w*(0.08+t*0.12),0,7);c.fill();}}
  if(o.label&&w>24){
    const fs=clamp(w*0.12,10,19),lf=(o.mono?'600 ':'')+(o.mono?fs*0.95:fs)+'px '+(o.mono?F_MONO:F_RACE),sf=`600 ${fs*0.82}px ${F_MONO}`;
    c.font=lf;const tw=c.measureText(o.label).width;c.font=sf;const sw=c.measureText(o.sub||'').width;
    const pw=tw+sw+fs*1.3,py=y-h-fs*1.9;
    c.fillStyle=o.human?rgba(o.color,0.92):'rgba(13,11,31,0.84)';rr(c,x-pw/2,py,pw,fs*1.45,fs*0.3);c.fill();
    c.font=lf;c.fillStyle=o.human?COL.night:o.color;c.textAlign='left';c.fillText(o.label,x-pw/2+fs*0.4,py+fs*1.05);
    c.font=sf;c.fillStyle=o.human?COL.night:o.subCol;c.fillText(o.sub||'',x-pw/2+fs*0.85+tw,py+fs*1.03);
  }
}
function drawItem(c,it,x,y,sc){
  const u=sc*W/2;
  if(it.type==='palm'){const th=1700*u,tw=60*u;if(th<4)return;
    c.strokeStyle='#3a2a1e';c.lineWidth=Math.max(1,tw);c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x+th*0.12,y-th*0.5,x+th*0.05,y-th);c.stroke();
    c.strokeStyle='#1f4a33';c.lineWidth=Math.max(1,tw*0.9);
    for(let k=0;k<6;k++){const a=-Math.PI/2+(k-2.5)*0.55;c.beginPath();c.moveTo(x+th*0.05,y-th);c.quadraticCurveTo(x+th*0.05+Math.cos(a)*th*0.25,y-th+Math.sin(a)*th*0.15-th*0.05,x+th*0.05+Math.cos(a)*th*0.42,y-th+Math.sin(a)*th*0.08+th*0.14);c.stroke();}}
  else if(it.type==='lamp'){const lh=1500*u;if(lh<5)return;const d=it.off<0?1:-1;
    c.strokeStyle='#4a4560';c.lineWidth=Math.max(1,30*u);c.beginPath();c.moveTo(x,y);c.lineTo(x,y-lh);c.lineTo(x+d*lh*0.2,y-lh);c.stroke();
    c.fillStyle='rgba(255,180,90,0.9)';c.beginPath();c.arc(x+d*lh*0.2,y-lh+90*u,Math.max(1.5,40*u),0,7);c.fill();
    c.fillStyle='rgba(255,170,80,0.07)';c.beginPath();c.moveTo(x+d*lh*0.2,y-lh);c.lineTo(x+d*lh*0.2-lh*0.35,y);c.lineTo(x+d*lh*0.2+lh*0.35,y);c.fill();}
  else if(it.type==='can'){if(it.taken||!S)return;const cw=170*u,ch=230*u;if(cw<2)return;
    c.fillStyle=COL.gas;rr(c,x-cw/2,y-ch,cw,ch,cw*0.15);c.fill();c.fillStyle=COL.night;c.fillRect(x-cw*0.15,y-ch*1.12,cw*0.3,ch*0.14);
    if(cw>18){c.font=`${cw*(S.w.mode==='fun'?0.3:0.24)}px ${F_RACE}`;c.textAlign='center';c.fillText(S.w.mode==='fun'?'GAS':'$10',x,y-ch*0.4);c.textAlign='left';}}
  else if(it.type==='gate'&&S&&S.w.mode==='fun'){
    const coins=it.coins||gatePicks(it);const gw=ROADW*1.15*u,top=y-1900*u,bh=520*u;if(gw<6)return;
    c.fillStyle='#24203f';c.fillRect(x-gw-30*u,top,60*u,y-top);c.fillRect(x+gw-30*u,top,60*u,y-top);c.fillStyle='#120f26';c.fillRect(x-gw,top,gw*2,bh);
    const pw=(gw*2)/3;
    coins.forEach((k,i)=>{const cn=S.w.coins[k],px=x-gw+i*pw;c.fillStyle=rgba(cn.color,0.85);c.fillRect(px+40*u,top+30*u,pw-80*u,bh-60*u);
      if(pw>40){const fs=Math.min(bh*0.36,pw*0.16);c.textAlign='center';c.font=`${fs}px ${F_RACE}`;c.fillStyle=COL.night;c.fillText(k,px+pw/2,top+bh*0.45);
        c.font=`600 ${fs*0.8}px ${F_MONO}`;c.fillText(cn.rugged?'RUGGED':fmtM(cn.m)+(cn.mom>=0?' ▲':' ▼'),px+pw/2,top+bh*0.82);c.textAlign='left';}});
    if(gw>60){c.font=`${Math.min(18,gw*0.04)}px ${F_RACE}`;c.fillStyle=COL.gas;c.textAlign='center';c.fillText('OFFLINE SWAP',x,top-6);c.textAlign='left';}
  }
}
function renderView(pl,others){
  const c=ctx;c.save();
  if(pl.shake>0&&!reduce)c.translate((Math.random()-0.5)*8,(Math.random()-0.5)*5);
  const camZ=pl.pos-playerZ,base=segAt(camZ),bp=(camZ%SEG)/SEG,ps=segAt(pl.pos),pp=(pl.pos%SEG)/SEG,plY=lerp(ps.p1.world.y,ps.p2.world.y,pp);
  drawSky(c,pl.skyOff);
  let maxy=H,x=0,dx=-(base.curve*bp);const camX=pl.x*ROADW,camY=plY+CAMH,drawn=[];
  for(let n=0;n<DRAW;n++){const idx=base.index+n;if(idx>=segments.length)break;const s=segments[idx];s.clip=maxy;
    project(s.p1,camX-x,camY,camZ);project(s.p2,camX-x-dx,camY,camZ);x+=dx;dx+=s.curve;drawn.push(s);
    if(s.p1.camera.z<=camDepth||s.p2.screen.y>=s.p1.screen.y||s.p2.screen.y>=maxy)continue;
    drawSegment(c,s,Math.min(0.85,Math.pow(n/DRAW,2)*1.4));maxy=s.p1.screen.y;}
  for(const s of drawn)s.cars.length=0;
  for(const r of others){const i=Math.floor(r.pos/SEG)-base.index;if(i>=0&&i<drawn.length)drawn[i].cars.push(r);}
  for(let i=drawn.length-1;i>0;i--){const s=drawn[i];if(s.p1.camera.z<=camDepth)continue;
    c.save();c.beginPath();c.rect(0,0,W,s.clip);c.clip();
    for(const it of s.items){const sc=s.p1.screen.scale;drawItem(c,it,s.p1.screen.x+sc*it.off*ROADW*W/2,s.p1.screen.y,sc);}
    for(const r of s.cars){const p=(r.pos%SEG)/SEG,sc=lerp(s.p1.screen.scale,s.p2.screen.scale,p);
      drawCar(c,lerp(s.p1.screen.x,s.p2.screen.x,p)+sc*r.x*ROADW*W/2,lerp(s.p1.screen.y,s.p2.screen.y,p),sc*CARW*W/2,r.d||{color:r.color});}
    c.restore();}
  const py=H/2-(camDepth/playerZ)*lerp(ps.p1.camera.y,ps.p2.camera.y,pp)*H/2;
  drawCar(c,W/2+(pl.inp.left?-4:pl.inp.right?4:0),py-4,(camDepth/playerZ)*CARW*W/2,{color:pl.color,brake:pl.inp.brake,boost:pl.boosting&&!pl.finished});
  c.restore();
}
function drawSpeedFx(c,sp,boost){
  const cx=W/2,cy=H*0.52,R=Math.hypot(W,H)/2;
  const vg=c.createRadialGradient(cx,cy,R*0.45,cx,cy,R*1.05);vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,0,0.32)');c.fillStyle=vg;c.fillRect(0,0,W,H);
  const a=clamp((sp-0.7)*0.55+(boost?0.18:0),0,0.55);if(a<=0.01)return;
  c.strokeStyle=`rgba(255,255,255,${a})`;c.lineWidth=1.6;c.beginPath();
  for(let i=0;i<34;i++){const ang=Math.random()*Math.PI*2,r1=R*(0.55+Math.random()*0.25),r2=r1+R*(0.12+Math.random()*0.3*sp);c.moveTo(cx+Math.cos(ang)*r1,cy+Math.sin(ang)*r1*0.62);c.lineTo(cx+Math.cos(ang)*r2,cy+Math.sin(ang)*r2*0.62);}
  c.stroke();
}
function ordinal(n){const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);}
function fmtRaceTime(t){t=Math.max(0,t);const m=Math.floor(t/60),s=t-m*60;return m+':'+(s<10?'0':'')+s.toFixed(2);}
function drawGauge(c,cx,cy,r,speed,boost){
  const kmh=Math.round(speed/BASE*190),MAX=320,a0=Math.PI*0.75,a1=Math.PI*2.25,ang=v=>a0+(a1-a0)*clamp(v/MAX,0,1);
  c.save();
  c.fillStyle='rgba(13,11,31,0.42)';c.beginPath();c.arc(cx,cy,r+12,0,7);c.fill();
  c.lineCap='round';c.lineWidth=6;c.strokeStyle='rgba(255,255,255,0.18)';c.beginPath();c.arc(cx,cy,r,a0,a1);c.stroke();
  const gr=c.createLinearGradient(cx-r,cy,cx+r,cy);gr.addColorStop(0,boost?'#7ad7ff':'#ffd23f');gr.addColorStop(1,boost?'#c08bff':'#ff7a2f');
  c.strokeStyle=gr;c.beginPath();c.arc(cx,cy,r,a0,ang(kmh));c.stroke();
  c.lineCap='butt';c.font=`600 10px ${F_MONO}`;c.fillStyle='rgba(241,237,255,0.75)';c.textAlign='center';c.textBaseline='middle';
  for(let v=0;v<=MAX;v+=40){const a=ang(v),ci=Math.cos(a),si=Math.sin(a);c.strokeStyle='rgba(241,237,255,0.7)';c.lineWidth=v%80===0?2:1;
    c.beginPath();c.moveTo(cx+ci*(r-9),cy+si*(r-9));c.lineTo(cx+ci*(r-3),cy+si*(r-3));c.stroke();if(v%80===0)c.fillText(v,cx+ci*(r-20),cy+si*(r-20));}
  const a=ang(kmh);c.strokeStyle='#ff4f4f';c.lineWidth=3;c.beginPath();c.moveTo(cx-Math.cos(a)*8,cy-Math.sin(a)*8);c.lineTo(cx+Math.cos(a)*(r-10),cy+Math.sin(a)*(r-10));c.stroke();
  c.fillStyle='#ff4f4f';c.beginPath();c.arc(cx,cy,5,0,7);c.fill();
  c.fillStyle=COL.ink;c.font=`30px ${F_RACE}`;c.fillText(kmh,cx,cy+r*0.52);c.font=`600 10px ${F_MONO}`;c.fillStyle=COL.dim;c.fillText('KM/H',cx,cy+r*0.52+20);
  c.restore();c.textBaseline='alphabetic';
}
function drawHUD(pl,list){
  if(G&&!reduce)drawSpeedFx(ctx,G.speedFx||0,pl.boosting);
  const c=ctx,fun=S.w.mode==='fun',place=placeOf(pl,list);
  const shadow=on=>{c.shadowColor=on?'rgba(0,0,0,0.55)':'transparent';c.shadowBlur=on?8:0;c.shadowOffsetY=on?2:0;};
  // progress, top left
  const prog=clamp(pl.pos/(FIN*SEG),0,1);
  shadow(true);c.textAlign='left';c.font=`600 11px ${F_MONO}`;c.fillStyle=COL.gas;c.fillText('PROGRESS',20,26);
  c.font=`40px ${F_RACE}`;c.fillStyle=COL.ink;c.fillText(Math.round(prog*100)+' %',18,64);shadow(false);
  c.fillStyle='rgba(13,11,31,0.55)';c.fillRect(20,72,170,4);c.fillStyle=COL.gas;c.fillRect(20,72,170*prog,4);
  for(const r of S.remotes){c.fillStyle=r.color;c.fillRect(20+170*clamp(r.pos/(FIN*SEG),0,1)-1,68,3,12);}
  // mini standings: top 3, you and friends
  const rows=list.filter((r,i)=>i<3||r.me||r.remote).slice(0,7);
  c.fillStyle='rgba(13,11,31,0.58)';rr(c,16,86,236,rows.length*21+10,8);c.fill();
  rows.forEach((r,j)=>{const y=104+j*21,d=r.d||disp(r),i=list.indexOf(r);
    c.font=`600 12px ${F_MONO}`;c.fillStyle=COL.dim;c.textAlign='left';c.fillText(ordinal(i+1),22,y);
    c.fillStyle=r.color;c.fillRect(54,y-9,8,8);
    c.fillStyle=r.me?COL.gas:r.remote?COL.moon:COL.ink;c.font=(r.me||r.remote)?`13px ${F_RACE}`:`600 12px ${F_MONO}`;
    c.fillText((r.me?'YOU':d.name||d.label).slice(0,12),68,y);
    c.textAlign='right';c.font=`600 11px ${F_MONO}`;c.fillStyle=(r.me||r.remote)?COL.gas:d.subCol;c.fillText(r.finished?'FIN':String(d.sub).slice(0,9),244,y);c.textAlign='left';});
  // position and race time, top right (left of the exit button)
  const xr=W-76,t=pl.finished?pl.ft:Math.max(0,S.w.wt);
  shadow(true);c.textAlign='right';c.font=`600 11px ${F_MONO}`;c.fillStyle=COL.gas;c.fillText('POS',xr,26);
  c.font=`40px ${F_RACE}`;c.fillStyle=COL.ink;c.fillText(`${place}/${list.length}`,xr,64);
  c.font=`600 15px ${F_MONO}`;c.fillStyle=COL.ink;c.fillText(fmtRaceTime(t),xr,86);shadow(false);
  // nitro (fun) or boost cash (token), top centre, with the radar under it
  const nv=fun?pl.gas/100:clamp((pl.cash||0)/Math.max(1,(pl.buy||25)*0.5),0,1),nx=W/2-160,ny=14,segs=14,sw=320/segs;
  c.font=`13px ${F_RACE}`;c.textAlign='right';c.fillStyle=pl.boosting?'#7ad7ff':COL.gas;c.fillText(fun?'N2O':'BUY',nx-8,ny+12);
  for(let i=0;i<segs;i++){const on=i<Math.round(nv*segs);c.fillStyle=on?(pl.boosting?'#7ad7ff':i>segs*0.7?'#ff7a2f':COL.gas):'rgba(13,11,31,0.5)';c.beginPath();c.moveTo(nx+i*sw+4,ny);c.lineTo(nx+(i+1)*sw,ny);c.lineTo(nx+(i+1)*sw-4,ny+14);c.lineTo(nx+i*sw,ny+14);c.closePath();c.fill();}
  const rx=W/2-150,rw=300,ry=42;c.fillStyle='rgba(13,11,31,0.45)';rr(c,rx-8,ry-6,rw+16,22,6);c.fill();
  c.strokeStyle='rgba(241,237,255,0.25)';c.beginPath();c.moveTo(rx,ry+5);c.lineTo(rx+rw,ry+5);c.stroke();
  const R=SEG*70;
  for(const r of list){if(r===pl)continue;const g=r.pos-pl.pos;if(Math.abs(g)>R)continue;const xx=rx+rw/2+g/R*rw/2;
    c.fillStyle=r.color;c.beginPath();c.arc(xx,ry+5,r.remote?5:3.5,0,7);c.fill();if(r.remote){c.strokeStyle=COL.ink;c.lineWidth=1.5;c.stroke();c.lineWidth=1;}}
  c.fillStyle=COL.gas;c.fillRect(rx+rw/2-2,ry-3,4,16);
  // your bag
  const pw=300,bx=W-pw-16,by=100,ph=74;c.textAlign='left';c.fillStyle='rgba(13,11,31,0.66)';rr(c,bx,by,pw,ph,8);c.fill();
  const eg=fun?engine(pl):priceFactor()*engine(pl);
  if(fun){const cn=S.w.coins[pl.coin];c.fillStyle=cn.color;c.fillRect(bx,by,5,ph);c.font=`18px ${F_RACE}`;c.fillText(pl.coin,bx+14,by+24);const cw=c.measureText(pl.coin).width;
    c.font=`600 13px ${F_MONO}`;c.fillStyle=cn.rugged?COL.dim:cn.m>=50?COL.moon:cn.mom>=0?COL.up:COL.down;c.fillText(cn.rugged?'RUGGED':fmtM(cn.m),bx+22+cw,by+23);
    c.fillStyle=COL.ink;c.font=`600 15px ${F_MONO}`;c.fillText(fmtUsd(myValue(pl)),bx+14,by+46);
  } else {const mk=S.w.mk,ch=(mk.P/mk.p0-1)*100,tl=tokLabel();c.fillStyle=TOK[S.tok]?TOK[S.tok].color:COL.gas;c.fillRect(bx,by,5,ph);
    c.font=`18px ${F_RACE}`;c.fillText(tl,bx+14,by+24);const cw=c.measureText(tl).width;
    c.font=`600 13px ${F_MONO}`;c.fillStyle=COL.ink;const pt=fmtPrice(mk.P);c.fillText(pt,bx+22+cw,by+23);const ptw=c.measureText(pt).width;
    c.fillStyle=ch>=0?COL.up:COL.down;c.fillText(`${ch>=0?'+':''}${ch.toFixed(1)}%`,bx+30+cw+ptw,by+23);
    c.fillStyle=COL.ink;c.font=`600 12px ${F_MONO}`;c.fillText(`${fmtAmt(pl.amt)} ${tl.replace('$','')} · ${fmtUsd(myValue(pl))} · cash ${fmtUsd(pl.cash)}`,bx+14,by+45);}
  c.font=`600 11px ${F_MONO}`;c.fillStyle=eg>=1?COL.up:COL.down;c.fillText(`${fun?'ENGINE':'SPEED'} ${(eg*100).toFixed(0)}%`,bx+14,by+64);
  if(pl.realX){c.fillStyle=COL.moon;c.textAlign='right';c.fillText(`YOUR WALLET ${fmtX(pl.realX)}`,bx+pw-10,by+64);c.textAlign='left';}
  // speedometer, right side above the pedals
  drawGauge(c,W-112,H-238,58,pl.speed,pl.boosting);
  if(fun){const ng=GATES.find(g=>g.n*SEG>pl.pos);if(ng){const d=(ng.n*SEG-pl.pos)/SEG;if(d<70){shadow(true);c.textAlign='center';c.font=`16px ${F_RACE}`;c.fillStyle=COL.gas;c.fillText(`SWAP GATE ${Math.round(d*4)}m · pick a lane`,W/2,84);shadow(false);}}}
  c.textAlign='center';shadow(true);pl.toasts.forEach((tt,i)=>{c.globalAlpha=Math.min(1,tt.t*2);c.font=`26px ${F_RACE}`;c.fillStyle=tt.color;c.fillText(tt.txt,W/2,H*0.36+i*32);});c.globalAlpha=1;
  const left=(S.go-Date.now())/1000;
  if(left>0){c.font=`120px ${F_RACE}`;c.fillStyle=COL.gas;c.fillText(Math.ceil(left),W/2,H*0.56);c.font=`18px ${F_RACE}`;c.fillStyle=COL.ink;c.fillText(S.remotes.length?`${S.remotes.length+1} RACERS ON THE GRID`:'GET READY',W/2,H*0.64);}
  else if(left>-0.9){c.font=`110px ${F_RACE}`;c.fillStyle=COL.up;c.globalAlpha=1+left;c.fillText('GO',W/2,H*0.56);c.globalAlpha=1;}
  shadow(false);c.textAlign='left';
}

/* ================= DOM panels ================= */
function renderBoard(list){
  if(!S){$('#board').innerHTML='<li style="color:var(--dim);display:block">Start a race to see the standings.</li>';return;}
  $('#board').innerHTML=list.map((r,i)=>{
    let nm,tag;
    if(r.me||r.remote){nm=`<span class="nm h">${esc(r.me?r.name+' (you)':r.name)}</span>`;tag=`<span class="tagc c-gas">${fmtUsd(r.me?myValue(r):r.value)}</span>`;}
    else{const d=r.d||disp(r);nm=`<span class="nm${S.w.mode==='fun'?' h':''}">${esc(d.name||d.label)}</span>`;
      const cls=d.rug?'c-dim':d.moon?'c-moon':d.subCol===COL.up?'c-up':d.subCol===COL.down?'c-down':S.w.mode==='fun'?'c-up':'c-dim';
      tag=`<span class="tagc ${cls}">${esc(r.finished?'FIN':d.sub)}</span>`;}
    return `<li class="${r.me?'me':r.remote?'friend':''}"><span class="pl">${i+1}</span><span class="dot" style="background:${r.color}"></span>${nm}${tag}</li>`;}).join('');
  $('#lapInfo').textContent=`${Math.round(clamp(S.me.pos/(FIN*SEG),0,1)*100)}%`;
  if(S.w.mode!=='fun'){const mk=S.w.mk,ch=(mk.P/mk.p0-1)*100;$('#priceInfo').innerHTML=`<span style="color:${ch>=0?COL.up:COL.down}">${esc(tokLabel())} ${fmtPrice(mk.P)} ${ch>=0?'+':''}${ch.toFixed(1)}%</span>`;}else $('#priceInfo').textContent='';
}
function renderFeed(){if(!S)return;$('#feed').innerHTML=S.w.feed.slice(0,30).map(t=>`<li>${t}</li>`).join('')||'<li>Quiet so far.</li>';S.feedDirty=false;}
function showEnd(){
  const list=ranked();
  const humans=list.filter(r=>r.me||r.remote);
  const p=placeOf(S.me,list);
  $('#endH').textContent=p===1?'P1. You won the race.':`You finished P${p} of ${list.length}`;
  const v=myValue(S.me),start=S.me.start||100;
  let sub=`Your bag: ${fmtUsd(v)} (${v>=start?'+':''}${((v/start-1)*100).toFixed(0)}%).`;
  if(humans.length>1){const ahead=humans.filter(h=>h!==S.me&&placeOf(h,list)<p).length;sub+=ahead?` ${ahead} friend${ahead>1?'s':''} beat you.`:' You beat every friend in the race.';}
  if(S.w.mode==='fun'&&S.me.swaps)sub+=` ${S.me.swaps} offline swap${S.me.swaps>1?'s':''} settled at the line.`;
  if(!S.credited){S.credited=true;const prize=Math.max(0,(list.length+1-p))*0.5;if(window.PRWallet)window.PRWallet.creditRace((v-start)*0.1+prize,p);}
  sub+=' Winnings go to your demo wallet in USDT.';
  $('#endSub').textContent=sub;
  $('#resTbl').innerHTML='<tr><th>Pos</th><th>Racer</th><th>Result</th><th>Bag / holding</th></tr>'+list.map((r,i)=>{
    const d=r.d||disp(r),human=r.me||r.remote;
    return `<tr class="${r.me?'me':r.remote?'friend':''}"><td>${i+1}</td><td class="${human?'':'a'}">${esc(human?r.name+(r.me?' (you)':''):(d.name||d.label))}</td><td>${r.finished?(r.ft-Math.max(0,0)).toFixed(1)+'s':'racing'}</td><td>${human?fmtUsd(r.me?myValue(r):r.value):esc(d.sub)}</td></tr>`;}).join('');
  const canRestart=!nr||isHost;
  $('#bAgain').hidden=!canRestart;$('#endWait').hidden=canRestart;$('#bLobby').textContent=nr?'Back to lobby':'Change race';
  $('#endOv').hidden=false;$('#pads').hidden=true;document.body.classList.remove('racing');
}

/* ================= multiplayer: room & lobby ================= */
let room=null,nr=null,code=null,isHost=false,lastGo=0,state='home',hostGo=null,peersUnsub=null;
const WORDS=['jollof','trotro','kenkey','azonto','waakye','kelewele','banku','shito','fufu','sobolo'];
function setNetStatus(t,ok){$('#netStatus').textContent=t;$('#bCreate').disabled=!ok;$('#bJoin').disabled=!ok;}
(window.claude&&window.claude.use?window.claude.use('room'):window.RallyNet?window.RallyNet():Promise.resolve(null)).then(r=>{room=r;
  if(room)setNetStatus('Get a code to share with a friend.',true);
  else setNetStatus('Racing with friends isn’t available right now. Solo still works.',false);
}).catch(()=>setNetStatus('Racing with friends isn’t available right now. Solo still works.',false));

function readNick(){const n=$('#nick').value.trim().replace(/\s+/g,' ').slice(0,16);me.nick=n||'Racer';try{localStorage.setItem('pumprally-nick',me.nick);}catch(e){}return me.nick;}
function homeErr(t){const e=$('#homeErr');e.textContent=t||'';e.hidden=!t;}
async function enterRoom(c,host){
  homeErr('');readNick();
  try{nr=await room.join(c);}catch(e){homeErr(e&&e.code==='not_permitted'?'You can’t join races from here.':'Couldn’t join that race. Check the code and try again.');return;}
  code=c;isHost=host;hostGo=null;
  if(peersUnsub)peersUnsub();
  knownPeers=new Map();
  peersUnsub=nr.onPeers(()=>{peerDiff();if(state==='lobby')renderLobby();checkHostGo();},()=>{});
  lobbyPresence();showLobby();
}
function lobbyPresence(){
  if(!nr)return;
  nr.presence({n:me.nick,c:me.color,b:menuBuy,st:'lobby',host:isHost?1:0,mode:isHost?menuMode:null,tok:isHost?(menuMode==='real'?menuReal:menuTok):null,go:isHost?hostGo:null,p:null,x:null,s:null,f:null,ft:null,v:null,g:null,k:null}).catch(()=>{});
}
let knownPeers=new Map(),toastTimer=0;
function peerDiff(){
  if(!nr)return;const now=new Map();
  nr.peers().forEach(p=>{if(!p.sameTab&&p.presence&&p.presence.n)now.set(p.peer,String(p.presence.n).slice(0,16));});
  now.forEach((n,k)=>{if(!knownPeers.has(k))joinAlert(n,true);});
  knownPeers.forEach((n,k)=>{if(!now.has(k))joinAlert(n,false);});
  knownPeers=now;
}
function joinAlert(name,joined){
  const t=joined?`${name} joined the race`:`${name} left`;
  if(S&&state==='race')S.me.toasts.push({txt:(joined?name+' JOINED':name+' LEFT').toUpperCase(),color:joined?COL.up:COL.down,t:2.6});
  const el=$('#joinToast');el.textContent=t;el.classList.toggle('left',!joined);el.hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true;},4000);
}
function hostPeer(){if(!nr)return null;return nr.peers().filter(p=>p.presence&&p.presence.host===1).sort((a,b)=>a.peer<b.peer?-1:1)[0]||null;}
function checkHostGo(){
  if(isHost||!nr)return;
  const hp=hostPeer();if(!hp)return;const q=hp.presence;
  if(q.mode==='real'&&REAL_RE.test(String(q.tok))&&!REAL[q.tok]&&!LOADING.has(q.tok)){loadReal(q.tok).then(()=>{if(state==='lobby')renderLobby();});}
  if(state==='lobby')renderLobby();
  if(typeof q.go==='number'&&q.go!==lastGo&&Date.now()-q.go<180000&&(((q.mode==='fun'||q.mode==='token')&&TOK[q.tok])||(q.mode==='real'&&REAL_RE.test(String(q.tok))))){
    if(state==='race'&&S&&!S.me.finished)return;
    startRace(q.mode,q.tok,q.go,`${code}|${q.go}|${q.mode}|${q.tok}`);
  }
}
function showLobby(){
  state='lobby';S=null;
  ['homeOv','endOv','launchOv'].forEach(id=>$('#'+id).hidden=true);$('#lobbyOv').hidden=false;$('#pads').hidden=true;document.body.classList.remove('racing');
  if(!immersive()){$('#lobbyOv').hidden=true;$('#launchOv').hidden=false;}
  $('#codeTxt').textContent=nr?code:'Solo';$('#lobbyLbl').textContent=nr?'Race code':'Mode';
  $('#bCopy').hidden=!nr;$('#lobbyHint').hidden=!nr;
  renderLobby();
}
function renderBuy(){
  const chips=BUYS.map(v=>`<button data-b="${v}" aria-pressed="${menuBuy===v}">$${v}</button>`).join('');
  const custom=BUYS.includes(menuBuy)?'':String(menuBuy);
  if(!$('#buyRow').dataset.built){$('#buyRow').innerHTML=chips+`<input type="text" id="buyCustom" inputmode="decimal" placeholder="Other $" aria-label="Other amount in dollars">`;$('#buyRow').dataset.built='1';
    $('#buyRow').addEventListener('click',e=>{const b=e.target.closest('button[data-b]');if(!b)return;setBuy(+b.dataset.b);$('#buyCustom').value='';});
    $('#buyCustom').addEventListener('input',e=>{const v=parseFloat(e.target.value.replace(/[^0-9.]/g,''));if(v>=1&&v<=100000)setBuy(Math.round(v*100)/100,true);});}
  $('#buyRow').querySelectorAll('button[data-b]').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.b===menuBuy));
  if(custom&&document.activeElement!==$('#buyCustom'))$('#buyCustom').value=custom;
  const hp=!isHost&&nr?hostPeer():null,mode=hp?hp.presence.mode:menuMode,tok=hp?hp.presence.tok:(menuMode==='real'?menuReal:menuTok);
  const rd=mode==='real'?REAL[tok]:null,symTxt=rd&&rd.symbol?'$'+rd.symbol:tok;
  $('#buyNote').textContent=mode==='fun'?`You start with ${fmtUsd(menuBuy)} of ${tok||'SOL'} to race and swap at the gates. Play money.`
    :`You buy ${fmtUsd(menuBuy)} of ${tok||'SOL'} at the start, plus ${fmtUsd(menuBuy/2)} of cash to buy more mid-race for boosts. Play money.`;
  const rb=$('#realBuy');rb.hidden=!(window.HFWallet&&((mode==='token'&&SWAP_CHAIN[tok])||(mode==='real'&&rd)));
  if(!rb.hidden){if(mode==='real'){rb.href=`/swap?chain=${encodeURIComponent(rd.chain)}&buy=${encodeURIComponent(rd.token)}`;rb.textContent=`Join for real: buy ${symTxt} on AUTISTIK Swap →`;}else{rb.href='/swap?chain='+SWAP_CHAIN[tok];rb.textContent=`Buy real ${tok} on AUTISTIK Swap →`;}}
  $('#bStart').textContent=`Buy in ${fmtUsd(menuBuy)} · ${nr?'Start race':'Start solo race'}`;
  $('#bStart').disabled=menuMode==='real'&&!(menuReal&&REAL[menuReal]&&REAL[menuReal].tracked);
}
function setBuy(v,typed){menuBuy=v;try{localStorage.setItem('hf-buyin',String(v));}catch(e){}if(!typed)renderBuy();else{$('#buyRow').querySelectorAll('button[data-b]').forEach(b=>b.setAttribute('aria-pressed',false));$('#bStart').textContent=`Buy in ${fmtUsd(menuBuy)} · ${nr?'Start race':'Start solo race'}`;}if(nr)lobbyPresence();}
function renderLobby(){
  renderBuy();
  const hostView=!nr||isHost;
  $('#modeBox').hidden=!hostView;$('#bStart').hidden=!hostView;$('#guestMode').hidden=hostView;
  $('#mTok').setAttribute('aria-pressed',menuMode==='token');$('#mFun').setAttribute('aria-pressed',menuMode==='fun');$('#mReal').setAttribute('aria-pressed',menuMode==='real');
  $('#mReal').hidden=!window.HFWallet;$('#tokRow').hidden=menuMode==='real';$('#realBox').hidden=menuMode!=='real';
  $('#tokRow').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.t===menuTok));
  $('#modeDesc').textContent=menuMode==='real'?'Every car is a real holder of this coin, shown by wallet. Each one drives as fast as that wallet is up since it bought in, so 100x wallets fly past you. The last day\'s real buys and sells replay as boosts and slowdowns.':menuMode==='token'?`You race the real-feel crowd of ${menuTok} holders. Buyers boost, sellers drop back, and a rising price speeds everyone up.`:`Nine coins race. Pumpers fly, rugs stall, and you can swap your coin offline at the gates.`;
  if(!nr){$('#players').innerHTML=`<li><span class="dot" style="background:${me.color}"></span>${esc(me.nick||'You')}<span class="t">you</span></li>`;return;}
  const ps=nr.peers();
  $('#players').innerHTML=ps.length?ps.map(p=>{const q=p.presence||{};const c=typeof q.c==='string'&&/^#[0-9a-f]{6}$/i.test(q.c)?q.c:'#888888';
    const bi=+q.b>0?` · $${Math.round(+q.b)} in`:'';return `<li><span class="dot" style="background:${c}"></span>${esc(q.n||'Joining…')}<span class="t">${q.host===1?'host · ':''}${p.sameTab?'you':q.st==='race'?'racing':'ready'}${esc(bi)}</span></li>`;}).join(''):'<li>Connecting…</li>';
  if(!isHost){const hp=hostPeer();$('#guestMode').textContent=hp?`${hp.presence.n||'The host'} picked ${hp.presence.mode==='fun'?'a Fun race':hp.presence.mode==='real'?'a real-token race':'a Token race'}${hp.presence.tok?' with '+(hp.presence.mode==='real'?(REAL[hp.presence.tok]&&REAL[hp.presence.tok].symbol?'$'+REAL[hp.presence.tok].symbol:'a pasted coin'):hp.presence.tok):''}. Waiting for them to start…`:'Waiting for the host to arrive…';}
}
$('#nick').value=me.nick;
function renderWorld(){$('#worldPick').querySelectorAll('button').forEach(b=>{b.setAttribute('aria-pressed',b.dataset.w===WORLD);b.onclick=()=>{if(WORLD===b.dataset.w)return;WORLD=b.dataset.w;try{localStorage.setItem('hf-world',WORLD);}catch(e){}renderWorld();rebuildWorld();};});}
function renderGfx(){$('#gfxPick').querySelectorAll('button').forEach(b=>{b.setAttribute('aria-pressed',b.dataset.q===GFX);b.onclick=()=>{setGFX(b.dataset.q);renderGfx();};});}
function renderGarage(){renderWorld();renderGfx();
  const bar=v=>`<span class="bar" style="width:${Math.round(clamp((v-0.4)/0.85,0.08,1)*100)}%"></span>`;
  $('#carPick').innerHTML=CAR_KEYS.map(k=>{const c=CARS[k];return `<button data-c="${k}" aria-pressed="${me.car===k}"><b>${c.name}</b><span class="bars"><small>SPD</small>${bar(c.speed)}<small>GRIP</small>${bar(c.handle)}<small>BOOST</small>${bar(c.boost)}</span></button>`;}).join('');
  $('#paintPick').innerHTML=PAINTS.map(c=>`<button data-v="${c}" aria-pressed="${me.color===c}" aria-label="Paint ${c}" style="background:${c}"></button>`).join('');
  $('#helmPick').innerHTML=HELMS.map(c=>`<button data-v="${c}" aria-pressed="${me.helmet===c}" aria-label="Helmet ${c}" style="background:${c}"></button>`).join('');
  $('#carPick').querySelectorAll('button').forEach(b=>b.onclick=()=>{me.car=b.dataset.c;saveLook();renderGarage();});
  $('#paintPick').querySelectorAll('button').forEach(b=>b.onclick=()=>{me.color=b.dataset.v;saveLook();renderGarage();});
  $('#helmPick').querySelectorAll('button').forEach(b=>b.onclick=()=>{me.helmet=b.dataset.v;saveLook();renderGarage();});
}
renderGarage();
$('#bCreate').onclick=()=>{if(!room)return;const c=WORDS[Math.floor(Math.random()*WORDS.length)]+'-'+(1000+Math.floor(Math.random()*9000));enterRoom(c,true);};
$('#bJoin').onclick=()=>{if(!room)return;const c=$('#joinCode').value.trim().toLowerCase().replace(/\s+/g,'-');if(!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(c)){homeErr('That code doesn’t look right. It should look like jollof-4821.');return;}enterRoom(c,false);};
$('#joinCode').addEventListener('keydown',e=>{if(e.key==='Enter')$('#bJoin').click();});
$('#bSolo').onclick=()=>{readNick();if(nr){nr.leave().catch(()=>{});nr=null;}isHost=false;showLobby();};
$('#bCopy').onclick=()=>{const t=code||'';const done=()=>{$('#bCopy').textContent='Copied';setTimeout(()=>$('#bCopy').textContent='Copy code',1500);};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(done).catch(sel);else sel();
  function sel(){const r=document.createRange();r.selectNodeContents($('#codeTxt'));const s=getSelection();s.removeAllRanges();s.addRange(r);}};
$('#mTok').onclick=()=>{menuMode='token';renderLobby();if(isHost)lobbyPresence();};
$('#mFun').onclick=()=>{menuMode='fun';renderLobby();if(isHost)lobbyPresence();};
$('#mReal').onclick=()=>{menuMode='real';renderLobby();loadHot();fillMine();if(isHost)lobbyPresence();};
/* ---------- real-token races (autistik.io) ---------- */
function shortA(a){return a.length>12?a.slice(0,6)+'…'+a.slice(-4):a;}
async function loadReal(key){
  const m=REAL_RE.exec(key);if(!m)return null;
  LOADING.add(key);setTimeout(()=>LOADING.delete(key),8000);
  try{const r=await fetch(`/api/hyperfocus/race?chain=${encodeURIComponent(m[1])}&token=${encodeURIComponent(m[2])}`);const d=await r.json();if(r.ok){REAL[key]=d;}else d.error=d.error||'Couldn’t load that token.';return d;}
  catch(e){return {error:'Couldn’t reach the race data. Try again.'};}
}
function showReal(d,key){
  const el=$('#rInfo');
  if(!d){el.textContent='Paste a token address, or pick a hot coin above.';return;}
  if(d.error){el.innerHTML=`<span class="bad">${esc(d.error)}</span>`;return;}
  const img=d.image?`<img src="${esc(d.image)}" alt="">`:'';
  if(!d.tracked){el.innerHTML=`<span class="rtok">${img}<b>${esc(d.symbol?'$'+d.symbol:shortA(d.token))}</b></span> isn’t in the arena yet. <button id="rKick">Kick off this race</button> <span id="rKickMsg"></span>`;
    $('#rKick').onclick=async()=>{$('#rKickMsg').textContent='Loading every holder… about a minute.';
      try{const r=await fetch('/api/analytics/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chain:d.chain,token:d.token})});
        if(r.status===401){$('#rKickMsg').innerHTML=`<a href="/login?next=${encodeURIComponent('/hyperfocus?chain='+d.chain+'&ca='+d.token)}">Sign in</a> to kick off a new race.`;return;}
        const j=await r.json().catch(()=>({}));if(!r.ok){$('#rKickMsg').textContent=j.error||'Couldn’t start that race.';return;}
        delete REAL[key];const nd=await loadReal(key);showReal(nd,key);renderLobby();if(isHost)lobbyPresence();}
      catch(e){$('#rKickMsg').textContent='Couldn’t reach the site. Try again.';}};
    return;}
  const big=d.holders.filter(h=>(h.x||0)>=100).length,known=d.holders.filter(h=>h.x!=null).length,ch=d.ch24;
  el.innerHTML=`<span class="rtok">${img}<b>$${esc(d.symbol||'TOKEN')}</b> ${fmtPrice(d.price)}${ch!=null?` <span class="${ch>=0?'ok':'bad'}">${ch>=0?'+':''}${ch.toFixed(1)}% 24h</span>`:''}</span> ${d.holders.length} holder cars · ${d.trades.length} real trades in the last day${big?` · ${big} wallet${big>1?'s':''} up 100x or more`:''}${known<d.holders.length?` · gains known for ${known} of them (the rest show their bag)`:''}.`;
  showMine();
}
async function pickReal(chain,token){
  const key=`${chain}:${token}`;menuReal=key;$('#rChain').value=chain;$('#rCA').value=token;
  $('#rInfo').textContent='Loading holders…';
  const d=REAL[key]||await loadReal(key);if(menuReal!==key)return;
  showReal(d,key);renderLobby();if(isHost)lobbyPresence();
}
$('#rLoad').onclick=()=>{const ca=$('#rCA').value.trim();let ch=$('#rChain').value;if(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)&&!/^0x/i.test(ca))ch='solana';
  if(!/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(ca)){$('#rInfo').innerHTML='<span class="bad">That doesn’t look like a token address.</span>';return;}pickReal(ch,ca);};
$('#rCA').addEventListener('keydown',e=>{if(e.key==='Enter')$('#rLoad').click();});
let hotLoaded=false;
async function loadHot(){
  if(hotLoaded||!window.HFWallet)return;hotLoaded=true;
  try{const r=await fetch('/api/hyperfocus/hot');const list=r.ok?await r.json():[];
    $('#hotRow').innerHTML=list.length?'<span class="mini">Hot now:</span>'+list.map((t,i)=>`<button data-i="${i}">${t.image?`<img src="${esc(t.image)}" alt="">`:''}$${esc(t.symbol||'?')}${t.h1!=null?` <small class="${t.h1>=0?'ok':'bad'}">${t.h1>=0?'+':''}${Number(t.h1).toFixed(0)}%</small>`:''}</button>`).join(''):'';
    $('#hotRow').querySelectorAll('button').forEach(b=>b.onclick=()=>{const t=list[+b.dataset.i];pickReal(t.chain,t.token);});}catch(e){}
}
function showMine(){
  const a=(me.wallet||'').toLowerCase(),d=menuReal&&REAL[menuReal];
  if(!a){$('#myInfo').textContent='Optional: if your wallet holds this coin, your car is you, with your real gains.';return;}
  if(!d||!d.tracked){$('#myInfo').textContent=`Racing as ${shortA(me.wallet)}.`;return;}
  const h=d.holders.find(x=>x.w.toLowerCase()===a);
  $('#myInfo').innerHTML=h?`<span class="ok">Found you:</span> ${shortA(me.wallet)} holds ${fmtK(h.usd||0)}${h.x!=null?`, up ${fmtX(h.x)}`:''}. Your car gets a boost for it.`:`${shortA(me.wallet)} isn’t one of the top holders of this coin. Buy in for real to get on the grid.`;
}
$('#myAddr').addEventListener('input',e=>{me.wallet=e.target.value.trim();showMine();});
async function fillMine(){
  if(me.wallet||!window.HFWallet||!window.HFWallet.addresses)return;
  try{const a=await window.HFWallet.addresses();const d=menuReal&&REAL[menuReal];const pick=(d&&d.chain==='solana')?(a.sol||a.evm):(a.evm||a.sol);if(pick){me.wallet=pick;$('#myAddr').value=pick;showMine();}}catch(e){}
}
$('#useMine').onclick=async()=>{
  if(!window.HFWallet){$('#myInfo').textContent='Paste your wallet address above.';return;}
  let a=window.HFWallet.addresses?await window.HFWallet.addresses():{};
  if(!a.evm&&!a.sol){try{await window.HFWallet.connect();}catch(e){}a=await window.HFWallet.addresses();}
  const d=menuReal&&REAL[menuReal];const pick=(d&&d.chain==='solana')?(a.sol||a.evm):(a.evm||a.sol);
  if(pick){me.wallet=pick;$('#myAddr').value=pick;showMine();}else $('#myInfo').textContent='No wallet connected yet. Connect one, or paste your address.';
};
/* links like /hyperfocus?chain=bsc&ca=0x… open that coin's race */
(function(){try{const q=new URLSearchParams(location.search),ca=q.get('ca'),ch=q.get('chain')||'bsc';
  if(ca&&window.HFWallet&&/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(ca)){menuMode='real';pickReal(/^(bsc|ethereum|base|solana)$/.test(ch)?ch:'bsc',ca);
    const lc=document.querySelector('#launchOv .lcard p');if(lc)lc.textContent='Opening a real-token race. Tap play to pick your car and join.';}}catch(e){}})();
$('#tokRow').querySelectorAll('button').forEach(b=>b.onclick=()=>{menuTok=b.dataset.t;renderLobby();if(isHost)lobbyPresence();});
function hostStart(){
  const go=Date.now()+(nr?5000:3200);
  const tk=menuMode==='real'?menuReal:menuTok;if(menuMode==='real'&&!(tk&&REAL[tk]&&REAL[tk].tracked))return;
  if(nr){hostGo=go;lobbyPresence();startRace(menuMode,tk,go,`${code}|${go}|${menuMode}|${tk}`);}
  else startRace(menuMode,tk,go,`solo|${go}|${Math.random()}`);
}
$('#bStart').onclick=hostStart;
$('#bAgain').onclick=hostStart;
$('#bLobby').onclick=()=>{if(nr)lobbyPresence();showLobby();};
$('#bLeave').onclick=()=>{if(nr){nr.leave().catch(()=>{});nr=null;}code=null;isHost=false;state='home';S=null;$('#lobbyOv').hidden=true;$('#homeOv').hidden=false;renderBoard([]);$('#feed').innerHTML='';};

/* ================= input ================= */
const KEYS={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',Space:'gas',ArrowUp:'gas',KeyW:'gas',ShiftLeft:'gas',ShiftRight:'gas',ArrowDown:'brake',KeyS:'brake'};
addEventListener('keydown',e=>{if(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;const k=KEYS[e.code];if(k&&S&&state==='race'){S.me.inp[k]=1;e.preventDefault();}});
addEventListener('keyup',e=>{const k=KEYS[e.code];if(k&&S)S.me.inp[k]=0;});
$('#pads').querySelectorAll('button[data-k]').forEach(b=>{const k=b.dataset.k;
  const set=v=>{if(S){if(k==='left'){S.me.padL=v;applyTouch();}else if(k==='right'){S.me.padR=v;applyTouch();}else S.me.inp[k]=v;}b.classList.toggle('on',!!v);};
  b.addEventListener('pointerdown',e=>{e.preventDefault();try{b.setPointerCapture(e.pointerId);}catch(_){}set(1);});
  ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>b.addEventListener(ev,()=>set(0)));
  b.addEventListener('contextmenu',e=>e.preventDefault());});

/* ================= full screen ================= */
function immersive(){return document.body.classList.contains('immersive');}
function enterImmersive(gesture){
  document.body.classList.add('immersive');$('#launchOv').hidden=true;$('#bExit').hidden=false;
  if(gesture){const el=$('#stage');try{const p=el.requestFullscreen?el.requestFullscreen({navigationUI:'hide'}):el.webkitRequestFullscreen?el.webkitRequestFullscreen():null;
    if(p&&p.then)p.then(()=>{try{screen.orientation&&screen.orientation.lock&&screen.orientation.lock('landscape').catch(()=>{});}catch(e){}}).catch(()=>{});}catch(e){}}
  requestAnimationFrame(resize);setTimeout(resize,300);
}
function exitImmersive(){
  document.body.classList.remove('immersive','racing');$('#bExit').hidden=true;$('#pads').hidden=true;
  try{if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});}catch(e){}
  if(state==='race'){S=null;state=nr?'lobby':'home';if(nr)lobbyPresence();}
  ['homeOv','lobbyOv','endOv'].forEach(id=>$('#'+id).hidden=true);$('#launchOv').hidden=false;
  requestAnimationFrame(resize);
}
$('#bLaunch').onclick=()=>{enterImmersive(true);if(nr&&state==='lobby')showLobby();else{state='home';$('#homeOv').hidden=false;}};
$('#bExit').onclick=exitImmersive;
addEventListener('resize',()=>requestAnimationFrame(resize));
if(window.ResizeObserver)new ResizeObserver(()=>resize()).observe($('#view'));

/* tilt the phone to steer (works where the browser allows motion sensors) */
let tiltOn=false,tiltVal=0,tiltSeen=false;
function onTilt(e){tiltSeen=true;const a=(screen.orientation&&typeof screen.orientation.angle==='number')?screen.orientation.angle:(window.orientation||0);
  const t=a===90?e.beta:(a===-90||a===270)?-e.beta:e.gamma;if(t==null)return;tiltVal=clamp(t/22,-1,1);}
function tiltToast(t){if(S&&S.me)S.me.toasts.push({txt:t,color:COL.gas,t:2.2});}
function setTilt(on){tiltOn=on;$('#bTilt').setAttribute('aria-pressed',on);if(!on){removeEventListener('deviceorientation',onTilt);tiltVal=0;}}
$('#bTilt').addEventListener('click',async()=>{
  if(tiltOn){setTilt(false);tiltToast('TILT OFF');return;}
  try{if(window.DeviceOrientationEvent&&typeof DeviceOrientationEvent.requestPermission==='function'){const r=await DeviceOrientationEvent.requestPermission();if(r!=='granted')throw 0;}}catch(e){tiltToast('TILT NOT ALLOWED');return;}
  tiltSeen=false;addEventListener('deviceorientation',onTilt);setTilt(true);tiltToast('TILT ON · LEAN TO STEER');
  setTimeout(()=>{if(tiltOn&&!tiltSeen){setTilt(false);tiltToast('NO TILT SENSOR HERE');}},1500);
});
/* camera views: chase, close chase, bonnet, and a front view facing your car */
const CAMS=['CHASE CAM','CLOSE CHASE','BONNET CAM','FRONT VIEW'];
let camMode=0;try{camMode=Math.min(3,Math.max(0,parseInt(localStorage.getItem('hf-cam')||'0',10)||0));}catch(e){}
function nextCam(){camMode=(camMode+1)%CAMS.length;try{localStorage.setItem('hf-cam',String(camMode));}catch(e){}if(G)G.camInit=false;if(S&&S.me)S.me.toasts.push({txt:CAMS[camMode],color:COL.gas,t:1.4});}
$('#bCam').addEventListener('click',nextCam);
addEventListener('keydown',e=>{if(e.code==='KeyC'&&S&&state==='race'&&!(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)))nextCam();});
/* hold the left or right side of the screen to steer */
const touchSide=new Map();
function applyTouch(){if(!S)return;let l=0,r=0;touchSide.forEach(s=>{if(s<0)l=1;else r=1;});S.me.inp.left=l||S.me.padL?1:0;S.me.inp.right=r||S.me.padR?1:0;}
cv.addEventListener('pointerdown',e=>{if(!S||state!=='race')return;const b=cv.getBoundingClientRect();touchSide.set(e.pointerId,(e.clientX-b.left)<b.width/2?-1:1);try{cv.setPointerCapture(e.pointerId);}catch(_){}applyTouch();e.preventDefault();});
['pointerup','pointercancel','lostpointercapture'].forEach(ev=>cv.addEventListener(ev,e=>{if(touchSide.delete(e.pointerId))applyTouch();}));

function safeGL(pl,others,dt){try{renderGL(pl,others,dt,true);}catch(e){console.error(e);G=null;$('#gl').style.display='none';renderView(pl,others);}}
/* ================= sound ================= */
/* Every sound is made live with Web Audio (no files): an engine that climbs through the gears, wind, tyre squeal in hard
   turns, guard-rail scrape, nitro whoosh, bumps, pickups, countdown beeps, a finish fanfare and a driving music loop. */
const Sound=(()=>{
  let ac=null,master,sfx,mus,engA,engB,engF,engG,windF,windG,sqF,sqG,scF,scG,noiseBuf,nextNote=0,step=0;
  let mode='all';try{const m=localStorage.getItem('hf-sound');if(m==='all'||m==='sfx'||m==='off')mode=m;}catch(e){}
  let lastToasts=0,lastShake=0,lastCd=99,wasBoost=false,lastPl=null,gearPrev=0;
  function noise(){const b=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return b;}
  function loopNoise(){const s=ac.createBufferSource();s.buffer=noiseBuf;s.loop=true;s.start();return s;}
  function init(){
    if(ac)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    try{ac=new AC();}catch(e){return;}
    const comp=ac.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=4;comp.connect(ac.destination);
    master=ac.createGain();master.connect(comp);sfx=ac.createGain();sfx.connect(master);mus=ac.createGain();mus.connect(master);
    noiseBuf=noise();
    // engine: two detuned saws and a sub square through a low-pass that opens with revs
    engF=ac.createBiquadFilter();engF.type='lowpass';engF.Q.value=4;engG=ac.createGain();engG.gain.value=0;engF.connect(engG);engG.connect(sfx);
    engA=ac.createOscillator();engA.type='sawtooth';engB=ac.createOscillator();engB.type='square';
    const ga=ac.createGain();ga.gain.value=0.5;const gb=ac.createGain();gb.gain.value=0.35;engA.connect(ga);engB.connect(gb);ga.connect(engF);gb.connect(engF);engA.start();engB.start();
    windF=ac.createBiquadFilter();windF.type='bandpass';windF.frequency.value=700;windF.Q.value=0.6;windG=ac.createGain();windG.gain.value=0;loopNoise().connect(windF);windF.connect(windG);windG.connect(sfx);
    sqF=ac.createBiquadFilter();sqF.type='bandpass';sqF.frequency.value=2100;sqF.Q.value=9;sqG=ac.createGain();sqG.gain.value=0;loopNoise().connect(sqF);sqF.connect(sqG);sqG.connect(sfx);
    scF=ac.createBiquadFilter();scF.type='highpass';scF.frequency.value=2600;scG=ac.createGain();scG.gain.value=0;loopNoise().connect(scF);scF.connect(scG);scG.connect(sfx);
    nextNote=ac.currentTime+0.1;apply();
  }
  function apply(){if(!ac)return;const t=ac.currentTime;master.gain.setTargetAtTime(mode==='off'?0:0.9,t,0.05);mus.gain.setTargetAtTime(mode==='all'?0.22:0,t,0.1);}
  function wake(){init();if(ac&&ac.state==='suspended'&&!document.hidden)ac.resume().catch(()=>{});}
  ['pointerdown','keydown','touchstart'].forEach(ev=>addEventListener(ev,wake,{passive:true}));
  document.addEventListener('visibilitychange',()=>{if(!ac)return;if(document.hidden)ac.suspend().catch(()=>{});else ac.resume().catch(()=>{});});
  // one-shot helpers
  function tone(f,dur,{type='sine',vol=0.2,at=0,slide=0,dest=null}={}){if(!ac)return;const t=ac.currentTime+at,o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(20,f*slide),t+dur);
    g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.01);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);o.connect(g);g.connect(dest||sfx);o.start(t);o.stop(t+dur+0.05);}
  function burst(dur,{f=1000,q=1,type='bandpass',vol=0.2,at=0,sweep=0,dest=null}={}){if(!ac)return;const t=ac.currentTime+at,s=ac.createBufferSource(),fl=ac.createBiquadFilter(),g=ac.createGain();s.buffer=noiseBuf;fl.type=type;fl.frequency.setValueAtTime(f,t);fl.Q.value=q;
    if(sweep)fl.frequency.exponentialRampToValueAtTime(f*sweep,t+dur);g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);s.connect(fl);fl.connect(g);g.connect(dest||sfx);s.start(t,Math.random());s.stop(t+dur+0.05);}
  const fx={
    beep:()=>tone(660,0.18,{type:'square',vol:0.12}),go:()=>{tone(1320,0.45,{type:'square',vol:0.14});tone(660,0.45,{type:'square',vol:0.08});},
    coin:()=>{tone(988,0.12,{type:'triangle',vol:0.18});tone(1480,0.25,{type:'triangle',vol:0.16,at:0.07});},
    swap:()=>[660,880,1100,1320].forEach((f,i)=>tone(f,0.16,{type:'triangle',vol:0.13,at:i*0.05})),
    miss:()=>tone(180,0.3,{type:'sawtooth',vol:0.1,slide:0.6}),
    rug:()=>{tone(520,0.7,{type:'sawtooth',vol:0.12,slide:0.25});burst(0.5,{f:400,vol:0.08,type:'lowpass'});},
    join:()=>{tone(784,0.15,{vol:0.16});tone(1175,0.3,{vol:0.14,at:0.1});},
    bump:()=>{tone(90,0.25,{vol:0.4,slide:0.5});burst(0.18,{f:600,type:'lowpass',vol:0.35});},
    nitro:()=>{burst(0.9,{f:300,q:0.8,vol:0.22,sweep:8});tone(110,0.6,{type:'sawtooth',vol:0.06,slide:2.2});},
    shift:()=>burst(0.08,{f:1800,q:2,vol:0.05}),
    finish:()=>[523,659,784,1047,784,1047].forEach((f,i)=>tone(f,i===5?0.8:0.2,{type:'square',vol:0.11,at:[0,0.12,0.24,0.36,0.56,0.68][i]})),
    click:()=>tone(1400,0.04,{type:'square',vol:0.05})};
  // driving music: 124 bpm, kick, offbeat hats, a minor-key bassline and stabs
  const BASS=[45,45,57,45,48,48,60,48,43,43,55,43,50,50,52,55],mtof=m=>440*Math.pow(2,(m-69)/12);
  function music(){if(!ac||mode!=='all')return;const spb=60/124/4;
    while(nextNote<ac.currentTime+0.25){const t=nextNote-ac.currentTime,s=step%16,bar=Math.floor(step/16)%4;
      if(s%4===0){tone(120,0.22,{vol:0.55,slide:0.35,at:t,dest:mus});}
      if(s%4===2)burst(0.05,{f:8000,type:'highpass',vol:0.13,at:t,dest:mus});
      if(s===4||s===12)burst(0.16,{f:1800,q:0.7,vol:0.18,at:t,dest:mus});
      if(s%2===0){const n=BASS[(s/2|0)+(bar%2)*8];tone(mtof(n),spb*1.8,{type:'sawtooth',vol:0.12,at:t,dest:mus});}
      if(bar===3&&(s===0||s===6||s===10))[0,3,7].forEach(k=>tone(mtof(69+k),0.14,{type:'square',vol:0.035,at:t,dest:mus}));
      nextNote+=spb;step++;}}
  function tick(pl,dt){
    if(!ac)return;music();const t=ac.currentTime;
    if(!pl||!S){engG.gain.setTargetAtTime(0,t,0.15);windG.gain.setTargetAtTime(0,t,0.2);sqG.gain.setTargetAtTime(0,t,0.05);scG.gain.setTargetAtTime(0,t,0.05);lastPl=null;return;}
    if(pl!==lastPl){lastPl=pl;lastToasts=pl.toasts.length;lastShake=0;lastCd=99;wasBoost=false;}
    const sp=Math.max(0,(pl.speed||0)/BASE),cd=(S.go-Date.now())/1000;
    // countdown beeps, then GO
    if(cd>0){const c=Math.ceil(cd);if(c<lastCd&&c<=3){fx.beep();lastCd=c;}}else if(lastCd!==0){fx.go();lastCd=0;}
    // engine: rev range per gear, revs climb as speed builds, dip on each shift
    const gears=[0,0.25,0.5,0.8,1.15,1.55,2.5];let g=1;while(g<gears.length-1&&sp>gears[g])g++;
    const lo=gears[g-1],hi=gears[g],fr=Math.min(1,(sp-lo)/(hi-lo)),idle=cd>0||pl.finished;
    const rpm=idle?0.12+(pl.inp&&pl.inp.gas?0.5:0):0.18+fr*0.82;
    if(!idle&&g!==gearPrev){if(g>gearPrev)fx.shift();gearPrev=g;}
    const f=38+rpm*92+g*6;engA.frequency.setTargetAtTime(f,t,0.05);engB.frequency.setTargetAtTime(f*0.5,t,0.05);
    engF.frequency.setTargetAtTime(300+rpm*1900+(pl.boosting?900:0),t,0.06);
    engG.gain.setTargetAtTime(pl.finished?0.04:0.07+rpm*0.07+(pl.inp&&pl.inp.gas?0.03:0),t,0.08);
    windF.frequency.setTargetAtTime(500+sp*900,t,0.2);windG.gain.setTargetAtTime(Math.min(0.2,sp*sp*0.07),t,0.2);
    const sq=Math.max(0,Math.abs(pl.steer||0)*sp-0.75)*0.35+(pl.inp&&pl.inp.brake&&sp>0.7?0.08:0);
    sqF.frequency.setTargetAtTime(1900+Math.random()*500,t,0.05);sqG.gain.setTargetAtTime(Math.min(0.16,sq),t,0.05);
    scG.gain.setTargetAtTime(pl.scrape>0?0.12:0,t,0.03);
    if((pl.shake||0)>lastShake+0.15)fx.bump();lastShake=pl.shake||0;
    if(pl.boosting&&!wasBoost)fx.nitro();wasBoost=!!pl.boosting;
    if(pl.toasts.length>lastToasts){for(let i=lastToasts;i<pl.toasts.length;i++){const x=String(pl.toasts[i].txt||'');
      if(/GAS|AIRDROP/.test(x))fx.coin();else if(/^SWAPPED/.test(x))fx.swap();else if(/FINISHED/.test(x))fx.finish();else if(/JOINED/.test(x))fx.join();else if(/MISSED|OUT OF/.test(x))fx.miss();else if(/RUG/.test(x))fx.rug();}}
    lastToasts=pl.toasts.length;
  }
  function cycle(){mode=mode==='all'?'sfx':mode==='sfx'?'off':'all';try{localStorage.setItem('hf-sound',mode);}catch(e){}wake();apply();if(mode!=='off')fx.click();return mode;}
  return {tick,cycle,mode:()=>mode,fx,wake};
})();
function soundLabel(){const m=Sound.mode();const b=$('#bSnd');if(b){b.textContent=m==='all'?'SOUND':m==='sfx'?'NO MUSIC':'MUTED';b.setAttribute('aria-pressed',m!=='off');b.setAttribute('aria-label','Sound: '+(m==='all'?'music and effects':m==='sfx'?'effects only':'off'));}}
$('#bSnd').addEventListener('click',()=>{Sound.cycle();soundLabel();});soundLabel();
addEventListener('keydown',e=>{if(e.code==='KeyM'&&!(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))){Sound.cycle();soundLabel();}});
/* ================= loop ================= */
let last=performance.now(),uiT=0,idleZ=0;
buildTrack();
try{G=initGL();applySceneTheme();setupFX();loadPhotoEnv();}catch(e){console.error(e);G=null;}
if(!G)$('#gl').style.display='none';
resize();
function frame(now){
  if(!cv.isConnected)return; // the page was left (in-site navigation): stop the loop
  const dt=Math.min(0.05,(now-last)/1000);last=now;tClock+=dt;
  if(G)ctx.clearRect(0,0,W,H);else{ctx.fillStyle=COL.night;ctx.fillRect(0,0,W,H);}
  if(S&&state==='race'){
    stepWorld();readRemotes();
    if(racing())updMe(S.me,dt);
    S.pubT-=dt;if(S.pubT<=0){S.pubT=0.1;publish();}
    const list=ranked();list.forEach((r,i)=>{r.d=disp(r);if(!r.me){r.d.name=r.d.label;r.d.label=ordinal(i+1)+'  '+r.d.label;}});
    const others=list.filter(r=>r!==S.me);
    if(G)safeGL(S.me,others,dt);else renderView(S.me,others);
    drawHUD(S.me,list);
    uiT-=dt;if(uiT<=0){uiT=0.25;renderBoard(list);if(S.feedDirty)renderFeed();if(!$('#endOv').hidden)showEnd();}
    if(S.me.finished&&!S.endShown&&S.w.wt-S.me.ft>1.8){S.endShown=true;showEnd();}
  } else {
    idleZ+=BASE*0.55*dt;if(idleZ>SEG*(FIN-400))idleZ=0;
    const ghost={pos:playerZ+SEG*8+idleZ,x:Math.sin(tClock*0.3)*0.35,skyOff:idleZ*0.002,shake:0,inp:{},boosting:false,finished:true,color:me.color,speed:BASE*0.55};
    if(G)safeGL(ghost,[],dt);else renderView(ghost,[]);
    uiT-=dt;if(uiT<=0){uiT=0.5;if(!S)renderBoard([]);}
  }
  try{Sound.tick(S&&state==='race'?S.me:null,dt);}catch(e){}
  requestAnimationFrame(frame);
}
renderBoard([]);
requestAnimationFrame(frame);
})();
