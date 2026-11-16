import { pbkdf2Sync } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deliverEmails } from './email';
import { membership } from './membership';
import { marketPulse,cryptoHeadlines } from './market-intelligence';
import { paymentConfig,pilotAllowed,mainnetPreflight,createQuote,verifyQuote,presentQuote,reconcilePayments,type PaymentEnv } from './payments';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
type Bindings = PaymentEnv & { AUTH_LIMITER: RateLimit; EMAIL_DELIVERY_ENABLED?: string; RESEND_API_KEY?: string; EMAIL_FROM?: string; DB: D1Database; ASSETS: Fetcher; APP_ORIGIN: string; FUNDING_ENABLED: string; COINGECKO_DEMO_API_KEY?: string; CRYPTOPANIC_API_TOKEN?: string; CELO_SEPOLIA_RPC_URL?: string; CELO_TEST_USDC_ADDRESS?: string; CELO_TEST_TREASURY_ADDRESS?: string };
const app = new Hono<{Bindings:Bindings}>();
app.onError((error,c)=>{console.error('CIV request failed',c.req.path,error instanceof Error ? error.name : 'UnknownError');return c.json({error:'Account service temporarily unavailable. Please try again.'},503)});
app.use('/api/*',bodyLimit({maxSize:16384,onError:c=>c.json({error:'Request too large'},413)}));
const enc = new TextEncoder();
const b64 = (bytes:Uint8Array)=> btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const rand = (n=32)=>b64(crypto.getRandomValues(new Uint8Array(n)));
async function digest(s:string){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))))}
async function passwordHash(password:string,salt:string) {
 // Preserve the existing PBKDF2 digest format across Worker runtimes.
 if (!salt.startsWith('v2:')) return b64(pbkdf2Sync(password,salt,310000,32,'sha256'));
 let material = enc.encode(password);
 for (let round=0; round<3; round++) {
   const key=await crypto.subtle.importKey('raw',material,'PBKDF2',false,['deriveBits']);
   const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt+':'+round),iterations:100000},key,256);
   material=new Uint8Array(bits);
 }
 return b64(material);
}
function same(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
async function currentUser(c:import('hono').Context<{Bindings:Bindings}>){const token=getCookie(c,'civ_session');if(!token)return null;const hash=await digest(token);return await c.env.DB.prepare('SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id_hash=? AND sessions.expires_at>?').bind(hash,Date.now()).first<{id:string,email:string}>()}
async function session(c:import('hono').Context<{Bindings:Bindings}>, id:string, accountWrites:D1PreparedStatement[] = []) {
  const token = rand();
  const lifetimeSeconds = 7 * 86400;
  const insertSession = c.env.DB.prepare('INSERT INTO sessions(id_hash,user_id,expires_at) VALUES(?,?,?)')
    .bind(await digest(token), id, Date.now() + lifetimeSeconds * 1000);
  const oldToken=getCookie(c,'civ_session');
  const retire=oldToken?[c.env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(await digest(oldToken))]:[];
  await c.env.DB.batch([...accountWrites,...retire,insertSession]);
  setCookie(c, 'civ_session', token, {
    httpOnly: true, secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict', path: '/', maxAge: lifetimeSeconds
  });
}
app.use('/api/*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');if(c.req.method!=='GET'&&c.req.method!=='HEAD'){const origin=c.req.header('origin');const url=new URL(c.req.url);if(origin&&origin!==url.origin)return c.json({error:'Cross-origin requests are not allowed'},403)}await next()});
// Reject abusive authentication traffic before password derivation or D1 reads.
app.use('/api/auth/*',async(c,next)=>{
 if (c.req.method==='POST') {
  const {success}=await c.env.AUTH_LIMITER.limit({key:c.req.header('cf-connecting-ip')||'local'});
  if(!success){c.header('Retry-After','60');return c.json({error:'Too many requests. Please wait a minute.'},429)}
 }
 await next();
});
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const referralPattern=/^(?:[a-f0-9]{10}|[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
const termsVersion='2026-11-16';
app.post('/api/auth/register',async c=>{
 const body=await c.req.json().catch(()=>null);
 if(!body||typeof body!=='object')return c.json({error:'Invalid request'},400);
 const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
 const name=String(body.name||'').trim().replace(/\s+/g,' ');
 const referral=String(body.referral||'').toLowerCase();
 if(email.length>254||!emailPattern.test(email)||password.length<12||password.length>128)
  return c.json({error:'Use a valid email and a password of 12–128 characters'},400);
 if(name.length<2||name.length>80||/[\u0000-\u001f<>]/.test(name))return c.json({error:'Enter your name (2–80 characters)'},400);
 if(body.acceptTerms!==true)return c.json({error:'Accept the Terms, Privacy Notice and Risk Disclosure to continue'},400);
 let attributedCode:string|null=null;
 if(referralPattern.test(referral)) {
  const record=await c.env.DB.prepare('SELECT r.code FROM referral_codes r LEFT JOIN referral_aliases a ON a.user_id=r.user_id WHERE (r.code=? OR r.user_id=? OR a.code=?) AND r.user_id IS NOT NULL').bind(referral,referral,referral).first<{code:string}>();
  attributedCode=record?.code||null;
 }
 const id=crypto.randomUUID(),salt='v2:'+rand(16),hash=await passwordHash(password,salt);
 const writes=[
  c.env.DB.prepare('INSERT INTO users(id,email,password_hash,salt) VALUES(?,?,?,?)').bind(id,email,hash,salt),
  c.env.DB.prepare('INSERT INTO portfolios(user_id) VALUES(?)').bind(id),
  c.env.DB.prepare('INSERT OR IGNORE INTO signup_deposit_requirements(user_id) VALUES(?)').bind(id),
  c.env.DB.prepare('INSERT INTO account_profiles(user_id,display_name,terms_version) VALUES(?,?,?)').bind(id,name,termsVersion),
  c.env.DB.prepare('INSERT INTO referral_codes(code,user_id) VALUES(?,?)').bind(id,id),
  c.env.DB.prepare('INSERT INTO email_outbox(id,user_id,event_type,available_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),id,'account.welcome.v1',Date.now()),
  c.env.DB.prepare('INSERT INTO audit_events(id,user_id,event_type) VALUES(?,?,?)').bind(crypto.randomUUID(),id,'registered')
 ];
 if(attributedCode)writes.push(c.env.DB.prepare('INSERT INTO referral_attributions(user_id,code) VALUES(?,?)').bind(id,attributedCode));
 try{await session(c,id,writes)}catch(error){
  if(String(error).includes('UNIQUE constraint failed: users.email'))return c.json({error:'Unable to create account. Try signing in or use another email.'},409);
  throw error;
 }
 const alias=await c.env.DB.prepare('SELECT code FROM referral_aliases WHERE user_id=?').bind(id).first<{code:string}>();
 return c.json({user:{id,email,name},referral:{code:alias!.code,url:new URL('/r/'+alias!.code,c.env.APP_ORIGIN).href},signupDeposit:{currency:'USDC_OR_USDT',requiredMinor:100000000,status:'awaiting_payment',collectionEnabled:false},welcomeEmail:envEmailStatus(c.env)},201);
});
function envEmailStatus(env:Bindings){return env.EMAIL_DELIVERY_ENABLED==='true'&&env.RESEND_API_KEY&&env.EMAIL_FROM?'queued':'awaiting_provider'}
app.post('/api/auth/login',async c=>{
 const body=await c.req.json().catch(()=>null);
 if(!body||typeof body!=='object')return c.json({error:'Invalid request'},400);
 const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
 if(!emailPattern.test(email)||email.length>254||!password.length||password.length>128)return c.json({error:'Invalid credentials'},401);
 const now=Date.now();
 const attempts=await c.env.DB.prepare('SELECT locked_until FROM auth_attempts WHERE email=?').bind(email).first<{locked_until:number}>();
 if(attempts&&attempts.locked_until>now){c.header('Retry-After',String(Math.ceil((attempts.locked_until-now)/1000)));return c.json({error:'Too many attempts. Try again later.'},429)}
 const user=await c.env.DB.prepare('SELECT id,email,password_hash,salt FROM users WHERE email=?').bind(email).first<{id:string,email:string,password_hash:string,salt:string}>();
 const check=await passwordHash(password,user?.salt||'v2:fallback');
 if(!user||!same(check,user.password_hash)){
  await c.env.DB.prepare(`INSERT INTO auth_attempts(email,attempts,window_start,locked_until) VALUES(?,1,?,0)
   ON CONFLICT(email) DO UPDATE SET
   attempts=CASE WHEN auth_attempts.window_start>? THEN auth_attempts.attempts+1 ELSE 1 END,
   locked_until=CASE WHEN auth_attempts.window_start>? AND auth_attempts.attempts>=4 THEN ? ELSE 0 END,
   window_start=CASE WHEN auth_attempts.window_start>? THEN auth_attempts.window_start ELSE ? END`)
   .bind(email,now,now-900000,now-900000,now+900000,now-900000,now).run();
  return c.json({error:'Invalid credentials'},401);
 }
 await session(c,user.id,[c.env.DB.prepare('DELETE FROM auth_attempts WHERE email=?').bind(email)]);
 return c.json({user:{id:user.id,email:user.email}});
});
app.post('/api/auth/logout',async c=>{const token=getCookie(c,'civ_session');if(token)await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(await digest(token)).run();deleteCookie(c,'civ_session',{path:'/'});return c.json({ok:true})});
app.get('/api/me',async c=>{const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);const portfolio=await c.env.DB.prepare('SELECT cash_usdt,updated_at FROM portfolios WHERE user_id=?').bind(user.id).first();return c.json({user,portfolio,fundingEnabled:false,product:'The Big 7'})});
app.get('/api/investor/overview',async c=>{
  const user=await currentUser(c);
  if(!user)return c.json({error:'Unauthorized'},401);
  const [portfolio,events,funding]=await Promise.all([
    c.env.DB.prepare('SELECT cash_usdt,updated_at FROM portfolios WHERE user_id=?').bind(user.id).first<{cash_usdt:number,updated_at:string}>(),
    c.env.DB.prepare('SELECT event_type,detail,created_at FROM audit_events WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(user.id).all(),membership(c.env.DB,user.id)
  ]);
  return c.json({
    user,fundingBalances:funding.balances,portfolio:{cashUsdt:Math.max(0,Number(portfolio?.cash_usdt||0)),updatedAt:portfolio?.updated_at||null},
    holdings:[],holdingsSource:'No positions ledger has been activated',
    activity:(events.results||[]).map((e:any)=>({type:e.event_type,at:e.created_at})),
    fundingEnabled:false,withdrawalsEnabled:false,liveTradingEnabled:false,
    notice:'Account data comes from CIV D1. No investments or returns are simulated in this view.'
  });
});
app.get('/api/investor/onboarding',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const [profile,email,member]=await Promise.all([
  c.env.DB.prepare('SELECT display_name,terms_accepted_at FROM account_profiles WHERE user_id=?').bind(user.id).first<{display_name:string,terms_accepted_at:string}>(),
  c.env.DB.prepare('SELECT status FROM email_outbox WHERE user_id=?').bind(user.id).first<{status:string}>(),
  membership(c.env.DB,user.id)
 ]);
 return c.json({name:profile?.display_name||null,memberId:user.id,termsAcceptedAt:profile?.terms_accepted_at||null,
  emailVerified:false,welcomeEmail:email?.status==='sent'?'sent':envEmailStatus(c.env),
  signupDeposit:{...member.deposit,collectionEnabled:paymentConfig(c.env).liveDepositsEnabled&&pilotAllowed(c.env,user.email)},activated:member.activated,balances:member.balances,promotion:member.promotion,perks:member.perks,
  referral:{code:member.invitationCode,url:new URL('/r/'+member.invitationCode,c.env.APP_ORIGIN).href,...member.referral,rewardsEnabled:true},referralWallet:member.referralWallet});
});

app.get('/api/payments/config',async c=>{
 const member=await currentUser(c);
 const {rpc,treasury,...config}=paymentConfig(c.env);
 const permitted=pilotAllowed(c.env,member?.email);
 return c.json({...config,ready:config.ready&&permitted,liveDepositsEnabled:config.liveDepositsEnabled&&permitted,pilotOnly:true});
});
app.get('/api/payments/preflight',async c=>{
 const member=await currentUser(c);
 if(!member)return c.json({error:'Unauthorized'},401);
 if(!pilotAllowed(c.env,member.email))return c.json({error:'Production pilot access is restricted'},403);
 try{return c.json(await mainnetPreflight(c.env))}
 catch(error){console.error('CIV mainnet preflight failed',error instanceof Error?error.message:'unknown');return c.json({ready:false,error:'Production mainnet validation did not pass. Do not send funds.'},503)}
});
app.get('/api/payments/quotes',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const rows=await c.env.DB.prepare('SELECT * FROM payment_quotes WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(user.id).all();
 return c.json({quotes:rows.results.map(presentQuote)});
});
app.post('/api/payments/quotes',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const {success}=await c.env.AUTH_LIMITER.limit({key:'payments:'+user.id});if(!success)return c.json({error:'Please wait before requesting another quote'},429);
 const body=await c.req.json().catch(()=>null);
 const config=paymentConfig(c.env);
 if(!pilotAllowed(c.env,user.email))return c.json({error:'Live deposits are restricted to one authorized pilot account',code:'PILOT_ACCESS_RESTRICTED'},403);
 if(!config.ready)return c.json({error:'Production pilot payment configuration is incomplete',code:'PILOT_NOT_CONFIGURED'},503);
 if(!config.supportedTokens.includes(body?.symbol)||typeof body?.sender!=='string'||!config.depositPresets.includes(body?.amount))return c.json({error:'Choose a supported token and amount for the selected network'},400);
 if(config.treasury&&body.sender.toLowerCase()===config.treasury)return c.json({error:'This MiniPay wallet is set as CIV’s receiving wallet. Use a separate paying wallet for the deposit.',code:'RECEIVING_WALLET_CANNOT_PAY_ITSELF'},409);
 const existing=await c.env.DB.prepare('SELECT COUNT(*) AS count FROM funding_receipts WHERE user_id=? AND chain_id=42220').bind(user.id).first<{count:number}>();
 if(Number(existing?.count||0)>0)return c.json({error:'The private pilot permits one verified real-money deposit per authorized account. Further deposits are paused for review.',code:'PILOT_DEPOSIT_LIMIT'},409);
 try{await mainnetPreflight(c.env)}catch{return c.json({error:'Celo mainnet or token verification failed. No transfer was initiated.',code:'MAINNET_PREFLIGHT_FAILED'},503)}
 try{return c.json(await createQuote(c.env,user.id,body.symbol,body.sender,body.amount),201)}catch(error){console.error('Quote unavailable',error instanceof Error?error.message:'error');return c.json({error:'Payment quote unavailable. Check payment setup or try again shortly.'},503)}
});
app.post('/api/payments/quotes/:id/verify',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const {success}=await c.env.AUTH_LIMITER.limit({key:'verify:'+user.id});if(!success)return c.json({error:'Please wait before checking again'},429);
 const q=await c.env.DB.prepare('SELECT * FROM payment_quotes WHERE id=? AND user_id=?').bind(c.req.param('id'),user.id).first<any>();if(!q)return c.json({error:'Quote not found'},404);
 const body=await c.req.json().catch(()=>null);if(!/^0x[a-fA-F0-9]{64}$/.test(body?.txHash||''))return c.json({error:'Invalid transaction hash'},400);
 return c.json(await verifyQuote(c.env,q,body.txHash.toLowerCase()));
});
app.get('/api/payments/wallet',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const config=paymentConfig(c.env),allowed=pilotAllowed(c.env,user.email);
 return c.json({memberId:user.id,network:config.mode==='production'?'Celo mainnet':'Celo Sepolia',chainId:config.chainId,address:config.liveDepositsEnabled&&allowed?config.treasury:null,ready:config.liveDepositsEnabled&&allowed,minimumDeposit:100,manualVerification:'review_required',cardCheckoutEnabled:false,pilotOnly:true});
});
app.post('/api/payments/manual-claims',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const config=paymentConfig(c.env);
 if(config.pilotOnly)return c.json({error:'Manual transfer claims are disabled during the pilot; use verified MiniPay checkout only'},403);
 if(!config.liveDepositsEnabled)return c.json({error:'Production collection is not configured'},503);
 const {success}=await c.env.AUTH_LIMITER.limit({key:'claims:'+user.id});if(!success)return c.json({error:'Please wait before submitting another transfer'},429);
 const body=await c.req.json().catch(()=>null);if(!['USDC','USDT'].includes(body?.asset)||!/^0x[a-fA-F0-9]{64}$/.test(body?.txHash||''))return c.json({error:'Provide a Celo transaction hash and token'},400);
 await c.env.DB.prepare('INSERT OR IGNORE INTO manual_deposit_claims(id,user_id,chain_id,asset,tx_hash) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),user.id,42220,body.asset,body.txHash.toLowerCase()).run();
 return c.json({status:'pending_review',notice:'A transfer hash alone does not establish ownership. Reconciliation and proof of the funding source are required before credit.'},202);
});
app.get('/api/investor/preferences',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const selected=await c.env.DB.prepare('SELECT entry_tier_usd,payout_cycle,acknowledgement_at,updated_at FROM investor_preferences WHERE user_id=?').bind(user.id).first<any>();
 return c.json({preference:selected?{entryTierUsd:selected.entry_tier_usd,payoutCycle:selected.payout_cycle,acknowledgedAt:selected.acknowledgement_at,updatedAt:selected.updated_at}:null,availableTiersUsd:[100,200],fundingEnabled:false,weeklyPayoutsEnabled:false});
});
app.put('/api/investor/preferences',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 let body:any;try{body=await c.req.json()}catch{return c.json({error:'Invalid JSON'},400)}
 const amount=body?.entryTierUsd;
 if(!Number.isInteger(amount)||![100,200].includes(amount)||body?.acknowledgeRisk!==true)return c.json({error:'Select $100 or $200 and acknowledge the risk notice'},400);
 const now=new Date().toISOString();
 await c.env.DB.prepare("INSERT INTO investor_preferences(user_id,entry_tier_usd,payout_cycle,acknowledgement_at,updated_at) VALUES(?,?,'weekly',?,?) ON CONFLICT(user_id) DO UPDATE SET entry_tier_usd=excluded.entry_tier_usd,acknowledgement_at=excluded.acknowledgement_at,updated_at=excluded.updated_at").bind(user.id,amount,now,now).run();
 await c.env.DB.prepare('INSERT INTO audit_events(id,user_id,event_type,detail) VALUES(?,?,?,?)').bind(crypto.randomUUID(),user.id,'tier_preference_saved',JSON.stringify({entryTierUsd:amount})).run();
 return c.json({ok:true,entryTierUsd:amount,payoutCycle:'weekly',fundingEnabled:false,weeklyPayoutsEnabled:false});
});
app.get('/api/investor/ledger',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const entries=await c.env.DB.prepare('SELECT id,entry_type,asset,amount_minor,source_ref,occurred_at FROM ledger_entries WHERE user_id=? ORDER BY occurred_at DESC LIMIT 100').bind(user.id).all<any>();
 const totals=await c.env.DB.prepare('SELECT COALESCE(SUM(amount_minor),0) AS balance_minor FROM ledger_entries WHERE user_id=?').bind(user.id).first<any>();
 const requests=await c.env.DB.prepare('SELECT id,asset,amount_minor,destination_network,status,requested_at FROM withdrawal_requests WHERE user_id=? ORDER BY requested_at DESC LIMIT 30').bind(user.id).all<any>();
 const funding=await c.env.DB.prepare('SELECT * FROM funding_receipts WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all<any>();
 const usdt=Number(totals?.balance_minor||0)+funding.results.filter(x=>x.asset==='USDT').reduce((a,x)=>a+x.amount_minor-x.refunded_minor,0);
 const usdc=funding.results.filter(x=>x.asset==='USDC').reduce((a,x)=>a+x.amount_minor-x.refunded_minor,0);
 return c.json({asOf:new Date().toISOString(),currency:'STABLECOINS',balanceUsdt:usdt/1e6,balanceUsdc:usdc/1e6,
  entries:[...(entries.results||[]).map((x:any)=>({id:x.id,type:x.entry_type,amountUsdt:x.amount_minor/1e6,asset:x.asset,at:x.occurred_at})),...funding.results.map(x=>({id:x.id,type:'verified_deposit',amountUsdt:(x.amount_minor-x.refunded_minor)/1e6,asset:x.asset,at:x.settled_at}))],
  withdrawalRequests:requests.results,depositsEnabled:paymentConfig(c.env).liveDepositsEnabled&&pilotAllowed(c.env,user.email),withdrawalsEnabled:false,payoutsEnabled:false,valuationPolicy:'Actual stablecoin units, recorded separately. CIV is a platform, not a token.'});
});
app.get('/api/investor/projection',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const principal=Number(c.req.query('principal')||100),rate=Number(c.req.query('dailyRate')||0),days=Number(c.req.query('days')||7);
 if(![100,200].includes(principal)||!Number.isFinite(rate)||rate< -100||rate>100||!Number.isInteger(days)||days<1||days>365)return c.json({error:'Invalid projection parameters'},400);
 const values=Array.from({length:days+1},(_,day)=>({day,valueUsd:Number((principal*Math.pow(1+rate/100,day)).toFixed(2))}));
 return c.json({kind:'hypothetical_projection',principalUsd:principal,dailyRatePct:rate,days,values,weeklyDistribution:'Not calculated: actual distributable profits and fees are unknown',notice:'Illustration only. No actual investment return, account credit, guaranteed growth or payout.'});
});
// MiniPay-compatible Celo Sepolia payment sandbox. Never credits the production ledger.
const celoChainId=11142220;
const addressPattern=/^0x[a-fA-F0-9]{40}$/;
const hashPattern=/^0x[a-fA-F0-9]{64}$/;
const transferTopic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topicAddress=(a:string)=>'0x'+'0'.repeat(24)+a.slice(2).toLowerCase();
async function celoRpc(c:any,method:string,params:any[]){
 const url=c.env.CELO_SEPOLIA_RPC_URL;
 if(!url||!url.startsWith('https://'))throw Error('Celo Sepolia RPC is not configured');
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(9000)});
 if(!r.ok)throw Error('Blockchain RPC unavailable');
 const d:any=await r.json();if(d.error||!d.result)throw Error('Blockchain RPC returned an error');return d.result;
}
app.get('/api/celo/config',c=>{
 const token=c.env.CELO_TEST_USDC_ADDRESS,treasury=c.env.CELO_TEST_TREASURY_ADDRESS;
 return c.json({mode:'testnet_only',network:'Celo Sepolia',chainId:celoChainId,tokenAddress:token&&addressPattern.test(token)?token:null,treasuryAddress:treasury&&addressPattern.test(treasury)?treasury:null,ready:Boolean(c.env.CELO_SEPOLIA_RPC_URL&&addressPattern.test(token||'')&&addressPattern.test(treasury||'')),liveDepositsEnabled:false,livePayoutsEnabled:false});
});
function transferData(id:string, treasury:string, minor:number) {
 // The ERC-20 transfer arguments are followed by the account-specific intent reference.
 return '0xa9059cbb' + treasury.slice(2).padStart(64,'0') +
   minor.toString(16).padStart(64,'0') + id.replaceAll('-','');
}

app.post('/api/celo/testnet/intents', async c => {
 const user = await currentUser(c);
 if (!user) return c.json({error:'Unauthorized'},401);
 const token = c.env.CELO_TEST_USDC_ADDRESS?.toLowerCase();
 const treasury = c.env.CELO_TEST_TREASURY_ADDRESS?.toLowerCase();
 if (!token || !treasury || !addressPattern.test(token) || !addressPattern.test(treasury) || /^0x0{40}$/.test(treasury))
   return c.json({error:'The test treasury is not configured.'},503);
 const body = await c.req.json().catch(()=>null);
 if (![100,200].includes(body?.amountUsd) || !addressPattern.test(body?.sender))
   return c.json({error:'Select a test amount and connect MiniPay.'},400);
 const id = crypto.randomUUID(), minor = body.amountUsd * 1000000;
 const rpc = {env:c.env};
 if (Number(await celoRpc(rpc,'eth_chainId',[])) !== celoChainId) return c.json({error:'Unexpected test network'},503);
 const block = Number(await celoRpc(rpc,'eth_blockNumber',[]));
 await c.env.DB.batch([
   c.env.DB.prepare('INSERT INTO celo_testnet_deposit_intents(id,user_id,amount_minor,sender,token,treasury) VALUES(?,?,?,?,?,?)')
     .bind(id,user.id,minor,body.sender.toLowerCase(),token,treasury),
   c.env.DB.prepare('INSERT OR IGNORE INTO celo_scan_cursor VALUES(?,?,?)').bind(token,treasury,block)
 ]);
 return c.json({id,chainId:celoChainId,to:token,data:transferData(id,treasury,minor)},201);
});

async function creditTransfer(env:Bindings, intent:any, txHash:string, finalized:number) {
 const rpc = {env};
 const tx = await celoRpc(rpc,'eth_getTransactionByHash',[txHash]);
 if (tx.from?.toLowerCase()!==intent.sender || tx.to?.toLowerCase()!==intent.token ||
     tx.input?.toLowerCase()!==transferData(intent.id,intent.treasury,intent.amount_minor)) return 'mismatch';
 const receipt = await celoRpc(rpc,'eth_getTransactionReceipt',[txHash]);
 if (receipt.status!=='0x1') return 'failed';
 if (Number(receipt.blockNumber)>finalized) return 'pending';
 const log = receipt.logs.find((item:any)=>!item.removed && item.address.toLowerCase()===intent.token &&
   item.topics[0]===transferTopic && item.topics[1]===topicAddress(intent.sender) &&
   item.topics[2]===topicAddress(intent.treasury) && BigInt(item.data)===BigInt(intent.amount_minor));
 if (!log) return 'mismatch';
 await env.DB.batch([
   env.DB.prepare('INSERT INTO celo_test_credits VALUES(?,?,?,?,?,?,?) ON CONFLICT(intent_id) DO NOTHING')
     .bind(intent.id,celoChainId,intent.token,txHash,Number(log.logIndex),intent.amount_minor,receipt.blockHash),
   env.DB.prepare("UPDATE celo_testnet_deposit_intents SET status='observed',tx_hash=?,verified_at=CURRENT_TIMESTAMP WHERE id=? AND status='awaiting_transfer'")
     .bind(txHash,intent.id)
 ]);
 return 'credited';
}

async function finalizedHeight(env:Bindings) {
 const rpc = {env};
 if (Number(await celoRpc(rpc,'eth_chainId',[]))!==celoChainId) throw Error('Unexpected chain');
 const block = await celoRpc(rpc,'eth_getBlockByNumber',['finalized',false]);
 if (!/^0x[0-9a-f]+$/i.test(block.number)) throw Error('Missing finality');
 return Number(block.number);
}

app.post('/api/celo/testnet/intents/:id/verify',async c=>{
 const user=await currentUser(c);
 if (!user) return c.json({error:'Unauthorized'},401);
 const intent=await c.env.DB.prepare('SELECT * FROM celo_testnet_deposit_intents WHERE id=? AND user_id=?')
   .bind(c.req.param('id'),user.id).first<any>();
 if (!intent?.sender) return c.json({error:'Wallet-bound intent required'},404);
 if (intent.status==='observed') return c.json({status:'credited'});
 const body=await c.req.json().catch(()=>null);
 if (!hashPattern.test(body?.txHash)) return c.json({error:'Invalid transaction'},400);
 const status=await creditTransfer(c.env,intent,body.txHash.toLowerCase(),await finalizedHeight(c.env));
 return c.json({status});
});

async function reconcile(env:Bindings) {
 const rows=await env.DB.prepare('SELECT * FROM celo_scan_cursor').all<{token:string,treasury:string,next_block:number}>();
 if (!rows.results.length) return;
 const finalized=await finalizedHeight(env);
 for (const row of rows.results) {
   const end=Math.min(row.next_block+999,finalized);
   if (end<row.next_block) continue;
   const hex=(n:number)=>'0x'+n.toString(16);
   const logs=await celoRpc({env},'eth_getLogs',[{address:row.token,fromBlock:hex(row.next_block),toBlock:hex(end),
     topics:[transferTopic,null,topicAddress(row.treasury)]}]);
   for (const event of logs) {
     const tx=await celoRpc({env},'eth_getTransactionByHash',[event.transactionHash]);
     const match=/^0xa9059cbb[0-9a-f]{128}([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i.exec(tx.input);
     if (!match) continue;
     const intent=await env.DB.prepare("SELECT * FROM celo_testnet_deposit_intents WHERE id=? AND status='awaiting_transfer'").bind(match.slice(1).join('-').toLowerCase()).first();
     if (intent) await creditTransfer(env,intent,event.transactionHash.toLowerCase(),finalized);
   }
   await env.DB.prepare('UPDATE celo_scan_cursor SET next_block=? WHERE token=? AND treasury=? AND next_block=?')
     .bind(end+1,row.token,row.treasury,row.next_block).run();
 }
}
app.get('/api/celo/testnet/intents',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const rows=await c.env.DB.prepare('SELECT id,amount_minor,status,tx_hash,created_at,verified_at FROM celo_testnet_deposit_intents WHERE user_id=? ORDER BY created_at DESC LIMIT 30').bind(user.id).all();
 const balance=await c.env.DB.prepare('SELECT COALESCE(SUM(c.amount_minor),0) AS total FROM celo_test_credits c JOIN celo_testnet_deposit_intents i ON i.id=c.intent_id WHERE i.user_id=?').bind(user.id).first<{total:number}>();
 return c.json({testUsdcMinor:balance?.total??0,mode:'testnet_only',intents:(rows.results||[]).map((x:any)=>({id:x.id,amountTestUsdc:x.amount_minor/1000000,status:x.status,txHash:x.tx_hash,createdAt:x.created_at,verifiedAt:x.verified_at})),liveBalanceCredits:false});
});
app.get('/api/celo/payout-signer/status',c=>c.json({mode:'disabled',mainnetSigningEnabled:false,testnetSigningEnabled:false,reason:'Signer must be isolated in a separate, authenticated treasury service with dual approval and hardware-backed keys. No signing key is stored in the public web worker.'}));
const coinMap=[['bitcoin','BTC','Bitcoin'],['ethereum','ETH','Ethereum'],['solana','SOL','Solana'],['ripple','XRP','XRP'],['binancecoin','BNB','BNB'],['cardano','ADA','Cardano'],['dogecoin','DOGE','Dogecoin']] as const;
// Server-side market summaries are independent of the payment and investment ledgers.
app.get('/api/market-pulse',c=>marketPulse(c.env,c.req.raw,c.executionCtx));
app.get('/api/headlines',c=>cryptoHeadlines(c.env,c.req.raw,c.executionCtx));
app.get('/api/markets',async c=>{
  const key=c.env.COINGECKO_DEMO_API_KEY;
  if(!key)return c.json({error:'CoinGecko market data is not configured',code:'PROVIDER_NOT_CONFIGURED'},503);
  const cache=caches.default;
  const cacheKey=new Request(new URL('/api/markets',c.req.url).toString(),{method:'GET'});
  const cached=await cache.match(cacheKey);
  if(cached)return new Response(cached.body,cached);
  try{
    const url=new URL('https://api.coingecko.com/api/v3/coins/markets');
    url.searchParams.set('vs_currency','usd');
    url.searchParams.set('ids',coinMap.map(x=>x[0]).join(','));
    url.searchParams.set('order','market_cap_desc');
    url.searchParams.set('per_page','7');
    url.searchParams.set('page','1');
    url.searchParams.set('sparkline','false');
    url.searchParams.set('price_change_percentage','24h');
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    let response:Response;
    try{response=await fetch(url.toString(),{headers:{'accept':'application/json','x-cg-demo-api-key':key},signal:controller.signal})}finally{clearTimeout(timeout)}
    if(!response.ok)throw new Error('CoinGecko returned '+response.status);
    const raw:any=await response.json();
    if(!Array.isArray(raw))throw new Error('Unexpected CoinGecko response');
    const byId=new Map(raw.map((item:any)=>[item.id,item]));
    const assets=coinMap.map(([id,symbol,name])=>{
      const item:any=byId.get(id);
      const price=Number(item?.current_price);
      const change=item?.price_change_percentage_24h;
      if(!item||!Number.isFinite(price)||price<=0)throw new Error('Incomplete market response: '+symbol);
      const pct=change===null||change===undefined?null:Number(change);
      return {symbol,name,priceUsd:price,change24h:pct!==null&&Number.isFinite(pct)?pct:null};
    });
    const asOf=new Date().toISOString();
    const payload=JSON.stringify({source:'CoinGecko',asOf,assets,quoteCurrency:'USD',refreshSeconds:300});
    const result=new Response(payload,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
    c.executionCtx.waitUntil(cache.put(cacheKey,result.clone()));
    return new Response(payload,{headers:result.headers});
  }catch(e){
    console.error('CoinGecko market request failed',e instanceof Error?e.message:'Unknown error');
    return c.json({error:'Live market data temporarily unavailable',code:'MARKET_DATA_UNAVAILABLE'},503);
  }
});
const disclosureCategories=['performance','custody','legal','fees','risk','team','withdrawals'] as const;
app.get('/api/transparency',async c=>{
  const disclosures=await c.env.DB.prepare("SELECT category,title,summary,status,evidence_url,verified_by,verified_at,published_at,updated_at FROM disclosures WHERE status IN ('published','verified') ORDER BY category,updated_at DESC").all();
  const latest=await c.env.DB.prepare("SELECT period_start,period_end,net_return_pct,max_drawdown_pct,fees_pct,verification_url,verified_by,published_at FROM strategy_performance WHERE verification_url IS NOT NULL AND verified_by IS NOT NULL ORDER BY period_end DESC LIMIT 12").all();
  const announcements=await c.env.DB.prepare("SELECT title,body,published_at FROM platform_announcements ORDER BY published_at DESC LIMIT 5").all();
  const categories=disclosureCategories.map(category=>({category,items:(disclosures.results||[]).filter((d:any)=>d.category===category),status:(disclosures.results||[]).some((d:any)=>d.category===category)?'published':'not_published'}));
  return c.json({asOf:new Date().toISOString(),fundingEnabled:false,liveTradingEnabled:false,categories,verifiedPerformance:latest.results||[],announcements:announcements.results||[],notice:'No publication is proof of independent verification unless the source and verifier are provided. Historical performance does not guarantee future returns.'});
});
app.all('/api/funding/*',c=>c.json({error:'Funding and withdrawals are not enabled'},403));
app.get('/api/status',c=>c.json({platform:'Crypto Investment Vault',product:'The Big 7',release:'stablecoin-funding-v4',membershipDepositsEnabled:false,pilotOnly:true,fundingEnabled:false,liveTradingEnabled:false}));
app.get('/api/ready',async c=>{
 // Preparing these queries validates required columns as well as table presence.
 await c.env.DB.batch([
  c.env.DB.prepare('SELECT user_id,display_name,terms_version FROM account_profiles LIMIT 0'),
  c.env.DB.prepare('SELECT user_id,code FROM referral_attributions LIMIT 0'),
  c.env.DB.prepare('SELECT status,available_at,lease_until FROM email_outbox LIMIT 0'),
  c.env.DB.prepare('SELECT sender,token,treasury FROM celo_testnet_deposit_intents LIMIT 0'),
  c.env.DB.prepare('SELECT event_key,amount_minor FROM ledger_entries LIMIT 0'),
  c.env.DB.prepare('SELECT intent_id,amount_minor FROM celo_test_credits LIMIT 0'),
  c.env.DB.prepare('SELECT required_minor,settled_minor,active FROM member_activation LIMIT 0'),
  c.env.DB.prepare('SELECT payment_ref,refunded_minor,environment FROM signup_deposits LIMIT 0'),
  c.env.DB.prepare('SELECT metric,threshold,status FROM member_perks LIMIT 0'),
  c.env.DB.prepare('SELECT token_minor,funding_minor,purpose,expires_at FROM payment_quotes LIMIT 0'),
  c.env.DB.prepare('SELECT user_id,asset,amount_minor,refunded_minor FROM funding_receipts LIMIT 0'),
  c.env.DB.prepare('SELECT user_id,status FROM deposit_promotions LIMIT 0'),
  c.env.DB.prepare('SELECT code,user_id FROM referral_aliases LIMIT 0'),
  c.env.DB.prepare('SELECT user_id,status FROM referral_wallet LIMIT 0'),
  c.env.DB.prepare('SELECT user_id,status FROM manual_deposit_claims LIMIT 0')
 ]);
 return c.json({ready:true,schema:12,membershipDepositsEnabled:false,pilotOnly:true,registrationEnabled:true,emailDelivery:envEmailStatus(c.env),liveDepositsEnabled:false});
});
app.all('/api/*',c=>c.json({error:'Not found'},404));
// Return the complete signup page to social crawlers without needing client JavaScript.
async function entryPage(c:import('hono').Context<{Bindings:Bindings}>) {
 const response=await c.env.ASSETS.fetch(new Request(new URL('/',c.req.url)));
 let html=await response.text();
 const canonical=new URL(c.req.path,c.env.APP_ORIGIN).href;
 html=html.replace('<link rel="canonical" href="https://cryptoinvestmentvault.com/">',`<link rel="canonical" href="${canonical}">`).replace('<meta property="og:url" content="https://cryptoinvestmentvault.com/">',`<meta property="og:url" content="${canonical}">`);
 if(c.req.path==='/dashboard')html=html.replace('index,follow,max-image-preview:large','noindex,nofollow');
 c.header('Cache-Control','no-store');
 c.header('X-Content-Type-Options','nosniff');
 return c.html(html);
}
app.get('/join',entryPage);
app.get('/dashboard',entryPage);
app.get('/r/:code',async c=>{
 const code=c.req.param('code').toLowerCase();
 if(!referralPattern.test(code))return c.text('Invitation not found',404);
 const found=await c.env.DB.prepare('SELECT r.user_id,a.code FROM referral_codes r JOIN referral_aliases a ON a.user_id=r.user_id WHERE (r.code=? OR r.user_id=? OR a.code=?) AND r.user_id IS NOT NULL').bind(code,code,code).first<{user_id:string,code:string}>();
 if(!found)return c.text('Invitation not found',404);
 if(c.req.param('code')!==found.code)return c.redirect('/r/'+found.code,301);
 return entryPage(c);
});
export default {fetch:app.fetch, scheduled(_event:ScheduledController,env:Bindings,ctx:ExecutionContext){
 ctx.waitUntil(reconcile(env).catch(()=>console.error('Testnet reconciliation unavailable')));
 ctx.waitUntil(deliverEmails(env));
 ctx.waitUntil(reconcilePayments(env));
 ctx.waitUntil(env.DB.batch([
  env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()),
  env.DB.prepare('DELETE FROM auth_attempts WHERE window_start<? AND locked_until<?').bind(Date.now()-86400000,Date.now())
 ]));
}};
