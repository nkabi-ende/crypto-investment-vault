import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID,pbkdf2Sync} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {reviewerSql} from '../scripts/kyc-reviewer.mjs';
const origin='https://cryptoinvestmentvault.com';let mf,db,member,other,reviewer,operator,sequence=0;const operatorId=randomUUID();
before(async()=>{
 const result=await build({entryPoints:['src/index.ts'],bundle:true,write:false,format:'esm',platform:'node',external:['node:crypto']});
 mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',workers:[{name:'security-tests',modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],assets:{routerConfig:{has_user_worker:true},directory:'public',binding:'ASSETS',run_worker_first:true},ratelimits:{AUTH_LIMITER:{namespace_id:'1424211760',simple:{limit:1000,period:60}},API_LIMITER:{namespace_id:'1424211761',simple:{limit:10,period:60}}},bindings:{APP_ORIGIN:origin,CIV_OWNER_USER_ID:operatorId,CIV_OWNER_EMAIL:'security-operator@example.invalid'}}]}));db=await mf.getD1Database('DB');
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  let statement='';for(const line of (await readFile('migrations/'+file,'utf8')).replace(/--[^\n]*/g,'').split('\n')){statement+=line+'\n';if(!line.trim().endsWith(';'))continue;if(/^CREATE TRIGGER/i.test(statement.trim())&&!statement.trim().endsWith('END;'))continue;await db.prepare(statement.trim()).run();statement=''}
 }
 async function account(name,id=randomUUID()){const token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('base64url');await db.batch([
  db.prepare('INSERT INTO users(id,email,password_hash,salt) VALUES(?,?,?,?)').bind(id,name+'@example.invalid','unused','unused'),
  db.prepare('INSERT INTO portfolios(user_id) VALUES(?)').bind(id),db.prepare('INSERT INTO account_profiles(user_id,display_name,terms_version) VALUES(?,?,?)').bind(id,name,'test'),db.prepare('INSERT INTO referral_codes(code,user_id) VALUES(?,?)').bind(id,id),
  db.prepare('INSERT INTO sessions(id_hash,user_id,expires_at,security_version,authenticated_at,last_seen_at) VALUES(?,?,?,1,?,?)').bind(hash,id,Date.now()+7*86400000,Date.now(),Date.now())
 ]);return {id,token,hash,cookie:'__Host-civ_session='+token}}
 operator=await account('security-operator',operatorId);member=await account('security-member');other=await account('security-other');reviewer=operator;await db.prepare('INSERT INTO kyc_reviewers(user_id,granted_by) VALUES(?,?)').bind(reviewer.id,'isolated test setup').run();
});
after(async()=>{await mf?.dispose()});
async function call(path,options={}){const {actor,headers={},...rest}=options;return mf.dispatchFetch(origin+path,{...rest,redirect:'manual',headers:{Origin:origin,'CF-Connecting-IP':'192.0.'+Math.floor(++sequence/250)+'.'+(sequence%250+1),...(actor?{Cookie:actor.cookie}:{}),...headers}})}
async function status(path,options){const r=await call(path,options);await r.arrayBuffer();return r.status}

test('HTML and error responses carry enforced browser protections; script nonces are fresh and match the markup',async()=>{
 let previous;
 for(const path of ['/','/join','/dashboard','/legal/privacy']){
  const response=await call(path),html=await response.text();assert.equal(response.status,200,path);
  for(const name of ['X-Frame-Options','X-Content-Type-Options','Strict-Transport-Security','Referrer-Policy','Permissions-Policy','Cross-Origin-Opener-Policy'])assert.ok(response.headers.get(name),path+' '+name);
  for(const name of ['Cache-Control','CDN-Cache-Control','Cloudflare-CDN-Cache-Control'])assert.equal(response.headers.get(name),'no-store');
  const csp=response.headers.get('Content-Security-Policy');assert.match(csp,/frame-ancestors 'none'/);assert.match(csp,/base-uri 'none'/);assert.match(csp,/script-src-attr 'none'/);
  const scriptPolicy=csp.split(';').find(value=>value.trim().startsWith('script-src '));assert.doesNotMatch(scriptPolicy,/unsafe-inline|unsafe-eval/);
  const nonce=/nonce-([^']+)/.exec(scriptPolicy)[1];assert.notEqual(nonce,previous);previous=nonce;
  for(const tag of html.matchAll(/<script\b[^>]*>/g))assert.ok(tag[0].includes('nonce="'+nonce+'"'));
  assert.equal(response.headers.get('etag'),null);
 }
 const early=await call('/api/auth/register',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(early.status,403);assert.equal(early.headers.get('Cache-Control'),'no-store');assert.equal(early.headers.get('X-Frame-Options'),'DENY');await early.text();
});

test('session cache controls do not mix two members or honor validators on authenticated JSON',async()=>{
 for(const actor of [member,other,member]){
  const response=await call('/api/me?userId='+other.id,{actor,headers:{'If-None-Match':'attacker-validator'}});assert.equal(response.status,200);
  assert.equal((await response.json()).user.id,actor.id);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('cdn-cache-control'),'no-store');assert.match(response.headers.get('vary'),/Cookie/);
 }
 for(const path of ['/api/investor/overview','/api/investor/onboarding']){
  const response=await call(path+'?userId='+other.id+'&role=admin',{actor:member}),data=await response.json();assert.equal(response.status,200);assert.equal(path.endsWith('overview')?data.user.id:data.memberId,member.id);assert.doesNotMatch(JSON.stringify(data),/security-other@example/);
 }
 assert.equal(await status('/api/investor/'+other.id+'/overview',{actor:member}),404);
 assert.equal(await status('/api/admin/kyc?role=admin',{actor:member,headers:{'X-User-Id':reviewer.id,'X-Role':'admin'}}),403);
});

test('reviewer HTML, aliases, scripts and API deny anonymous and ordinary member access',async()=>{
 for(const path of ['/review-identity','/review-identity/','/review-identity.html']){
  const anonymous=await call(path);assert.equal(anonymous.status,303);assert.equal(anonymous.headers.get('location'),'/join');assert.equal(anonymous.headers.get('cache-control'),'no-store');await anonymous.text();
  assert.equal(await status(path,{actor:member}),403);
  const admin=await call(path,{actor:reviewer});assert.equal(admin.status,200);assert.match(await admin.text(),/Identity review/);assert.equal(admin.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
 }
 assert.equal(await status('/review-identity.js'),401);assert.equal(await status('/review-identity.js',{actor:member}),403);assert.equal(await status('/review-identity.js',{actor:reviewer}),200);
 assert.equal(await status('/api/admin/kyc'),401);assert.equal(await status('/api/admin/kyc',{actor:reviewer}),200);
});

test('branded admin entry requires a session and renders only links permitted by the separate roles',async()=>{
 for(const path of ['/admin','/admin/']){
  const guest=await call(path);assert.equal(guest.status,303);assert.equal(guest.headers.get('location'),'/join?returnTo=%2Fadmin');await guest.text();
  for(const [actor,code,title] of [[member,403,'Access required.'],[operator,200,'Vault control.']]){
   const response=await call(path,{actor}),html=await response.text();assert.equal(response.status,code);assert.ok(html.includes(title));assert.match(html,/src="\/civ-mark.svg"/);assert.match(html,/href="\/favicon.svg"/);assert.match(html,/href="\/admin.css"/);
   assert.equal(html.includes('href="/review-identity"'),actor===reviewer);assert.equal(html.includes('href="/dashboard/mirror"'),actor===operator);
   if(actor!==operator)assert.doesNotMatch(html,/<script|@example/);
   for(const header of ['Cache-Control','CDN-Cache-Control','Cloudflare-CDN-Cache-Control'])assert.match(response.headers.get(header),/no-store/);
   assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
  }
 }
});

test('owner correction updates the member ledger exactly once and rejects stale and unprivileged edits',async()=>{
 const password=randomBytes(20).toString('hex'),salt='v3:'+randomUUID();
 await db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').bind(salt,pbkdf2Sync(password,salt,600000,32,'sha256').toString('base64url'),operator.id).run();
 const body={id:randomUUID(),actor:'ignored',target:other.id,action:'balance',asset:'USDC',expected:'0',value:'2.000001',reason:'Reconcile settlement discrepancy',password};
 const send=(actor,changes={})=>status('/api/admin/operations',{actor,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,...changes})});
 assert.equal(await send(member),403);
 assert.equal(await send(operator,{password:'wrong'}),403);
 assert.equal(await send(operator),200);
 assert.equal(await send(operator),200);
 assert.equal(await send(operator,{id:randomUUID()}),409);
 const balance=await db.prepare("SELECT amount_minor FROM ada_balances WHERE user_id=? AND asset='USDC'").bind(other.id).first();
 assert.equal(balance.amount_minor,2000001);
 const ledger=await db.prepare("SELECT SUM(amount_minor) AS net FROM ada_postings WHERE transaction_id=?").bind('correction:'+body.id).first();
 assert.equal(ledger.net,0);
 const withdrawal=await (await call('/api/investor/withdrawals',{actor:other})).text();
 assert.match(withdrawal,/2000001/);
 const uid=randomUUID(),email=uid+'@example.invalid';
 await db.prepare("INSERT INTO users(id,email,password_hash,salt) VALUES(?,?,'unused','unused')").bind(uid,email).run();
 const action=(name,value,expected)=>send(operator,{id:randomUUID(),action:name,value,expected,target:uid,asset:''});
 assert.equal(await action('delete',email,''),409);
 assert.equal(await action('state','closed','active'),200);
 assert.equal(await action('delete',email,''),200);
 assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind(uid).first(),null);
 assert.equal(await send(operator,{id:randomUUID(),action:'state',value:'closed',expected:'active',target:operator.id}),409);
});
test('manual reviewer assignment accepts only an existing exact UUID, records the actor and supports revocation',async()=>{
 const id=randomUUID();await db.prepare('INSERT INTO users(id,email,password_hash,salt) VALUES(?,?,?,?)').bind(id,'access-workflow@example.invalid','unused','unused').run();
 for(const invalid of ['admin','email@example.invalid',id+"'; DROP TABLE users; --",''])assert.throws(()=>reviewerSql('grant',invalid));
 assert.throws(()=>reviewerSql('delete',id));
 async function apply(action,userId,actor){for(const statement of reviewerSql(action,userId,actor).split('\n'))await db.prepare(statement).run()}
 const label="operator'; DROP TABLE users; --";
 await apply('grant',id,label);let row=await db.prepare('SELECT enabled,granted_by FROM kyc_reviewers WHERE user_id=?').bind(id).first();assert.equal(row.enabled,1);assert.equal(row.granted_by,label);
 await apply('revoke',id,'isolated test');row=await db.prepare('SELECT enabled FROM kyc_reviewers WHERE user_id=?').bind(id).first();assert.equal(row.enabled,0);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE user_id=? AND event_type IN (?,?)').bind(id,'kyc_reviewer_grant','kyc_reviewer_revoke').first()).n,2);
 const missing=randomUUID();await apply('grant',missing,'isolated test');assert.equal(await db.prepare('SELECT user_id FROM kyc_reviewers WHERE user_id=?').bind(missing).first(),null);
 assert.equal(await db.prepare('SELECT user_id FROM kyc_reviewers WHERE user_id=?').bind(member.id).first(),null);
});

test('cross-origin, missing-origin, same-site forged writes and content-type confusion are rejected',async()=>{
 for(const headers of [{Origin:'https://attacker.invalid'},{Origin:'null'},{Origin:origin,'Sec-Fetch-Site':'same-site'},{Origin:origin,'Sec-Fetch-Site':'cross-site'}])assert.equal(await status('/api/auth/logout',{actor:member,method:'POST',headers}),403);
 const noOrigin=await mf.dispatchFetch(origin+'/api/auth/logout',{method:'POST',headers:{Cookie:member.cookie}});assert.equal(noOrigin.status,403);await noOrigin.text();
 assert.equal(await status('/api/me',{actor:member,headers:{'Sec-Fetch-Site':'cross-site'}}),403);
 assert.equal(await status('/api/auth/login',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'}),415);
 assert.equal(await status('/api/auth/login',{method:'OPTIONS'}),405);
 assert.equal(await status('/api/me',{actor:member}),200,'Rejected logout attempts must not revoke the member');
});

test('legacy, idle, over-age and ambiguous cookies are refused and a reviewer has a shorter session window',async()=>{
 assert.equal(await status('/api/me',{headers:{Cookie:'civ_session='+member.token}}),401);
 assert.equal(await status('/api/me',{headers:{Cookie:member.cookie+'; '+member.cookie}}),401);
 await db.prepare('UPDATE sessions SET security_version=0 WHERE id_hash=?').bind(member.hash).run();assert.equal(await status('/api/me',{actor:member}),401);
 await db.prepare('UPDATE sessions SET security_version=1,last_seen_at=? WHERE id_hash=?').bind(Date.now()-86400001,member.hash).run();assert.equal(await status('/api/me',{actor:member}),401);
 await db.prepare('UPDATE sessions SET authenticated_at=?,last_seen_at=? WHERE id_hash=?').bind(Date.now()-7*86400000-1,Date.now(),member.hash).run();assert.equal(await status('/api/me',{actor:member}),401);
 await db.prepare('UPDATE sessions SET authenticated_at=?,last_seen_at=? WHERE id_hash=?').bind(Date.now(),Date.now(),member.hash).run();
 await db.prepare('UPDATE sessions SET last_seen_at=? WHERE id_hash=?').bind(Date.now()-15*60000-1,reviewer.hash).run();assert.equal(await status('/api/admin/kyc',{actor:reviewer}),401);
 await db.prepare('UPDATE sessions SET authenticated_at=?,last_seen_at=? WHERE id_hash=?').bind(Date.now()-8*3600000-1,Date.now(),reviewer.hash).run();assert.equal(await status('/api/admin/kyc',{actor:reviewer}),401);
 await db.prepare('UPDATE sessions SET authenticated_at=?,last_seen_at=? WHERE id_hash=?').bind(Date.now(),Date.now(),reviewer.hash).run();
 const logout=await call('/api/auth/logout',{actor:member,method:'POST'});assert.equal(logout.status,200);await logout.text();assert.equal(await status('/api/me',{actor:member}),401);
});

test('request budget applies before database work, source artifacts stay inaccessible and HTTP redirects safely',async()=>{
 let blocked=false;
 for(let i=0;i<12;i++){const response=await call('/api/me',{headers:{'CF-Connecting-IP':'203.0.113.244'}});if(response.status===429){blocked=true;assert.equal(response.headers.get('retry-after'),'60')}await response.text()}
 assert.equal(blocked,true);
 for(const path of ['/.git/config','/.env','/src/index.ts','/wrangler.toml','/migrations/0021_session_security.sql','/index.html.map','/api/admin/kyc%00'])assert.equal(await status(path),404,path);
 const redirect=await mf.dispatchFetch('http://cryptoinvestmentvault.com/dashboard',{redirect:'manual'});assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),origin+'/dashboard');await redirect.text();
 const wrongHost=await mf.dispatchFetch('https://unexpected.invalid/api/me',{redirect:'manual'});assert.equal(wrongHost.status,403);await wrongHost.text();
});


test('public assets contain no source maps, private key blocks or known provider secret signatures',async()=>{
 const html=await readFile('public/index.html','utf8');
 for(const match of html.matchAll(/<meta (?:property="og:image"|name="twitter:image") content="([^"]+)"/g)){
  const path=new URL(match[1]).pathname,bytes=await readFile('public'+path);
  assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10],'Referenced sharing image must ship in a clean checkout: '+path);
  assert.equal(bytes.readUInt32BE(16),1200);assert.equal(bytes.readUInt32BE(20),630);
 }
 async function scan(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=directory+'/'+entry.name;
  if(entry.isDirectory()){await scan(path);continue}
  assert.doesNotMatch(path,/\.(?:map|env|sql|sqlite|toml|bak)$/i,'Sensitive artifact published: '+path);
  if(!/\.(?:js|css|html|json|svg|txt|xml)$/.test(path))continue;
  const content=await readFile(path,'utf8');
  assert.doesNotMatch(content,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,'Private key in '+path);
  assert.doesNotMatch(content,/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|live_)[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16}|CG-[A-Za-z0-9]{24,})/,'Provider secret signature in '+path);
 }}await scan('public');
});


test('paper-portfolio operators and KYC reviewers remain separate roles and the mirror retains its stricter policy',async()=>{
 assert.equal(await status('/api/admin/shaka-simulation',{actor:other}),403);
 assert.equal(await status('/api/admin/shaka-simulation',{actor:reviewer}),200);
 assert.equal(await status('/api/admin/shaka-simulation',{actor:operator}),200);
 assert.equal(await status('/api/admin/kyc',{actor:operator}),200);
 assert.equal(await status('/dashboard/mirror'),404);assert.equal(await status('/dashboard/mirror',{actor:other}),404);
 const mirror=await call('/dashboard/mirror',{actor:operator});assert.equal(mirror.status,200);assert.equal(mirror.headers.get('cache-control'),'private, no-store');assert.match(mirror.headers.get('content-security-policy'),/default-src 'none'/);assert.doesNotMatch(mirror.headers.get('content-security-policy'),/strict-dynamic/);await mirror.text();
 await db.prepare('UPDATE sessions SET last_seen_at=? WHERE id_hash=?').bind(Date.now()-15*60000-1,operator.hash).run();assert.equal(await status('/api/admin/shaka-simulation',{actor:operator}),401);
});
