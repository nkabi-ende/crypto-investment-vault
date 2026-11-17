(() => {
 const root = document.getElementById('shakaSimulation');
 const admin = document.getElementById('shakaSimulationAdmin');
 const node = id => document.getElementById(id);
 const base = '/api/admin/shaka-simulation';
 const credits = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const toggles = [...document.querySelectorAll('[data-vault-currency]')];
 const fxNotes = [...document.querySelectorAll('[data-vault-fx]')];
 const rand = new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'});
 const usd = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
 let currency='USD', rate=null, rateRequest=null, portfolio=null;
 try { if(localStorage.getItem('civ.displayCurrency')==='ZAR')currency='ZAR'; } catch {}
 const reference = amount => currency==='ZAR'&&rate ? rand.format(amount*rate.rate) : usd.format(amount);
 const bonusMoney = amountMinor => currency==='USD'&&rate
  ? usd.format(amountMinor/100/rate.rate)+' equivalent' : rand.format(amountMinor/100);
 const money = cents => currency==='ZAR' && rate
  ? rand.format(Number(cents)/100*rate.rate)+' equivalent'
  : credits.format(Number(cents)/100)+' credits';
 const percent = bps => (bps>0?'+':'')+(bps/100).toFixed(2)+'%';

 async function api(path,body) {
  const response = await fetch(path,{
   signal:AbortSignal.timeout(12000),
   ...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
 }

 function renderVerified() {
  const {ledger,promotion}=civAccountDisplay;
  const depositReference=node('verifiedDepositReference');
  const principal=ledger?.assets?.reduce((total,asset)=>total+asset.principalMinor/1000000,0);
  const showReference=Number.isFinite(principal)&&principal>0&&(currency==='USD'||rate!==null);
  depositReference.classList.toggle('hidden',!showReference);
  if(showReference)depositReference.textContent='Deposit reference · '+reference(principal)+' · Stablecoins may trade away from USD 1.';
  const bonus=promotion ?? (ledger?.promotion && {amountMinor:ledger.promotion.amount_minor,status:ledger.promotion.status});
  const showBonus=!!bonus&&['pending_terms','approved'].includes(bonus.status);
  node('verifiedDepositBonus').classList.toggle('hidden',!showBonus);
  node('depositBonusValue').classList.toggle('hidden',!showBonus);
  if(showBonus){
   for(const label of document.querySelectorAll('[data-vault-bonus-value]'))label.textContent=bonusMoney(bonus.amountMinor);
   node('verifiedDepositBonus').querySelector('[data-vault-bonus-status]').textContent=
    bonus.status==='approved'?'Approved promotional credit':'Pending offer terms';
  }
 }

 function renderPortfolio() {
  if (!portfolio) return;
  const data=portfolio;
  node('shakaSimBalance').textContent = money(data.balanceCents);
  node('shakaSimDaily').textContent = data.latest
   ? money(data.latest.changeCents)+' ('+percent(data.latest.rateBps)+')' : 'Pending';
  if (data.confirmedDeposit) {
   const {amountMinor,asset}=data.confirmedDeposit;
   node('shakaSimDeposit').textContent = credits.format(amountMinor/1000000)+' '+asset;
  }
  const bonus=data.bonus;
  node('shakaSimBonusCard').classList.toggle('hidden',!bonus||!['pending_terms','approved'].includes(bonus.status));
  if (bonus) {
   node('shakaSimBonus').textContent = bonusMoney(bonus.amountMinor);
   node('shakaSimBonusStatus').textContent = bonus.status==='approved'?'Approved promotional credit':'Pending offer terms';
  }
  const history = node('shakaSimHistory');
  history.replaceChildren(...data.entries.map(entry=>{
   const row = document.createElement('li');
   row.textContent = entry.tradingDay+' · '+entry.scenario+' · '+percent(entry.rateBps)+' · '+money(entry.changeCents)+' · Closing '+money(entry.closingCents);
   return row;
  }));
  node('shakaSimJournal').classList.toggle('hidden',!data.entries.length);
 }

 function loadRate() {
  if (rate || rateRequest) return;
  rateRequest=api('/api/markets/usd-zar').then(result=>{
   rate=result;
   for(const note of fxNotes)note.textContent='Reference rate · '+rate.date;
   renderPortfolio();
   renderVerified();
  }).catch(()=>{
   for(const note of fxNotes)note.textContent='Exchange rate unavailable. Amounts remain in their original units.';
  }).finally(()=>{rateRequest=null;});
 }

 function selectCurrency(next) {
  currency=next;
  try { localStorage.setItem('civ.displayCurrency',next); } catch {}
  syncToggles();
  renderPortfolio();
  renderVerified();
  loadRate();
 }
 function syncToggles(){
  for(const toggle of toggles){
   toggle.dataset.currency=currency;
   for(const button of toggle.querySelectorAll('[data-paper-currency]')){
    button.setAttribute('aria-pressed',String(button.dataset.paperCurrency===currency));
   }
  }
 }
 for(const toggle of toggles){
  let touchStart=null, swiped=false;
  toggle.addEventListener('click',event=>{
   const button=event.target.closest('[data-paper-currency]');
   if(button&&(!swiped||event.detail===0))selectCurrency(button.dataset.paperCurrency);
  });
  toggle.addEventListener('pointerdown',event=>{
   swiped=false;
   if(event.pointerType==='touch')touchStart=event.clientX;
  });
  toggle.addEventListener('pointercancel',()=>{touchStart=null;});
  toggle.addEventListener('pointerup',event=>{
   if(touchStart===null)return;
   const distance=event.clientX-touchStart;
   touchStart=null;
   if(Math.abs(distance)>=24){
    swiped=true;
    selectCurrency(distance>0?'ZAR':'USD');
   }
  });
 }
 syncToggles();
 document.addEventListener('civ:account-display-updated',renderVerified);
 renderVerified();

 async function loadMember() {
  try {
   const data = await api('/api/investor/shaka-simulation');
   root.classList.remove('hidden');
   const active = !['verification_required','deposit_required'].includes(data.status);
   node('shakaSimLedger').classList.toggle('hidden',!active);
   const messages = {
    verification_required:'Account verification is required to access the paper portfolio.',
    deposit_required:'Your paper portfolio opens after your deposit is confirmed.',
    pending:'Waiting for the first scheduled close. Eligible from '+data.startsOn+' (Johannesburg).',
    active:'Latest paper portfolio close on '+data.latest?.tradingDay+' (Johannesburg).',
    complete:'Paper portfolio completed after '+data.termDays+' daily closes.'
   };
   node('shakaSimStatus').textContent = messages[data.status];
   portfolio=active?data:null;
   if (!active) return;
   node('shakaSimBasket').textContent = data.basket.join(' · ');
   renderPortfolio();
   loadRate();
  } catch {
   root.classList.remove('hidden');
   node('shakaSimLedger').classList.add('hidden');
   node('shakaSimStatus').textContent = 'The paper portfolio is temporarily unavailable.';
  }
 }

 async function loadAdmin() {
  const data = await api(base);
  const select = node('shakaSimScenario');
  const selected = select.value;
  select.replaceChildren(...data.scenarios.map(s=>new Option(
   s.label+' ('+percent(Math.min(...s.rates))+' to '+percent(Math.max(...s.rates))+')',s.id
  )));
  if (selected) select.value = selected;
  node('shakaSimSchedules').replaceChildren(...data.schedules.map(s=>{
   const row = document.createElement('li');
   row.textContent = s.startsOn+' · '+(data.scenarios.find(x=>x.id===s.scenario)?.label ?? s.scenario)+' · Saved '+s.createdAt+' UTC';
   return row;
  }));
  node('shakaSimLastRun').textContent = data.lastClose ? 'Latest close on '+data.lastClose : 'No daily closes yet.';
  const activations = data.activations.length ? data.activations.map(event=>
   'Paper portfolio enabled for '+event.userId+' · '+event.activatedAt+' UTC · First eligible day '+event.startsOn
  ) : ['No paper portfolio activations yet.'];
  const feed = node('shakaSimActivations');
  if (Array.from(feed.children).map(item=>item.textContent).join('\n')!==activations.join('\n')) {
   feed.replaceChildren(...activations.map(message=>{
    const item = document.createElement('li');
    item.textContent = message;
    return item;
   }));
  }
  admin.classList.remove('hidden');
 }

 function bindForm(id,buttonAction,statusId) {
  const form = node(id);
  const status = node(statusId);
  form.addEventListener('submit',async event=>{
   event.preventDefault();
   const button = form.querySelector('button');
   button.disabled = true;
   status.textContent = 'Saving…';
   try { status.textContent = await buttonAction(); }
   catch(error) { status.textContent = error.message; }
   finally { button.disabled = false; }
  });
 }

 bindForm('shakaSimScheduleForm',async()=>{
  const result = await api(base+'/scenario',{scenario:node('shakaSimScenario').value});
  await loadAdmin().catch(()=>{});
  return 'Scenario scheduled for '+result.startsOn+' (Johannesburg).';
 },'shakaSimScheduleStatus');

 bindForm('shakaSimMemberForm',async()=>{
  const input = node('shakaSimMemberId');
  const result = await api(base+'/members',{userId:input.value.trim()});
  input.value = '';
  await loadMember();
  await loadAdmin().catch(()=>{});
  return 'Member verified. Paper portfolio access also requires a confirmed deposit.';
 },'shakaSimMemberStatus');

 function loadAccount() {
  loadRate();
  loadMember();
  loadAdmin().catch(()=>admin.classList.add('hidden'));
 }
 document.addEventListener('civ:account-ready',loadAccount);
 if(!node('dashboard').classList.contains('hidden'))loadAccount();
 window.addEventListener('civ:deposit-verified',event=>{
  if (event.detail?.status==='verified') loadMember();
 });
 window.setInterval(()=>{
  if (!document.hidden && document.body.classList.contains('signed-in')) {
   loadMember();
   if (!admin.classList.contains('hidden')) loadAdmin().catch(()=>{});
  }
 },60000);
})();
