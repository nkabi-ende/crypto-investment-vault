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
const payload=(email,referral=null)=>({email,password:'a long unique passphrase 123',name:'CIV Test Member',acceptTerms:true,referral});
test('registration is atomic and creates a durable welcome event plus referral attribution',async()=>{
 const created=await call('/api/auth/register',{method:'POST',body:payload('First@Example.com')});
 assert.equal(created.r.status,201);assert.equal(created.data.user.email,'first@example.com');assert.equal(created.data.welcomeEmail,'awaiting_provider');
 assert.match(created.r.headers.get('set-cookie'),/HttpOnly/);assert.match(created.r.headers.get('set-cookie'),/Secure/);assert.match(created.r.headers.get('set-cookie'),/SameSite=Strict/);
 const profile=await db.prepare('SELECT * FROM account_profiles WHERE user_id=?').bind(created.data.user.id).first();assert.equal(profile.display_name,'CIV Test Member');
 const attribution=await db.prepare('SELECT code FROM referral_attributions WHERE user_id=?').bind(created.data.user.id).first();assert.equal(attribution,null);
 const queue=await db.prepare('SELECT status,attempts FROM email_outbox WHERE user_id=?').bind(created.data.user.id).first();assert.deepEqual(queue,{status:'pending',attempts:0});
 const overview=await call('/api/investor/overview',{cookie:created.cookie});assert.equal(overview.data.user.id,created.data.user.id);assert.equal(overview.data.portfolio.cashUsdt,0);
 const ledger=await call('/api/investor/ledger',{cookie:created.cookie});assert.equal(ledger.r.status,200);assert.equal(ledger.data.balanceUsdt,0);
 const onboarding=await call('/api/investor/onboarding',{cookie:created.cookie});assert.match(onboarding.data.referral.code,/^[a-f0-9]{10}$/);assert.equal(onboarding.data.referral.url,origin+'/r/'+created.data.referral.code);assert.equal(onboarding.data.emailVerified,false);
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
 const ready=await call('/api/ready');assert.equal(ready.r.status,200);assert.equal(ready.data.schema,12);
 assert.equal((await call('/api/celo/config')).data.ready,false);
 const made=await call('/api/auth/register',{method:'POST',body:payload('payment@example.com')});
 assert.equal((await call('/api/celo/testnet/intents',{method:'POST',cookie:made.cookie,body:{amountUsd:100,sender:'0x'+'1'.repeat(40)}})).r.status,503);
 assert.equal((await call('/api/funding/deposit',{method:'POST',cookie:made.cookie})).r.status,403);
 const d=await call('/api/celo/testnet/intents',{cookie:made.cookie});assert.equal(d.data.testUsdcMinor,0);assert.equal(d.data.liveBalanceCredits,false);
});

test('invitation HTML has server-rendered OpenGraph metadata and invalid links do not load signup',async()=>{
 const made=await call('/api/auth/register',{method:'POST',body:payload('social-member@example.com')});
 const legacy=await mf.dispatchFetch(origin+'/r/'+made.data.user.id,{redirect:'manual'});assert.equal(legacy.status,301);assert.equal(legacy.headers.get('location'),'/r/'+made.data.referral.code);await legacy.text();const response=await mf.dispatchFetch(made.data.referral.url);assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes('property="og:url" content="'+made.data.referral.url+'"'));assert.match(html,/og-invitation-v3.png/);assert.match(html,/id="authForm"/);assert.match(html,/Minimum deposit: 100 USDC or USDT/);assert.doesNotMatch(html,/kzn-ai|KZN AI Solutions/i);
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
 const redirect=await mf.dispatchFetch(origin+'/r/00000000000040008000000000000001',{redirect:'manual'});assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'/r/'+(await db.prepare("SELECT code FROM referral_aliases WHERE user_id='00000000-0000-4000-8000-000000000001'").first()).code);await redirect.text();
 await assert.rejects(db.prepare("INSERT INTO referral_codes(code,label) VALUES('campaign','not a member')").run());
 await assert.rejects(db.prepare("INSERT INTO referral_attributions(user_id,code) VALUES('00000000-0000-4000-8000-000000000001','00000000000040008000000000000001')").run());
 await assert.rejects(db.prepare("UPDATE referral_attributions SET code=code").run());
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
 assert.equal(evaluate('/join','?ref='+id),id);assert.equal(evaluate('/r/abcdef0123'),'abcdef0123');assert.equal(evaluate('/'),'abcdef0123');
});

test('stablecoin deposits activate membership, preserve token balances and isolate R500 promotion',async()=>{
 const built=await build({entryPoints:['src/payments.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const p=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const sender='0x'+'1'.repeat(40),treasury='0x'+'2'.repeat(40),blockHash='0x'+'b'.repeat(64);
 const env={DB:db,PAYMENTS_ENABLED:'true',PAYMENT_MODE:'production',PAYMENT_CANARY_ONLY:'true',PAYMENT_CANARY_EMAIL:'funding-owner@example.com',CELO_MAINNET_RPC_URL:'https://rpc.example',CELO_MAINNET_TREASURY_ADDRESS:treasury,CELO_SEPOLIA_RPC_URL:'https://test-rpc.example',CELO_TEST_TREASURY_ADDRESS:treasury,CELO_TEST_USDC_ADDRESS:'0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B'};
 assert.equal(p.paymentConfig({...env,PAYMENTS_ENABLED:'false'}).ready,false);
 assert.equal(p.paymentConfig({...env,PAYMENT_CANARY_ONLY:'false'}).ready,false,'Disabling the pilot gate must fail closed');
 assert.equal(p.paymentConfig({...env,PAYMENT_CANARY_EMAIL:undefined}).ready,false,'Missing canary secret must fail closed');
 assert.equal(p.paymentConfig({...env,PAYMENT_CANARY_EMAIL:'not-an-email'}).ready,false);
 assert.equal(p.pilotAllowed(env,'FUNDING-OWNER@example.com'),true);
 assert.equal(p.pilotAllowed(env,'funding-other@example.com'),false);assert.equal(p.paymentConfig({...env,CELO_MAINNET_TREASURY_ADDRESS:'0x'+'0'.repeat(40)}).ready,false);assert.deepEqual(p.paymentConfig(env).depositPresets,[100,200]);assert.equal(p.paymentConfig(env).platformToken,false);
 const owner=await call('/api/auth/register',{method:'POST',body:payload('funding-owner@example.com')});
 const other=await call('/api/auth/register',{method:'POST',body:payload('funding-other@example.com',owner.data.user.id)});
 const createQuoteFor=(userId,symbol,from,amount)=>{
   env.PAYMENT_CANARY_EMAIL=userId===owner.data.user.id?'funding-owner@example.com':'funding-other@example.com';
   return p.createQuote(env,userId,symbol,from,amount);
 };
 await assert.rejects(p.createQuote({...env,PAYMENT_CANARY_EMAIL:'unrelated@example.com'},owner.data.user.id,'USDC',sender,100),/restricted/);
 let q,hash='0x'+'a'.repeat(64),chain=42220,final=100,late=false,wrongAmount=false;
 const realFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.ok(!String(url).includes('coingecko'),'Token-unit deposits do not depend on an FX provider');
  const {method}=JSON.parse(options.body);let result;
  if(method==='eth_chainId')result='0x'+chain.toString(16);
  else if(method==='eth_call')result='0x6';
  else if(method==='eth_getCode')result='0x60016000';
  else if(method==='eth_blockNumber')result='0x64';
  else if(method==='eth_getTransactionByHash')result={hash,from:sender,to:q.token,input:p.paymentData(q),value:'0x0'};
  else if(method==='eth_getTransactionReceipt')result={status:'0x1',blockNumber:'0x64',blockHash,logs:[{address:q.token,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+sender.slice(2).padStart(64,'0'),'0x'+treasury.slice(2).padStart(64,'0')],data:'0x'+BigInt(q.token_minor+(wrongAmount?1:0)).toString(16)}]};
  else if(method==='eth_getBlockByNumber')result=JSON.parse(options.body).params[0]==='finalized'?{number:'0x'+final.toString(16)}:{hash:blockHash,timestamp:'0x'+Math.floor((late?q.expires_at+60000:q.created_at+1000)/1000).toString(16)};
  else if(method==='eth_getLogs')result=[{transactionHash:hash}];else throw Error(method);
  return Response.json({jsonrpc:'2.0',id:1,result});
 };
 const stored=async quote=>db.prepare('SELECT * FROM payment_quotes WHERE id=?').bind(quote.id).first();
 const onboard=async account=>(await call('/api/investor/onboarding',{cookie:account.cookie})).data;
 try{
  const health=await p.mainnetPreflight(env);assert.equal(health.ready,true);assert.equal(health.chainId,42220);assert.equal(health.usdc,true);assert.equal(health.usdt,true);assert.equal(health.feeAdaptersVerified,true);
  for(const amount of [0,50,99,101,500,'100'])await assert.rejects(createQuoteFor(owner.data.user.id,'USDT',sender,amount));
  const first=await createQuoteFor(owner.data.user.id,'USDT',sender,100);assert.equal(first.tokenMinor,'100000000');assert.equal(first.purpose,'funding');assert.equal(first.amount,100);q=await stored(first);assert.equal(q.expires_at-q.created_at,300000);assert.equal((await createQuoteFor(owner.data.user.id,'USDT',sender,100)).id,first.id);
  final=99;assert.equal((await p.verifyQuote(env,q,hash)).status,'pending');assert.equal((await onboard(owner)).activated,false);await assert.rejects(createQuoteFor(owner.data.user.id,'USDC',sender,200),/awaiting verification/);
  final=100;assert.equal((await p.verifyQuote(env,q,hash)).status,'verified');assert.equal((await p.verifyQuote(env,q,hash)).status,'verified');let state=await onboard(owner);assert.equal(state.activated,true);assert.deepEqual(state.balances,[{asset:'USDT',amountMinor:100000000}]);assert.equal(state.promotion.amountMinor,50000);assert.equal(state.promotion.status,'pending_terms');assert.equal(state.promotion.withdrawable,false);
  const second=await createQuoteFor(other.data.user.id,'USDC',sender,200);const secondQ=await stored(second);assert.equal((await p.verifyQuote(env,secondQ,hash)).status,'mismatch');
  assert.equal((await call('/api/payments/quotes/'+first.id+'/verify',{method:'POST',cookie:other.cookie,body:{txHash:hash}})).r.status,404);
  q=secondQ;hash='0x'+'c'.repeat(64);late=true;assert.equal((await p.verifyQuote(env,q,hash)).status,'review');assert.equal((await onboard(other)).activated,false);late=false;
  chain=11142220;
  const testEnv={...env,PAYMENT_MODE:'testnet'};
  assert.deepEqual(p.paymentConfig(testEnv).depositPresets,[1,2]);
  assert.equal(p.paymentConfig(testEnv).liveDepositsEnabled,false);
  await assert.rejects(p.createQuote(testEnv,other.data.user.id,'USDC',sender,100),/supported deposit amount/);
  await assert.rejects(p.createQuote({...testEnv,CELO_TEST_USDC_ADDRESS:'0x'+'1'.repeat(40)},other.data.user.id,'USDC',sender,1),/token configuration/);
  const test=await p.createQuote(testEnv,other.data.user.id,'USDC',sender,1);
  q=await stored(test);assert.equal(test.tokenMinor,'1000000');assert.equal(test.depositAmount,1);assert.equal(q.token,p.testUSDC);assert.equal(q.funding_minor,null,'Sandbox quotes must not store production funding values');
  assert.equal((await p.verifyQuote(env,q,hash)).status,'verified_test');
  assert.equal((await onboard(other)).activated,false);
  assert.deepEqual((await onboard(other)).balances,[]);
  assert.equal((await onboard(owner)).referralWallet.amountMinor,0);
  chain=42220;hash='0x'+'d'.repeat(64);const recovery=await createQuoteFor(other.data.user.id,'USDT',sender,100);q=await stored(recovery);await p.reconcilePayments(env);assert.equal((await stored(recovery)).status,'verified');assert.equal((await onboard(other)).activated,true);assert.equal((await onboard(owner)).referral.qualified,1);assert.equal((await onboard(owner)).referralWallet.amountMinor,100000);await p.verifyQuote(env,await stored(recovery),hash);assert.equal((await onboard(owner)).referralWallet.amountMinor,100000);
  hash='0x'+'e'.repeat(64);const repeat=await createQuoteFor(owner.data.user.id,'USDC',sender,200);q=await stored(repeat);assert.equal((await p.verifyQuote(env,q,hash)).status,'verified');state=await onboard(owner);assert.equal(state.balances.find(b=>b.asset==='USDT').amountMinor,100000000);assert.equal(state.balances.find(b=>b.asset==='USDC').amountMinor,200000000);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM deposit_promotions WHERE user_id=?').bind(owner.data.user.id).first()).n,1);
  const ledger=(await call('/api/investor/ledger',{cookie:owner.cookie})).data;assert.equal(ledger.balanceUsdc,200);assert.equal(ledger.balanceUsdt,100);
  hash='0x'+'f'.repeat(64);q=await stored(await createQuoteFor(other.data.user.id,'USDC',sender,100));wrongAmount=true;assert.equal((await p.verifyQuote(env,q,hash)).status,'review');wrongAmount=false;
  await db.prepare('UPDATE funding_receipts SET refunded_minor=amount_minor WHERE user_id=?').bind(owner.data.user.id).run();state=await onboard(owner);assert.equal(state.activated,false);assert.equal(state.promotion.status,'ineligible');
  await assert.rejects(db.prepare('UPDATE funding_receipts SET user_id=? WHERE id=?').bind(other.data.user.id,first.id).run());
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM signup_deposits').first()).n,0,'No new ZAR activation payments');
  await db.prepare('UPDATE funding_receipts SET refunded_minor=amount_minor WHERE user_id=?').bind(other.data.user.id).run();const refunded=await onboard(owner);assert.equal(refunded.referralWallet.amountMinor,0);assert.equal(refunded.referralWallet.suspendedMinor,100000);assert.equal(refunded.referralWallet.withdrawable,false);
  const privateHistory=(await call('/api/payments/quotes',{cookie:other.cookie})).data.quotes;assert.ok(!privateHistory.some(x=>x.id===first.id));
  assert.equal((await call('/api/payments/wallet')).r.status,401);assert.equal((await call('/api/payments/quotes')).r.status,401);
  assert.equal((await call('/api/payments/manual-claims',{method:'POST',cookie:owner.cookie,body:{asset:'USDC',txHash:hash}})).r.status,503);
 }finally{globalThis.fetch=realFetch}
});

test('Big 7 market data uses one verified provider response, D1 cache and rate-limit fallback',async()=>{
 const initial=await call('/api/markets');
 assert.equal(initial.r.status,503);assert.equal(initial.data.code,'PROVIDER_NOT_CONFIGURED');
 const built=await build({entryPoints:['src/market-prices.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const prices=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const env={DB:db,COINGECKO_DEMO_API_KEY:'test-only-key'};
 let calls=0;
 const prior=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  calls++;assert.equal(new URL(url).hostname,'api.coingecko.com');assert.equal(options.headers['x-cg-demo-api-key'],'test-only-key');
  return Response.json(['bitcoin','ethereum','solana','ripple','binancecoin','cardano','dogecoin'].map((id,i)=>({id,current_price:i===0?100000.25:i===5?0.714:i+0.5,price_change_percentage_24h:1.25})));
 };
 try{
  const first=await prices.marketPrices(env);assert.equal(first.status,200);
  const body=await first.json();assert.equal(body.stale,false);assert.equal(body.assets.length,7);
  assert.equal(body.assets[0].symbol,'BTC');assert.equal(body.assets[0].priceUsd,100000.25);
  assert.equal(body.assets[5].priceUsd,0.714);
  const cached=await prices.marketPrices(env);assert.equal(cached.status,200);
  assert.equal(calls,1,'Shared D1 snapshot should prevent unnecessary provider requests');
  await db.prepare('UPDATE market_data_cache SET updated_at_ms=?,lease_until_ms=0,next_attempt_ms=0 WHERE cache_key=?').bind(Date.now()-11*60_000,'big7-usd-v1').run();
  globalThis.fetch=async()=>{calls++;return Response.json({error:'rate limit'},{status:429})};
  const fallback=await prices.marketPrices(env);assert.equal(fallback.status,200);
  const old=await fallback.json();assert.equal(old.stale,true);assert.equal(old.assets[0].priceUsd,100000.25);
  await prices.marketPrices(env);assert.equal(calls,2,'Provider cooldown should suppress repeated requests');
  const row=await db.prepare('SELECT updated_at_ms,response_json FROM market_data_cache WHERE cache_key=?').bind('big7-usd-v1').first();
  assert.ok(row.response_json.includes('100000.25'));
 }finally{globalThis.fetch=prior}
});
