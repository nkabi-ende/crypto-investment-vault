import { pbkdf2Sync } from 'node:crypto';
import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
type Bindings = { DB: D1Database; ASSETS: Fetcher; APP_ORIGIN: string; FUNDING_ENABLED: string; COINGECKO_DEMO_API_KEY?: string; CELO_SEPOLIA_RPC_URL?: string; CELO_TEST_USDC_ADDRESS?: string; CELO_TEST_TREASURY_ADDRESS?: string };
const app = new Hono<{Bindings:Bindings}>();
const enc = new TextEncoder();
const b64 = (bytes:Uint8Array)=> btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const rand = (n=32)=>b64(crypto.getRandomValues(new Uint8Array(n)));
async function digest(s:string){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))))}
async function passwordHash(password:string,salt:string) {
 // Preserve the existing PBKDF2 digest format across Worker runtimes.
 return b64(pbkdf2Sync(password,salt,310000,32,'sha256'));
}
function same(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
async function currentUser(c:any){const token=getCookie(c,'civ_session');if(!token)return null;const hash=await digest(token);return await c.env.DB.prepare('SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id_hash=? AND sessions.expires_at>?').bind(hash,Date.now()).first<{id:string,email:string}>()}
async function session(c:any, id:string, accountWrites:D1PreparedStatement[] = []) {
  const token = rand();
  const lifetimeSeconds = 7 * 86400;
  const insertSession = c.env.DB.prepare('INSERT INTO sessions(id_hash,user_id,expires_at) VALUES(?,?,?)')
    .bind(await digest(token), id, Date.now() + lifetimeSeconds * 1000);
  await c.env.DB.batch([...accountWrites, insertSession]);
  setCookie(c, 'civ_session', token, {
    httpOnly: true, secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict', path: '/', maxAge: lifetimeSeconds
  });
}
app.use('/api/*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');if(c.req.method!=='GET'&&c.req.method!=='HEAD'){const origin=c.req.header('origin');const url=new URL(c.req.url);if(origin&&origin!==url.origin)return c.json({error:'Cross-origin requests are not allowed'},403)}await next()});
app.post('/api/auth/register',async c=>{let body:any;try{body=await c.req.json()}catch{return c.json({error:'Invalid request'},400)}const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||password.length>128)return c.json({error:'Use a valid email and password of at least 12 characters'},400);const id=crypto.randomUUID(),salt=rand(16),hash=await passwordHash(password,salt);try{await session(c,id,[c.env.DB.prepare('INSERT INTO users(id,email,password_hash,salt) VALUES(?,?,?,?)').bind(id,email,hash,salt),c.env.DB.prepare('INSERT INTO portfolios(user_id) VALUES(?)').bind(id),c.env.DB.prepare('INSERT INTO audit_events(id,user_id,event_type) VALUES(?,?,?)').bind(crypto.randomUUID(),id,'registered')]);}catch(error){
  if(String(error).includes('UNIQUE constraint failed: users.email'))return c.json({error:'Unable to create account; email may already be registered'},409);
  return c.json({error:'Account service temporarily unavailable. Please try again.'},503)
}return c.json({user:{id,email}})});
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
export default {fetch:app.fetch, scheduled(_event:ScheduledController,env:Bindings,ctx:ExecutionContext){ctx.waitUntil(reconcile(env))}};
