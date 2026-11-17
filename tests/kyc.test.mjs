import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const origin='https://cryptoinvestmentvault.com';let mf,db,member,other,reviewer;
before(async()=>{
 const result=await build({entryPoints:['src/index.ts'],bundle:true,write:false,format:'esm',platform:'node',external:['node:crypto']});
 mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',workers:[{name:'kyc-tests',modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],ratelimits:{API_LIMITER:{namespace_id:'1424211761',simple:{limit:1000,period:60}},AUTH_LIMITER:{namespace_id:'1424211760',simple:{limit:1000,period:60}}},bindings:{APP_ORIGIN:origin}}]}));db=await mf.getD1Database('DB');
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  let statement='';for(const line of (await readFile('migrations/'+file,'utf8')).replace(/--[^\n]*/g,'').split('\n')){statement+=line+'\n';if(!line.trim().endsWith(';'))continue;if(/^CREATE TRIGGER/i.test(statement.trim())&&!statement.trim().endsWith('END;'))continue;try{await db.prepare(statement.trim()).run()}catch(error){console.error('Migration failed:',file,statement.slice(0,150));throw error}statement=''}
 }
 async function account(name){const id=randomUUID(),token=randomUUID();await db.batch([db.prepare('INSERT INTO users(id,email,password_hash,salt) VALUES(?,?,?,?)').bind(id,name+'@example.invalid','unused','unused'),db.prepare('INSERT INTO account_profiles(user_id,display_name,terms_version) VALUES(?,?,?)').bind(id,name,'test'),db.prepare('INSERT INTO sessions(id_hash,user_id,expires_at,security_version,authenticated_at,last_seen_at) VALUES(?,?,?,1,?,?)').bind(createHash('sha256').update(token).digest('base64url'),id,Date.now()+3600000,Date.now(),Date.now())]);return {id,cookie:'__Host-civ_session='+token}}
 member=await account('member');other=await account('other');reviewer=await account('reviewer');await db.prepare('INSERT INTO kyc_reviewers(user_id,granted_by) VALUES(?,?)').bind(reviewer.id,'isolated test setup').run();
});
after(async()=>{await mf?.dispose()});
async function call(path,{actor=member,method='GET',body,headers={}}={}){
 let payload=body instanceof FormData?body:body?JSON.stringify(body):undefined;
 let extra=body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{};
 if(body instanceof FormData){const encoded=new Request(origin+path,{method,body});payload=await encoded.arrayBuffer();extra={'Content-Type':encoded.headers.get('content-type')}}
 const response=await mf.dispatchFetch(origin+path,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(method==='POST'?{Origin:origin}:{}),...extra,...headers},...(payload?{body:payload}:{})});
 const type=response.headers.get('content-type')||'';return {response,data:type.includes('application/json')?await response.json():new Uint8Array(await response.arrayBuffer())}
}
const png=new Uint8Array(96);png.set([137,80,78,71,13,10,26,10]);const largePng=new Uint8Array(700000);largePng.set(png);largePng[largePng.length-1]=42;
function form(bytes=png,type='image/png'){const f=new FormData();f.append('document',new Blob([bytes],{type}),'private-evidence.png');return f}
const submit=actor=>call('/api/investor/kyc/submit',{actor,method:'POST',body:{consent:true,consentVersion:'kyc-2026-11-17'}});
const decision=(submission,changes={})=>call('/api/admin/kyc/'+submission.submissionId+'/decision',{actor:reviewer,method:'POST',body:{revision:submission.revision,decision:'approved',note:'Document ownership and validity checked in this isolated test.',identityMatched:true,addressMatched:true,validityChecked:true,...changes}});
test('identity endpoints require the member session and reject cross-origin and forged document input',async()=>{
 assert.equal((await call('/api/investor/kyc',{actor:null})).response.status,401);
 assert.equal((await call('/api/investor/kyc/documents/identity',{actor:null,method:'POST',body:form()})).response.status,401);
 assert.equal((await call('/api/investor/kyc/documents/identity',{method:'POST',body:form(),headers:{Origin:'https://attacker.invalid'}})).response.status,403);
 assert.equal((await call('/api/investor/kyc/documents/identity',{method:'POST',body:form(new TextEncoder().encode('not a real image even if the content type says image/png'))})).response.status,400);
 const f=form();f.append('userId',other.id);assert.equal((await call('/api/investor/kyc/documents/identity',{method:'POST',body:f})).response.status,400);
 const big=new Uint8Array(5*1024*1024+1);big.set(png);assert.equal((await call('/api/investor/kyc/documents/identity',{method:'POST',body:form(big)})).response.status,413);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM kyc_documents').first()).n,0);
});
test('private evidence is linked to the session owner and submission never self-approves or unlocks withdrawals',async()=>{
 const id=await call('/api/investor/kyc/documents/identity',{method:'POST',body:form()});assert.equal(id.response.status,201,JSON.stringify(id.data));assert.equal(id.data.kyc.verified,false);
 assert.equal((await submit(member)).response.status,400,'Both documents are mandatory');
 const address=await call('/api/investor/kyc/documents/address',{method:'POST',body:form(largePng)});assert.equal(address.response.status,201);
 const stored=await db.prepare('SELECT user_id,sha256 FROM kyc_documents WHERE id=?').bind(id.data.document.id).first();assert.equal(stored.user_id,member.id);assert.equal(stored.sha256,createHash('sha256').update(png).digest('hex'));
 const otherStatus=await call('/api/investor/kyc',{actor:other});assert.equal(otherStatus.data.documents.length,0);
 const submission=await submit(member);assert.equal(submission.response.status,202);assert.equal(submission.data.status,'pending');assert.equal(submission.data.verified,false);assert.equal(submission.data.withdrawalRequestsEnabled,false);
 assert.equal((await submit(member)).data.submissionId,submission.data.submissionId,'Submission retry is idempotent');
 assert.equal((await call('/api/investor/kyc/documents/address',{method:'POST',body:form()})).response.status,409,'Pending evidence cannot be swapped');
 assert.equal((await call('/api/investor/withdrawals',{method:'POST',body:{}})).response.status,403);
 assert.equal((await call('/api/admin/kyc',{actor:member})).response.status,403);
 assert.equal((await call('/api/admin/kyc/'+submission.data.submissionId+'/decision',{actor:member,method:'POST',body:{decision:'approved',revision:1}})).response.status,403);
});
test('reviewer must open both documents and complete checks; approval is audited and cannot be replayed or self-issued',async()=>{
 const state=(await call('/api/investor/kyc')).data;
 assert.equal((await decision(state)).response.status,409,'Evidence must be accessed before approval');
 const identity=await call('/api/admin/kyc/'+state.submissionId+'/documents/identity',{actor:reviewer});assert.equal(identity.response.status,200);assert.deepEqual(identity.data,png);assert.match(identity.response.headers.get('content-disposition'),/^attachment/);assert.equal(identity.response.headers.get('cache-control'),'no-store');
 assert.equal((await decision(state)).response.status,409);
 assert.equal((await call('/api/admin/kyc/'+state.submissionId+'/documents/address',{actor:other})).response.status,403);
 const address=await call('/api/admin/kyc/'+state.submissionId+'/documents/address',{actor:reviewer});assert.equal(address.data.length,700000);assert.equal(address.data.at(-1),42);
 assert.equal((await decision(state,{identityMatched:false})).response.status,400);
 assert.equal((await decision(state)).response.status,200);
 const approved=(await call('/api/investor/kyc')).data;assert.equal(approved.status,'approved');assert.equal(approved.verified,true);assert.equal(approved.withdrawalRequestsEnabled,true);assert.equal(approved.payoutExecutionEnabled,false);
 assert.equal((await decision(state)).response.status,409);
 assert.equal((await call('/api/investor/kyc',{actor:other})).data.verified,false);
 const audit=await db.prepare("SELECT * FROM kyc_events WHERE submission_id=? AND action='approved'").bind(state.submissionId).first();assert.equal(audit.actor_id,reviewer.id);
 await assert.rejects(db.prepare("UPDATE kyc_events SET action='changed' WHERE id=?").bind(audit.id).run());
 await db.prepare('INSERT INTO kyc_reviewers(user_id,granted_by) VALUES(?,?)').bind(member.id,'isolated self-review test').run();
 assert.equal((await call('/api/admin/kyc/'+state.submissionId+'/documents/identity')).response.status,404,'Reviewer cannot access their own case as a reviewer');
});
test('verified withdrawal requests reserve only settled funds, reject excess and deduplicate retries without executing a payout',async()=>{
 const id=randomUUID();await db.prepare("INSERT INTO ada_transactions(id,source_key,kind,status,evidence_ref,effective_at) VALUES(?,?,'funding','draft',?,CURRENT_TIMESTAMP)").bind(id,'isolated-kyc-funding-'+id,'isolated-test').run();await db.batch([db.prepare("INSERT INTO ada_postings(transaction_id,line_no,user_id,account,asset,bucket,amount_minor) VALUES(?,1,?,'customer:test','USDC','funding',100000000)").bind(id,member.id),db.prepare("INSERT INTO ada_postings(transaction_id,line_no,user_id,account,asset,bucket,amount_minor) VALUES(?,2,NULL,'external:test','USDC','clearing',-100000000)").bind(id),db.prepare("UPDATE ada_transactions SET status='posted' WHERE id=?").bind(id)]);
 const available=await call('/api/investor/withdrawals');assert.equal(available.data.balances.find(b=>b.asset==='USDC').available_minor,100000000);
 const key=randomUUID(),body={asset:'USDC',amountMinor:60000000,destinationAddress:'0x'+'1'.repeat(40)},options={method:'POST',body,headers:{'Idempotency-Key':key}};
 const first=await call('/api/investor/withdrawals',options);assert.equal(first.response.status,201);assert.equal(first.data.status,'pending_review');assert.equal(first.data.payoutExecutionEnabled,false);
 assert.equal((await call('/api/investor/withdrawals',options)).data.requestId,first.data.requestId);
 assert.equal((await call('/api/investor/withdrawals',{...options,body:{...body,amountMinor:1}})).response.status,409);
 const competing=await Promise.all([call('/api/investor/withdrawals',{...options,headers:{'Idempotency-Key':randomUUID()},body:{...body,amountMinor:30000000}}),call('/api/investor/withdrawals',{...options,headers:{'Idempotency-Key':randomUUID()},body:{...body,amountMinor:30000000}})]);assert.deepEqual(competing.map(r=>r.response.status).sort(),[201,409]);
 assert.equal((await call('/api/investor/withdrawals')).data.balances.find(b=>b.asset==='USDC').available_minor,10000000);
 const row=await db.prepare('SELECT executed_at,transaction_hash FROM withdrawal_requests WHERE id=?').bind(first.data.requestId).first();assert.equal(row.executed_at,null);assert.equal(row.transaction_hash,null);
});
test('rejected documents can be replaced and resubmitted without mutating the original evidence',async()=>{
 for(const kind of ['identity','address'])await call('/api/investor/kyc/documents/'+kind,{actor:other,method:'POST',body:form()});
 const state=(await submit(other)).data;for(const kind of ['identity','address'])await call('/api/admin/kyc/'+state.submissionId+'/documents/'+kind,{actor:reviewer});
 const rejected=await decision(state,{decision:'rejected',note:'Please provide a clearer proof of address.'});assert.equal(rejected.response.status,200);
 const original=(await call('/api/investor/kyc',{actor:other})).data;assert.equal(original.verified,false);assert.match(original.reviewNote,/clearer proof/);
 const replacement=await call('/api/investor/kyc/documents/address',{actor:other,method:'POST',body:form()});assert.equal(replacement.response.status,201);
 const resubmitted=(await submit(other)).data;assert.equal(resubmitted.revision,2);assert.equal(resubmitted.status,'pending');assert.equal(resubmitted.verified,false);
 const first=await db.prepare('SELECT address_document_id,status FROM kyc_submissions WHERE id=?').bind(state.submissionId).first();assert.equal(first.status,'rejected');assert.notEqual(first.address_document_id,replacement.data.document.id);
});

test('expired approvals never expose a verified badge or withdrawal eligibility',async()=>{
 const built=await build({entryPoints:['src/kyc.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const {kycStatus}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const expired={id:'expired-submission',revision:1,status:'approved',submitted_at:'2025-01-01',reviewed_at:'2025-01-02',expires_at:'2025-01-03T00:00:00.000Z',review_note:null};
 const mockDb={prepare(){return {bind(){return this},async first(){return expired},async all(){return {results:[]}}}}};
 const state=await kycStatus(mockDb,'expired-member');assert.equal(state.status,'expired');assert.equal(state.verified,false);assert.equal(state.withdrawalRequestsEnabled,false);
});
