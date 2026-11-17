/** One selected asset, cached reference data; no wallet or account dependencies. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),buttons=[...document.querySelectorAll('[data-asset]')];
if(!buttons.length)return;
const ids={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',XRP:'ripple',BNB:'binancecoin',ADA:'cardano',DOGE:'dogecoin'};
const profiles=new Map([...document.querySelectorAll('.asset-profile')].map(el=>[el.querySelector('.asset-head .muted')?.textContent,{name:el.querySelector('strong')?.textContent,role:el.querySelector('.asset-role')?.textContent,about:el.querySelector('p')?.textContent}]));
let selected='BTC',quotes=window.civMarketSnapshot?.assets||null,version=0;
const cache=new Map(),pending=new Map();
const percent=n=>typeof n==='number'&&Number.isFinite(n)?(n>0?'+':'')+n.toFixed(2)+'%':'—';
const price=n=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:n<1?5:2}).format(n):'—';
function metric(id,value,text){const el=$(id);el.textContent=text;el.dataset.direction=typeof value==='number'&&Number.isFinite(value)?value<0?'down':value>0?'up':'flat':'flat'}
function renderQuote(){const asset=quotes?.find(x=>x.symbol===selected);$('assetDetailPrice').textContent=price(asset?.priceUsd);metric('assetDetail24h',asset?.change24h,percent(asset?.change24h))}
async function ytd(symbol){
 const year=new Date().getUTCFullYear(),key=year+':'+symbol,old=cache.get(key);
 if(old&&Date.now()-old.at<10*60_000)return old.data;
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
  const r=await fetch('/api/markets/'+symbol+'/ytd',{signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('YTD unavailable');
  const data=await r.json();
  if(data.symbol!==symbol||data.year!==year)throw Error('Wrong asset or year');
  if(typeof data.changePct==='number'&&Number.isFinite(data.changePct))cache.set(key,{data,at:Date.now()});
  return data;
 })();
 pending.set(key,task);try{return await task}finally{pending.delete(key)}
}
async function select(symbol){
 if(!ids[symbol])return;
 selected=symbol;const current=++version,profile=profiles.get(symbol);
 buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.asset===symbol)));
 $('assetDetailName').textContent=profile?.name||symbol;$('assetDetailRole').textContent=profile?.role||'';$('assetDetailAbout').textContent=profile?.about||'';
 $('assetDetailIcon').src='/assets/coins/'+symbol.toLowerCase()+'.svg';$('assetDetailSource').href='https://www.coingecko.com/en/coins/'+ids[symbol];
 $('assetDetailYtdLabel').textContent=new Date().getUTCFullYear()+' · YTD';metric('assetDetailYtd',null,'—');renderQuote();
 $('assetDetailRetry').hidden=true;$('assetDetail').setAttribute('aria-busy','true');$('assetDetailStatus').textContent='Loading '+symbol+' year-to-date performance…';
 try{
  const data=await ytd(symbol);if(current!==version)return;
  const valid=typeof data.changePct==='number'&&Number.isFinite(data.changePct);
  metric('assetDetailYtd',data.changePct,percent(data.changePct));
  if(valid){$('assetDetailPrice').textContent=price(data.priceUsd);$('assetDetailStatus').textContent='CoinGecko · 1 Jan '+data.year+' → '+new Date(data.asOf).toLocaleString()+(data.stale?' · Delayed snapshot':' · USD spot');}
  else{$('assetDetailStatus').textContent='YTD unavailable from CoinGecko. Background and charts are still available.';$('assetDetailRetry').hidden=false}
 }catch{if(current!==version)return;$('assetDetailStatus').textContent='YTD data could not be loaded. Try again shortly.';$('assetDetailRetry').hidden=false}
 finally{if(current===version)$('assetDetail').setAttribute('aria-busy','false')}
}
buttons.forEach((button,index)=>{
 button.addEventListener('click',()=>select(button.dataset.asset));
 button.addEventListener('keydown',e=>{let i;if(e.key==='ArrowRight')i=(index+1)%buttons.length;if(e.key==='ArrowLeft')i=(index+buttons.length-1)%buttons.length;if(e.key==='Home')i=0;if(e.key==='End')i=buttons.length-1;if(i!==undefined){e.preventDefault();buttons[i].focus();buttons[i].click()}});
});
$('assetDetailRetry').addEventListener('click',()=>select(selected));
$('assetDetailChart').addEventListener('click',()=>document.querySelector('[data-market="'+selected+'"]')?.click());
window.addEventListener('civ:market-snapshot',e=>{quotes=e.detail.assets;renderQuote()});
// Research loads only as the selector approaches the viewport.
if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){select(selected);observer.disconnect()}},{rootMargin:'200px'});observer.observe($('assetDetail'))}else select(selected);
})();
