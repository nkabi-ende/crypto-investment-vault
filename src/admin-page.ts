/** Server-rendered navigation only; authority still lives in each protected handler. */
export function adminPage(reviewer:boolean,operator:boolean,report=''){
 const allowed=reviewer||operator;
 const item=(number:string,title:string,copy:string,href:string,label:string,enabled:boolean)=>`<article class="operation"><span class="operation-number">${number}</span><div><h2>${title}</h2><p>${copy}</p>${enabled?`<a class="operation-link" href="${href}">${label}<span aria-hidden="true">↗</span></a>`:'<span class="role-needed">This account needs the relevant operator role.</span>'}</div></article>`;
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1011"><meta name="robots" content="noindex,nofollow,noarchive"><title>CIV | Vault control</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/admin.css"></head><body><div class="admin-shell"><header><a class="admin-brand" href="/" aria-label="Crypto Investment Vault home"><img src="/civ-mark.svg" width="116" height="50" alt="CIV"><span>CRYPTO INVESTMENT<br><strong>VAULT</strong></span></a><a class="account-link" href="/dashboard">My account <span aria-hidden="true">↗</span></a></header><main><div class="admin-kicker">CIV / OPERATIONS</div><div class="admin-heading"><h1>${allowed?'Vault control.':'Access required.'}</h1><span class="session-label">${allowed?'AUTHORISED SESSION':'SIGNED IN / NO ADMIN ROLE'}</span></div><p class="admin-intro">${allowed?'A clear view of your operating tools. Each action is protected by its own server-side permission.':'You are signed in, but administrator access has not been enabled for this account. An authorised operator needs to assign the relevant role.'}</p>${operator?report:''}<div class="operations">${item('01','Identity review','Review submitted ID and address documents. Record evidence checks and approve or request an update.','/review-identity','Open identity review',reviewer)}${item('02','Paper-portfolio controls','Manage the private Shaka paper-portfolio settings from your member dashboard.','/dashboard','Open portfolio controls',operator)}${item('03','Dashboard mirror','Inspect the branded member layout in a separate, read-only preview.','/dashboard/mirror','Open read-only mirror',operator)}</div><p class="admin-note">Use your own CIV account. Administrative access is assigned separately from membership.</p></main><footer><span>Crypto Investment Vault</span><a href="mailto:dev@cryptoinvestmentvault.com">Technical support</a></footer></div></body></html>`;
}

const reports = {
 accounts: { title:'Accounts', columns:['Email','Account ID'], sql:'SELECT email, id FROM users ORDER BY email, id' },
 deposits: { title:'Settled deposits', columns:['Account','Amount','Asset','Chain ID','Transaction'], sql:`SELECT u.email, printf('%d.%06d', f.amount_minor / 1000000, f.amount_minor % 1000000) AS amount,
 f.asset, f.chain_id, f.tx_hash FROM funding_receipts f JOIN users u ON u.id=f.user_id ORDER BY f.settled_at DESC, f.id` },
 referrals: { title:'Referrals', columns:['Referred account','Referrer','Referral code'], sql:`SELECT member.email AS member, sponsor.email AS sponsor, a.code
 FROM referral_attributions a JOIN users member ON member.id=a.user_id
 LEFT JOIN referral_codes r ON r.code=a.code LEFT JOIN users sponsor ON sponsor.id=r.user_id ORDER BY member.email, member.id` }
};

function cell(value:unknown){
 return String(value ?? 'Unavailable').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

export async function platformReport(db:D1Database, view:string, page:number){
 const section=view==='deposits'||view==='referrals'?view:'accounts';
 const report=reports[section];
 const results=await db.prepare(report.sql+' LIMIT 26 OFFSET ?').bind((page-1)*25).raw<unknown[]>();
 const nav=Object.entries(reports).map(([key,item])=>`<a href="?view=${key}"${section===key?' aria-current="page"':''}>${item.title}</a>`).join(' · ');
 const rows=results.slice(0,25).map(row=>'<tr>'+row.map(value=>'<td>'+cell(value)+'</td>').join('')+'</tr>').join('');
 const prev=page>1?`<a href="?view=${section}&amp;page=${page-1}">Previous</a>`:'';
 const next=results.length>25?`<a href="?view=${section}&amp;page=${page+1}">Next</a>`:'';
 return `<section class="platform-report"><nav aria-label="Platform reports">${nav}</nav><h2>${report.title}</h2>${rows?`<div class="report-scroll"><table><thead><tr>${report.columns.map(name=>'<th scope="col">'+name+'</th>').join('')}</tr></thead><tbody>${rows}</tbody></table></div>`:'<p>No records on this page.</p>'}<nav aria-label="Report pages">${prev} Page ${page} ${next}</nav></section>`;
}
