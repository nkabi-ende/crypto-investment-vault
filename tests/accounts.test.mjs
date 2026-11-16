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
  for(const statement of sql.split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(statement).run();
 }
});
after(async()=>{await mf?.dispose()});
let ip=1;
async function call(path,{body,cookie,method='GET',headers={},address}={}){
 const r=await mf.dispatchFetch(origin+path,{method,headers:{'cf-connecting-ip':address||`192.0.2.${ip++}`,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 const raw=await r.text();if(!raw.startsWith('{'))throw Error(raw);const data=JSON.parse(raw);return {r,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
const payload=(email,referral='kzn-ai')=>({email,password:'a long unique passphrase 123',name:'Brandon Nkabinde',acceptTerms:true,referral});
test('registration is atomic and creates a durable welcome event plus referral attribution',async()=>{
 const created=await call('/api/auth/register',{method:'POST',body:payload('First@Example.com')});
 assert.equal(created.r.status,201);assert.equal(created.data.user.email,'first@example.com');assert.equal(created.data.welcomeEmail,'awaiting_provider');
 assert.match(created.r.headers.get('set-cookie'),/HttpOnly/);assert.match(created.r.headers.get('set-cookie'),/Secure/);assert.match(created.r.headers.get('set-cookie'),/SameSite=Strict/);
 const profile=await db.prepare('SELECT * FROM account_profiles WHERE user_id=?').bind(created.data.user.id).first();assert.equal(profile.display_name,'Brandon Nkabinde');
 const attribution=await db.prepare('SELECT code FROM referral_attributions WHERE user_id=?').bind(created.data.user.id).first();assert.equal(attribution.code,'kzn-ai');
 const queue=await db.prepare('SELECT status,attempts FROM email_outbox WHERE user_id=?').bind(created.data.user.id).first();assert.deepEqual(queue,{status:'pending',attempts:0});
 const overview=await call('/api/investor/overview',{cookie:created.cookie});assert.equal(overview.data.user.id,created.data.user.id);assert.equal(overview.data.portfolio.cashUsdt,0);
 const ledger=await call('/api/investor/ledger',{cookie:created.cookie});assert.equal(ledger.r.status,200);assert.equal(ledger.data.balanceUsdt,0);
 const onboarding=await call('/api/investor/onboarding',{cookie:created.cookie});assert.match(onboarding.data.referral.url,/^https:\/\/cryptoinvestmentvault.com\/r\/[a-f0-9]{32}$/);assert.equal(onboarding.data.emailVerified,false);
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
test('invalid attribution is ignored, expired sessions fail and existing users get a stable referral',async()=>{
 const made=await call('/api/auth/register',{method:'POST',body:payload('invalid-ref@example.com','<script>')});assert.equal(made.r.status,201);
 assert.equal(await db.prepare('SELECT * FROM referral_attributions WHERE user_id=?').bind(made.data.user.id).first(),null);
 await db.prepare('DELETE FROM referral_codes WHERE user_id=?').bind(made.data.user.id).run();
 const first=await call('/api/investor/onboarding',{cookie:made.cookie});const second=await call('/api/investor/onboarding',{cookie:made.cookie});assert.equal(first.data.referral.url,second.data.referral.url);
 await db.prepare('UPDATE sessions SET expires_at=1 WHERE user_id=?').bind(made.data.user.id).run();assert.equal((await call('/api/me',{cookie:made.cookie})).r.status,401);
});
test('readiness validates required schema, and payment rails remain correctly disabled',async()=>{
 const ready=await call('/api/ready');assert.equal(ready.r.status,200);assert.equal(ready.data.schema,8);
 assert.equal((await call('/api/celo/config')).data.ready,false);
 const made=await call('/api/auth/register',{method:'POST',body:payload('payment@example.com')});
 assert.equal((await call('/api/celo/testnet/intents',{method:'POST',cookie:made.cookie,body:{amountUsd:100,sender:'0x'+'1'.repeat(40)}})).r.status,503);
 assert.equal((await call('/api/funding/deposit',{method:'POST',cookie:made.cookie})).r.status,403);
 const d=await call('/api/celo/testnet/intents',{cookie:made.cookie});assert.equal(d.data.testUsdcMinor,0);assert.equal(d.data.liveBalanceCredits,false);
});

test('invitation HTML has server-rendered OpenGraph metadata and invalid links do not load signup',async()=>{
 const response=await mf.dispatchFetch(origin+'/r/kzn-ai');assert.equal(response.status,200);const html=await response.text();assert.match(html,/<meta property="og:url" content="https:\/\/cryptoinvestmentvault.com\/r\/kzn-ai">/);assert.match(html,/og-invitation-v1.png/);assert.match(html,/id="authForm"/);
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
