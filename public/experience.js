/* CIV enhancement layer. No dependency, payment signing keys, or invented market data. */
(()=>{
'use strict';
const $=q=>document.querySelector(q);
const steps=[
 ['Get your MiniPay wallet','New to MiniPay? Install the app and set up a wallet.','Download MiniPay from the official app stores and follow its onboarding. You do not need MiniPay to register for CIV. When funding is available, the paying MiniPay wallet must be different from CIV’s receiving wallet.'],
 ['Add USDC or USDT','In MiniPay, choose Add Cash.','Choose a funding method supported in your region, follow the provider’s instructions, and confirm that the token has arrived in MiniPay on Celo. Fees, identity checks and payment options vary. Buying stablecoins in MiniPay does not deposit them into CIV.'],
 ['Choose your CIV amount','Select 100 or 200 USDC or USDT and request a payment.','Use the Deposit tab in your CIV account when eligible. Select the exact stablecoin amount and choose Continue with MiniPay. CIV creates a personal payment request that expires after five minutes.'],
 ['Approve in MiniPay','Check the transfer before you approve.','Review the Celo mainnet network, stablecoin contract, amount, recipient and any network fee. Approve the fresh CIV request only when everything matches. You can cancel without making a deposit.'],
 ['Wait for verification','Only a confirmed transfer becomes a CIV deposit.','Wallet approval alone does not credit CIV. Wait for independent on-chain verification and a recorded account credit. Keep your transaction hash and do not send funds twice while a payment is pending.']
];
const guide=document.createElement('dialog');
guide.className='civ-guide-dialog';
guide.id='civDepositGuide';
guide.setAttribute('aria-labelledby','civGuideTitle');
guide.innerHTML='<div class="guide-inner"><div class="top"><div class="guide-kicker">CIV / DEPOSIT WALKTHROUGH</div><button type="button" class="pill" id="civGuideClose" aria-label="Close walkthrough">✕</button></div><div class="guide-track" aria-hidden="true"><i id="civGuideBar"></i></div><span class="guide-number" id="civGuideCounter"></span><h2 id="civGuideTitle"></h2><p id="civGuideLead"></p><div class="guide-details" id="civGuideBody"></div><div class="guide-actions"><button type="button" class="pill" id="civGuideSkip">Skip tutorial</button><div class="actions"><button type="button" class="pill" id="civGuideBack">Back</button><button type="button" class="primary" id="civGuideNext">Next</button></div></div><p class="field-help" style="margin-top:16px">This guide is optional. You can reopen it from the Deposit tab. No transfers are initiated by the tutorial.</p></div>';
document.body.append(guide);
let step=0;
const safeStore=(method,key,value)=>{try{return method==='get'?localStorage.getItem(key):method==='set'?localStorage.setItem(key,value):localStorage.removeItem(key)}catch{return null}};
const tutorialKey='civ:deposit-tour-v1',pendingKey='civ:pending-quote-v1';
function setGuideStep(n){
 step=Math.max(0,Math.min(steps.length-1,n));
 const [title,lead,body]=steps[step];
 $('#civGuideTitle').textContent=title;
 $('#civGuideLead').textContent=lead;
 $('#civGuideBody').textContent=body;
 $('#civGuideCounter').textContent='STEP '+(step+1)+' OF '+steps.length;
 $('#civGuideBar').style.width=((step+1)*100/steps.length)+'%';
 $('#civGuideBack').disabled=step===0;
 $('#civGuideNext').textContent=step===steps.length-1?'Finish tutorial':'Next step';
}
function openGuide(force=false){
 if(!force&&safeStore('get',tutorialKey))return;
 if(!$('#dashboard')||$('#dashboard').classList.contains('hidden'))return;
 setGuideStep(0);
 if(!guide.open)guide.showModal();
}
function closeGuide(){safeStore('set',tutorialKey,'completed');if(guide.open)guide.close();}
document.querySelectorAll('.civ-wallet-signup').forEach(button=>button.addEventListener('click',()=>document.getElementById('startBtn')?.click()));
$('#openMiniPaySetup')?.addEventListener('click',()=>openGuide(true));
$('#openDepositGuide')?.addEventListener('click',()=>openGuide(true));
$('#civGuideClose').addEventListener('click',closeGuide);
$('#civGuideSkip').addEventListener('click',closeGuide);
$('#civGuideBack').addEventListener('click',()=>setGuideStep(step-1));
$('#civGuideNext').addEventListener('click',()=>step===steps.length-1?closeGuide():setGuideStep(step+1));
guide.addEventListener('close',()=>safeStore('set',tutorialKey,'seen'));
document.querySelector('[data-vault-tab="deposits"]')?.addEventListener('click',()=>setTimeout(()=>openGuide(),80));
function progress(position){
 document.querySelectorAll('#depositProgress span').forEach((node,i)=>{node.classList.toggle('done',i<position);node.classList.toggle('active',i===position)});
}
function outcome(kind,title,message,txHash){
 const node=$('#depositOutcome');if(!node)return;
 node.replaceChildren();node.classList.remove('hidden');node.dataset.state=kind;
 const h=document.createElement('strong');h.textContent=title;h.style.display='block';h.style.marginBottom='7px';
 const p=document.createElement('span');p.textContent=message;node.append(h,p);
 if(/^0x[a-f0-9]{64}$/i.test(txHash||'')){
  const a=document.createElement('a');a.href='https://celoscan.io/tx/'+txHash;a.target='_blank';a.rel='noopener noreferrer';a.textContent='View transaction on CeloScan';a.style.display='block';a.style.marginTop='9px';node.append(a);
 }
}
function savePending(d){if(d?.quoteId&&/^0x[a-fA-F0-9]{64}$/.test(d.txHash||''))safeStore('set',pendingKey,JSON.stringify({quoteId:d.quoteId,txHash:d.txHash,amount:d.amount,symbol:d.symbol,chainId:d.chainId,at:Date.now()}))}
function clearPending(d){try{const pending=JSON.parse(safeStore('get',pendingKey)||'null');if(!d||d.quoteId===pending?.quoteId)safeStore('remove',pendingKey)}catch{safeStore('remove',pendingKey)}}
window.addEventListener('civ:deposit-config',e=>{if(!e.detail?.ready)progress(0)});
window.addEventListener('civ:deposit-quoted',()=>progress(1));
window.addEventListener('civ:deposit-submitted',e=>{
 const d=e.detail||{};savePending(d);progress(3);
 outcome('pending','Transfer submitted · verification pending','Your transaction has been submitted to Celo. CIV has not credited the funds yet. Wait for an on-chain confirmation and do not pay again.',d.txHash);
});
window.addEventListener('civ:deposit-verified',e=>{
 const d=e.detail||{};const status=d.status;
 if(status==='verified'&&d.chainId===42220){
  clearPending(d);progress(3);$('#depositProgress span:last-child')?.classList.add('done');
  outcome('success','Deposit successfully verified',Number(d.amount).toFixed(2)+' '+d.symbol+' was verified on Celo mainnet and recorded in your CIV account. Your membership and balance were updated.',d.txHash);
 }else if(status==='verified_test'){
  clearPending(d);outcome('success','Sandbox transaction verified','Testnet USDC has no monetary value. No real CIV balance, membership or referral reward was created.',null);
 }else if(status==='pending'){
  outcome('pending','Awaiting network finality','The transfer has not yet passed independent finality and receipt checks. Do not send again.',d.txHash);
 }else if(status==='review'||status==='mismatch'){
  outcome('review','Payment requires review','The chain details did not match the quote or the transfer needs review. Do not send another payment. Contact info@cryptoinvestmentvault.com with your transaction hash.',d.txHash);
 }
});
let recoveryBusy=false;
async function recover(){
 if(recoveryBusy||!document.body.classList.contains('signed-in'))return;
 let prior;try{prior=JSON.parse(safeStore('get',pendingKey)||'null')}catch{return}
 if(!prior?.quoteId)return;
 recoveryBusy=true;
 try{
  const r=await fetch('/api/payments/quotes',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!r.ok)return;
  const d=await r.json(),q=(d.quotes||[]).find(x=>x.id===prior.quoteId);
  if(q?.status==='verified'||q?.status==='verified_test'){
   window.dispatchEvent(new CustomEvent('civ:deposit-verified',{detail:{status:q.status,quoteId:q.id,txHash:q.txHash||prior.txHash,amount:q.amount,symbol:q.symbol,chainId:q.chainId}}));
  }else if(q?.status==='review'){
   window.dispatchEvent(new CustomEvent('civ:deposit-verified',{detail:{status:'review',quoteId:q.id,txHash:q.txHash||prior.txHash}}));
   clearPending(prior);
  }else{
   outcome('pending','Payment still under verification','CIV is checking the blockchain. Keep this transaction reference and do not send another transfer.',prior.txHash);
  }
 }catch{}finally{recoveryBusy=false}
}
document.querySelector('[data-vault-tab="deposits"]')?.addEventListener('click',()=>setTimeout(recover,300));
setInterval(()=>{if(document.body.classList.contains('signed-in')&&!document.hidden)recover()},30000);
const money=(n,decimals=0)=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('en-US',{maximumFractionDigits:decimals}).format(n):'—';
let intelligenceLoaded=false;
function empty(parent,message){parent.replaceChildren();const p=document.createElement('p');p.className='muted';p.textContent=message;parent.append(p)}
async function loadPulse(){
 if(!document.body.classList.contains('signed-in')||intelligenceLoaded)return;
 intelligenceLoaded=true;
 try{
  const r=await fetch('/api/market-pulse',{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Provider unavailable');
  const d=await r.json(),global=d.global||{};
  const fields=[
   ['Total crypto market cap','$'+money(global.marketCapUsd)],
   ['24-hour trading volume','$'+money(global.volume24hUsd)],
   ['Bitcoin dominance',global.btcDominancePct==null?'—':money(global.btcDominancePct,2)+'%'],
   ['Market cap change · 24h',global.marketCapChange24hPct==null?'—':(global.marketCapChange24hPct>=0?'+':'')+money(global.marketCapChange24hPct,2)+'%']
  ];
  const parent=$('#marketPulseGrid');parent.replaceChildren();
  for(const [label,value] of fields){const card=document.createElement('div');card.className='card';const name=document.createElement('div');name.className='muted';name.textContent=label;const amount=document.createElement('div');amount.className='metric';amount.style.fontSize='clamp(18px,2.5vw,26px)';amount.textContent=value;card.append(name,amount);parent.append(card)}
  const trending=$('#marketPulseTrending');trending.replaceChildren();
  for(const item of d.trending||[]){
   if(!item.url?.startsWith('https://www.coingecko.com/en/coins/'))continue;
   const card=document.createElement('article');card.className='trend-item';
   const a=document.createElement('a');a.textContent=item.name+' · '+item.symbol;a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';
   const change=document.createElement('small');change.textContent=item.change24hPct==null?'CoinGecko trending':(item.change24hPct>=0?'+':'')+money(item.change24hPct,2)+'% · 24h';
   card.append(a,change);trending.append(card);
  }
  if(!trending.children.length)empty(trending,'Trending assets are unavailable.');
  $('#marketPulseUpdated').textContent='CoinGecko · '+new Date(d.asOf).toLocaleTimeString();
 }catch{empty($('#marketPulseGrid'),'CoinGecko data is not configured or is temporarily unavailable. Balances and deposits are unaffected.');empty($('#marketPulseTrending'),'Trending data unavailable.');$('#marketPulseUpdated').textContent='Unavailable'}
 try{
  const r=await fetch('/api/headlines',{credentials:'same-origin',signal:AbortSignal.timeout(11000)});
  if(!r.ok)throw Error('News provider unavailable');
  const d=await r.json(),parent=$('#cryptoHeadlines');parent.replaceChildren();
  for(const item of d.articles||[]){
   if(typeof item.url!=='string'||!item.url.startsWith('https://'))continue;
   const card=document.createElement('article'),h=document.createElement('h3'),a=document.createElement('a'),source=document.createElement('small');
   a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=item.title;h.append(a);
   source.textContent=item.source+(item.publishedAt?' · '+new Date(item.publishedAt).toLocaleDateString():'');
   card.append(h,source);parent.append(card);
  }
  if(!parent.children.length)empty(parent,'No verified publisher links are available right now.');
  $('#headlinesUpdated').textContent='External publishers';
 }catch{empty($('#cryptoHeadlines'),'Crypto news integration is being connected. No unverified headlines are displayed.');$('#headlinesUpdated').textContent='Provider pending'}
}
const observe=new MutationObserver(()=>{if(document.body.classList.contains('signed-in'))loadPulse()});
observe.observe(document.body,{attributes:true,attributeFilter:['class']});
if(document.body.classList.contains('signed-in'))loadPulse();
})();
