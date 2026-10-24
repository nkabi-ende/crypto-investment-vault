import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
type Bindings = { DB: D1Database; ASSETS: Fetcher; APP_ORIGIN: string; FUNDING_ENABLED: string; COINGECKO_DEMO_API_KEY?: string; CELO_SEPOLIA_RPC_URL?: string; CELO_TEST_USDC_ADDRESS?: string; CELO_TEST_TREASURY_ADDRESS?: string };
const app = new Hono<{Bindings:Bindings}>();
const enc = new TextEncoder();
const b64 = (bytes:Uint8Array)=> btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const rand = (n=32)=>b64(crypto.getRandomValues(new Uint8Array(n)));
async function digest(s:string){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))))}
async function passwordHash(password:string,salt:string){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return b64(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:310000,hash:'SHA-256'},key,256)))}
function same(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
async function currentUser(c:any){const token=getCookie(c,'civ_session');if(!token)return null;const hash=await digest(token);return await c.env.DB.prepare('SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id_hash=? AND sessions.expires_at>?').bind(hash,Date.now()).first<{id:string,email:string}>()}
async function session(c:any,id:string){const token=rand();await c.env.DB.prepare('INSERT INTO sessions(id_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token),id,Date.now()+7*86400000).run();setCookie(c,'civ_session',token,{httpOnly:true,secure:new URL(c.req.url).protocol==='https:',sameSite:'Strict',path:'/',maxAge:604800});}
app.use('/api/*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');if(c.req.method!=='GET'&&c.req.method!=='HEAD'){const origin=c.req.header('origin');const url=new URL(c.req.url);if(origin&&origin!==url.origin)return c.json({error:'Cross-origin requests are not allowed'},403)}await next()});
app.post('/api/auth/register',async c=>{let body:any;try{body=await c.req.json()}catch{return c.json({error:'Invalid request'},400)}const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||password.length>128)return c.json({error:'Use a valid email and password of at least 12 characters'},400);const id=crypto.randomUUID(),salt=rand(16),hash=await passwordHash(password,salt);try{await c.env.DB.batch([c.env.DB.prepare('INSERT INTO users(id,email,password_hash,salt) VALUES(?,?,?,?)').bind(id,email,hash,salt),c.env.DB.prepare('INSERT INTO portfolios(user_id) VALUES(?)').bind(id),c.env.DB.prepare('INSERT INTO audit_events(id,user_id,event_type) VALUES(?,?,?)').bind(crypto.randomUUID(),id,'registered')]);}catch{return c.json({error:'Unable to create account; email may already be registered'},409)}await session(c,id);return c.json({user:{id,email}})});
app.post('/api/auth/login',async c=>{let body:any;try{body=await c.req.json()}catch{return c.json({error:'Invalid request'},400)}const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');const now=Date.now();const attempts=await c.env.DB.prepare('SELECT attempts,window_start,locked_until FROM auth_attempts WHERE email=?').bind(email).first<any>();if(attempts&&attempts.locked_until>now)return c.json({error:'Too many attempts. Try again later.'},429);const user=await c.env.DB.prepare('SELECT id,email,password_hash,salt FROM users WHERE email=?').bind(email).first<any>();const check=await passwordHash(password,user?.salt||'fallback');if(!user||!same(check,user.password_hash)){const within=attempts&&now-attempts.window_start<900000;const count=within?attempts.attempts+1:1;await c.env.DB.prepare('INSERT INTO auth_attempts(email,attempts,window_start,locked_until) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET attempts=excluded.attempts,window_start=excluded.window_start,locked_until=excluded.locked_until').bind(email,count,within?attempts.window_start:now,count>=5?now+900000:0).run();return c.json({error:'Invalid credentials'},401)}await c.env.DB.prepare('DELETE FROM auth_attempts WHERE email=?').bind(email).run();await session(c,user.id);return c.json({user:{id:user.id,email:user.email}})});
app.post('/api/auth/logout',async c=>{const token=getCookie(c,'civ_session');if(token)await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(await digest(token)).run();deleteCookie(c,'civ_session',{path:'/'});return c.json({ok:true})});
app.get('/api/me',async c=>{const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);const portfolio=await c.env.DB.prepare('SELECT cash_usdt,updated_at FROM portfolios WHERE user_id=?').bind(user.id).first();return c.json({user,portfolio,fundingEnabled:false,product:'The Big 7'})});
app.get('/api/investor/overview',async c=>{
  const user=await currentUser(c);
  if(!user)return c.json({error:'Unauthorized'},401);
  const [portfolio,events]=await Promise.all([
    c.env.DB.prepare('SELECT cash_usdt,updated_at FROM portfolios WHERE user_id=?').bind(user.id).first<{cash_usdt:number,updated_at:string}>(),
    c.env.DB.prepare('SELECT event_type,detail,created_at FROM audit_events WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(user.id).all()
  ]);
  return c.json({
    user,portfolio:{cashUsdt:Math.max(0,Number(portfolio?.cash_usdt||0)),updatedAt:portfolio?.updated_at||null},
    holdings:[],holdingsSource:'No positions ledger has been activated',
    activity:(events.results||[]).map((e:any)=>({type:e.event_type,at:e.created_at})),
    fundingEnabled:false,withdrawalsEnabled:false,liveTradingEnabled:false,
    notice:'Account data comes from CIV D1. No investments or returns are simulated in this view.'
  });
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
 const balanceMinor=Number(totals?.balance_minor||0);
 return c.json({asOf:new Date().toISOString(),currency:'USDT',balanceUsdt:balanceMinor/1000000,entries:(entries.results||[]).map((x:any)=>({id:x.id,type:x.entry_type,amountUsdt:x.amount_minor/1000000,asset:x.asset,sourceRef:x.source_ref,at:x.occurred_at})),withdrawalRequests:(requests.results||[]).map((x:any)=>({id:x.id,amountUsdt:x.amount_minor/1000000,asset:x.asset,network:x.destination_network,status:x.status,requestedAt:x.requested_at})),depositsEnabled:false,withdrawalsEnabled:false,payoutsEnabled:false,valuationPolicy:'Verified ledger entries only; no automatic yield credits'});
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
app.post('/api/celo/testnet/intents',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const configured=c.env.CELO_SEPOLIA_RPC_URL&&addressPattern.test(c.env.CELO_TEST_USDC_ADDRESS||'')&&addressPattern.test(c.env.CELO_TEST_TREASURY_ADDRESS||'');
 if(!configured)return c.json({error:'Celo testnet token, treasury and RPC must be configured'},503);
 let body:any;try{body=await c.req.json()}catch{return c.json({error:'Invalid JSON'},400)}
 if(![100,200].includes(body?.amountUsd))return c.json({error:'Select 100 or 200 test USDC'},400);
 const id=crypto.randomUUID();
 await c.env.DB.prepare('INSERT INTO celo_testnet_deposit_intents(id,user_id,amount_minor) VALUES(?,?,?)').bind(id,user.id,body.amountUsd*1000000).run();
 return c.json({id,mode:'testnet_only',chainId:celoChainId,tokenAddress:c.env.CELO_TEST_USDC_ADDRESS,treasuryAddress:c.env.CELO_TEST_TREASURY_ADDRESS,amountTestUsdc:body.amountUsd,status:'awaiting_transfer',notice:'Test tokens only. Never send real USDC to this address.'},201);
});
app.post('/api/celo/testnet/intents/:id/verify',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 let body:any;try{body=await c.req.json()}catch{return c.json({error:'Invalid JSON'},400)}
 const tx=String(body?.txHash||'');if(!hashPattern.test(tx))return c.json({error:'Invalid transaction hash'},400);
 const intent=await c.env.DB.prepare('SELECT id,amount_minor,status,tx_hash FROM celo_testnet_deposit_intents WHERE id=? AND user_id=?').bind(c.req.param('id'),user.id).first<any>();
 if(!intent)return c.json({error:'Intent not found'},404);
 if(intent.status==='observed')return c.json({status:'observed',txHash:intent.tx_hash,mode:'testnet_only'});
 if(!addressPattern.test(c.env.CELO_TEST_USDC_ADDRESS||'')||!addressPattern.test(c.env.CELO_TEST_TREASURY_ADDRESS||''))return c.json({error:'Testnet contract configuration missing'},503);
 const prior=await c.env.DB.prepare('SELECT id FROM celo_testnet_deposit_intents WHERE tx_hash=?').bind(tx).first();
 if(prior)return c.json({error:'Transaction already used'},409);
 try{
 const chain=await celoRpc(c,'eth_chainId',[]);
 if(parseInt(chain,16)!==celoChainId)return c.json({error:'RPC chain mismatch'},503);
 const receipt:any=await celoRpc(c,'eth_getTransactionReceipt',[tx]);
 if(receipt.status!=='0x1')return c.json({error:'Transaction was not successful'},422);
 const tip=parseInt(await celoRpc(c,'eth_blockNumber',[]),16),block=parseInt(receipt.blockNumber,16);
 if(!Number.isSafeInteger(tip)||!Number.isSafeInteger(block)||tip-block<5)return c.json({error:'Waiting for at least 6 confirmations'},409);
 const matching=(receipt.logs||[]).some((log:any)=>String(log.address).toLowerCase()===c.env.CELO_TEST_USDC_ADDRESS.toLowerCase()&&String(log.topics?.[0]).toLowerCase()===transferTopic&&String(log.topics?.[2]).toLowerCase()===topicAddress(c.env.CELO_TEST_TREASURY_ADDRESS)&&BigInt(log.data||'0x0')===BigInt(intent.amount_minor));
 if(!matching)return c.json({error:'No matching test-token transfer to configured treasury'},422);
 const updated=await c.env.DB.prepare("UPDATE celo_testnet_deposit_intents SET status='observed',tx_hash=?,verified_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='awaiting_transfer'").bind(tx,intent.id,user.id).run();
 if(!updated.meta.changes)return c.json({error:'Intent already processed'},409);
 return c.json({status:'observed',txHash:tx,confirmations:tip-block+1,mode:'testnet_only',creditedToInvestorBalance:false});
 }catch(e){return c.json({error:'Unable to verify transaction on Celo Sepolia'},503)}
});
app.get('/api/celo/testnet/intents',async c=>{
 const user=await currentUser(c);if(!user)return c.json({error:'Unauthorized'},401);
 const rows=await c.env.DB.prepare('SELECT id,amount_minor,status,tx_hash,created_at,verified_at FROM celo_testnet_deposit_intents WHERE user_id=? ORDER BY created_at DESC LIMIT 30').bind(user.id).all();
 return c.json({mode:'testnet_only',intents:(rows.results||[]).map((x:any)=>({id:x.id,amountTestUsdc:x.amount_minor/1000000,status:x.status,txHash:x.tx_hash,createdAt:x.created_at,verifiedAt:x.verified_at})),liveBalanceCredits:false});
});
app.get('/api/celo/payout-signer/status',c=>c.json({mode:'disabled',mainnetSigningEnabled:false,testnetSigningEnabled:false,reason:'Signer must be isolated in a separate, authenticated treasury service with dual approval and hardware-backed keys. No signing key is stored in the public web worker.'}));
const coinMap=[['bitcoin','BTC','Bitcoin'],['ethereum','ETH','Ethereum'],['solana','SOL','Solana'],['ripple','XRP','XRP'],['binancecoin','BNB','BNB'],['cardano','ADA','Cardano'],['dogecoin','DOGE','Dogecoin']] as const;
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
app.get('/api/status',c=>c.json({platform:'Crypto Investment Vault',product:'The Big 7',fundingEnabled:false,liveTradingEnabled:false}));
app.all('/api/*',c=>c.json({error:'Not found'},404));
export default app;
