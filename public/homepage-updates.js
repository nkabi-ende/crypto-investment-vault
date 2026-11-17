/* Published announcements and independently sourced performance history. */
(()=>{
 'use strict';
 const announcements=document.getElementById('announcementRecords');
 const history=document.getElementById('performanceRecords');
 if(!announcements||!history)return;
 const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node};
 const empty=(root,text)=>root.replaceChildren(el('p','vault-update-empty',text));
 const date=value=>{const parsed=new Date(String(value).replace(' ','T').replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/,'$1Z'));return Number.isNaN(parsed.getTime())?'':parsed.toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})};
 const pct=value=>value!==null&&value!==''&&Number.isFinite(Number(value))?Number(value).toLocaleString('en-ZA',{maximumFractionDigits:2})+'%':'—';
 async function load(){
  try{
   const response=await fetch('/api/transparency',{credentials:'same-origin',signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('Updates unavailable');
   const data=await response.json();
   if(!Array.isArray(data.announcements)||!Array.isArray(data.verifiedPerformance))throw Error('Invalid updates');
   announcements.replaceChildren();history.replaceChildren();
   for(const item of data.announcements){
    const entry=el('div','vault-update-entry');
    if(date(item.published_at)){const time=el('time','',date(item.published_at));entry.append(time)}
    entry.append(el('h4','',item.title),el('p','',item.body));announcements.append(entry);
   }
   if(!data.announcements.length)empty(announcements,"Announcements will appear here as they're published.");
   for(const record of data.verifiedPerformance){
    const entry=el('div','vault-update-entry');
    entry.append(el('h4','',date(record.period_start)+' – '+date(record.period_end)));
    const stats=el('dl','vault-history-stats');
    for(const [label,value] of [['Net return',record.net_return_pct],['Max drawdown',record.max_drawdown_pct],['Fees',record.fees_pct]]){const stat=el('div');stat.append(el('dt','',label),el('dd','',pct(value)));stats.append(stat)}
    entry.append(stats,el('div','vault-update-verifier','Verified by '+record.verified_by));
    try{const url=new URL(record.verification_url);if(url.protocol==='https:'){const link=el('a','vault-update-evidence','View verification');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';entry.append(link)}}catch{}
    history.append(entry);
   }
   if(!data.verifiedPerformance.length)empty(history,'No independently verified performance records have been published.');
  }catch{
   empty(announcements,'Announcements are temporarily unavailable. Please try again later.');
   empty(history,'Verified history is temporarily unavailable. Please try again later.');
  }finally{announcements.setAttribute('aria-busy','false');history.setAttribute('aria-busy','false')}
 }
 load();
})();
