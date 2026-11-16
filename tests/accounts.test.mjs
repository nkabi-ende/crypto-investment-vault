import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf, db;
const origin='https://cryptoinvestmentvault.com';
before(async()=>{
 const result=await build({entryPoints:['src/index.ts'],bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['node:crypto']});
 mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',workers:[{name:'civ-test',modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],ratelimits:{AUTH_LIMITER:{namespace_id:'1424211760',simple:{limit:20,period:60}}},assets:{routerConfig:{has_user_worker:true},directory:'public',binding:'ASSETS',run_worker_first:['/api/*','/join','/dashboard','/r/*']},bindings:{APP_ORIGIN:origin,EMAIL_DELIVERY_ENABLED:'false'}}]}));
 db=await mf.getD1Database('DB');
 for(const file of (await readdir('migrations')).filter(x=>x.endsWith('.sql')).sort()){
  const sql=(await readFile('migrations/'+file,'utf8')).replace(/--[^\n]*/g,'');
  let statement='';
  for(const line of sql.split('\n')){statement+=line+'\n';if(!line.trim().endsWith(';'))continue;if(/^CREATE TRIGGER/i.test(statement.trim())&&!statement.trim().endsWith('END;'))continue;await db.prepare(statement.trim()).run();statement=''}
  if(file.startsWith('0008')){
   for(const [id,email] of [['00000000-0000-4000-8000-000000000001','legacy-owner@example.com'],['00000000-0000-4000-8000-000000000002','legacy-member@example.com'],['00000000-0000-4000-8000-000000000003','legacy-direct@example.com']])await db.prepare('INSERT INTO users(id,email,password_hash,salt) VALUES(?,?,?,?)').bind(id,email,'unused','unused').run();
   await db.prepare('INSERT INTO referral_codes(code,user_id) VALUES(?,?)').bind('00000000000040008000000000000001','00000000-0000-4000-8000-000000000001').run();
   await db.prepare('INSERT INTO referral_attributions(user_id,code) VALUES(?,?)').bind('00000000-0000-4000-8000-000000000002','00000000000040008000000000000001').run();
   await db.prepare('INSERT INTO referral_codes(code,label) VALUES(?,?)').bind('kzn-ai','obsolete campaign').run();
   await db.prepare('INSERT INTO referral_attributions(user_id,code) VALUES(?,?)').bind('00000000-0000-4000-8000-000000000003','kzn-ai').run();
  }
 }
});
after(async()=>{await mf?.dispose()});
let ip=1;
async function call(path,{body,cookie,method='GET',headers={},address}={}){
 const r=await mf.dispatchFetch(origin+path,{method,headers:{'cf-connecting-ip':address||`192.0.2.${ip++}`,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 const raw=await r.text();if(!raw.startsWith('{'))throw Error(raw);const data=JSON.parse(raw);return {r,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
const payload=(email,referral=null)=>({email,password:'a long unique passphrase 123',name:'Brandon Nkabinde',acceptTerms:true,referral});
test('registration is atomic and creates a durable welcome event plus referral attribution',async()=>{
 const created=await call('/api/auth/register',{method:'POST',body:payload('First@Example.com')});
 assert.equal(created.r.status,201);assert.equal(created.data.user.email,'first@example.com');assert.equal(created.data.welcomeEmail,'awaiting_provider');
 assert.match(created.r.headers.get('set-cookie'),/HttpOnly/);assert.match(created.r.headers.get('set-cookie'),/Secure/);assert.match(created.r.headers.get('set-cookie'),/SameSite=Strict/);
 const profile=await db.prepare('SELECT * FROM account_profiles WHERE user_id=?').bind(created.data.user.id).first();assert.equal(profile.display_name,'Brandon Nkabinde');
 const attribution=await db.prepare('SELECT code FROM referral_attributions WHERE user_id=?').bind(created.data.user.id).first();assert.equal(attribution,null);
 const queue=await db.prepare('SELECT status,attempts FROM email_outbox WHERE user_id=?').bind(created.data.user.id).first();assert.deepEqual(queue,{status:'pending',attempts:0});
 const overview=await call('/api/investor/overview',{cookie:created.cookie});assert.equal(overview.data.user.id,created.data.user.id);assert.equal(overview.data.portfolio.cashUsdt,0);
 const ledger=await call('/api/investor/ledger',{cookie:created.cookie});assert.equal(ledger.r.status,200);assert.equal(ledger.data.balanceUsdt,0);
 const onboarding=await call('/api/investor/onboarding',{cookie:created.cookie});assert.equal(onboarding.data.referral.url,origin+'/r/'+created.data.user.id);assert.equal(onboarding.data.emailVerified,false);
 const ref=onboarding.data.referral.url.split('/').at(-1);
 const second=await call('/api/auth/register',{method:'POST',body:payload('second@example.com',ref)});assert.equal(second.r.status,201);
 const updated=await call('/api/investor/onboarding',{cookie:created.cookie});assert.equal(updated.data.referral.registrations,1);assert.equal(JSON.stringify(updated.data).includes('second@example.com'),false);
 const dup=await call('/api/auth/register',{method:'POST',body:payload('first@example.com')});assert.equal(dup.r.status,409);
 const total=await db.prepare('SELECT COUNT(*) AS n FROM email_outbox').first();assert.equal(total.n,2);
 const login=await call('/api/auth/login',{method:'POST',body:payload('first@example.com'),cookie:created.cookie});assert.equal(login.r.status,200);
 assert.equal((await call('/api/me',{cookie:created.cookie})).r.status,401); // rotated
 assert.equal((await call('/api/me',{cookie:login.cookie})).r.status,200);
 await call('/api/auth/logout',{method:'POST',cookie:login.cookie});assert.equal((await call('/api/me',{cookie:login.cookie})).r.status,401);
});
test('rejects missing consent, oversized input, cross-origin writes and anonymous account access',async()=>{
 for(const change of [{acceptTerms:false},{name:''},{password:'short'},{password:'x'.repeat(129)},{email:'e'.repeat(255)+'@example.com'}]) assert.equal((await call('/api/auth/register',{method:'POST',body:{...payload('bad@example.com'),...change}})).r.status,400);
 assert.equal((await call('/api/auth/register',{method:'POST',body:payload('cross@example.com'),headers:{Origin:'https://attacker.example'}})).r.status,403);
 assert.equal((await call('/api/auth/register',{method:'POST',body:{name:'x'.repeat(17000)}})).r.status,413);
 for(const path of ['/api/me','/api/investor/onboarding','/api/investor/ledger','/api/investor/overview','/api/celo/testnet/intents']) assert.equal((await call(path)).r.status,401);
});
test('per-account lockout survives requests from different IPs and shared IP limit protects signup',async()=>{
 for(let i=0;i<5;i++)assert.equal((await call('/api/auth/login',{method:'POST',body:payload('unknown@example.com')})).r.status,401);
 const locked=await call('/api/auth/login',{method:'POST',body:payload('unknown@example.com')});assert.equal(locked.r.status,429);assert.ok(Number(locked.r.headers.get('retry-after'))>0);
 let limited=false;for(let i=0;i<22;i++){const a=await call('/api/auth/register',{method:'POST',body:{},address:'203.0.113.88'});if(a.r.status===429){limited=true;break}}assert.ok(limited);
});
test('invalid attribution is ignored, expired sessions fail and members get a stable referral',async()=>{
 const made=await call('/api/auth/register',{method:'POST',body:payload('invalid-ref@example.com','<script>')});assert.equal(made.r.status,201);
 assert.equal(await db.prepare('SELECT * FROM referral_attributions WHERE user_id=?').bind(made.data.user.id).first(),null);

 const first=await call('/api/investor/onboarding',{cookie:made.cookie});const second=await call('/api/investor/onboarding',{cookie:made.cookie});assert.equal(first.data.referral.url,second.data.referral.url);
 await db.prepare('UPDATE sessions SET expires_at=1 WHERE user_id=?').bind(made.data.user.id).run();assert.equal((await call('/api/me',{cookie:made.cookie})).r.status,401);
});
test('readiness validates required schema, and payment rails remain correctly disabled',async()=>{
 const ready=await call('/api/ready');assert.equal(ready.r.status,200);assert.equal(ready.data.schema,9);
 assert.equal((await call('/api/celo/config')).data.ready,false);
 const made=await call('/api/auth/register',{method:'POST',body:payload('payment@example.com')});
 assert.equal((await call('/api/celo/testnet/intents',{method:'POST',cookie:made.cookie,body:{amountUsd:100,sender:'0x'+'1'.repeat(40)}})).r.status,503);
 assert.equal((await call('/api/funding/deposit',{method:'POST',cookie:made.cookie})).r.status,403);
 const d=await call('/api/celo/testnet/intents',{cookie:made.cookie});assert.equal(d.data.testUsdcMinor,0);assert.equal(d.data.liveBalanceCredits,false);
});

test('invitation HTML has server-rendered OpenGraph metadata and invalid links do not load signup',async()=>{
 const made=await call('/api/auth/register',{method:'POST',body:payload('social-member@example.com')});
 const response=await mf.dispatchFetch(origin+'/r/'+made.data.user.id);assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes('property="og:url" content="'+origin+'/r/'+made.data.user.id+'"'));assert.match(html,/og-invitation-v1.png/);assert.match(html,/id="authForm"/);assert.match(html,/R500 signup deposit/);assert.doesNotMatch(html,/kzn-ai|KZN AI Solutions/i);
 const retired=await mf.dispatchFetch(origin+'/r/kzn-ai');assert.equal(retired.status,404);await retired.text();
 const bad=await mf.dispatchFetch(origin+'/r/unknown-invitation');assert.equal(bad.status,404);await bad.text();
 const dashboard=await mf.dispatchFetch(origin+'/dashboard');assert.match(await dashboard.text(),/noindex,nofollow/);
});
test('a mid-registration database failure rolls back the user and every related write',async()=>{
 await db.prepare("CREATE TRIGGER fail_profile BEFORE INSERT ON account_profiles WHEN NEW.display_name='Rollback User' BEGIN SELECT RAISE(ABORT,'deliberate test failure'); END").run();
 const result=await call('/api/auth/register',{method:'POST',body:{...payload('rollback@example.com'),name:'Rollback User'}});assert.equal(result.r.status,503);assert.equal(result.cookie,undefined);
 assert.equal(await db.prepare("SELECT id FROM users WHERE email='rollback@example.com'").first(),null);
 await db.prepare('DROP TRIGGER fail_profile').run();
});
test('welcome mail stays queued until activation and delivery retries do not duplicate a sent job',async()=>{
 const result=await build({entryPoints:['src/email.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const {deliverEmails,welcomeEmail}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const escaped=welcomeEmail('<b>Angel</b>',origin);assert.ok(escaped.html.includes('&lt;b&gt;Angel&lt;/b&gt;'));assert.ok(escaped.text.includes('/dashboard'));
 const before=await db.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE status='pending'").first();assert.ok(before.n>0);
 await deliverEmails({DB:db,APP_ORIGIN:origin,EMAIL_DELIVERY_ENABLED:'false'});
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE status='pending'").first()).n,before.n);
 const realFetch=globalThis.fetch;const keys=[];
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');assert.ok(options.headers['User-Agent']);keys.push(options.headers['Idempotency-Key']);return new Response(JSON.stringify({id:'test-provider-id'}),{headers:{'Content-Type':'application/json'}})};
 try{
  const env={DB:db,APP_ORIGIN:origin,EMAIL_DELIVERY_ENABLED:'true',RESEND_API_KEY:'test-only',EMAIL_FROM:'CIV <noreply@example.com>'};
  await deliverEmails(env);const count=keys.length;assert.ok(count>0);assert.equal(new Set(keys).size,count);
  await deliverEmails(env);assert.equal(keys.length,count);
  const sent=await db.prepare("SELECT id FROM email_outbox WHERE status='sent' LIMIT 1").first();
  await db.prepare("UPDATE email_outbox SET status='pending',available_at=0,attempts=0 WHERE id=?").bind(sent.id).run();
  globalThis.fetch=async()=>new Response('private provider response must not be stored',{status:503});
  await deliverEmails(env);const retry=await db.prepare('SELECT status,attempts,available_at,last_error FROM email_outbox WHERE id=?').bind(sent.id).first();assert.equal(retry.status,'pending');assert.equal(retry.attempts,1);assert.ok(retry.available_at>Date.now());assert.equal(retry.last_error,'PROVIDER_HTTP_503');
 }finally{globalThis.fetch=realFetch}
});

test('migration removes campaign attribution, preserves member history and redirects legacy member URLs',async()=>{
 assert.equal(await db.prepare("SELECT * FROM referral_codes WHERE user_id IS NULL OR label IS NOT NULL").first(),null);
 assert.equal(await db.prepare("SELECT * FROM referral_attributions WHERE user_id='00000000-0000-4000-8000-000000000003'").first(),null);
 const kept=await db.prepare("SELECT code FROM referral_attributions WHERE user_id='00000000-0000-4000-8000-000000000002'").first();assert.equal(kept.code,'00000000000040008000000000000001');
 assert.equal((await db.prepare("SELECT required_minor FROM signup_deposit_requirements WHERE user_id='00000000-0000-4000-8000-000000000003'").first()).required_minor,50000);
 const redirect=await mf.dispatchFetch(origin+'/r/00000000000040008000000000000001',{redirect:'manual'});assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'/r/00000000-0000-4000-8000-000000000001');await redirect.text();
 await assert.rejects(db.prepare("INSERT INTO referral_codes(code,label) VALUES('campaign','not a member')").run());
 await assert.rejects(db.prepare("INSERT INTO referral_attributions(user_id,code) VALUES('00000000-0000-4000-8000-000000000001','00000000000040008000000000000001')").run());
 await assert.rejects(db.prepare("UPDATE referral_attributions SET code=code").run());
});
test('R500 activation counts settled production ZAR only, handles refunds and unlocks published perks',async()=>{
 const inviter=await call('/api/auth/register',{method:'POST',body:payload('activation-owner@example.com')});
 const invitee=await call('/api/auth/register',{method:'POST',body:payload('activation-member@example.com',inviter.data.user.id)});
 assert.equal(invitee.data.referral.code,invitee.data.user.id);assert.equal(invitee.data.signupDeposit.requiredMinor,50000);
 async function onboard(account){return (await call('/api/investor/onboarding',{cookie:account.cookie})).data}
 let state=await onboard(inviter);assert.equal(state.signupDeposit.requiredMinor,50000);assert.equal(state.signupDeposit.remainingMinor,50000);assert.equal(state.signupDeposit.collectionEnabled,false);assert.equal(state.activated,false);assert.deepEqual(state.perks,[]);assert.equal(state.referral.pending,1);
 const settle=(account,ref,amount,environment='production')=>db.prepare("INSERT INTO signup_deposits(id,user_id,provider,payment_ref,currency,amount_minor,environment,settled_at) VALUES(?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),account.data.user.id,'test-fixture',ref,'ZAR',amount,environment,new Date().toISOString()).run();
 await assert.rejects(settle(invitee,'testnet',50000,'testnet'));
 await assert.rejects(db.prepare("INSERT INTO signup_deposits(id,user_id,provider,payment_ref,currency,amount_minor,environment,settled_at) VALUES('fake',?,'fixture','fake-usd','USDC',50000,'production','now')").bind(invitee.data.user.id).run());
 for(const path of ['/api/investor/onboarding','/api/investor/deposit/confirm','/api/funding/signup-deposit']){const r=await call(path,{method:'POST',cookie:invitee.cookie,body:{paid:true,amountMinor:50000}});assert.ok([403,404].includes(r.r.status))}
 await settle(invitee,'partial',20000);state=await onboard(invitee);assert.equal(state.signupDeposit.status,'partially_paid');assert.equal(state.signupDeposit.remainingMinor,30000);assert.equal((await onboard(inviter)).referral.qualified,0);
 await settle(invitee,'remaining',30000);await assert.rejects(settle(inviter,'remaining',30000));
 state=await onboard(inviter);assert.equal(state.referral.qualified,1);assert.equal(state.referral.pending,0);assert.equal((await onboard(invitee)).activated,true);assert.ok(!JSON.stringify(state).includes('activation-member@example.com'));
 await db.prepare("INSERT INTO member_perks(id,title,description,metric,threshold,status) VALUES('test-referral','Member feature','Fixture perk','qualified_referrals',1,'published'),('test-community','Community feature','Fixture community perk','activated_members',1,'published'),('draft-perk','Hidden feature','Not published','qualified_referrals',1,'draft')").run();
 state=await onboard(inviter);assert.equal(state.perks.length,2);assert.ok(state.perks.every(p=>p.status==='locked'));
 await settle(inviter,'owner',50000);state=await onboard(inviter);assert.ok(state.perks.every(p=>p.status==='unlocked'));
 await db.prepare("UPDATE signup_deposits SET refunded_minor=1 WHERE payment_ref='remaining'").run();state=await onboard(inviter);assert.equal(state.referral.qualified,0);assert.equal(state.perks.find(p=>p.id==='test-referral').status,'locked');assert.equal((await onboard(invitee)).signupDeposit.remainingMinor,1);
 const ledger=await call('/api/investor/ledger',{cookie:inviter.cookie});assert.equal(ledger.data.balanceUsdt,0);
 await db.prepare("DELETE FROM member_perks WHERE id IN ('test-referral','test-community','draft-perk')").run();
});

test('browser invitation capture rejects campaign tags, expires old links and works without local storage',async()=>{
 const {Script,runInNewContext}=await import('node:vm');
 const html=await readFile('public/index.html','utf8');
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(match[0].includes('application/ld+json'))continue;new Script(match[1])}
 const fn=html.match(/function readReferral\(\)\{[^\n]+/)[0];
 const id='00000000-0000-4000-8000-000000000001';let saved=null;
 const storage={setItem:(key,value)=>saved=value,getItem:()=>saved,removeItem:()=>saved=null};
 const evaluate=(path,search='',localStorage=storage)=>runInNewContext(fn+';readReferral()',{location:{pathname:path,search},localStorage,URLSearchParams,Date});
 assert.equal(evaluate('/r/'+id),id);assert.equal(evaluate('/'),id);
 saved=JSON.stringify({code:'kzn-ai',at:Date.now()});assert.equal(evaluate('/'),null);assert.equal(saved,null);
 saved=JSON.stringify({code:id,at:Date.now()-31*86400000});assert.equal(evaluate('/'),null);
 const blocked={setItem(){throw Error('disabled')},getItem(){throw Error('disabled')}};assert.equal(evaluate('/r/'+id,'',blocked),id);
 assert.equal(evaluate('/join','?ref='+id),id);
});
