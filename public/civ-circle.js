(()=>{
 'use strict';
 const money=n=>new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR',maximumFractionDigits:2}).format(Number(n||0)/100);
 const name=t=>t==='platinum'?'Platinum Circle':t==='gold'?'Gold Circle':'Circle';
 const date=s=>s?new Date(s.includes('T')?s:s.replace(' ','T')+'Z').toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'}):'—';
 const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
 async function get(path){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Unavailable');return r.json()}
 async function loadBoard(root,period='month'){
  const list=root.querySelector('.circle-board'),updated=root.querySelector('.circle-updated');
  root.dataset.period=period;
  root.querySelectorAll('[data-circle-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.circlePeriod===period)));
  try{const d=await get('/api/affiliates/leaderboard?period='+period);if(root.dataset.period!==period)return;list.replaceChildren();
   for(const row of d.rows){const item=el('li','circle-row'),rank=el('span','circle-rank',String(row.rank).padStart(2,'0')),person=el('div','circle-person'),count=el('div','circle-count',row.qualifiedReferrals);
    item.dataset.rank=String(row.rank);person.append(el('strong','',row.alias),el('small','circle-person-tier',name(row.tier)));count.append(el('small','','qualified referrals'));person.append(el('small','','Capital introduced · '+row.capitalIntroducedBand));item.append(rank,person,count);list.append(item)}
   if(!d.rows.length)list.append(el('li','circle-empty','The circle starts here. Partner rankings appear as invitations are accepted and qualifying referrals are validated.'));
   updated.textContent='Updated '+new Date(d.asOf).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'})+' · Capital introduced excludes bonuses, gains and repeat deposits. Amount bands use nominal USDC/USDT units.';
  }catch{if(root.dataset.period!==period)return;list.replaceChildren(el('li','circle-empty','Rankings are temporarily unavailable. Please try again shortly.'));updated.textContent=''}
 }
 let loading=false;
 async function loadAccount(){if(loading||!document.body.classList.contains('signed-in'))return;loading=true;
  try{const d=await get('/api/investor/affiliates');document.getElementById('circleTier').textContent=name(d.tier);document.getElementById('circleTier').dataset.tier=d.tier;document.getElementById('circleAlias').textContent=d.profile?.public_alias||'Your public alias is created when your first invitation is accepted.';
   document.getElementById('circlePending').textContent=money(d.amounts.pending);document.getElementById('circleApproved').textContent=money(d.amounts.approved+(d.legacy?.credited||0));document.getElementById('circlePaid').textContent=money(d.amounts.paid);
   const progress=document.getElementById('circleProgress');progress.max=d.nextThreshold||15;progress.value=Math.min(d.qualified90d,progress.max);
   document.getElementById('circleProgressLabel').textContent=d.nextTier?d.qualified90d+' qualified in 90 days · '+d.remaining+' more to '+name(d.nextTier):'Platinum Circle · '+d.qualified90d+' qualified referrals in 90 days';
   document.getElementById('circleRate100').textContent=money(d.rates[100]);document.getElementById('circleRate200').textContent=money(d.rates[200]);
   document.getElementById('circleCapital').textContent=d.capitalIntroduced.length?d.capitalIntroduced.map(x=>(x.amountMinor/1e6).toLocaleString('en-ZA')+' '+x.asset).join(' · '):'No validated capital introduced yet.';
   const history=document.getElementById('circleRewardHistory');history.replaceChildren();
   for(const r of d.rewards){const li=el('li','circle-reward'),left=el('div','','$'+r.accountUsd+' account · '+name(r.tier)),right=el('strong','',money(r.amountMinor));left.append(el('small','',r.status.replaceAll('_',' ')+' · '+(r.status==='paid'?'Settled '+date(r.paidAt):'Eligible '+date(r.eligibleAt))));if(r.reviewReason)left.append(el('small','',r.reviewReason));li.append(left,right);history.append(li)}
   if(!d.rewards.length)history.append(el('li','circle-empty','Your referral commission activity will appear here.'));
   document.getElementById('circlePayoutStatus').textContent=d.payoutSchedule+'. '+(d.legacy?.credited?'Historical rewards retain their original terms. ':'')+'Commissions and the R500 customer bonus are separate from deposited USDC/USDT. Payout execution is not active.';
   const wallet=document.getElementById('referralBalance');if(wallet)wallet.textContent=money(d.amounts.approved+(d.legacy?.credited||0));
   const status=document.getElementById('referralRewardStatus');if(status)status.textContent=money(d.amounts.pending)+' pending · '+money(d.amounts.paid)+' paid';
   const rate=JSON.stringify(d.rates);document.body.dataset.circleRates=rate;
  }catch{document.getElementById('circlePayoutStatus').textContent='Partner reporting is temporarily unavailable. Refresh to try again.'}finally{loading=false}
 }
 async function loadDaily(){if(!document.body.classList.contains('signed-in'))return;try{const d=await get('/api/investor/ledger');const node=document.getElementById('verifiedDailyChange');if(!node)return;node.textContent=d.daily?.status==='reconciled'?d.daily.results.map(r=>((r.realizedMinor+r.unrealizedMinor)/1e6>=0?'+':'')+((r.realizedMinor+r.unrealizedMinor)/1e6).toFixed(2)+' '+r.asset).join(' · '):'Pending';node.style.fontSize='22px';document.getElementById('adaDailyStatus').textContent=d.daily?.status==='reconciled'?'Reconciled result · '+d.daily.tradingDay:'Awaiting a reconciled daily result';}catch{}}
 function ready(){document.querySelectorAll('[data-circle-board]').forEach(root=>{root.querySelectorAll('[data-circle-period]').forEach(b=>b.addEventListener('click',()=>loadBoard(root,b.dataset.circlePeriod)));loadBoard(root)});const invite=document.getElementById('circleInviteCode');invite?.addEventListener('input',()=>invite.dataset.edited='true');get('/api/referrals/claim').then(d=>{if(d.code&&invite?.dataset.edited!=='true'){invite.value=d.code;document.getElementById('referralNotice').classList.remove('hidden')}}).catch(()=>{});loadAccount();loadDaily()}
 document.addEventListener('civ:account-ready',()=>{loadAccount();loadDaily();document.querySelectorAll('[data-circle-board]').forEach(root=>loadBoard(root,root.dataset.period||'month'))});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
