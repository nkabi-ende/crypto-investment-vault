/** CIV public market-reference prices, independent of the investment and payments ledgers. */
type MarketEnv={DB:D1Database;COINGECKO_DEMO_API_KEY?:string};
type CachedRow={response_json:string;updated_at_ms:number;lease_until_ms:number;next_attempt_ms:number};
const key='big7-usd-v1',refreshMs=10*60_000,staleLimitMs=24*60*60_000;
const coins=[['bitcoin','BTC','Bitcoin'],['ethereum','ETH','Ethereum'],['solana','SOL','Solana'],['ripple','XRP','XRP'],['binancecoin','BNB','BNB'],['cardano','ADA','Cardano'],['dogecoin','DOGE','Dogecoin']] as const;
const headers={'Cache-Control':'public, max-age=60, s-maxage=60','X-Content-Type-Options':'nosniff'};
const json=(object:object,status=200,seconds?:number)=>Response.json(object,{status,headers:{...headers,...(seconds?{'Retry-After':String(seconds)}:{})}});
const snapshot=(row:CachedRow|null,now:number)=>{
 if(!row?.response_json||now-row.updated_at_ms>=staleLimitMs)return null;
 try{
  const value=JSON.parse(row.response_json);
  if(value?.assets?.length!==7)return null;
  return {...value,stale:now-row.updated_at_ms>=refreshMs,refreshSeconds:600,ageSeconds:Math.max(0,Math.floor((now-row.updated_at_ms)/1000))};
 }catch{return null}
};
export async function marketPrices(env:MarketEnv):Promise<Response>{
 const now=Date.now();
 const stored=await env.DB.prepare('SELECT response_json,updated_at_ms,lease_until_ms,next_attempt_ms FROM market_data_cache WHERE cache_key=?').bind(key).first<CachedRow>();
 const saved=snapshot(stored,now);
 if(saved&&!saved.stale)return json(saved);
 const apiKey=env.COINGECKO_DEMO_API_KEY?.trim();
 if(!apiKey)return saved?json({...saved,stale:true,warning:'API key missing; showing previous verified CoinGecko snapshot.'}):json({error:'CoinGecko API key must be configured in Cloudflare',code:'PROVIDER_NOT_CONFIGURED'},503);
 if(stored&&stored.next_attempt_ms>now)return saved?json({...saved,stale:true,warning:'Provider temporarily unavailable; showing last known price snapshot.'}):json({error:'Price provider temporarily unavailable',code:'MARKET_RETRY_LATER'},503,30);
 const claim=await env.DB.prepare('UPDATE market_data_cache SET lease_until_ms=? WHERE cache_key=? AND lease_until_ms<? AND next_attempt_ms<=? AND updated_at_ms<?')
   .bind(now+12000,key,now,now,now-refreshMs).run();
 if(claim.meta.changes!==1)return saved?json({...saved,stale:true,warning:'Refreshing prices; showing last known snapshot.'}):json({error:'Prices are currently refreshing',code:'MARKET_REFRESHING'},503,5);
 let backoffMs=45_000,reason='MARKET_DATA_UNAVAILABLE';
 try{
  const url=new URL('https://api.coingecko.com/api/v3/coins/markets');
  url.searchParams.set('vs_currency','usd');
  url.searchParams.set('ids',coins.map(x=>x[0]).join(','));
  url.searchParams.set('order','market_cap_desc');
  url.searchParams.set('per_page','7');
  url.searchParams.set('page','1');
  url.searchParams.set('sparkline','false');
  url.searchParams.set('price_change_percentage','24h');
  const response=await fetch(url.href,{headers:{accept:'application/json','x-cg-demo-api-key':apiKey},signal:AbortSignal.timeout(8000)});
  if(!response.ok){
   reason=response.status===429?'PROVIDER_RATE_LIMITED':response.status===401||response.status===403?'PROVIDER_AUTH_FAILED':'MARKET_DATA_UNAVAILABLE';
   if(response.status===429)backoffMs=120_000;
   if(response.status===401||response.status===403)backoffMs=300_000;
   throw Error('CoinGecko HTTP '+response.status);
  }
  const raw:unknown=await response.json();
  if(!Array.isArray(raw))throw Error('Invalid market API response');
  const byId=new Map(raw.map((coin:any)=>[coin.id,coin]));
  const assets=coins.map(([id,symbol,name])=>{
   const item:any=byId.get(id);
   const price=item?.current_price;
   if(typeof price!=='number'||!Number.isFinite(price)||price<=0)throw Error('Missing positive price for '+symbol);
   const change=item.price_change_percentage_24h;
   return {symbol,name,priceUsd:price,change24h:typeof change==='number'&&Number.isFinite(change)?change:null};
  });
  const payload={source:'CoinGecko',asOf:new Date().toISOString(),assets,quoteCurrency:'USD',refreshSeconds:600};
  await env.DB.prepare('UPDATE market_data_cache SET response_json=?,updated_at_ms=?,lease_until_ms=0,next_attempt_ms=0 WHERE cache_key=?')
   .bind(JSON.stringify(payload),Date.now(),key).run();
  return json({...payload,stale:false,ageSeconds:0});
 }catch(error){
  console.error('CoinGecko market snapshot failed',error instanceof Error?error.message:'unknown');
  await env.DB.prepare('UPDATE market_data_cache SET lease_until_ms=0,next_attempt_ms=? WHERE cache_key=?')
   .bind(Date.now()+backoffMs,key).run().catch(()=>{});
  return saved?json({...saved,stale:true,warning:'CoinGecko is temporarily unavailable. Last verified prices are labelled as delayed.'}):json({error:reason==='PROVIDER_AUTH_FAILED'?'CoinGecko API key was rejected':'Market prices are temporarily unavailable',code:reason},503,Math.ceil(backoffMs/1000));
 }
}
