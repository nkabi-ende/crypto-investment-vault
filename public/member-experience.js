(()=>{
 'use strict';
 const $=id=>document.getElementById(id),node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
 const icons={close:'<path d="m6 6 12 12M6 18 18 6"/>',id:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M5 16c0-3 6-3 6 0m3-7h4m-4 4h4"/>',address:'<path d="m3 10 9-7 9 7v10H3V10Z"/><path d="M9 20v-7h6v7"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',check:'<path d="m5 12 4 4L19 6"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'};
 const svg=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
 const dialog=document.createElement('dialog');dialog.id='identityDialog';dialog.className='identity-dialog';dialog.setAttribute('aria-labelledby','identityTitle');dialog.innerHTML='<div class="identity-dialog-head"><span>CIV / IDENTITY CENTRE</span><button type="button" class="identity-close" aria-label="Close identity verification">'+svg('close')+'</button></div><div class="identity-dialog-body" id="identityDialogBody"></div>';document.body.append(dialog);
 const withdrawal=document.createElement('dialog');withdrawal.id='withdrawalDialog';withdrawal.className='identity-dialog';withdrawal.setAttribute('aria-labelledby','withdrawalTitle');withdrawal.innerHTML='<div class="identity-dialog-head"><span>CIV / WITHDRAWAL REQUEST</span><button type="button" class="identity-close" aria-label="Close withdrawal request">'+svg('close')+'</button></div><div class="identity-dialog-body" id="withdrawalDialogBody"></div>';document.body.append(withdrawal);
 dialog.querySelector('.identity-close').onclick=()=>dialog.close();withdrawal.querySelector('.identity-close').onclick=()=>withdrawal.close();
 let identity=null,refreshing=false,uploadBusy=false,accountEpoch=0;
 async function api(path,options={}){const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(options.body instanceof FormData?90000:15000),...options});const data=await response.json();if(!response.ok)throw Error(data.error||'Please try again shortly.');return data}
 const post=(path,data,headers={})=>api(path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 function paint(){
  const verified=identity?.verified===true,pending=identity?.status==='pending';$('memberVerifiedBadge').hidden=!verified;
  $('identityPromptTitle').textContent=verified?'Identity verified':pending?'Verification in progress':'Verify your account.';
  $('identityPromptCopy').textContent=verified?'You can request a withdrawal. Every request is reviewed before payment.':pending?'Your ID and address documents are saved and awaiting review.':'Complete your identity check to unlock withdrawal requests.';
  $('profileKycStatus').textContent=verified?'VERIFIED':pending?'IN REVIEW':identity?.status==='rejected'?'UPDATE REQUIRED':identity?.status==='expired'?'RENEWAL REQUIRED':'NOT VERIFIED';
  $('profileKycCopy').textContent=verified?'Your identity check is approved and linked to your unique account ID.':pending?'Both documents have been received. Your status updates here after review.':'A clear photo of your ID. A recent proof of address. One account, verified.';
  $('withdrawalAccessTitle').textContent=verified?'Ready to request':pending?'Awaiting verification':'Verify to unlock';
  $('withdrawalAccessCopy').textContent=verified?'Request from your available settled USDC or USDT. Payments are reviewed separately; promotional credits are excluded.':'Your ID and proof of address need approval before withdrawal requests are available.';
  $('withdrawalAccessButton').textContent=verified?'Request withdrawal':'Verify identity';
  document.querySelectorAll('[data-open-kyc]').forEach(b=>b.textContent=verified?'View verification':pending?'View progress':'Verify identity');
 }
 async function refresh(){
  if(refreshing||!document.body.classList.contains('signed-in'))return;refreshing=true;const epoch=accountEpoch;
  try{const previous=identity?.status;const state=await api('/api/investor/kyc');if(epoch!==accountEpoch)return;identity=state;paint();if(dialog.open&&!uploadBusy&&(previous!==identity.status||identity.verified))renderIdentity()}catch{if(epoch===accountEpoch&&!identity){$('profileKycStatus').textContent='STATUS UNAVAILABLE';$('identityPromptCopy').textContent='Your verification status is temporarily unavailable. Please retry shortly.'}}finally{if(epoch===accountEpoch)refreshing=false}
 }
 function outcome(verified){
  const body=$('identityDialogBody');body.replaceChildren();const root=node('div','identity-outcome'),symbol=node('div','identity-outcome-symbol');symbol.innerHTML=svg(verified?'check':'clock');
  root.append(symbol,node('h2','',verified?'Your identity. Verified.':'Documents received.'),node('p','',verified?'Your account now carries a verified badge. Withdrawal requests are available from your settled balance, subject to a separate payment review.':'Your ID and proof of address are saved to your account. Your verification is now in review. Your badge and withdrawal access update after approval.'));
  root.querySelector('h2').id='identityTitle';const timeline=node('div','identity-timeline');
  for(const [title,detail,complete] of [['Documents','Received',true],['Identity review',verified?'Approved':'In progress',verified],['Withdrawals',verified?'Requests unlocked':'Locked until approval',verified]]){const item=node('span',complete?'complete':'');item.append(node('strong','',title),node('span','',detail));timeline.append(item)}root.append(timeline);
  if(identity?.submissionId)root.append(node('div','identity-outcome-reference','REFERENCE / '+identity.submissionId.slice(-8).toUpperCase()));
  const done=node('button','primary','Back to my vault');done.type='button';done.onclick=()=>dialog.close();root.append(done);
  if(!verified){const check=node('button','identity-secondary','Refresh verification status');check.type='button';check.onclick=async()=>{check.disabled=true;await refresh();check.disabled=false};root.append(check)}
  body.append(root);
 }
 function renderIdentity(){
  if(identity?.verified||identity?.status==='pending'){outcome(identity.verified);return}
  const body=$('identityDialogBody');body.innerHTML='<h2 id="identityTitle">A little proof.<br>A verified profile.</h2><p class="identity-intro">Upload a clear photo of your ID and recent proof of address in your name. Both documents are linked privately to your CIV account.</p><form id="identityForm"><div class="identity-documents"><label class="identity-upload" id="identityUploadCard"><input id="identityFile" name="identity" type="file" accept="image/jpeg,image/png" aria-label="Upload your ID photograph"><span class="identity-upload-icon">'+svg('id')+'</span><span><strong>01 / Your identity document</strong><small id="identityFileLabel">Choose a JPG or PNG photo · up to 5 MB</small></span></label><label class="identity-upload" id="addressUploadCard"><input id="addressFile" name="address" type="file" accept="image/jpeg,image/png,application/pdf" aria-label="Upload your proof of address"><span class="identity-upload-icon">'+svg('address')+'</span><span><strong>02 / Your proof of address</strong><small id="addressFileLabel">Choose a JPG, PNG or PDF · up to 5 MB</small></span></label></div><label class="identity-consent"><input id="identityConsent" type="checkbox" required><span>I confirm these documents are mine and permit CIV to use them to verify my account, as described in the <a href="/legal/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Notice</a>.</span></label><button class="primary" id="identitySubmit" type="submit">Submit for verification</button><p id="identityFeedback" class="identity-feedback" role="status"></p></form><p class="identity-private">Private document storage · Linked to your account ID · Approved identity verification is required for withdrawals. You can deposit without KYC when deposits are available for your account.</p>';
  if(identity?.reviewNote){const note=node('p','identity-feedback','Review note: '+identity.reviewNote);body.insertBefore(note,$('identityForm'))}
  for(const kind of ['identity','address']){
   const input=$(kind+'File'),saved=identity?.documents?.find(d=>d.kind===kind);if(saved){$(kind+'UploadCard').dataset.ready='true';$(kind+'FileLabel').textContent='Document saved · select a file to replace it'}
   input.onchange=()=>{const file=input.files?.[0];if(!file)return;$(kind+'FileLabel').textContent=file.size>5*1024*1024?'File too large. Choose a file under 5 MB.':file.name;$(kind+'UploadCard').dataset.ready=String(file.size<=5*1024*1024)};
  }
  $('identityForm').onsubmit=async event=>{
   event.preventDefault();if(uploadBusy)return;const consent=$('identityConsent').checked;if(!consent)return;
   const feedback=$('identityFeedback'),button=$('identitySubmit'),epoch=accountEpoch;uploadBusy=true;button.disabled=true;
   try{
    for(const [index,kind] of ['identity','address'].entries()){
     const file=$(kind+'File').files?.[0],saved=identity?.documents?.some(d=>d.kind===kind);
     if(!file&&!saved)throw Error('Please select both your ID photograph and proof of address.');
     if(file){if(file.size>5*1024*1024)throw Error('Each document must be 5 MB or smaller.');feedback.textContent='Saving document '+(index+1)+' of 2 securely…';const form=new FormData();form.append('document',file);const result=await api('/api/investor/kyc/documents/'+kind,{method:'POST',body:form});if(epoch!==accountEpoch)return;identity=result.kyc}
    }
    feedback.textContent='Submitting your documents for review…';const submitted=await post('/api/investor/kyc/submit',{consent:true,consentVersion:identity.consentVersion});if(epoch!==accountEpoch)return;identity=submitted;paint();outcome(false);
   }catch(error){feedback.textContent=error.message}finally{uploadBusy=false;if(button.isConnected)button.disabled=false}
  };
 }
 async function openIdentity(){
  await refresh();renderIdentity();if(!dialog.open)dialog.showModal();
 }
 document.querySelectorAll('[data-open-kyc]').forEach(b=>b.addEventListener('click',openIdentity));
 function amountMinor(value){if(!/^\d+(?:\.\d{1,6})?$/.test(value))throw Error('Use a positive amount with up to six decimal places.');const [whole,fraction='']=value.split('.'),minor=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));if(minor<=0n||minor>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Enter a valid token amount.');return Number(minor)}
 async function openWithdrawal(){
  await refresh();if(!identity?.verified){await openIdentity();return}
  const body=$('withdrawalDialogBody');body.innerHTML='<h2 id="withdrawalTitle">Your next move.</h2><p class="identity-intro">Request a withdrawal from your available settled balance. Your request is reviewed before any payment is made.</p><form id="withdrawalForm" class="withdrawal-form"><label>Stablecoin<select id="withdrawalAsset"><option>USDC</option><option>USDT</option></select></label><div id="withdrawalAvailable" class="withdrawal-available">Checking available balance…</div><label>Amount<input id="withdrawalAmount" type="text" inputmode="decimal" placeholder="0.00" required autocomplete="off"></label><label>Your Celo receiving wallet<input id="withdrawalAddress" type="text" placeholder="0x…" required autocomplete="off" spellcheck="false"></label><button class="primary" id="withdrawalSubmit" type="submit" disabled>Submit withdrawal request</button><p id="withdrawalFeedback" class="identity-feedback" role="status"></p></form><p class="identity-private">USDC and USDT remain separate. Unrealised values, promotions and referral credits are excluded from the available balance. This request does not execute a payment.</p>';
  if(!withdrawal.open)withdrawal.showModal();let balances=[];
  try{const data=await api('/api/investor/withdrawals');balances=data.balances||[];const update=()=>{const amount=Number(balances.find(b=>b.asset===$('withdrawalAsset').value)?.available_minor||0);$('withdrawalAvailable').textContent='Available / '+(amount/1e6).toLocaleString('en-ZA',{maximumFractionDigits:6})+' '+$('withdrawalAsset').value;$('withdrawalSubmit').disabled=!data.requestsEnabled||amount<=0};$('withdrawalAsset').onchange=update;update()}catch(error){$('withdrawalFeedback').textContent=error.message;return}
  let key=null,fingerprint=null;
  $('withdrawalForm').onsubmit=async event=>{event.preventDefault();const button=$('withdrawalSubmit'),feedback=$('withdrawalFeedback');button.disabled=true;
   try{const payload={asset:$('withdrawalAsset').value,amountMinor:amountMinor($('withdrawalAmount').value.trim()),destinationAddress:$('withdrawalAddress').value.trim()},next=JSON.stringify(payload);if(fingerprint!==next){fingerprint=next;key=crypto.randomUUID()}const data=await post('/api/investor/withdrawals',payload,{'Idempotency-Key':key});body.replaceChildren();const root=node('div','identity-outcome'),symbol=node('div','identity-outcome-symbol');symbol.innerHTML=svg('clock');const title=node('h2','','Request received.');title.id='withdrawalTitle';root.append(symbol,title,node('p','','Your withdrawal is queued for review. Your available balance reserves this request. No payment has been executed.'),node('div','identity-outcome-reference','REFERENCE / '+data.requestId.slice(-8).toUpperCase()));const done=node('button','primary','Back to my vault');done.type='button';done.onclick=()=>withdrawal.close();root.append(done);body.append(root)}catch(error){feedback.textContent=error.message;if(button.isConnected)button.disabled=false}
  };
 }
 $('withdrawalAccessButton').onclick=openWithdrawal;
 document.addEventListener('civ:account-ready',()=>{accountEpoch++;refreshing=false;identity=null;$('memberVerifiedBadge').hidden=true;refresh()});
 $('logout')?.addEventListener('click',()=>{accountEpoch++;refreshing=false;identity=null;$('memberVerifiedBadge').hidden=true;if(dialog.open)dialog.close();if(withdrawal.open)withdrawal.close();$('identityDialogBody').replaceChildren();$('withdrawalDialogBody').replaceChildren()});
 window.addEventListener('focus',refresh);setInterval(()=>{if(!document.hidden&&(dialog.open||!$('vault-account').classList.contains('hidden')))refresh()},30000);
 document.querySelectorAll('a[href="#market-terminal"]').forEach(a=>a.addEventListener('click',()=>{const detail=document.querySelector('.market-disclosure');if(detail)detail.open=true}));
 if(location.hash==='#market-terminal'){const detail=document.querySelector('.market-disclosure');if(detail)detail.open=true}
 if(document.body.classList.contains('signed-in'))refresh();
})();
