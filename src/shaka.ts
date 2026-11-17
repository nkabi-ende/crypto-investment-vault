/** Reference signal implementation. Venue execution and measured returns are separate integrations. */
export type Candle={at:number,open:number,high:number,low:number,close:number,volume:number,closed:boolean};
export type ShakaConfig={atrPeriod:number,volumePeriod:number,zonePeriod:number,pressurePeriod:number,minRelativeVolume:number,minVolatilityPct:number,maxVolatilityPct:number,zoneWidthAtr:number,stopAtr:number,rewardRisk:number,maxAgeMs:number};
export const shakaConfig:ShakaConfig={atrPeriod:14,volumePeriod:20,zonePeriod:40,pressurePeriod:5,minRelativeVolume:1.5,minVolatilityPct:0.1,maxVolatilityPct:10,zoneWidthAtr:0.5,stopAtr:2,rewardRisk:2,maxAgeMs:120000};
export function validateConfig(c:ShakaConfig){
 if(![c.atrPeriod,c.volumePeriod,c.zonePeriod,c.pressurePeriod].every(n=>Number.isInteger(n)&&n>=2&&n<=500)||![c.minRelativeVolume,c.minVolatilityPct,c.maxVolatilityPct,c.zoneWidthAtr,c.stopAtr,c.rewardRisk,c.maxAgeMs].every(n=>Number.isFinite(n)&&n>0)||c.maxVolatilityPct<=c.minVolatilityPct)throw new Error('Invalid strategy configuration');
}
export function analyzeShaka(bars:Candle[],config=shakaConfig,now=Date.now()){
 validateConfig(config);
 if(bars.length>1000||bars.length<Math.max(config.atrPeriod+1,config.volumePeriod+1,config.zonePeriod+1,config.pressurePeriod+1))throw new Error('Insufficient closed-candle history');
 let previous=0;
 for(const b of bars){if(!b.closed||![b.at,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.at<=previous||b.at>now||b.low<=0||b.high<b.low||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.volume<0)throw new Error('Invalid or unclosed market data');previous=b.at}
 const last=bars.at(-1)!;
 if(now-last.at>config.maxAgeMs)return {action:'wait' as const,reason:'stale_market_data',orderSubmitted:false};
 const tr=bars.map((b,i)=>Math.max(b.high-b.low,i?Math.abs(b.high-bars[i-1].close):0,i?Math.abs(b.low-bars[i-1].close):0));
 let atr=tr.slice(0,config.atrPeriod).reduce((a,b)=>a+b,0)/config.atrPeriod;
 for(let i=config.atrPeriod;i<tr.length;i++)atr=(atr*(config.atrPeriod-1)+tr[i])/config.atrPeriod;
 const prior=bars.slice(-config.volumePeriod-1,-1),averageVolume=prior.reduce((s,b)=>s+b.volume,0)/prior.length;
 const relativeVolume=averageVolume>0?last.volume/averageVolume:0;
 const volatilityIndexPct=100*atr/last.close;
 const flow=(b:Candle)=>b.high===b.low?0:((2*b.close-b.high-b.low)/(b.high-b.low))*b.volume;
 if(!Number.isFinite(atr)||!Number.isFinite(relativeVolume)||!Number.isFinite(volatilityIndexPct))throw new Error('Non-finite market indicators');
 const pressure=bars.slice(-config.pressurePeriod).reduce((n,b)=>n+flow(b),0);
 const history=bars.slice(-config.zonePeriod-1,-1),support=Math.min(...history.map(b=>b.low)),resistance=Math.max(...history.map(b=>b.high));
 const width=atr*config.zoneWidthAtr;
 const indicators={atr,volatilityIndexPct,relativeVolume,accumulationDistribution:bars.reduce((n,b)=>n+flow(b),0),pressure,
  accumulationZone:{low:Math.max(0,support-width),high:support+width},distributionZone:{low:resistance-width,high:resistance+width}};
 if(atr<=0||relativeVolume<config.minRelativeVolume||volatilityIndexPct<config.minVolatilityPct||volatilityIndexPct>config.maxVolatilityPct)return {action:'wait' as const,reason:'entry_filters_not_met',indicators,orderSubmitted:false};
 const long=last.close>=indicators.accumulationZone.low&&last.close<=indicators.accumulationZone.high&&pressure>0&&last.close>last.open;
 const short=last.close>=indicators.distributionZone.low&&last.close<=indicators.distributionZone.high&&pressure<0&&last.close<last.open;
 if(!long&&!short)return {action:'wait' as const,reason:'no_confirmed_zone',indicators,orderSubmitted:false};
 const risk=atr*config.stopAtr,stop=long?last.close-risk:last.close+risk,target=long?last.close+risk*config.rewardRisk:last.close-risk*config.rewardRisk;
 if(!Number.isFinite(stop)||!Number.isFinite(target)||stop<=0||target<=0)return {action:'wait' as const,reason:'invalid_risk_distance',indicators,orderSubmitted:false};
 return {action:long?'long_candidate' as const:'short_candidate' as const,reason:'zone_volume_volatility_confluence',entryReference:last.close,stopReference:stop,targetReference:target,indicators,orderSubmitted:false};
}
export function trailingStop(side:'long'|'short',previousStop:number,watermark:number,atr:number,multiple:number){
 if(!['long','short'].includes(side)||![previousStop,watermark,atr,multiple].every(x=>Number.isFinite(x)&&x>0))throw new Error('Invalid trailing stop input');
 return side==='long'?Math.max(previousStop,watermark-atr*multiple):Math.min(previousStop,watermark+atr*multiple);
}
export function shakaMethodology(){return {
 name:'Shaka',strategy:'Volatility and volume confluence',version:'shaka-big-seven-v1',executionStatus:'not_connected',
 description:'Shaka maps accumulation and distribution candidate zones, then checks asset-specific volatility and relative volume before producing an entry candidate. Volatility-adjusted stops and one-way trailing stops define the exit logic.',
 stages:[{title:'Map the zones',detail:'Use prior price structure and accumulation/distribution volume pressure to identify candidate support and resistance zones.'},{title:'Confirm participation',detail:'Compare closed-candle volume with its recent baseline. Require the configured relative-volume threshold.'},{title:'Filter volatility',detail:'Use an ATR-based, asset-specific volatility index to filter unsuitable market conditions and size stop distances.'},{title:'Manage the exit',detail:'Apply an initial risk distance and a trailing stop that tightens with favourable movement without widening the original stop.'}],
 executionDesign:'Bounded indicator calculations and event-driven venue adapters; actual latency depends on data feeds, networks and the execution venue.',
 indicators:['Accumulation/Distribution pressure','Relative volume','ATR-based volatility index','Price-structure zones'],
 riskObjective:'Defined risk per position and selective entries seeking favourable reward relative to risk. Stops can slip or fail to fill at the requested price.',
 performance:{netReturn:null,maxDrawdown:null,latencyP50Ms:null,latencyP95Ms:null},
 parameterStatus:'Reference configuration; no optimised parameters, live order execution or performance record are claimed.',
 ledger:'ADA records only reconciled funding and actual performance evidence.'
};}
