/** Calendar-year USD spot change. Independent of CIV strategy returns and all ledgers. */
import { marketPrices } from './market-prices';
type Env={DB:D1Database;COINGECKO_DEMO_API_KEY?:string};
const ids:Record<string,string>={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',XRP:'ripple',BNB:'binancecoin',ADA:'cardano',DOGE:'dogecoin'};
const json=(data:object,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'}});
export async function marketYtd(env:Env,symbol:string):Promise<Response>{
 const id=ids[symbol];
 if(!id)return json({error:'Unknown asset'},404);
 const year=new Date().getUTCFullYear(),startAt=`${year}-01-01T00:00:00.000Z`,key=`ytd-${year}-${symbol}`,now=Date.now();
 const unavailable=()=>json({symbol,year,startAt,source:'CoinGecko',changePct:null,notice:'Year-to-date data temporarily unavailable.'});
 await env.DB.prepare('INSERT OR IGNORE INTO market_data_cache(cache_key) VALUES (?)').bind(key).run();
 const row=await env.DB.prepare('SELECT response_json,lease_until_ms,next_attempt_ms FROM market_data_cache WHERE cache_key=?').bind(key).first<{response_json:string;lease_until_ms:number;next_attempt_ms:number}>();
 let startPriceUsd:number|null=null;
 try{const saved=JSON.parse(row?.response_json||'null');if(saved?.year===year&&typeof saved.priceUsd==='number'&&Number.isFinite(saved.priceUsd)&&saved.priceUsd>0)startPriceUsd=saved.priceUsd}catch{}
 if(startPriceUsd===null){
  const apiKey=env.COINGECKO_DEMO_API_KEY?.trim();
  if(!apiKey||Number(row?.next_attempt_ms)>now)return unavailable();
  const claim=await env.DB.prepare('UPDATE market_data_cache SET lease_until_ms=? WHERE cache_key=? AND lease_until_ms<? AND next_attempt_ms<=? AND response_json=?').bind(now+12000,key,now,now,row?.response_json||'').run();
  if(claim.meta.changes!==1)return unavailable();
  try{
   const url=`https://api.coingecko.com/api/v3/coins/${id}/history?date=01-01-${year}&localization=false`;
   const r=await fetch(url,{headers:{accept:'application/json','x-cg-demo-api-key':apiKey},signal:AbortSignal.timeout(8000)});
   if(!r.ok)throw Error('History provider unavailable');
   const data:any=await r.json(),price=data?.market_data?.current_price?.usd;
   if(typeof price!=='number'||!Number.isFinite(price)||price<=0)throw Error('Invalid year-start price');
   startPriceUsd=price;
   await env.DB.prepare('UPDATE market_data_cache SET response_json=?,updated_at_ms=?,lease_until_ms=0,next_attempt_ms=0 WHERE cache_key=?').bind(JSON.stringify({year,priceUsd:price}),now,key).run();
  }catch{
   await env.DB.prepare('UPDATE market_data_cache SET lease_until_ms=0,next_attempt_ms=? WHERE cache_key=?').bind(now+60*60_000,key).run();
   return unavailable();
  }
 }
 const response=await marketPrices(env);
 if(!response.ok)return unavailable();
 const current:any=await response.json(),asset=current.assets?.find((item:any)=>item.symbol===symbol);
 const asOf=Date.parse(current.asOf);
 if(!asset||!Number.isFinite(asOf)||asOf<Date.parse(startAt)||asOf>=Date.UTC(year+1,0,1))return unavailable();
 const changePct=(asset.priceUsd/startPriceUsd-1)*100;
 if(!Number.isFinite(changePct))return unavailable();
 return json({symbol,year,startAt,asOf:current.asOf,source:'CoinGecko',startPriceUsd,priceUsd:asset.priceUsd,changePct,stale:Boolean(current.stale),notice:'USD spot price change since 1 January, 00:00 UTC. Excludes fees and staking; not CIV returns.'});
}
