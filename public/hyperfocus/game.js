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
  while(segments.length<4400){const hill=Math.round((r()-0.5)*70-lastY()/SEG*0.35);
    if(r()<0.22)addRoad(25,30+Math.floor(r()*40),25,0,hill);
    else addRoad(20+Math.floor(r()*40),25+Math.floor(r()*70),20+Math.floor(r()*40),[2,3,4,5,6][Math.floor(r()*5)]*(r()<0.5?-1:1),hill);}
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
  const sp=h.speed/BASE,dx=dt*2.1*st.handle*Math.max(0.35,Math.min(1,sp));
  if(i.left)h.x-=dx;if(i.right)h.x+=dx;
  if(tiltOn&&!i.left&&!i.right&&Math.abs(tiltVal)>0.08)h.x+=dx*tiltVal*1.15;
  h.x-=dx*Math.min(1,sp)*seg.curve*0.28;h.x=clamp(h.x,-2.3,2.3);
  if(Math.abs(h.x)>1.05&&h.speed>BASE*0.3)h.speed-=BASE*1.1*st.off*dt;
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
  if(S.w.mode==='real')return {label:h.label,sub:recent?h.act.t:h.out?'SOLD ALL':fmtX(h.x)+(h.est&&h.x!=null?'~':''),subCol:recent?h.act.c:h.out?COL.dim:h.x>=100?COL.moon:h.x>=1?COL.up:COL.down,color:r.color,boost:h.boost>0,brake:h.drag>0,rug:h.out,moon:(h.x||0)>=100&&!h.out,mono:true};
  return {label:h.label,sub:recent?h.act.t:h.out?'SOLD OUT':fmtK(h.amt*S.w.mk.P),subCol:recent?h.act.c:h.out?COL.dim:COL.ink,color:r.color,boost:h.boost>0,brake:h.drag>0,rug:h.out,mono:true};
}

/* ================= rendering ================= */
const cv=$('#screen'),dpr=Math.min(2,window.devicePixelRatio||1);const ctx=cv.getContext('2d');
function resize(){
  const r=$('#view').getBoundingClientRect(),cw=Math.max(1,r.width),ch=Math.max(1,r.height),asp=cw/ch;
  W=Math.round(clamp(H*asp,720,1400));
  cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);ctx.setTransform(cv.width/W,0,0,cv.height/H,0,0);
  if(G){G.renderer.setSize(cw,ch,false);G.camera.aspect=asp;G.camera.updateProjectionMatrix();}
}

/* ================= 3D renderer (three.js) ================= */
const SC=0.01,RW=13,KCURVE=0.0032;
let G=null,C3=[];
function initGL(){
  if(!window.THREE)return null;
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas:$('#gl'),antialias:true,powerPreference:'high-performance'});}catch(e){return null;}
  renderer.setPixelRatio(Math.min(1.75,window.devicePixelRatio||1));
  _v=new THREE.Vector3();_v2=new THREE.Vector3();
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x0b0820);scene.fog=new THREE.FogExp2(0x24163f,0.0056);
  const camera=new THREE.PerspectiveCamera(66,16/9,0.3,1600);
  const hemi=new THREE.HemisphereLight(0x8a7cff,0x0a0a14,0.75);scene.add(hemi);
  const moon=new THREE.DirectionalLight(0xb8c4ff,0.5);moon.position.set(-60,120,-40);scene.add(moon);
  const amb=new THREE.AmbientLight(0x3a3460,0.5);scene.add(amb);
  // sky dome with gradient + stars, follows the camera
  const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms:{top:{value:new THREE.Color(0x07061a)},mid:{value:new THREE.Color(0x1a0f36)},hz:{value:new THREE.Color(0x24163f)},glow:{value:new THREE.Color(0x6b2b33)}},
    vertexShader:'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform vec3 top;uniform vec3 mid;uniform vec3 hz;uniform vec3 glow;varying vec3 vP;void main(){float h=clamp(vP.y,-0.1,1.0);vec3 c=mix(hz,glow,smoothstep(0.0,0.04,h)*(1.0-smoothstep(0.04,0.14,h)));c=mix(c,mid,smoothstep(0.08,0.2,h));c=mix(c,top,smoothstep(0.2,0.65,h));gl_FragColor=vec4(c,1.0);}'});
  const sky=new THREE.Mesh(new THREE.SphereGeometry(1200,32,16),skyMat);scene.add(sky);
  const sg=new THREE.BufferGeometry(),sp=[],sr=mulberry(11);
  for(let i=0;i<900;i++){const th=sr()*Math.PI*2,ph=Math.acos(0.15+sr()*0.85);sp.push(1100*Math.sin(ph)*Math.cos(th),1100*Math.cos(ph),1100*Math.sin(ph)*Math.sin(th));}
  sg.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));
  const stars=new THREE.Points(sg,new THREE.PointsMaterial({color:0xe9e2ff,size:1.6,sizeAttenuation:false,fog:false,transparent:true,opacity:0.8}));scene.add(stars);
  const moonDisc=new THREE.Mesh(new THREE.CircleGeometry(40,32),new THREE.MeshBasicMaterial({color:0xfff2d6,fog:false}));scene.add(moonDisc);
  const head=new THREE.SpotLight(0xfff0d0,2.2,140,0.42,0.55,1);scene.add(head);scene.add(head.target);
  const lampLights=[];for(let i=0;i<4;i++){const l=new THREE.PointLight(0xffa850,1.6,46,2);scene.add(l);lampLights.push(l);}
  const g={renderer,scene,camera,sky,skyMat,stars,moonDisc,head,lampLights,hemi,moon,amb,cars:new Map(),labelCache:new Map(),camInit:false,lookAt:new THREE.Vector3(),tmp:{},
    geo:{body:new THREE.BoxGeometry(3.6,1.0,7.4),cabin:new THREE.BoxGeometry(3.0,0.95,3.6),wheel:new THREE.CylinderGeometry(0.66,0.66,0.62,14),light:new THREE.BoxGeometry(0.95,0.26,0.1),spoiler:new THREE.BoxGeometry(3.5,0.14,0.8),post:new THREE.BoxGeometry(0.14,0.5,0.2),flame:new THREE.ConeGeometry(0.34,2.4,10),shadow:new THREE.PlaneGeometry(5.2,8.6)},
    mat:{glass:new THREE.MeshPhongMaterial({color:0x0b0a18,shininess:120,specular:0x8888aa}),tire:new THREE.MeshLambertMaterial({color:0x08080c}),tail:new THREE.MeshBasicMaterial({color:0xff2a3a}),head:new THREE.MeshBasicMaterial({color:0xfff6e0}),
      flameB:new THREE.MeshBasicMaterial({color:0x7ad7ff,transparent:true,opacity:0.9,blending:THREE.AdditiveBlending,depthWrite:false}),flameM:new THREE.MeshBasicMaterial({color:0xff9a2f,transparent:true,opacity:0.95,blending:THREE.AdditiveBlending,depthWrite:false}),
      shadow:new THREE.MeshBasicMaterial({map:shadowTex(),transparent:true,depthWrite:false})}};
  return g;
}
/* The race world follows the page theme: daytime in light mode, night city in dark mode. */
function pageDark(){const t=document.documentElement.getAttribute('data-theme');if(t==='dark')return true;if(t==='light')return false;return !!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);}
function applySceneTheme(){
  if(!G)return;const day=!pageDark(),u=G.skyMat.uniforms;G.day=day;
  if(day){u.top.value.set(0x2f6fd0);u.mid.value.set(0x7fb2e6);u.hz.value.set(0xd4e2f0);u.glow.value.set(0xf2dcc0);
    G.scene.background.set(0xbcd4ec);G.scene.fog.color.set(0xc9d9ea);G.scene.fog.density=0.0042;
    G.hemi.color.set(0xe6f0ff);G.hemi.groundColor.set(0x5a6a4a);G.hemi.intensity=1.05;G.moon.color.set(0xfff4e0);G.moon.intensity=1.15;G.amb.color.set(0x8a8aa0);G.amb.intensity=0.55;
    G.stars.visible=false;G.moonDisc.material.color.set(0xfff8e6);G.moonDisc.scale.setScalar(0.8);G.lampLights.forEach(l=>l.intensity=0);G.head.intensity=0.6;
    if(G.bMat){G.bMat.color.set(0x8a90a6);G.bMat.emissiveIntensity=0.06;}}
  else{u.top.value.set(0x07061a);u.mid.value.set(0x1a0f36);u.hz.value.set(0x24163f);u.glow.value.set(0x6b2b33);
    G.scene.background.set(0x0b0820);G.scene.fog.color.set(0x24163f);G.scene.fog.density=0.0056;
    G.hemi.color.set(0x8a7cff);G.hemi.groundColor.set(0x0a0a14);G.hemi.intensity=0.75;G.moon.color.set(0xb8c4ff);G.moon.intensity=0.5;G.amb.color.set(0x3a3460);G.amb.intensity=0.5;
    G.stars.visible=true;G.moonDisc.material.color.set(0xfff2d6);G.moonDisc.scale.setScalar(1);G.lampLights.forEach(l=>l.intensity=1.6);G.head.intensity=2.2;
    if(G.bMat){G.bMat.color.set(0x17122b);G.bMat.emissiveIntensity=0.55;}}
}
try{new MutationObserver(applySceneTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class']});}catch(e){}
addEventListener('autistik-theme',()=>setTimeout(applySceneTheme,0));
try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applySceneTheme);}catch(e){}
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
function buildGLTrack(){
  if(!G||G.track)return;
  computeC3();
  const pos=[],col=[],idx=[],tc=new THREE.Color();
  const lat=(i,o,dy)=>{const c=C3[i],rx=-Math.cos(c.ang),rz=Math.sin(c.ang);return [c.x+rx*o,c.y+dy,c.z+rz*o];};
  function quad(i,o1,o2,dy,hex){tc.set(hex);const v=pos.length/3;[lat(i,o1,dy),lat(i,o2,dy),lat(i+1,o2,dy),lat(i+1,o1,dy)].forEach(p=>{pos.push(p[0],p[1],p[2]);col.push(tc.r,tc.g,tc.b);});idx.push(v,v+1,v+2,v,v+2,v+3);}
  const RB=RW+2.3,SW=RB+3.2;
  const apos=[],auv=[],aidx=[];
  function asphalt(i){const v=apos.length/3;[lat(i,-RW,0),lat(i,RW,0),lat(i+1,RW,0),lat(i+1,-RW,0)].forEach(p=>apos.push(p[0],p[1],p[2]));
    auv.push(0,i*0.35,3,i*0.35,3,(i+1)*0.35,0,(i+1)*0.35);aidx.push(v,v+1,v+2,v,v+2,v+3);}
  for(let i=0;i<segments.length;i++){
    const s=segments[i],cl=s.color,alt=Math.floor(i/RUMBLE)%2;
    quad(i,-170,-SW,-0.06,alt?'#0e1a15':'#11201a');quad(i,SW,170,-0.06,alt?'#0e1a15':'#11201a');
    quad(i,-SW,-RB,0.16,'#3a3744');quad(i,RB,SW,0.16,'#3a3744');                 // raised pavement
    quad(i,-SW,-SW+0.2,0.17,'#56526a');quad(i,SW-0.2,SW,0.17,'#56526a');
    quad(i,-RB,-RW,0.03,cl.rumble||'#ff7a2f');quad(i,RW,RB,0.03,cl.rumble||'#ff7a2f'); // kerbs
    if(cl.check){for(let k=0;k<8;k++)quad(i,-RW+k*RW/4,-RW+(k+1)*RW/4,0.01,(k+i)%2?'#f1edff':'#0d0b1f');}
    else{asphalt(i);
      if(i%6<3)for(let l=1;l<LANES;l++){const lx=-RW+l*2*RW/LANES;quad(i,lx-0.16,lx+0.16,0.02,'#e8e4f4');}
      quad(i,-RW+0.35,-RW+0.6,0.02,'#f1edff');quad(i,RW-0.6,RW-0.35,0.02,'#f1edff');}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));geo.setIndex(idx);geo.computeVertexNormals();
  const road=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));G.scene.add(road);
  // asphalt with grain, patches and a little wet sheen
  const ac=document.createElement('canvas');ac.width=ac.height=256;const ax=ac.getContext('2d'),ar=mulberry(31);
  ax.fillStyle='#2b2933';ax.fillRect(0,0,256,256);
  for(let k=0;k<9000;k++){const v=30+ar()*40|0;ax.fillStyle=`rgba(${v},${v},${v+8},${0.35+ar()*0.4})`;ax.fillRect(ar()*256,ar()*256,1+ar()*1.5,1+ar()*1.5);}
  for(let k=0;k<6;k++){ax.fillStyle='rgba(18,17,24,0.35)';ax.beginPath();ax.ellipse(ar()*256,ar()*256,20+ar()*40,8+ar()*20,ar()*3,0,7);ax.fill();}
  for(let k=0;k<2;k++){ax.fillStyle='rgba(12,11,16,0.45)';ax.fillRect(0,40+k*128+ar()*30,256,10);}
  const at=new THREE.CanvasTexture(ac);at.wrapS=at.wrapT=THREE.RepeatWrapping;at.anisotropy=Math.min(8,G.renderer.capabilities.getMaxAnisotropy());
  const ag=new THREE.BufferGeometry();ag.setAttribute('position',new THREE.Float32BufferAttribute(apos,3));ag.setAttribute('uv',new THREE.Float32BufferAttribute(auv,2));ag.setIndex(aidx);ag.computeVertexNormals();
  const asph=new THREE.Mesh(ag,new THREE.MeshStandardMaterial({map:at,roughness:0.62,metalness:0.08,envMap:makeEnvOnce(),envMapIntensity:0.35,side:THREE.DoubleSide}));G.scene.add(asph);
  // guard rails, posts and cat's-eye road studs
  const railG=new THREE.BoxGeometry(0.18,0.42,SEG*SC*1.03),postG=new THREE.BoxGeometry(0.16,1.1,0.16),studG=new THREE.BoxGeometry(0.3,0.07,0.3);
  const railM=new THREE.MeshStandardMaterial({color:0xb9bccb,metalness:0.85,roughness:0.32,envMap:makeEnvOnce(),envMapIntensity:0.9});
  const n=segments.length,rails=new THREE.InstancedMesh(railG,railM,n*2),posts=new THREE.InstancedMesh(postG,railM,Math.ceil(n/3)*2);
  const studs=new THREE.InstancedMesh(studG,new THREE.MeshBasicMaterial({color:0xffd27a}),Math.ceil(n/5)*4);
  const M=new THREE.Matrix4(),Q=new THREE.Quaternion(),Y=new THREE.Vector3(0,1,0),P=new THREE.Vector3(),ONE=new THREE.Vector3(1,1,1);
  let pi=0,si=0;
  for(let i=0;i<n;i++){const c=C3[i],d=C3[i+1],ang=(c.ang+d.ang)/2,rx=-Math.cos(ang),rz=Math.sin(ang),mx=(c.x+d.x)/2,my=(c.y+d.y)/2,mz=(c.z+d.z)/2;
    Q.setFromAxisAngle(Y,ang);
    [-1,1].forEach((sd,k)=>{P.set(mx+rx*sd*(SW-0.4),my+1.05,mz+rz*sd*(SW-0.4));M.compose(P,Q,ONE);rails.setMatrixAt(i*2+k,M);
      if(i%3===0){P.set(c.x+rx*sd*(SW-0.4),c.y+0.6,c.z+rz*sd*(SW-0.4));M.compose(P,Q,ONE);posts.setMatrixAt(pi++,M);}});
    if(i%5===0&&!segments[i].color.check)[-RW+0.48,RW-0.48,-RW/3,RW/3].forEach(o=>{P.set(c.x+rx*o,c.y+0.03,c.z+rz*o);M.compose(P,Q,ONE);if(si<studs.count)studs.setMatrixAt(si++,M);});}
  posts.count=pi;studs.count=si;
  [rails,posts,studs].forEach(m=>{m.frustumCulled=false;G.scene.add(m);});
  // neon billboards beside the road
  const ADS=[['$AUTISTIK','#ffd23f','#ff7a2f'],['HYPERFOCUS GP','#2fd0c9','#a27dff'],['DIAMOND HANDS ONLY','#7aa9ff','#2fd0c9'],['BUY · HOLD · RACE','#9be36b','#ffd23f'],['AUTISTIK.IO','#ff4fa0','#ffd23f'],['NO PAPER HANDS','#ff7a2f','#ff4fa0'],['SPECTRUM SPEEDWAY','#c08bff','#7aa9ff'],['LOCK IN','#ffd23f','#9be36b']];
  const bpost=new THREE.BoxGeometry(0.5,9,0.5),bpm=new THREE.MeshStandardMaterial({color:0x2a2738,metalness:0.6,roughness:0.5});
  for(let k=0,i=90;i<n-60;i+=150,k++){const c=C3[i],sd=k%2?1:-1,rx=-Math.cos(c.ang),rz=Math.sin(c.ang),off=sd*(SW+8);
    const cv=document.createElement('canvas');cv.width=512;cv.height=192;const x=cv.getContext('2d'),[t,c1,c2]=ADS[k%ADS.length];
    const gr=x.createLinearGradient(0,0,512,192);gr.addColorStop(0,'#120c26');gr.addColorStop(1,'#1d1238');x.fillStyle=gr;x.fillRect(0,0,512,192);
    x.strokeStyle=c2;x.lineWidth=8;x.strokeRect(8,8,496,176);x.shadowColor=c1;x.shadowBlur=24;x.fillStyle=c1;
    x.font=`${t.length>12?54:72}px 'Russo One', sans-serif`;x.textAlign='center';x.textBaseline='middle';x.fillText(t,256,100);
    const grp=new THREE.Group(),panel=new THREE.Mesh(new THREE.PlaneGeometry(17,6.4),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv)}));
    panel.position.y=11;panel.rotation.y=Math.PI;grp.add(panel);
    [-6,6].forEach(px=>{const pm=new THREE.Mesh(bpost,bpm);pm.position.set(px,4.5,0.3);grp.add(pm);});
    grp.position.set(c.x+rx*off,c.y,c.z+rz*off);grp.rotation.y=c.ang-sd*0.45;G.scene.add(grp);}
  // scenery
  const palms=[],lamps=[],m4=new THREE.Matrix4(),q=new THREE.Quaternion(),sc=new THREE.Vector3(),v=new THREE.Vector3(),o={};
  G.cans=[];G.gates=[];G.lamps=[];
  const canG=new THREE.CylinderGeometry(0.7,0.7,1.7,14),canM=new THREE.MeshLambertMaterial({color:0xffd23f,emissive:0x8a6a00});
  for(let n=0;n<segments.length;n++)segments[n].items.forEach((it,k)=>{
    if(it.type==='palm')palms.push({n,off:it.off});
    else if(it.type==='lamp')lamps.push({n,off:it.off});
    else if(it.type==='can'){tp(n*SEG,it.off,o);const m=new THREE.Mesh(canG,canM);m.position.set(o.x,o.y+1.1,o.z);G.scene.add(m);G.cans.push({m,n,k});}
    else if(it.type==='gate'){const g=makeGate(it,n);g.k=k;G.gates.push(g);}
  });
  const trunkG=new THREE.CylinderGeometry(0.28,0.45,10,6);trunkG.translate(0,5,0);
  const crownG=new THREE.ConeGeometry(3.4,2.2,7);crownG.translate(0,10.4,0);
  const trunks=new THREE.InstancedMesh(trunkG,new THREE.MeshLambertMaterial({color:0x4a3524}),palms.length);
  const crowns=new THREE.InstancedMesh(crownG,new THREE.MeshLambertMaterial({color:0x1f5a3a,emissive:0x062012}),palms.length);
  palms.forEach((p,i)=>{tp(p.n*SEG,p.off,o);const s=0.85+((p.n*37)%10)/25;q.setFromAxisAngle(v.set(0,0,1),Math.sign(p.off)*0.08);sc.set(s,s,s);m4.compose(v.set(o.x,o.y,o.z),q,sc);trunks.setMatrixAt(i,m4);crowns.setMatrixAt(i,m4);});
  trunks.frustumCulled=crowns.frustumCulled=false;G.scene.add(trunks,crowns);
  const poleG=new THREE.CylinderGeometry(0.16,0.2,11,6);poleG.translate(0,5.5,0);
  const bulbG=new THREE.SphereGeometry(0.55,10,8);
  const poles=new THREE.InstancedMesh(poleG,new THREE.MeshLambertMaterial({color:0x4a4560}),lamps.length);
  const bulbs=new THREE.InstancedMesh(bulbG,new THREE.MeshBasicMaterial({color:0xffc070}),lamps.length);
  const q0=new THREE.Quaternion(),one=new THREE.Vector3(1,1,1);
  lamps.forEach((l,i)=>{const side=l.off<0?-1:1;tp(l.n*SEG,side*1.24,o);m4.compose(v.set(o.x,o.y,o.z),q0,one);poles.setMatrixAt(i,m4);
    tp(l.n*SEG,side*1.08,o);m4.compose(v.set(o.x,o.y+10.8,o.z),q0,one);bulbs.setMatrixAt(i,m4);G.lamps.push({n:l.n,x:o.x,y:o.y+10,z:o.z});});
  poles.frustumCulled=bulbs.frustumCulled=false;G.scene.add(poles,bulbs);
  // city
  const br=mulberry(99),blds=[];
  for(let n=20;n<segments.length;n+=7){const side=br()<0.5?-1:1;blds.push({n,lat:side*(45+br()*140),h:14+br()*70,w:10+br()*22,d:10+br()*22});}
  const bG=new THREE.BoxGeometry(1,1,1);bG.translate(0,0.5,0);
  const bMat=new THREE.MeshLambertMaterial({color:0x17122b,emissive:0xffffff,emissiveMap:windowTex(),emissiveIntensity:0.55});G.bMat=bMat;
  const bm=new THREE.InstancedMesh(bG,bMat,blds.length);
  blds.forEach((b,i)=>{const c=C3[b.n],rx=-Math.cos(c.ang),rz=Math.sin(c.ang);q.setFromAxisAngle(v.set(0,1,0),c.ang);sc.set(b.w,b.h,b.d);m4.compose(v.set(c.x+rx*b.lat,c.y-2,c.z+rz*b.lat),q,sc);bm.setMatrixAt(i,m4);});
  bm.frustumCulled=false;G.scene.add(bm);
  G.track=true;applySceneTheme();
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
const SHAPES={
  street:{L:7.4,bw:3.7,ground:0.45,hood:1.25,ws:1.1,roofF:0.0,roofR:-1.45,roof:2.12,rw:-2.95,deck:1.45,wr:0.68,wz:2.45,spoiler:'lip'},
  muscle:{L:7.9,bw:3.9,ground:0.5,hood:1.42,ws:0.55,roofF:-0.55,roofR:-1.85,roof:2.2,rw:-2.75,deck:1.58,wr:0.74,wz:2.6,spoiler:'duck',scoop:true,stripes:true},
  super:{L:7.6,bw:4.0,ground:0.32,hood:0.98,ws:1.45,roofF:0.25,roofR:-0.95,roof:1.72,rw:-3.25,deck:1.32,wr:0.64,wz:2.55,spoiler:'wing',intakes:true},
  rally:{L:6.8,bw:3.6,ground:0.78,hood:1.62,ws:1.05,roofF:0.25,roofR:-2.0,roof:2.75,rw:-3.05,deck:1.95,wr:0.84,wz:2.0,spoiler:'roof',lightbar:true}};
function glowTex(){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),gr=x.createRadialGradient(32,32,2,32,32,32);gr.addColorStop(0,'rgba(255,255,255,0.9)');gr.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=gr;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);}
function makeEnvOnce(){if(!G.env)G.env=makeEnv();return G.env;}
function makeEnv(){
  // a night-city reflection map so car paint and chrome pick up lights like a game engine
  const c=document.createElement('canvas');c.width=1024;c.height=512;const x=c.getContext('2d'),r=mulberry(21);
  const g=x.createLinearGradient(0,0,0,512);g.addColorStop(0,'#05041a');g.addColorStop(0.42,'#2a1748');g.addColorStop(0.5,'#5a2848');g.addColorStop(0.52,'#141022');g.addColorStop(1,'#07060e');
  x.fillStyle=g;x.fillRect(0,0,1024,512);
  for(let i=0;i<420;i++){const px=r()*1024,py=170+r()*86,w=2+r()*5,h=2+r()*4;x.fillStyle=r()<0.7?`rgba(255,${180+r()*60|0},${90+r()*60|0},${0.5+r()*0.5})`:`rgba(${120+r()*80|0},${170+r()*60|0},255,0.8)`;x.fillRect(px,py,w,h);}
  for(let i=0;i<14;i++){const px=r()*1024;x.fillStyle='rgba(255,200,120,0.95)';x.fillRect(px,120+r()*40,24,8);}
  x.fillStyle='rgba(255,79,160,0.7)';x.fillRect(200,230,90,6);x.fillStyle='rgba(47,208,201,0.7)';x.fillRect(640,224,120,6);
  x.fillStyle='rgba(255,255,255,0.9)';x.fillRect(480,40,60,18);
  const t=new THREE.CanvasTexture(c);t.mapping=THREE.EquirectangularReflectionMapping;
  try{const pm=new THREE.PMREMGenerator(G.renderer);const e=pm.fromEquirectangular(t).texture;pm.dispose();return e;}catch(e){return t;}
}
function bodyGeo(type){
  const k='body_'+type;if(G.geo[k])return G.geo[k];
  const p=SHAPES[type],h=p.L/2,ar=p.wr+0.36,s=new THREE.Shape();
  s.moveTo(-h,p.deck-0.5);
  s.lineTo(-h+0.05,p.ground+0.08);
  s.lineTo(-p.wz-ar,p.ground);s.absarc(-p.wz,p.wr,ar,Math.PI,0,true);
  s.lineTo(p.wz-ar,p.ground);s.absarc(p.wz,p.wr,ar,Math.PI,0,true);
  s.lineTo(h-0.05,p.ground+0.08);
  s.lineTo(h+0.05,p.hood-0.3);
  s.quadraticCurveTo(h-0.05,p.hood-0.05,h-0.55,p.hood);
  s.lineTo(p.ws,p.hood+0.12);
  s.quadraticCurveTo(p.ws-0.45,p.roof-0.2,p.roofF,p.roof);
  s.lineTo(p.roofR,p.roof);
  s.quadraticCurveTo(p.rw+0.6,p.roof-0.08,p.rw,p.deck+0.05);
  s.lineTo(-h+0.25,p.deck);
  s.quadraticCurveTo(-h-0.05,p.deck-0.05,-h,p.deck-0.5);
  const depth=p.bw-0.5;
  const geo=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelThickness:0.25,bevelSize:0.22,bevelSegments:4,curveSegments:14,steps:1});
  geo.translate(0,0,-depth/2);geo.rotateY(-Math.PI/2);geo.computeVertexNormals();
  // glass greenhouse, a touch wider so side windows, windshield and rear glass show
  const gS=new THREE.Shape();const gb=p.hood+0.16;
  gS.moveTo(p.ws-0.08,gb);gS.quadraticCurveTo(p.ws-0.5,p.roof-0.25,p.roofF-0.05,p.roof-0.1);gS.lineTo(p.roofR+0.05,p.roof-0.1);gS.quadraticCurveTo(p.rw+0.62,p.roof-0.18,p.rw+0.1,Math.max(gb,p.deck+0.1));gS.lineTo(p.ws-0.08,gb);
  const gd=p.bw-0.06,gg=new THREE.ExtrudeGeometry(gS,{depth:gd,bevelEnabled:false,curveSegments:10});gg.translate(0,0,-gd/2);gg.rotateY(-Math.PI/2);
  G.geo[k]={body:geo,glass:gg};return G.geo[k];
}
let _glowT=null;
function carMats(){
  if(G.mat.chrome)return;
  makeEnvOnce();_glowT=glowTex();
  G.mat.chrome=new THREE.MeshStandardMaterial({color:0xdadbe6,metalness:1,roughness:0.18,envMap:G.env,envMapIntensity:1.3});
  G.mat.dark=new THREE.MeshStandardMaterial({color:0x111018,metalness:0.4,roughness:0.55,envMap:G.env,envMapIntensity:0.6});
  G.mat.carbon=new THREE.MeshStandardMaterial({color:0x1a1a22,metalness:0.6,roughness:0.3,envMap:G.env,envMapIntensity:0.8});
  G.mat.white=new THREE.MeshStandardMaterial({color:0xf1edff,metalness:0.2,roughness:0.3,envMap:G.env});
  G.mat.glassP=new THREE.MeshPhysicalMaterial({color:0x0a0a18,metalness:0.2,roughness:0.05,envMap:G.env,envMapIntensity:1.6,transparent:true,opacity:0.72,clearcoat:1});
  G.mat.tireS=new THREE.MeshStandardMaterial({color:0x0b0b0e,roughness:0.9,metalness:0});
  G.mat.amber=new THREE.MeshBasicMaterial({color:0xffe08a});
  G.mat.led=new THREE.MeshBasicMaterial({color:0xff1f3a});
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
  G.mat.hglow=new THREE.SpriteMaterial({map:_glowT,color:0xfff3d6,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true});
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
  carMats();
  const p=SHAPES[type]||SHAPES.street,g=new THREE.Group(),col=new THREE.Color(color),h=p.L/2;
  const B=(w,hh,d,m,x,y,z,rx)=>{const k='b'+w+'|'+hh+'|'+d;let gg=G.geo[k];if(!gg)gg=G.geo[k]=new THREE.BoxGeometry(w,hh,d);const me=new THREE.Mesh(gg,m);me.position.set(x,y,z);if(rx)me.rotation.x=rx;g.add(me);return me;};
  const bodyM=new THREE.MeshPhysicalMaterial({color:col,metalness:0.55,roughness:0.3,clearcoat:1,clearcoatRoughness:0.06,envMap:G.env,envMapIntensity:1.25,emissive:col.clone().multiplyScalar(0.06)});
  const bg=bodyGeo(type||'street');
  g.add(new THREE.Mesh(bg.body,bodyM));
  g.add(new THREE.Mesh(bg.glass,G.mat.glassP));
  // splitter, side skirts, diffuser, exhausts, mirrors
  B(p.bw*0.92,0.08,0.6,G.mat.carbon,0,p.ground+0.05,h-0.1);
  [-1,1].forEach(sd=>B(0.12,0.16,p.wz*2-1.6,G.mat.carbon,sd*(p.bw/2+0.02),p.ground+0.12,0));
  B(p.bw*0.7,0.22,0.5,G.mat.carbon,0,p.ground+0.1,-h+0.1);
  if(!G.geo.exh){G.geo.exh=new THREE.CylinderGeometry(0.15,0.15,0.5,12);G.geo.exh.rotateX(Math.PI/2);}
  [-0.55,0.55].forEach(x=>{const e=new THREE.Mesh(G.geo.exh,G.mat.chrome);e.position.set(x,p.ground+0.22,-h-0.08);g.add(e);});
  [-1,1].forEach(sd=>B(0.32,0.2,0.42,bodyM,sd*(p.bw/2+0.08),p.hood+0.32,p.ws-0.35));
  if(p.scoop)B(1.3,0.32,1.6,G.mat.carbon,0,p.hood+0.12,h*0.45);
  if(p.stripes)[-0.42,0.42].forEach(x=>{B(0.42,0.03,h-0.6,G.mat.white,x,p.hood+0.06,h*0.5);B(0.42,0.03,p.roofF-p.roofR,G.mat.white,x,p.roof+0.22,(p.roofF+p.roofR)/2);});
  if(p.intakes)[-1,1].forEach(sd=>B(0.1,p.hood*0.4,1.5,G.mat.carbon,sd*(p.bw/2+0.06),p.ground+0.5,-0.9));
  if(p.spoiler==='wing'){B(4.2,0.1,0.95,G.mat.carbon,0,p.deck+0.85,-h+0.55);[-1,1].forEach(sd=>B(0.1,0.8,0.32,G.mat.carbon,sd*1.25,p.deck+0.42,-h+0.55));[-1,1].forEach(sd=>B(0.06,0.5,1.0,G.mat.carbon,sd*2.1,p.deck+0.82,-h+0.55));}
  else if(p.spoiler==='lip'){B(p.bw*0.9,0.1,0.7,bodyM,0,p.deck+0.5,-h+0.5);[-1,1].forEach(sd=>B(0.12,0.42,0.2,G.mat.carbon,sd*1.1,p.deck+0.26,-h+0.5));}
  else if(p.spoiler==='duck')B(p.bw*0.86,0.18,0.42,bodyM,0,p.deck+0.24,-h+0.32,0.35);
  if(p.lightbar){B(2.6,0.24,0.42,G.mat.dark,0,p.roof+0.42,p.roofF-0.2);[-0.9,-0.3,0.3,0.9].forEach(x=>B(0.42,0.2,0.08,G.mat.amber,x,p.roof+0.42,p.roofF+0.03));
    B(2.9,0.08,2.2,G.mat.chrome,0,p.roof+0.26,(p.roofF+p.roofR)/2);[-1,1].forEach(sd=>B(0.9,0.75,0.08,G.mat.dark,sd*1.3,p.ground+0.15,-h+0.75));}
  // wheels: open tyre with tread, lettered sidewalls, dark barrel, chrome spokes, brake disc and caliper
  const wr=p.wr,wk='w'+wr;tireMats();
  if(!G.geo[wk]){G.geo[wk]=new THREE.CylinderGeometry(wr,wr,0.62,30,1,true);G.geo['wall'+wr]=new THREE.RingGeometry(wr*0.64,wr,30,1);G.geo['r'+wr]=new THREE.CylinderGeometry(wr*0.64,wr*0.64,0.5,22,1,true);
    G.geo['s'+wr]=new THREE.BoxGeometry(0.1,wr*1.22,0.13);G.geo['c'+wr]=new THREE.CylinderGeometry(wr*0.17,wr*0.17,0.12,12);G.geo['d'+wr]=new THREE.CylinderGeometry(wr*0.55,wr*0.55,0.06,22);G.geo['k'+wr]=new THREE.BoxGeometry(0.2,wr*0.4,wr*0.5);G.geo['hub'+wr]=new THREE.CircleGeometry(wr*0.64,22);}
  const wheels=[];
  [[-1,1],[1,1],[-1,-1],[1,-1]].forEach(([sx,sz])=>{
    const steer=new THREE.Group();steer.position.set(sx*(p.bw/2-0.12),wr,sz*p.wz);g.add(steer);
    const spin=new THREE.Group();steer.add(spin);
    const t=new THREE.Mesh(G.geo[wk],G.mat.tread);t.rotation.z=Math.PI/2;spin.add(t);
    [-1,1].forEach(side=>{const w=new THREE.Mesh(G.geo['wall'+wr],G.mat.wall);w.rotation.y=side*Math.PI/2;w.position.x=side*0.31;spin.add(w);});
    const barrel=new THREE.Mesh(G.geo['r'+wr],G.mat.barrel);barrel.rotation.z=Math.PI/2;spin.add(barrel);
    const back=new THREE.Mesh(G.geo['hub'+wr],G.mat.barrel);back.rotation.y=-sx*Math.PI/2;back.position.x=-sx*0.2;spin.add(back);
    for(let i=0;i<5;i++){const sp=new THREE.Mesh(G.geo['s'+wr],G.mat.chrome);sp.position.x=sx*0.26;sp.rotation.x=i*Math.PI*2/5;spin.add(sp);}
    const cap=new THREE.Mesh(G.geo['c'+wr],G.mat.chrome);cap.rotation.z=Math.PI/2;cap.position.x=sx*0.28;spin.add(cap);
    const disc=new THREE.Mesh(G.geo['d'+wr],G.mat.disc);disc.rotation.z=Math.PI/2;disc.position.x=sx*0.02;steer.add(disc);
    const cal=new THREE.Mesh(G.geo['k'+wr],G.mat.caliper);cal.position.set(sx*0.1,wr*0.3,-wr*0.18);steer.add(cal);
    wheels.push({steer,spin,front:sz>0});});
  // lights: LED bars, lamps, glow and beams, number plate
  const tails=[];tails.push(B(p.bw*0.86,0.14,0.08,G.mat.led,0,p.deck-0.2,-h-0.02));
  [-1,1].forEach(sd=>tails.push(B(p.bw*0.22,0.26,0.1,G.mat.tail,sd*p.bw*0.33,p.deck-0.32,-h-0.03)));
  const tglow=[],hglow=[];
  [-1,1].forEach(sd=>{B(p.bw*0.26,0.16,0.1,G.mat.head,sd*p.bw*0.31,p.hood-0.28,h+0.03);B(p.bw*0.22,0.05,0.1,G.mat.amber,sd*p.bw*0.31,p.hood-0.16,h+0.03);
    const hg=new THREE.Sprite(G.mat.hglow);hg.position.set(sd*p.bw*0.31,p.hood-0.28,h+0.2);hg.scale.set(1.6,1.0,1);g.add(hg);hglow.push(hg);
    const beam=new THREE.Mesh(G.geo.beam,G.mat.beam);beam.rotation.x=-Math.PI/2;beam.position.set(sd*p.bw*0.31,p.hood-0.45,h+6.2);g.add(beam);
    const tg=new THREE.Sprite(G.mat.tglow);tg.position.set(sd*p.bw*0.33,p.deck-0.32,-h-0.25);tg.scale.set(1.3,0.9,1);g.add(tg);tglow.push(tg);});
  const plate=new THREE.Mesh(G.geo.plate,G.mat.plate);plate.position.set(0,p.ground+0.62,-h-0.08);plate.rotation.y=Math.PI;g.add(plate);
  // driver in helmet
  const hm=new THREE.MeshStandardMaterial({color:new THREE.Color(helmet||'#f1edff'),metalness:0.3,roughness:0.2,envMap:G.env});
  if(!G.geo.helm){G.geo.helm=new THREE.SphereGeometry(0.46,18,14);G.geo.visor=new THREE.BoxGeometry(0.58,0.2,0.12);}
  const hz=(p.roofF+p.roofR)/2+0.25,hy=p.roof-0.62;
  const head=new THREE.Mesh(G.geo.helm,hm);head.position.set(0.68,hy,hz);g.add(head);
  const vis=new THREE.Mesh(G.geo.visor,G.mat.dark);vis.position.set(0.68,hy-0.02,hz+0.42);g.add(vis);
  // boost flames, contact shadow, underglow, name tag
  const flames=[-0.55,0.55].map(x=>{const f=new THREE.Mesh(G.geo.flame,G.mat.flameB);f.rotation.x=-Math.PI/2;f.position.set(x,p.ground+0.22,-h-1.45);f.visible=false;g.add(f);return f;});
  const shd=new THREE.Mesh(G.geo.shadow,G.mat.shadow);shd.rotation.x=-Math.PI/2;shd.position.y=0.04;shd.scale.set(p.bw/3.6,p.L/7.4,1);g.add(shd);
  if(human){const gm=new THREE.MeshBasicMaterial({map:_glowT,color:col,transparent:true,opacity:0.75,blending:THREE.AdditiveBlending,depthWrite:false});
    const glow=new THREE.Mesh(G.geo.glow||(G.geo.glow=new THREE.PlaneGeometry(6.4,10.4)),gm);glow.rotation.x=-Math.PI/2;glow.position.y=0.06;g.add(glow);}
  const label=new THREE.Sprite();label.position.set(0,p.roof+2.5,0);label.scale.set(9.2,2,1);g.add(label);
  g.userData={bodyM,flames,tails,tglow,hglow,wheels,label,key:'',baseColor:color,look:color+'|'+type+'|'+helmet,rug:false};
  G.scene.add(g);return g;
}
function placeCar(g,r,d,o){
  tp(r.pos,r.x,o);g.position.set(o.x,o.y,o.z);g.rotation.set(-o.pitch,o.ang,0,'YXZ');
  const u=g.userData;
  if(!!d.rug!==u.rug){u.rug=!!d.rug;u.bodyM.color.set(d.rug?'#5d5a6b':u.baseColor);u.bodyM.emissive.set(d.rug?'#000000':u.baseColor).multiplyScalar(d.rug?0:0.06);}
  const fl=d.moon||d.boost;u.flames.forEach(f=>{f.visible=!!fl&&!reduce;f.material=d.moon?G.mat.flameM:G.mat.flameB;f.scale.y=0.8+Math.random()*0.5;});
  u.tails.forEach(t=>t.scale.set(d.brake?1.3:1,d.brake?1.6:1,1));
  u.tglow.forEach(t=>t.scale.set(d.brake?2.4:1.3,d.brake?1.6:0.9,1));
  if(u.wheels){const roll=Math.min(((r.speed||0)*SC)*(G.dt||0)/0.7,1.15),st=clamp(d.steer!=null?d.steer:(r.tx!=null?-(r.tx-r.x)*2.5:0),-1,1)*0.38;
    u.wheels.forEach(w=>{w.spin.rotation.x+=roll;if(w.front)w.steer.rotation.y+=(st-w.steer.rotation.y)*0.25;});}
  if(d.label){const key=d.label+'|'+d.sub+'|'+d.color+'|'+d.subCol+'|'+(d.human?1:0);if(key!==u.key){u.key=key;u.label.material=labelSprite(key,d);}u.label.visible=true;}else u.label.visible=false;
}
const _o={},_o2={};let _v=null,_v2=null;
function renderGL(pl,others,dt,showMe){
  G.dt=dt;buildGLTrack();
  const fun=S&&S.w.mode==='fun',plSeg=Math.floor(pl.pos/SEG);
  // player car
  const look=me.color+'|'+me.car+'|'+me.helmet;
  if(!G.me||G.me.userData.look!==look){if(G.me)G.scene.remove(G.me);G.me=makeCar(me.color,me.car,me.helmet,true);}
  G.me.visible=showMe;
  if(showMe){const stv=pl.inp&&pl.inp.left?1:pl.inp&&pl.inp.right?-1:(tiltOn&&S?-tiltVal:0);placeCar(G.me,pl,{boost:pl.boosting&&!pl.finished,brake:pl.inp&&pl.inp.brake,steer:stv},_o);G.me.rotation.y+=stv*0.06;}
  // other cars
  const seen=new Set();
  for(const r of others){const gap=r.pos-pl.pos;if(gap<-SEG*30||gap>SEG*DRAW)continue;seen.add(r.id);
    const lk=r.color+'|'+(r.type||'street')+'|'+(r.helmet||'#f1edff');let g=G.cars.get(r.id);if(!g||g.userData.look!==lk){if(g)G.scene.remove(g);g=makeCar(r.color,r.type||'street',r.helmet||'#f1edff',!!r.remote);G.cars.set(r.id,g);}
    g.visible=true;placeCar(g,r,r.d||{color:r.color},_o2);}
  G.cars.forEach((g,id)=>{if(!seen.has(id))g.visible=false;});
  // cans, gates
  G.cans.forEach(c=>{const it=segments[c.n]&&segments[c.n].items[c.k];c.m.visible=!!S&&!!it&&!it.taken&&c.n>plSeg-5&&c.n<plSeg+DRAW;c.m.rotation.y+=dt*2;});
  G.gates.forEach(g=>{const vis=fun&&g.n>plSeg-10&&g.n<plSeg+DRAW;g.grp.visible=vis;
    if(vis){g.t-=dt;if(g.t<=0){g.t=0.3;const it=segments[g.n].items[g.k];const coins=(it&&it.coins)||gatePicks(it||g.it);coins.forEach((k,i)=>drawGatePanel(g.panels[i],k));}}});
  // lamp lights near the player
  let li=0;for(const l of G.lamps){if(l.n<plSeg-4)continue;if(li>=G.lampLights.length||l.n>plSeg+70)break;G.lampLights[li].position.set(l.x,l.y,l.z);li++;}
  for(;li<G.lampLights.length;li++)G.lampLights[li].position.set(0,-999,0);
  // chase camera
  tp(pl.pos,pl.x,_o);const fx=Math.sin(_o.ang),fz=Math.cos(_o.ang);
  const sp=clamp((pl.speed||0)/BASE,0,2);
  const back=12.5+sp*1.5,height=4.8+sp*0.4;
  _v.set(_o.x-fx*back,_o.y+height,_o.z-fz*back);
  const k=G.camInit?1-Math.exp(-dt*7):1;G.camInit=true;
  G.camera.position.lerp(_v,k);
  const minY=tp(Math.max(0,pl.pos-back/SC),pl.x,_o2).y+1.6;if(G.camera.position.y<minY)G.camera.position.y=minY;
  _v2.set(_o.x+fx*16,_o.y+1.8,_o.z+fz*16);G.lookAt.lerp(_v2,G.lookAt.lengthSq()?k:1);G.camera.lookAt(G.lookAt);
  if(pl.shake>0&&!reduce){G.camera.position.x+=(Math.random()-0.5)*0.5;G.camera.position.y+=(Math.random()-0.5)*0.3;}
  const fov=64+sp*9+(pl.boosting?7:0);G.camera.fov+=(fov-G.camera.fov)*Math.min(1,dt*4);G.camera.updateProjectionMatrix();
  // headlight, sky, moon follow
  G.head.position.set(_o.x+fx*3.5,_o.y+1.6,_o.z+fz*3.5);G.head.target.position.set(_o.x+fx*40,_o.y,_o.z+fz*40);
  G.sky.position.copy(G.camera.position);G.stars.position.copy(G.camera.position);
  G.moonDisc.position.set(G.camera.position.x-500,G.camera.position.y+420,G.camera.position.z+700);G.moonDisc.lookAt(G.camera.position);
  G.renderer.render(G.scene,G.camera);
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
function drawHUD(pl,list){
  const c=ctx,fun=S.w.mode==='fun';c.textAlign='left';
  c.font=`44px ${F_RACE}`;c.fillStyle=COL.ink;const pt=`P${placeOf(pl,list)}`;c.fillText(pt,20,56);
  const ptw=c.measureText(pt).width;c.font=`16px ${F_RACE}`;c.fillStyle=COL.dim;c.fillText(`/ ${list.length}`,26+ptw,56);
  const prog=clamp(pl.pos/(FIN*SEG),0,1);c.fillStyle='rgba(13,11,31,0.6)';c.fillRect(20,70,170,6);c.fillStyle=COL.gas;c.fillRect(20,70,170*prog,6);
  for(const r of S.remotes){c.fillStyle=r.color;c.fillRect(20+170*clamp(r.pos/(FIN*SEG),0,1)-1,66,3,14);}
  // mini standings: top 3, you, and friends
  const rows=list.filter((r,i)=>i<3||r.me||r.remote).slice(0,7);
  c.fillStyle='rgba(13,11,31,0.62)';rr(c,16,88,236,rows.length*21+10,8);c.fill();
  rows.forEach((r,j)=>{const y=106+j*21,d=r.d||disp(r),i=list.indexOf(r);
    c.font=`600 12px ${F_MONO}`;c.fillStyle=COL.dim;c.textAlign='left';c.fillText(String(i+1).padStart(2,' '),24,y);
    c.fillStyle=r.color;c.fillRect(46,y-9,8,8);
    c.fillStyle=r.me?COL.gas:r.remote?COL.moon:COL.ink;c.font=(r.me||r.remote)?`13px ${F_RACE}`:`600 12px ${F_MONO}`;
    c.fillText((r.me?'YOU':d.label).slice(0,13),60,y);
    c.textAlign='right';c.font=`600 11px ${F_MONO}`;c.fillStyle=(r.me||r.remote)?COL.gas:d.subCol;c.fillText(r.finished?'FIN':String(d.sub).slice(0,9),244,y);c.textAlign='left';});
  // radar
  const rx=W/2-170,rw=340,ry=18;c.fillStyle='rgba(13,11,31,0.65)';rr(c,rx-10,ry-10,rw+20,36,8);c.fill();
  c.strokeStyle=COL.line;c.beginPath();c.moveTo(rx,ry+8);c.lineTo(rx+rw,ry+8);c.stroke();
  c.font=`600 10px ${F_MONO}`;c.fillStyle=COL.dim;c.fillText('BEHIND',rx,ry+22);c.textAlign='right';c.fillText('AHEAD',rx+rw,ry+22);c.textAlign='left';
  const R=SEG*70;
  for(const r of list){if(r===pl)continue;const g=r.pos-pl.pos;if(Math.abs(g)>R)continue;const xx=rx+rw/2+g/R*rw/2;
    c.fillStyle=r.color;c.beginPath();c.arc(xx,ry+8,r.remote?6:4,0,7);c.fill();if(r.remote){c.strokeStyle=COL.ink;c.lineWidth=1.5;c.stroke();c.lineWidth=1;}}
  c.fillStyle=pl.color;c.fillRect(rx+rw/2-2,ry,4,16);
  c.textAlign='right';c.font=`48px ${F_RACE}`;c.fillStyle=COL.ink;c.fillText(Math.round(pl.speed/BASE*190),W-78,54);c.font=`14px ${F_RACE}`;c.fillStyle=COL.dim;c.fillText('KM/H',W-78,72);
  const pw=320,bx=W-pw-16,by=84,ph=80;c.textAlign='left';c.fillStyle='rgba(13,11,31,0.74)';rr(c,bx,by,pw,ph,8);c.fill();
  const eg=fun?engine(pl):priceFactor()*engine(pl);
  if(fun){const cn=S.w.coins[pl.coin];c.fillStyle=cn.color;c.fillRect(bx,by,5,ph);c.font=`18px ${F_RACE}`;c.fillText(pl.coin,bx+14,by+24);const cw=c.measureText(pl.coin).width;
    c.font=`600 13px ${F_MONO}`;c.fillStyle=cn.rugged?COL.dim:cn.m>=50?COL.moon:cn.mom>=0?COL.up:COL.down;c.fillText(cn.rugged?'RUGGED':fmtM(cn.m),bx+22+cw,by+23);
    c.fillStyle=COL.ink;c.font=`600 15px ${F_MONO}`;c.fillText(fmtUsd(myValue(pl)),bx+14,by+47);
  } else {const mk=S.w.mk,ch=(mk.P/mk.p0-1)*100,tl=tokLabel();c.fillStyle=TOK[S.tok]?TOK[S.tok].color:COL.gas;c.fillRect(bx,by,5,ph);
    c.font=`18px ${F_RACE}`;c.fillText(tl,bx+14,by+24);const cw=c.measureText(tl).width;
    c.font=`600 13px ${F_MONO}`;c.fillStyle=COL.ink;const pt=fmtPrice(mk.P);c.fillText(pt,bx+22+cw,by+23);const ptw=c.measureText(pt).width;
    c.fillStyle=ch>=0?COL.up:COL.down;c.fillText(`${ch>=0?'+':''}${ch.toFixed(1)}%`,bx+30+cw+ptw,by+23);
    c.fillStyle=COL.ink;c.font=`600 12px ${F_MONO}`;c.fillText(`${fmtAmt(pl.amt)} ${tl.replace('$','')} · ${fmtUsd(myValue(pl))} · cash ${fmtUsd(pl.cash)}`,bx+14,by+46);}
  c.font=`600 11px ${F_MONO}`;c.fillStyle=eg>=1?COL.up:COL.down;c.fillText(`${fun?'ENGINE':'SPEED'} ${(eg*100).toFixed(0)}%`,bx+14,by+68);
  if(pl.realX){c.fillStyle=COL.moon;c.textAlign='right';c.fillText(`YOUR WALLET ${fmtX(pl.realX)}`,bx+pw-10,by+68);c.textAlign='left';}
  if(fun){const gx=bx,gy=by+ph+8;c.fillStyle='rgba(13,11,31,0.74)';rr(c,gx,gy,pw,30,8);c.fill();c.fillStyle=COL.line;c.fillRect(gx+12,gy+9,pw-80,12);c.fillStyle=pl.gas>15?COL.gas:COL.down;c.fillRect(gx+12,gy+9,(pw-80)*pl.gas/100,12);
    c.font=`16px ${F_RACE}`;c.fillStyle=pl.boosting?'#7ad7ff':COL.gas;c.textAlign='right';c.fillText('GAS',gx+pw-10,gy+21);}
  if(fun){const ng=GATES.find(g=>g.n*SEG>pl.pos);if(ng){const d=(ng.n*SEG-pl.pos)/SEG;if(d<70){c.textAlign='center';c.font=`16px ${F_RACE}`;c.fillStyle=COL.gas;c.fillText(`SWAP GATE ${Math.round(d*4)}m · pick a lane`,W/2,74);}}}
  c.textAlign='center';pl.toasts.forEach((t,i)=>{c.globalAlpha=Math.min(1,t.t*2);c.font=`26px ${F_RACE}`;c.fillStyle=t.color;c.fillText(t.txt,W/2,H*0.36+i*32);});c.globalAlpha=1;
  const left=(S.go-Date.now())/1000;
  if(left>0){c.font=`120px ${F_RACE}`;c.fillStyle=COL.gas;c.fillText(Math.ceil(left),W/2,H*0.56);c.font=`18px ${F_RACE}`;c.fillStyle=COL.ink;c.fillText(S.remotes.length?`${S.remotes.length+1} RACERS ON THE GRID`:'GET READY',W/2,H*0.64);}
  else if(left>-0.9){c.font=`110px ${F_RACE}`;c.fillStyle=COL.up;c.globalAlpha=1+left;c.fillText('GO',W/2,H*0.56);c.globalAlpha=1;}
  c.textAlign='left';
}

/* ================= DOM panels ================= */
function renderBoard(list){
  if(!S){$('#board').innerHTML='<li style="color:var(--dim);display:block">Start a race to see the standings.</li>';return;}
  $('#board').innerHTML=list.map((r,i)=>{
    let nm,tag;
    if(r.me||r.remote){nm=`<span class="nm h">${esc(r.me?r.name+' (you)':r.name)}</span>`;tag=`<span class="tagc c-gas">${fmtUsd(r.me?myValue(r):r.value)}</span>`;}
    else{const d=r.d||disp(r);nm=`<span class="nm${S.w.mode==='fun'?' h':''}">${esc(d.label)}</span>`;
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
    return `<tr class="${r.me?'me':r.remote?'friend':''}"><td>${i+1}</td><td class="${human?'':'a'}">${esc(human?r.name+(r.me?' (you)':''):d.label)}</td><td>${r.finished?(r.ft-Math.max(0,0)).toFixed(1)+'s':'racing'}</td><td>${human?fmtUsd(r.me?myValue(r):r.value):esc(d.sub)}</td></tr>`;}).join('');
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
function renderGarage(){
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
  const big=d.holders.filter(h=>(h.x||0)>=100).length,ch=d.ch24;
  el.innerHTML=`<span class="rtok">${img}<b>$${esc(d.symbol||'TOKEN')}</b> ${fmtPrice(d.price)}${ch!=null?` <span class="${ch>=0?'ok':'bad'}">${ch>=0?'+':''}${ch.toFixed(1)}% 24h</span>`:''}</span> ${d.holders.length} holder cars · ${d.trades.length} real trades in the last day${big?` · ${big} wallet${big>1?'s':''} up 100x or more`:''}.`;
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
/* hold the left or right side of the screen to steer */
const touchSide=new Map();
function applyTouch(){if(!S)return;let l=0,r=0;touchSide.forEach(s=>{if(s<0)l=1;else r=1;});S.me.inp.left=l||S.me.padL?1:0;S.me.inp.right=r||S.me.padR?1:0;}
cv.addEventListener('pointerdown',e=>{if(!S||state!=='race')return;const b=cv.getBoundingClientRect();touchSide.set(e.pointerId,(e.clientX-b.left)<b.width/2?-1:1);try{cv.setPointerCapture(e.pointerId);}catch(_){}applyTouch();e.preventDefault();});
['pointerup','pointercancel','lostpointercapture'].forEach(ev=>cv.addEventListener(ev,e=>{if(touchSide.delete(e.pointerId))applyTouch();}));

function safeGL(pl,others,dt){try{renderGL(pl,others,dt,true);}catch(e){console.error(e);G=null;$('#gl').style.display='none';renderView(pl,others);}}
/* ================= loop ================= */
let last=performance.now(),uiT=0,idleZ=0;
buildTrack();
try{G=initGL();applySceneTheme();}catch(e){console.error(e);G=null;}
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
    const list=ranked();list.forEach(r=>r.d=disp(r));
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
  requestAnimationFrame(frame);
}
renderBoard([]);
requestAnimationFrame(frame);
})();
