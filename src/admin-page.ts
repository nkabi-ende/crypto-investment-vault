/** Server-rendered navigation only; authority still lives in each protected handler. */
export function adminPage(reviewer:boolean,operator:boolean,report=''){
 const allowed=reviewer||operator;
 const item=(number:string,title:string,copy:string,href:string,label:string,enabled:boolean)=>`<article class="operation"><span class="operation-number">${number}</span><div><h2>${title}</h2><p>${copy}</p>${enabled?`<a class="operation-link" href="${href}">${label}<span aria-hidden="true">↗</span></a>`:'<span class="role-needed">This account needs the relevant operator role.</span>'}</div></article>`;
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1011"><meta name="robots" content="noindex,nofollow,noarchive"><title>CIV | Vault control</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/admin.css"></head><body><div class="admin-shell"><header><a class="admin-brand" href="/" aria-label="Crypto Investment Vault home"><img src="/civ-mark.svg" width="116" height="50" alt="CIV"><span>CRYPTO INVESTMENT<br><strong>VAULT</strong></span></a><a class="account-link" href="/dashboard">My account <span aria-hidden="true">↗</span></a></header><main><div class="admin-kicker">CIV / OPERATIONS</div><div class="admin-heading"><h1>${allowed?'Vault control.':'Access required.'}</h1><span class="session-label">${allowed?'AUTHORISED SESSION':'SIGNED IN / NO ADMIN ROLE'}</span></div><p class="admin-intro">${allowed?'A clear view of your operating tools. Each action is protected by its own server-side permission.':'You are signed in, but administrator access has not been enabled for this account. An authorised operator needs to assign the relevant role.'}</p>${operator?report:''}<div class="operations">${item('01','Identity review','Review submitted ID and address documents. Record evidence checks and approve or request an update.','/review-identity','Open identity review',reviewer)}${item('02','Paper-portfolio controls','Manage the private Shaka paper-portfolio settings from your member dashboard.','/dashboard','Open portfolio controls',operator)}${item('03','Dashboard mirror','Inspect the branded member layout in a separate, read-only preview.','/dashboard/mirror','Open read-only mirror',operator)}</div><p class="admin-note">Use your own CIV account. Administrative access is assigned separately from membership.</p></main>${operator?'<script defer src="/owner-actions.js"></script>':''}<footer><span>Crypto Investment Vault</span><a href="mailto:dev@cryptoinvestmentvault.com">Technical support</a></footer></div></body></html>`;
}

const reports = {
 history:{title:'Change history',columns:['Recorded (UTC)','Action','Record ID','Previous input','New value','Asset','Reason','Owner ID'],sql:'SELECT created_at,action,target,expected,value,asset,reason,actor FROM owner_operations ORDER BY rowid DESC'},
 commissions:{title:'Circle commissions',columns:['Referrer','Referred account','ZAR cents','Payment status','Review status','Member ID'],sql:`SELECT sponsor.email,member.email,w.amount_minor,w.status,w.review_state,member.id FROM circle_wallet w JOIN users sponsor ON sponsor.id=w.user_id JOIN users member ON member.id=w.referred_user_id ORDER BY w.created_at DESC,w.receipt_id`},
 claims:{title:'Deposit claims',columns:['Account','Asset','Transaction','Status','Claim ID'],sql:'SELECT u.email,c.asset,c.tx_hash,c.status,c.id FROM manual_deposit_claims c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC,c.id'},
 accounts: { title:'Accounts', columns:['Email','Account ID','Name','Access','USDC cash','USDT cash'], sql:`SELECT u.email,u.id,p.display_name,u.access_state,
 COALESCE((SELECT SUM(amount_minor) FROM ada_balances WHERE user_id=u.id AND asset='USDC' AND bucket IN ('funding','realized')),0),
 COALESCE((SELECT SUM(amount_minor) FROM ada_balances WHERE user_id=u.id AND asset='USDT' AND bucket IN ('funding','realized')),0)
 FROM users u LEFT JOIN account_profiles p ON p.user_id=u.id ORDER BY u.email,u.id` },
 deposits: { title:'Settled deposits', columns:['Account','Amount','Asset','Chain ID','Transaction','Receipt','Latest note'], sql:`SELECT u.email, printf('%d.%06d', f.amount_minor / 1000000, f.amount_minor % 1000000) AS amount,
 f.asset, f.chain_id, f.tx_hash,f.id,(SELECT value FROM owner_operations WHERE target=f.id AND action='note' ORDER BY rowid DESC LIMIT 1) FROM funding_receipts f JOIN users u ON u.id=f.user_id ORDER BY f.settled_at DESC, f.id` },
 referrals: { title:'Referrals', columns:['Referred account','Referrer','Referral code','Account ID'], sql:`SELECT member.email AS member, sponsor.email AS sponsor, a.code,member.id
 FROM referral_attributions a JOIN users member ON member.id=a.user_id
 LEFT JOIN referral_codes r ON r.code=a.code LEFT JOIN users sponsor ON sponsor.id=r.user_id ORDER BY member.email, member.id` }
};

function cell(value:unknown){
 return String(value ?? 'Unavailable').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}

function menu(section:string,row:unknown[]){
 const account=cell(row[0]);
 function form(label:string,action:string,target:unknown,expected:unknown,asset='',options:string[]=[]){
  const hidden=Object.entries({id:crypto.randomUUID(),target,expected,action,asset}).map(([name,v])=>`<input type="hidden" name="${name}" value="${cell(v)}">`).join('');
  const input=options.length?`<select name="value">${options.map(v=>`<option>${v}</option>`).join('')}</select>`:`<input name="value" ${action==='referral'?'':'required'} maxlength="500">`;
  return `<form method="post" class="owner-action" data-label="${label}" data-account="${account}">${hidden}<label>${label} ${input}</label><label>Reason <input required minlength="5" maxlength="500" name="reason"></label><label>Owner password <input required type="password" autocomplete="current-password" name="password"></label><button>Review change</button><output role="status"></output></form>`;
 }
 let content='';
 if(section==='accounts'){
  content=form('Change email','email',row[1],row[0])+form('Change name','name',row[1],row[2])+form('Set access','state',row[1],row[3],'',['active','suspended','closed']);
  if(row[3]==='closed')content+=form('Delete unused account (type its email)','delete',row[1],'');
  for(const [i,asset] of ['USDC','USDT'].entries())content+=form('Set corrected cash balance in '+asset,'balance',row[1],row[4+i],asset);
 }else if(section==='deposits')content=form('Add receipt note','note',row[5],'');
 else if(section==='commissions'&&row[3]!=='paid')content=form('Commission review','commission',row[5],row[4],'',['clear','hold','rejected']);
 else if(section==='claims'&&row[3]==='pending_review')content=form('Review claim','claim',row[4],'pending_review','',['resolved','rejected']);
 else if(section==='referrals')content=form('New referrer ID (blank removes referral)','referral',row[3],row[2]);
 return content?`<details><summary>Actions</summary>${content}</details>`:'';
}

export async function platformReport(db:D1Database, view:string, page:number){
 const section=view==='history'||view==='commissions'||view==='claims'||view==='deposits'||view==='referrals'?view:'accounts';
 const report=reports[section];
 const results=await db.prepare(report.sql+' LIMIT 26 OFFSET ?').bind((page-1)*25).raw<unknown[]>();
 const nav=Object.entries(reports).map(([key,item])=>`<a href="?view=${key}"${section===key?' aria-current="page"':''}>${item.title}</a>`).join(' · ');
 const rows=results.slice(0,25).map(row=>'<tr>'+row.map((value,i)=>'<td>'+cell(section==='accounts'&&i>=4?(Number(value)/1e6).toFixed(6):value)+'</td>').join('')+'<td>'+menu(section,row)+'</td></tr>').join('');
 const prev=page>1?`<a href="?view=${section}&amp;page=${page-1}">Previous</a>`:'';
 const next=results.length>25?`<a href="?view=${section}&amp;page=${page+1}">Next</a>`:'';
 return `<section class="platform-report"><nav aria-label="Platform reports">${nav}</nav><h2>${report.title}</h2>${rows?`<div class="report-scroll"><table><thead><tr>${report.columns.map(name=>'<th scope="col">'+name+'</th>').join('')}<th scope="col">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p>No records on this page.</p>'}<nav aria-label="Report pages">${prev} Page ${page} ${next}</nav></section>`;
}
