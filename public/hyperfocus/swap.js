/* Hyperfocus GP: offline swap, demo wallet and the link to the site wallet. Built from the game source. */
/* ================= offline swap + demo wallet ================= */
(function(){
const $=s=>document.querySelector(s);
const TOKS=['SOL','ETH','BNB','USDT'];
const REF={SOL:150,ETH:3000,BNB:600,USDT:1};
const DP={SOL:4,ETH:5,BNB:4,USDT:2};
const START={SOL:2,ETH:0.1,BNB:0.5,USDT:200};
const PREFIX='PRSWAP1.';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(t,n)=>(+n).toLocaleString('en-US',{maximumFractionDigits:DP[t]});
const enc=new TextEncoder(),dec=new TextDecoder();
const b64u=buf=>{let s='';new Uint8Array(buf).forEach(b=>s+=String.fromCharCode(b));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const unb64u=s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;};
const hasCrypto=!!(window.crypto&&crypto.subtle);
async function sha(str){const h=await crypto.subtle.digest('SHA-256',enc.encode(str));return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');}
const ALG={name:'ECDSA',namedCurve:'P-256'},SIG={name:'ECDSA',hash:'SHA-256'};

let slot='A',W=null;
function load(s){try{const raw=localStorage.getItem('pr-wallet-'+s);if(raw)return JSON.parse(raw);}catch(e){}return null;}
function save(){try{localStorage.setItem('pr-wallet-'+slot,JSON.stringify(W));}catch(e){}}
async function ensure(s){
  let w=load(s);
  if(!w||!w.pub){
    w={bal:{...START},swaps:[],offers:[],act:[]};
    if(hasCrypto){const kp=await crypto.subtle.generateKey(ALG,true,['sign','verify']);w.priv=await crypto.subtle.exportKey('jwk',kp.privateKey);const pj=await crypto.subtle.exportKey('jwk',kp.publicKey);w.pub={x:pj.x,y:pj.y};w.addr='0x'+(await sha(pj.x+pj.y)).slice(0,40);}
    w.act.unshift({ts:Date.now(),t:`Wallet created with demo funds.`});
    slot=s;W=w;save();
  }
  return w;
}
async function sign(str){const k=await crypto.subtle.importKey('jwk',W.priv,ALG,false,['sign']);return b64u(await crypto.subtle.sign(SIG,k,enc.encode(str)));}
async function verify(pub,str,sig){try{const k=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:pub.x,y:pub.y,ext:true},ALG,false,['verify']);return await crypto.subtle.verify(SIG,k,unb64u(sig),enc.encode(str));}catch(e){return false;}}
function pack(b,s){return PREFIX+b64u(enc.encode(JSON.stringify({b,s})));}
function unpack(code){code=(code||'').trim().replace(/\s+/g,'');if(!code.startsWith(PREFIX))throw new Error('That isn’t a swap code from this app.');const o=JSON.parse(dec.decode(unb64u(code.slice(PREFIX.length))));if(!o||!o.b||!o.s)throw new Error('The code is incomplete. Copy the whole thing.');return o;}
function locked(t){let n=0;W.swaps.forEach(s=>{if(s.status==='signed'&&s.out.tok===t)n+=s.out.amt;});W.offers.forEach(o=>{if(o.open&&o.give.tok===t)n+=o.give.amt;});return n;}
const avail=t=>W.bal[t]-locked(t);
function act(t){W.act.unshift({ts:Date.now(),t});W.act=W.act.slice(0,40);}
const short=a=>a?a.slice(0,6)+'…'+a.slice(-4):'?';
const ago=ts=>{const s=Math.round((Date.now()-ts)/1000);return s<60?s+'s ago':s<3600?Math.round(s/60)+'m ago':Math.round(s/3600)+'h ago';};

/* ---- tabs ---- */
function showTab(name){if(!['race','swap','wallet'].includes(name))name='race';
  ['race','swap','wallet'].forEach(n=>{$('#tab-'+n).hidden=n!==name;$('#tb-'+n).setAttribute('aria-selected',n===name);});
  if(name==='wallet')renderWallet();}
document.querySelectorAll('nav.tabs button').forEach(b=>b.onclick=()=>{location.hash=b.dataset.tab;showTab(b.dataset.tab);});
addEventListener('hashchange',()=>showTab(location.hash.slice(1)));
showTab(location.hash.slice(1)||'race');

/* ---- connection chip ---- */
function net(){const on=navigator.onLine;$('#netChip').classList.toggle('on',on);$('#netChip').lastElementChild.textContent=on?'Online · swaps can settle':'Offline · you can still swap';renderSettle();}
addEventListener('online',net);addEventListener('offline',net);

/* ---- make offer ---- */
function fillSel(sel,val){sel.innerHTML=TOKS.map(t=>`<option ${t===val?'selected':''}>${t}</option>`).join('');}
fillSel($('#gTok'),'SOL');fillSel($('#wTok'),'USDT');
function rateHint(){const g=+$('#gAmt').value,w=+$('#wAmt').value,gt=$('#gTok').value,wt=$('#wTok').value;
  if(!(g>0)||!(w>0)){$('#rateHint').textContent='';return;}
  const fair=g*REF[gt]/REF[wt],diff=(w/fair-1)*100;
  $('#rateHint').innerHTML=`Last synced price: ${fmt(gt,g)} ${gt} ≈ ${fmt(wt,fair)} ${wt}. Your ask is <span class="${Math.abs(diff)<3?'ok':diff>0?'bad':'ok'}">${diff>=0?'+':''}${diff.toFixed(1)}%</span> vs that. Available: ${W?fmt(gt,avail(gt)):'…'} ${gt}.`;}
['gAmt','wAmt','gTok','wTok'].forEach(id=>$('#'+id).addEventListener('input',rateHint));
$('#bFair').onclick=()=>{const g=+$('#gAmt').value,gt=$('#gTok').value,wt=$('#wTok').value;if(g>0){$('#wAmt').value=+(g*REF[gt]/REF[wt]).toFixed(DP[wt]);rateHint();}};
function err(id,t){const e=$(id);e.textContent=t||'';e.hidden=!t;}
function qr(el,text){el.innerHTML='';if(window.QRCode){try{new QRCode(el,{text,width:240,height:240,colorDark:'#0d0b1f',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.L});return;}catch(e){}}el.innerHTML='<span style="color:#0d0b1f;font-size:13px;padding:8px">QR not available here. Share the code below.</span>';}
let current=null;
$('#bSign').onclick=async()=>{
  err('#makeErr');if(!hasCrypto){err('#makeErr','This browser can’t sign. Try another browser.');return;}
  const g=+$('#gAmt').value,w=+$('#wAmt').value,gt=$('#gTok').value,wt=$('#wTok').value;
  if(!(g>0)||!(w>0)){err('#makeErr','Enter both amounts.');return;}
  if(gt===wt){err('#makeErr','Pick two different coins.');return;}
  if(avail(gt)<g-1e-12){err('#makeErr',`You only have ${fmt(gt,avail(gt))} ${gt} available.`);return;}
  const body={t:'offer',id:b64u(crypto.getRandomValues(new Uint8Array(9))),maker:W.addr,mpub:W.pub,give:{tok:gt,amt:g},get:{tok:wt,amt:w},exp:Date.now()+24*3600e3};
  const str=JSON.stringify(body),sig=await sign(str),code=pack(body,sig);
  W.offers.unshift({id:body.id,open:true,give:body.give,get:body.get,ts:Date.now(),hash:await sha(str)});W.offers=W.offers.slice(0,20);
  act(`Signed offer: give ${fmt(gt,g)} ${gt} for ${fmt(wt,w)} ${wt}. ${fmt(gt,g)} ${gt} is held until it completes or you reset.`);save();
  current=body.id;$('#offerCode').value=code;qr($('#offerQR'),code);$('#offerOut').hidden=false;$('#completeMsg').textContent='';$('#acceptIn').value='';rateHint();
};
$('#bComplete').onclick=async()=>{
  const m=$('#completeMsg');
  try{
    const o=unpack($('#acceptIn').value),b=o.b;
    if(b.t!=='accept')throw new Error('That’s an offer, not an acceptance. Paste the code they showed you after accepting.');
    const mine=W.offers.find(x=>x.id===b.oid);
    if(!mine)throw new Error('This acceptance is for an offer made by a different wallet.');
    if(!mine.open)throw new Error('This swap is already complete.');
    if(b.ohash!==mine.hash)throw new Error('The acceptance doesn’t match your offer. Don’t complete it.');
    if(!await verify(b.tpub,JSON.stringify(b),o.s))throw new Error('The acceptance signature is invalid. Don’t complete it.');
    if(b.taker!=='0x'+(await sha(b.tpub.x+b.tpub.y)).slice(0,40))throw new Error('The acceptance signature doesn’t match the sender’s wallet.');
    mine.open=false;
    W.swaps.unshift({id:b.oid,role:'maker',out:mine.give,in:mine.get,counter:b.taker,status:'signed',ts:Date.now()});
    act(`Swap signed by both sides with ${short(b.taker)}. Waiting to settle.`);save();
    m.innerHTML=`<span class="ok">Swap complete offline.</span> Signed by you and ${esc(short(b.taker))}. It settles the next time either phone is online. See it in Wallet.`;
  }catch(e){m.innerHTML=`<span class="bad">${esc(e.message||'Couldn’t read that code.')}</span>`;}
};

/* ---- take offer ---- */
let pending=null;
$('#bRead').onclick=async()=>{
  err('#takeErr');$('#offerView').hidden=true;$('#acceptOut').hidden=true;pending=null;
  try{
    const o=unpack($('#offerIn').value),b=o.b;
    if(b.t!=='offer')throw new Error('That’s an acceptance code. Paste it under “Make an offer” instead.');
    const sigOk=await verify(b.mpub,JSON.stringify(b),o.s);
    const addrOk=b.maker==='0x'+(await sha(b.mpub.x+b.mpub.y)).slice(0,40);
    if(!sigOk||!addrOk)throw new Error('The signature on this offer is invalid. Someone may have changed it. Don’t accept it.');
    if(b.maker===W.addr)throw new Error('This is your own offer. Switch to the other wallet or use a second phone to take it.');
    if(b.exp<Date.now())throw new Error('This offer has expired.');
    if(W.swaps.some(s=>s.id===b.id))throw new Error('You already accepted this offer.');
    pending={o,b};
    $('#dealBox').innerHTML=`<div><small>You get</small><b>${fmt(b.give.tok,b.give.amt)}</b><small>${b.give.tok}</small></div><div class="arr">⇄</div><div><small>You give</small><b>${fmt(b.get.tok,b.get.amt)}</b><small>${b.get.tok}</small></div>`;
    const fair=b.give.amt*REF[b.give.tok]/REF[b.get.tok],diff=(b.get.amt/fair-1)*100;
    $('#dealMeta').innerHTML=`<span class="ok">✓ Signature valid</span> · from ${esc(short(b.maker))} · expires in ${Math.round((b.exp-Date.now())/3600e3)}h · you pay ${Math.abs(diff).toFixed(1)}% ${diff>0?'above':'below'} the last synced price · available: ${fmt(b.get.tok,avail(b.get.tok))} ${b.get.tok}`;
    $('#bAccept').disabled=avail(b.get.tok)<b.get.amt-1e-12;
    if($('#bAccept').disabled)$('#dealMeta').innerHTML+=` · <span class="bad">not enough ${b.get.tok}</span>`;
    $('#offerView').hidden=false;
  }catch(e){err('#takeErr',e.message&&e.message.length<160?e.message:'Couldn’t read that code. Copy the whole thing and try again.');}
};
$('#bAccept').onclick=async()=>{
  if(!pending)return;const b=pending.b;
  if(avail(b.get.tok)<b.get.amt-1e-12){err('#takeErr',`You need ${fmt(b.get.tok,b.get.amt)} ${b.get.tok} available.`);return;}
  const body={t:'accept',oid:b.id,ohash:await sha(JSON.stringify(b)),taker:W.addr,tpub:W.pub};
  const code=pack(body,await sign(JSON.stringify(body)));
  W.swaps.unshift({id:b.id,role:'taker',out:b.get,in:b.give,counter:b.maker,status:'signed',ts:Date.now()});
  act(`Accepted offer from ${short(b.maker)}: give ${fmt(b.get.tok,b.get.amt)} ${b.get.tok}, get ${fmt(b.give.tok,b.give.amt)} ${b.give.tok}.`);save();
  $('#acceptCode').value=code;qr($('#acceptQR'),code);$('#acceptOut').hidden=false;$('#offerView').hidden=true;pending=null;
};

/* ---- QR photo upload ---- */
function readQR(file,target,after){
  if(!file)return;if(!window.jsQR){target.value='';target.placeholder='QR reading isn’t available here. Paste the code instead.';return;}
  const img=new Image(),url=URL.createObjectURL(file);
  img.onload=()=>{const sc=Math.min(1,1400/Math.max(img.width,img.height)),cv=document.createElement('canvas');cv.width=Math.round(img.width*sc);cv.height=Math.round(img.height*sc);
    const c=cv.getContext('2d');c.drawImage(img,0,0,cv.width,cv.height);const d=c.getImageData(0,0,cv.width,cv.height);const r=jsQR(d.data,cv.width,cv.height);URL.revokeObjectURL(url);
    if(r&&r.data){target.value=r.data;after();}else{target.value='';target.placeholder='No QR code found in that photo. Try a sharper, closer photo, or paste the code.';}};
  img.onerror=()=>URL.revokeObjectURL(url);img.src=url;
}
$('#offerImg').onchange=e=>readQR(e.target.files[0],$('#offerIn'),()=>$('#bRead').click());
$('#acceptImg').onchange=e=>readQR(e.target.files[0],$('#acceptIn'),()=>$('#bComplete').click());
function copy(btn,ta){const t=ta.value;const done=()=>{btn.textContent='Copied';setTimeout(()=>btn.textContent='Copy code',1500);};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(done).catch(()=>{ta.select();});else ta.select();}
$('#bCopyOffer').onclick=()=>copy($('#bCopyOffer'),$('#offerCode'));
$('#bCopyAccept').onclick=()=>copy($('#bCopyAccept'),$('#acceptCode'));

/* ---- wallet ---- */
function renderWallet(){
  if(!W)return;
  $('#wAddr').textContent=W.addr||'Signing not available in this browser';
  $('#wA').setAttribute('aria-pressed',slot==='A');$('#wB').setAttribute('aria-pressed',slot==='B');
  $('#balBody').innerHTML=TOKS.map(t=>`<tr><td>${t}</td><td class="num">${fmt(t,W.bal[t])}</td><td class="num">${locked(t)?fmt(t,locked(t)):'—'}</td><td class="num">${fmt(t,avail(t))}</td></tr>`).join('');
  const open=W.offers.filter(o=>o.open).map(o=>`<li><span class="what">Give ${fmt(o.give.tok,o.give.amt)} ${o.give.tok} → get ${fmt(o.get.tok,o.get.amt)} ${o.get.tok}</span><span class="pill wait">waiting for taker</span><span class="meta">Offer signed ${ago(o.ts)}. Paste their acceptance in Offline swap to finish.</span></li>`);
  const sw=W.swaps.map(s=>`<li><span class="what">${fmt(s.out.tok,s.out.amt)} ${s.out.tok} → ${fmt(s.in.tok,s.in.amt)} ${s.in.tok}</span><span class="pill ${s.status==='settled'?'done':'wait'}">${s.status==='settled'?'settled':'signed offline'}</span><span class="meta">With ${esc(short(s.counter))} · ${s.role==='maker'?'you made the offer':'you took the offer'} · ${ago(s.ts)}</span></li>`);
  $('#swapList').innerHTML=open.concat(sw).join('')||'<li><span class="meta">No swaps yet. Make or take an offer in Offline swap.</span></li>';
  $('#actList').innerHTML=W.act.slice(0,12).map(a=>`<li><span class="meta" style="color:var(--ink)">${esc(a.t)}</span><span class="meta">${ago(a.ts)}</span></li>`).join('');
  renderSettle();
}
function renderSettle(){
  if(!W)return;const n=W.swaps.filter(s=>s.status==='signed').length,on=navigator.onLine;
  $('#bSettle').disabled=!n||!on;
  $('#settleHint').textContent=!n?'Nothing waiting to settle.':on?`${n} swap${n>1?'s':''} ready to broadcast.`:`${n} swap${n>1?'s':''} signed and safe on this phone. They’ll settle when you’re back online.`;
}
$('#bSettle').onclick=()=>{
  if(!navigator.onLine)return;$('#bSettle').disabled=true;$('#settleHint').textContent='Broadcasting to the chain…';
  setTimeout(()=>{W.swaps.forEach(s=>{if(s.status==='signed'){s.status='settled';W.bal[s.out.tok]-=s.out.amt;W.bal[s.in.tok]+=s.in.amt;act(`Settled: sent ${fmt(s.out.tok,s.out.amt)} ${s.out.tok}, received ${fmt(s.in.tok,s.in.amt)} ${s.in.tok}.`);}});save();renderWallet();},1300);
};
async function switchTo(s){$('#wAddr').textContent='Loading…';W=await ensure(s);slot=s;try{localStorage.setItem('pr-wallet-slot',s);}catch(e){}renderWallet();rateHint();$('#offerOut').hidden=true;$('#offerView').hidden=true;$('#acceptOut').hidden=true;}
$('#wA').onclick=()=>switchTo('A');$('#wB').onclick=()=>switchTo('B');
let resetArm=false;
$('#bReset').onclick=async()=>{if(!resetArm){resetArm=true;$('#resetMsg').textContent='Tap again to wipe this demo wallet.';setTimeout(()=>{resetArm=false;$('#resetMsg').textContent='';},4000);return;}
  resetArm=false;$('#resetMsg').textContent='';try{localStorage.removeItem('pr-wallet-'+slot);}catch(e){}W=null;await switchTo(slot);};

/* ---- hooks for the race ---- */
window.PRWallet={
  creditRace(delta,place){if(!W)return;const d=Math.max(-W.bal.USDT,+delta||0);W.bal.USDT+=d;act(`Race finished P${place}: ${d>=0?'+':''}${d.toFixed(2)} USDT ${d>=0?'won':'lost'}.`);save();},
  logRaceSwap(from,to,usd){if(!W)return;act(`In-race offline swap ${from} → ${to} ($${usd.toFixed(2)}).`);save();}
};

/* ---- the site's real wallet (only on autistik.io) ---- */
if(window.HFWallet){
  $('#siteWallet').hidden=false;
  $('#bConnect').onclick=()=>{try{window.HFWallet.connect();}catch(e){}};
  const upd=async()=>{let t='';try{t=await window.HFWallet.label();}catch(e){}$('#swStatus').textContent=t?'Connected: '+t:'Not connected';$('#bConnect').textContent=t?'Switch wallet':'Connect a wallet';};
  try{window.HFWallet.subscribe(upd);}catch(e){}upd();
}
let s0='A';try{s0=localStorage.getItem('pr-wallet-slot')||'A';}catch(e){}
switchTo(s0==='B'?'B':'A').then(net);
net();
})();
