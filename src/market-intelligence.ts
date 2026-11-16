/** Source-attributed, read-only market intelligence. Never used to price or settle deposits. */
type IntelligenceEnv={COINGECKO_DEMO_API_KEY?:string;CRYPTOPANIC_API_TOKEN?:string};
const headers={'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=300','x-content-type-options':'nosniff'};
const finite=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
async function jsonFrom(url:string,headers:Record<string,string>,ms=8000):Promise<any>{
 const r=await fetch(url,{headers:{accept:'application/json',...headers},signal:AbortSignal.timeout(ms)});
 if(!r.ok)throw Error('Provider unavailable');
 return r.json();
}
async function cached(request:Request,ctx:ExecutionContext,ttl:number,load:()=>Promise<object>):Promise<Response>{
 const cache=caches.default,key=new Request(request.url,{method:'GET'});
 const prior=await cache.match(key);
 if(prior)return prior;
 const payload=await load();
 const response=new Response(JSON.stringify(payload),{headers:{...headers,'cache-control':'public, max-age='+ttl}});
 ctx.waitUntil(cache.put(key,response.clone()));
 return response;
}
export async function marketPulse(env:IntelligenceEnv,request:Request,ctx:ExecutionContext):Promise<Response>{
 if(!env.COINGECKO_DEMO_API_KEY)return Response.json({error:'Market pulse awaits CoinGecko API configuration',code:'PROVIDER_NOT_CONFIGURED'},{status:503});
 try{
  return await cached(request,ctx,300,async()=>{
   const key={'x-cg-demo-api-key':env.COINGECKO_DEMO_API_KEY!};
   const [global,trending]=await Promise.all([
    jsonFrom('https://api.coingecko.com/api/v3/global',key),
    jsonFrom('https://api.coingecko.com/api/v3/search/trending',key)
   ]);
   const d=global?.data;
   if(!d||!Array.isArray(trending?.coins))throw Error('Invalid market data');
   return {source:'CoinGecko',asOf:new Date().toISOString(),
    global:{marketCapUsd:finite(d.total_market_cap?.usd),volume24hUsd:finite(d.total_volume?.usd),
      btcDominancePct:finite(d.market_cap_percentage?.btc),marketCapChange24hPct:finite(d.market_cap_change_percentage_24h_usd),
      activeCryptocurrencies:finite(d.active_cryptocurrencies)},
    trending:trending.coins.slice(0,6).map((entry:any)=>entry?.item).filter((item:any)=>item&&typeof item.id==='string'&&/^[a-z0-9-]+$/.test(item.id)).map((item:any)=>({
      id:item.id,name:String(item.name||item.symbol||'Asset').slice(0,64),
      symbol:String(item.symbol||'').toUpperCase().slice(0,12),rank:finite(item.market_cap_rank),
      change24hPct:finite(item.data?.price_change_percentage_24h?.usd),
      url:'https://www.coingecko.com/en/coins/'+item.id
    })),notice:'Independent market reference information, not CIV trading performance or investment advice.'};
  });
 }catch{console.error('CIV market intelligence unavailable');return Response.json({error:'CoinGecko market pulse is temporarily unavailable',code:'MARKET_PULSE_UNAVAILABLE'},{status:503})}
}
export async function cryptoHeadlines(env:IntelligenceEnv,request:Request,ctx:ExecutionContext):Promise<Response>{
 if(!env.CRYPTOPANIC_API_TOKEN)return Response.json({error:'News feed awaits provider activation',code:'NEWS_NOT_CONFIGURED'},{status:503});
 try{
  return await cached(request,ctx,900,async()=>{
   const url=new URL('https://cryptopanic.com/api/developer/v2/posts/');
   url.searchParams.set('auth_token',env.CRYPTOPANIC_API_TOKEN!);
   url.searchParams.set('public','true');
   url.searchParams.set('kind','news');
   url.searchParams.set('regions','en');
   const data=await jsonFrom(url.href,{},9000);
   if(!Array.isArray(data?.results))throw Error('Invalid news feed');
   const articles=data.results.slice(0,20).map((x:any)=>{
    try{
     const link=new URL(x?.original_url||'');
     if(link.protocol!=='https:')return null;
     const title=String(x?.title||'').trim().slice(0,180);
     if(!title)return null;
     return {title,url:link.href,source:String(x?.source?.title||link.hostname).slice(0,60),
      publishedAt:typeof x?.published_at==='string'?x.published_at:null,
      summary:typeof x?.description==='string'?x.description.replace(/<[^>]+>/g,'').slice(0,200):null};
    }catch{return null}
   }).filter(Boolean).slice(0,6);
   return {source:'CryptoPanic / original publishers',asOf:new Date().toISOString(),articles,
    notice:'External headlines link to their original publishers. CIV does not endorse article content.'};
  });
 }catch{console.error('CIV headline provider unavailable');return Response.json({error:'Crypto headlines temporarily unavailable',code:'NEWS_UNAVAILABLE'},{status:503})}
}
