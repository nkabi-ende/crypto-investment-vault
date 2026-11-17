/** CIV public seven-asset watchlist. Only server-verified CoinGecko data is rendered. */
(()=>{
'use strict';
const names=['BTC','ETH','SOL','XRP','BNB','ADA','DOGE'];
const status=document.getElementById('marketWatchStatus');
const retry=document.getElementById('marketWatchRetry');
if(!status)return;
const key='civ:coingecko-big7-last-good';
let inFlight=false,lastRequestAt=0,failRetry=null;
const formatPrice=n=>n<0.01?'$'+n.toLocaleString('en-US',{minimumFractionDigits:4,maximumFractionDigits:7}):
 n<1?'$'+n.toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:6}):
 '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function previous(){
 try{
  const p=JSON.parse(localStorage.getItem(key)||'null');
  if(p&&Date.now()-new Date(p.asOf).getTime()<6*60*60_000&&p.assets?.length===7)return p;
 }catch{}
 return null;
}
function render(data,fromBrowser=false){
 if(!data||!Array.isArray(data.assets)||data.assets.length!==7)return false;
 const map=new Map(data.assets.map(asset=>[asset.symbol,asset]));
 for(const symbol of names){
  const asset=map.get(symbol),el=document.getElementById('quote'+symbol);
  if(!asset||!el||typeof asset.priceUsd!=='number'||!Number.isFinite(asset.priceUsd)||asset.priceUsd<=0)return false;
  el.textContent=formatPrice(asset.priceUsd);
  const label=el.nextElementSibling;
  if(label){
   const change=typeof asset.change24h==='number'&&Number.isFinite(asset.change24h)?
    ' · '+(asset.change24h>=0?'+':'')+asset.change24h.toFixed(2)+'%':'';
   label.textContent='CoinGecko · 24h'+change;
  }
 }
 const at=new Date(data.asOf),stale=Boolean(data.stale)||fromBrowser||Date.now()-at.getTime()>10*60_000;
 const label=Number.isFinite(at.getTime())?at.toLocaleString():'time unavailable';
 status.textContent=(stale?'Previous verified snapshot':'CoinGecko spot prices')+' · Updated '+label+(stale?' · Delayed':' · Refreshes about every 10 min');
 status.dataset.state=stale?'stale':'fresh';
 window.civMarketSnapshot={...data,stale};
 window.dispatchEvent(new CustomEvent('civ:market-snapshot',{detail:window.civMarketSnapshot}));
 return true;
}
function problem(code){
 if(code==='PROVIDER_NOT_CONFIGURED')return 'CoinGecko connection pending. CIV needs its API key in Cloudflare.';
 if(code==='PROVIDER_AUTH_FAILED')return 'CoinGecko API key needs attention.';
 if(code==='PROVIDER_RATE_LIMITED')return 'CoinGecko is rate limiting requests. Last known prices may still be shown.';
 if(code==='MARKET_REFRESHING')return 'Market prices are syncing. Retrying shortly.';
 return 'CoinGecko prices are temporarily unavailable. Please retry.';
}
async function load(){
 if(inFlight||document.hidden)return;
 inFlight=true;lastRequestAt=Date.now();
 retry.disabled=true;status.textContent='Checking CoinGecko spot prices…';
 try{
  const r=await fetch('/api/markets',{cache:'no-store',signal:AbortSignal.timeout(13000)});
  const result=await r.json().catch(()=>({}));
  if(!r.ok){
   const old=previous();if(old)render({...old,stale:true},true);
   const message=problem(result.code);
   status.textContent=old?status.textContent+' · '+message:message;
   status.dataset.state='error';
   if(result.code==='MARKET_REFRESHING'){
    clearTimeout(failRetry);failRetry=setTimeout(()=>{if(!document.hidden)load()},5500);
   }
   return;
  }
  if(!render(result))throw Error('Incomplete market response');
  if(!result.stale){try{localStorage.setItem(key,JSON.stringify({asOf:result.asOf,assets:result.assets}))}catch{}}
 }catch{
  const old=previous();if(old)render({...old,stale:true},true);
  status.textContent=old?status.textContent+' · Feed temporarily offline':'Market data is unavailable. Check the connection and retry.';
  status.dataset.state='error';
 }finally{inFlight=false;retry.disabled=false}
}
const old=previous();if(old)render({...old,stale:true},true);
retry.addEventListener('click',load);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRequestAt>=10*60_000)load()});
setInterval(()=>{if(!document.hidden&&Date.now()-lastRequestAt>=10*60_000)load()},60_000);
load();
})();
