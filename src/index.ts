import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
type Bindings = { DB: D1Database; ASSETS: Fetcher; APP_ORIGIN: string; FUNDING_ENABLED: string; TWELVE_DATA_API_KEY?: string };
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
const coins=[['BTC/USD','BTC','Bitcoin'],['ETH/USD','ETH','Ethereum'],['SOL/USD','SOL','Solana'],['XRP/USD','XRP','XRP'],['BNB/USD','BNB','BNB'],['ADA/USD','ADA','Cardano'],['DOGE/USD','DOGE','Dogecoin']] as const;
app.get('/api/markets',async c=>{
  const key=c.env.TWELVE_DATA_API_KEY;
  if(!key)return c.json({error:'Market data provider is not configured'},503);
  const cache=caches.default;
  const cacheKey=new Request(new URL('/api/markets',c.req.url).toString(),{method:'GET'});
  const cached=await cache.match(cacheKey);
  if(cached)return new Response(cached.body,cached);
  try{
    const results=await Promise.all(coins.map(async([pair,symbol,name])=>{
      const url=new URL('https://api.twelvedata.com/quote');
      url.searchParams.set('symbol',pair);
      url.searchParams.set('apikey',key);
      const response=await fetch(url.toString(),{headers:{accept:'application/json'}});
      if(!response.ok)throw new Error('Provider unavailable');
      const quote:any=await response.json();
      if(quote.status==='error'||quote.code||quote.close===undefined)throw new Error('Quote unavailable: '+symbol);
      const price=Number(quote.close);
      const change=quote.percent_change===undefined?null:Number(quote.percent_change);
      if(!Number.isFinite(price)||price<=0)throw new Error('Invalid market price');
      return {symbol,name,priceUsd:price,change24h:Number.isFinite(change)?change:null};
    }));
    const payload=JSON.stringify({source:'Twelve Data',asOf:new Date().toISOString(),assets:results});
    const response=new Response(payload,{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=60'}});
    c.executionCtx.waitUntil(cache.put(cacheKey,response.clone()));
    return c.json(JSON.parse(payload));
  }catch{return c.json({error:'Live market data temporarily unavailable. Check Twelve Data plan and supported crypto symbols.'},503)}
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
