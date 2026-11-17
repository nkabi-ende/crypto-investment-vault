import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
let mf,db,ada,shaka,circle;let sequence=0;
const origin='https://cryptoinvestmentvault.com';
async function module(path){const r=await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'node'});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'))}
async function migrate(file){const sql=(await readFile('migrations/'+file,'utf8')).replace(/--[^\n]*/g,'');let statement='';for(const line of sql.split('\n')){statement+=line+'\n';if(!line.trim().endsWith(';'))continue;if(/^CREATE TRIGGER/i.test(statement.trim())&&!statement.trim().endsWith('END;'))continue;await db.prepare(statement.trim()).run();statement=''}assert.equal(statement.trim(),'')}
async function user(inviter){const id=randomUUID();await db.batch([
 db.prepare('INSERT INTO users(id,email,password_hash,salt) VALUES(?,?,?,?)').bind(id,id+'@example.invalid','unused','unused'),
 db.prepare('INSERT INTO portfolios(user_id) VALUES(?)').bind(id),
 db.prepare('INSERT INTO account_profiles(user_id,display_name,terms_version) VALUES(?,?,?)').bind(id,'Private Name '+id,'2026-11-17'),
 db.prepare('INSERT OR IGNORE INTO signup_deposit_requirements(user_id) VALUES(?)').bind(id),
 db.prepare('INSERT INTO referral_codes(code,user_id) VALUES(?,?)').bind(id,id),
 ...(inviter?[db.prepare('INSERT INTO referral_attributions(user_id,code) VALUES(?,?)').bind(id,inviter)]:[])
]);return id}
async function fund(id,amount=100,asset='USDC',sender){const receipt=randomUUID(),now=Date.now(),tx='0x'+(++sequence).toString(16).padStart(64,'0');await db.batch([
 db.prepare("INSERT INTO payment_quotes(id,user_id,chain_id,symbol,token,treasury,sender,token_minor,zar_minor,rate_micro_zar,rate_source,rate_at,created_at,expires_at,next_block,status,tx_hash,updated_at,purpose,funding_minor) VALUES(?,?,42220,?,?,?,?,?,1,1,'exact_token_units',?,?,?,0,'verified',?,?,'funding',?)").bind(receipt,id,asset,'0x'+'3'.repeat(40),'0x'+'2'.repeat(40),sender||'0x'+sequence.toString(16).padStart(40,'0'),amount*1e6,now,now,now+300000,tx,now,amount*1e6),
 db.prepare('INSERT INTO funding_receipts(id,user_id,asset,amount_minor,chain_id,tx_hash,settled_at) VALUES(?,?,?,?,42220,?,?)').bind(receipt,id,asset,amount*1e6,tx,new Date().toISOString())
]);return receipt}
async function matureFixture(owner,amount=100){
 // Historical fixtures are inserted with their original validation date, not by mutating earned contracts.
 const trigger=await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='circle_reward_verified_deposit'").first();
 await db.prepare('DROP TRIGGER circle_reward_verified_deposit').run();
 try{const id=await user(owner),receipt=await fund(id,amount);await db.prepare("INSERT INTO circle_rewards(referred_user_id,user_id,receipt_id,version,tier,account_usd,amount_minor,eligible_at,created_at) VALUES(?,?,?,'circle-2026-11-17','circle',?,?,datetime('now','-1 day'),datetime('now','-31 days'))").bind(id,owner,receipt,amount,amount===100?20000:30000).run();return {id,receipt}}
 finally{await db.prepare(trigger.sql).run()}
}
async function cookieFor(id){const token=randomUUID(),hash=createHash('sha256').update(token).digest('base64url');await db.prepare('INSERT INTO sessions(id_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash,id,Date.now()+86400000).run();return 'civ_session='+token}
async function call(path,{cookie,body,method='GET'}={}){const r=await mf.dispatchFetch(origin+path,{method,headers:{'cf-connecting-ip':'198.51.100.'+(++sequence%240+1),...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {r,data:await r.json()}}
let legacyOwner,legacyMember;
before(async()=>{
 const built=await build({entryPoints:['src/index.ts'],bundle:true,write:false,format:'esm',platform:'node',external:['node:crypto']});
 mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',workers:[{name:'circle-test',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],ratelimits:{AUTH_LIMITER:{namespace_id:'1424211760',simple:{limit:100,period:60}}},assets:{routerConfig:{has_user_worker:true},directory:'public',binding:'ASSETS',run_worker_first:['/api/*','/r/*','/dashboard','/join']},bindings:{APP_ORIGIN:origin,EMAIL_DELIVERY_ENABLED:'false'}}]}));
 db=await mf.getD1Database('DB');
 for(const file of (await readdir('migrations')).filter(x=>x.endsWith('.sql')).sort()){
  if(file.startsWith('0014')){legacyOwner=await user();legacyMember=await user(legacyOwner);await fund(legacyMember,100)}
  await migrate(file);
 }
 [ada,shaka,circle]=await Promise.all([module('src/ada.ts'),module('src/shaka.ts'),module('src/circle.ts')]);
});
after(async()=>{await mf?.dispose()});
test('migration preserves earned R1000 contracts and imports actual funding into a balanced ADA journal',async()=>{
 const r=await db.prepare('SELECT * FROM referral_rewards WHERE referred_user_id=?').bind(legacyMember).first();assert.equal(r.amount_minor,100000);
 const ledger=await ada.adaLedger(db,legacyMember);assert.equal(ledger.balanceUsdc,100);assert.equal(ledger.balanceUsdt,0);
 const balances=await db.prepare('SELECT p.asset,SUM(p.amount_minor) AS total FROM ada_postings p JOIN ada_transactions t ON t.id=p.transaction_id WHERE t.status=\'posted\' GROUP BY p.asset').all();assert.ok(balances.results.every(r=>r.total===0));
 await assert.rejects(db.prepare('UPDATE referral_rewards SET amount_minor=20000 WHERE referred_user_id=?').bind(legacyMember).run());
});
test('server invitation survives missing storage, subsequent links and account sign-in on another device',async()=>{
 const first=await user(),second=await user();const alias=async id=>(await db.prepare('SELECT code FROM referral_aliases WHERE user_id=?').bind(id).first()).code;
 const a=await alias(first),b=await alias(second);
 const visit=await mf.dispatchFetch(origin+'/r/'+a);const cookie=visit.headers.get('set-cookie').split(';')[0];assert.match(visit.headers.get('set-cookie'),/HttpOnly/);await visit.text();
 const later=await mf.dispatchFetch(origin+'/r/'+b,{headers:{cookie}});assert.equal(later.headers.get('set-cookie'),null);await later.text();
 assert.equal((await call('/api/referrals/claim',{cookie})).data.code,a);
 const created=await call('/api/auth/register',{method:'POST',cookie,body:{name:'Private Customer',email:'claim@example.invalid',password:'strong personal passphrase 123',acceptTerms:true,referral:b}});assert.equal(created.r.status,201);
 const attribution=await db.prepare('SELECT code FROM referral_attributions WHERE user_id=?').bind(created.data.user.id).first();assert.equal(attribution.code,first);
 const login=await call('/api/auth/login',{method:'POST',body:{email:'claim@example.invalid',password:'strong personal passphrase 123'}});assert.equal(login.r.status,200);
 const newCookie=login.r.headers.get('set-cookie').split(';')[0];assert.equal((await call('/api/investor/onboarding',{cookie:newCookie})).r.status,200);
 assert.equal((await db.prepare('SELECT code FROM referral_attributions WHERE user_id=?').bind(created.data.user.id).first()).code,first);
 assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM referral_click_claims WHERE code=?').bind(first).first().then(x=>x.n),0);
});
test('Circle rates, immutable snapshots, validation, refunds and payout evidence agree',async()=>{
 const owner=await user(),one=await user(owner),two=await user(owner);await fund(one,100);await fund(two,200,'USDT');
 let summary=await circle.affiliateSummary(db,owner);assert.equal(summary.amounts.pending,50000);assert.equal(summary.amounts.approved,0);assert.equal(summary.qualified90d,0);
 for(let i=0;i<5;i++)await matureFixture(owner);
 summary=await circle.affiliateSummary(db,owner);assert.equal(summary.tier,'gold');assert.equal(summary.rates[100],22500);assert.equal(summary.rates[200],35000);
 const gold=await user(owner);await fund(gold,200);const contract=await db.prepare('SELECT tier,amount_minor FROM circle_rewards WHERE referred_user_id=?').bind(gold).first();assert.deepEqual(contract,{tier:'gold',amount_minor:35000});
 for(let i=0;i<10;i++)await matureFixture(owner);
 summary=await circle.affiliateSummary(db,owner);assert.equal(summary.tier,'platinum');assert.equal(summary.rates[100],25000);assert.equal(summary.rates[200],40000);
 const platinum=await user(owner);await fund(platinum,100);assert.equal((await db.prepare('SELECT amount_minor FROM circle_rewards WHERE referred_user_id=?').bind(platinum).first()).amount_minor,25000);
 assert.equal((await db.prepare('SELECT amount_minor FROM circle_rewards WHERE referred_user_id=?').bind(gold).first()).amount_minor,35000);
 await fund(one,200);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM circle_rewards WHERE referred_user_id=?').bind(one).first()).n,1);
 await assert.rejects(db.prepare("UPDATE circle_rewards SET amount_minor=40000 WHERE referred_user_id=?").bind(one).run());
 await assert.rejects(db.prepare("INSERT INTO circle_payout_receipts VALUES(?,'unearned',20000,'ZAR','bank-receipt','2026-11-17T10:00:00Z')").bind(one).run());
 const earned=await matureFixture(owner);await assert.rejects(db.prepare("INSERT INTO circle_payout_receipts VALUES(?,'wrong',1,'ZAR','bank-receipt','2026-11-17T10:00:00Z')").bind(earned.id).run());
 await db.prepare("INSERT INTO circle_payout_receipts VALUES(?,'settled-reference',20000,'ZAR','verified-provider-receipt','2026-11-17T10:00:00Z')").bind(earned.id).run();assert.equal((await db.prepare('SELECT status FROM circle_wallet WHERE referred_user_id=?').bind(earned.id).first()).status,'paid');
 await db.prepare('UPDATE funding_receipts SET refunded_minor=amount_minor WHERE id=(SELECT receipt_id FROM circle_rewards WHERE referred_user_id=?)').bind(one).run();assert.equal((await db.prepare('SELECT status FROM circle_wallet WHERE referred_user_id=?').bind(one).first()).status,'suspended');
 assert.equal((await ada.adaLedger(db,one)).balanceUsdc,200,'Refunded first receipt is removed; later funding is preserved');
});
test('shared funding sources require review and public leaderboard reveals only aggregate partner fields',async()=>{
 const owner=await user(),a=await user(owner),b=await user(owner),sender='0x'+'f'.repeat(40);await fund(a,100,'USDC',sender);await fund(b,100,'USDC',sender);
 assert.equal((await db.prepare('SELECT review_state FROM circle_rewards WHERE referred_user_id=?').bind(b).first()).review_state,'hold');
 const result=await call('/api/affiliates/leaderboard?period=all');assert.equal(result.r.status,200);assert.ok(result.data.rows.length>0);
 const raw=JSON.stringify(result.data);for(const privateValue of [owner,a,b,legacyOwner,legacyMember,'Private Name','@example.invalid',sender])assert.equal(raw.includes(privateValue),false);
 for(const row of result.data.rows)assert.deepEqual(Object.keys(row).sort(),['alias','capitalIntroducedBand','qualifiedReferrals','rank','tier']);
 assert.equal((await call('/api/affiliates/leaderboard?period=invalid')).r.status,400);assert.equal((await call('/api/investor/affiliates')).r.status,401);
 const mine=await call('/api/investor/affiliates',{cookie:await cookieFor(owner)});assert.equal(mine.data.publication,'automatic_public_alias');assert.equal(JSON.stringify(mine.data).includes(b),false);
});
test('ADA rejects unbalanced or mutable journals and posts signed evidence-backed daily results exactly once',async()=>{
 const id=await user();await fund(id,100);
 await assert.rejects(db.batch([db.prepare("INSERT INTO ada_transactions VALUES('bad','bad','performance','evidence','2026-11-17','draft',CURRENT_TIMESTAMP)"),db.prepare("INSERT INTO ada_postings VALUES('bad',1,?,'customer','USDC','realized',100)").bind(id),db.prepare("UPDATE ada_transactions SET status='posted' WHERE id='bad'")]));
 assert.equal(await db.prepare("SELECT id FROM ada_transactions WHERE id='bad'").first(),null);
 const day=ada.johannesburgDay(),evidence={id:randomUUID(),tradingDay:day,asset:'USDC',realizedMinor:-2500000,unrealizedMinor:1000000,externalReportId:randomUUID(),evidenceRef:'venue-reconciliation-1',verifiedBy:'test-reconciler',effectiveAt:new Date().toISOString(),allocations:[{userId:id,realizedMinor:-2500000,unrealizedMinor:1000000}]};
 assert.equal((await ada.publishVerifiedClose(db,evidence)).replayed,false);assert.equal((await ada.publishVerifiedClose(db,evidence)).replayed,true);
 await assert.rejects(ada.publishVerifiedClose(db,{...evidence,evidenceRef:'different-report'}));
 const ledger=await ada.adaLedger(db,id);assert.equal(ledger.balanceUsdc,97.5);assert.equal(ledger.assets[0].portfolioValueMinor,98500000);assert.equal(ledger.daily.status,'reconciled');assert.equal(ledger.daily.results[0].realizedMinor,-2500000);
 await assert.rejects(db.prepare("UPDATE ada_postings SET amount_minor=1 WHERE transaction_id=?").bind('close:'+evidence.id).run());
 await assert.rejects(db.prepare("INSERT INTO ada_postings VALUES(?,99,?,'customer','USDC','realized',1)").bind('close:'+evidence.id,id).run());
 await assert.rejects(ada.publishVerifiedClose(db,{...evidence,id:randomUUID(),externalReportId:randomUUID(),allocations:[{userId:id,realizedMinor:1,unrealizedMinor:0}]}));
 assert.deepEqual(ada.allocateByUnits(101,[{userId:'c',units:'1'},{userId:'b',units:'1'},{userId:'a',units:'1'}]).map(x=>x.amountMinor),[34,34,33]);
 assert.deepEqual(ada.allocateByUnits(-101,[{userId:'a',units:'1'},{userId:'b',units:'1'},{userId:'c',units:'1'}]).map(x=>x.amountMinor),[-34,-34,-33]);
 assert.throws(()=>ada.allocateByUnits(1,[{userId:'a',units:'0'}]));
 const empty=await ada.adaLedger(db,await user());assert.equal(empty.daily.status,'pending');assert.equal(empty.balanceUsdc,0);
});
test('Shaka uses closed prior-price zones, volume/volatility filters and non-widening trailing stops',()=>{
 const now=Date.now(),bars=Array.from({length:45},(_,i)=>({at:now-(45-i)*1000,open:100,high:101,low:99,close:100.5,volume:100,closed:true}));
 let signal=shaka.analyzeShaka(bars,shaka.shakaConfig,now);assert.equal(signal.action,'wait');assert.equal(signal.orderSubmitted,false);
 const last=bars.at(-1);Object.assign(last,{open:99,high:100,low:98.9,close:99.5,volume:300});signal=shaka.analyzeShaka(bars,shaka.shakaConfig,now);assert.equal(signal.action,'long_candidate');assert.ok(signal.stopReference<signal.entryReference);assert.equal(signal.indicators.relativeVolume,3);assert.equal(signal.orderSubmitted,false);
 assert.equal(shaka.analyzeShaka(bars,shaka.shakaConfig,now+500000).reason,'stale_market_data');assert.throws(()=>shaka.analyzeShaka([...bars.slice(0,-1),{...last,closed:false}],shaka.shakaConfig,now));
 assert.equal(shaka.trailingStop('long',95,103,2,2),99);assert.equal(shaka.trailingStop('long',99,100,2,2),99);
 assert.equal(shaka.trailingStop('short',105,97,2,2),101);assert.equal(shaka.trailingStop('short',101,100,2,2),101);
 assert.equal(shaka.shakaMethodology().performance.netReturn,null);assert.equal(shaka.shakaMethodology().executionStatus,'not_connected');
});

test('zero-result and concurrent daily closes do not mint money or accept future reporting periods',async()=>{
 const id=await user();await fund(id,100,'USDT');
 const report={id:randomUUID(),tradingDay:ada.johannesburgDay(),asset:'USDT',realizedMinor:0,unrealizedMinor:0,externalReportId:randomUUID(),evidenceRef:'zero-venue-close',verifiedBy:'test-reconciler',effectiveAt:new Date().toISOString(),allocations:[{userId:id,realizedMinor:0,unrealizedMinor:0}]};
 const results=await Promise.all([ada.publishVerifiedClose(db,report),ada.publishVerifiedClose(db,report)]);assert.ok(results.every(x=>x.posted));assert.ok(results.some(x=>x.replayed));
 const ledger=await ada.adaLedger(db,id);assert.equal(ledger.balanceUsdt,100);assert.equal(ledger.daily.status,'reconciled');
 assert.equal(await db.prepare('SELECT id FROM ada_transactions WHERE id=?').bind('close:'+report.id).first(),null);
 await assert.rejects(ada.publishVerifiedClose(db,{...report,id:randomUUID(),tradingDay:'2099-01-01'}));
 await assert.rejects(ada.publishVerifiedClose(db,{...report,id:randomUUID(),tradingDay:'2026-02-30'}));
});
