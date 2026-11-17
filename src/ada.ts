/** ADA is a signed double-entry subledger. Evidence writes are internal, never public balance edits. */
export function johannesburgDay(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}
export function allocateByUnits(totalMinor:number,positions:{userId:string,units:string}[]){
 if(!Number.isSafeInteger(totalMinor))throw new Error('Unsafe allocation total');
 if(!positions.length||new Set(positions.map(x=>x.userId)).size!==positions.length)throw new Error('Distinct invested positions required');
 const rows=positions.map(p=>{if(!p.userId||!/^\d+$/.test(p.units)||BigInt(p.units)<=0n)throw new Error('Positive invested units required');return {...p,weight:BigInt(p.units),amount:0n,remainder:0n}}).sort((a,b)=>a.userId.localeCompare(b.userId));
 const weight=rows.reduce((s,p)=>s+p.weight,0n),sign=totalMinor<0?-1:1,total=BigInt(Math.abs(totalMinor));
 let allocated=0n;
 for(const row of rows){const n=total*row.weight;row.amount=n/weight;row.remainder=n%weight;allocated+=row.amount}
 const order=[...rows].sort((a,b)=>a.remainder===b.remainder?a.userId.localeCompare(b.userId):a.remainder>b.remainder?-1:1);
 for(let i=0;i<Number(total-allocated);i++)order[i].amount++;
 return rows.map(p=>({userId:p.userId,amountMinor:Number(p.amount)*sign}));
}
export async function adaLedger(db:D1Database,userId:string){
 const [balances,entries,closes,withdrawals,promo]=await db.batch([
  db.prepare('SELECT asset,bucket,amount_minor FROM ada_balances WHERE user_id=?').bind(userId),
  db.prepare(`SELECT t.id,t.kind,t.effective_at,p.asset,p.bucket,p.amount_minor FROM ada_postings p JOIN ada_transactions t ON t.id=p.transaction_id WHERE p.user_id=? AND t.status='posted' ORDER BY datetime(t.effective_at) DESC,t.id DESC,p.line_no LIMIT 100`).bind(userId),
  db.prepare(`SELECT c.trading_day,c.asset,c.effective_at,a.realized_minor,a.unrealized_minor FROM ada_daily_closes c JOIN ada_daily_allocations a ON a.close_id=c.id WHERE a.user_id=? AND c.status='posted' ORDER BY c.trading_day DESC LIMIT 30`).bind(userId),
  db.prepare('SELECT id,asset,amount_minor,destination_network,status,requested_at FROM withdrawal_requests WHERE user_id=? ORDER BY requested_at DESC LIMIT 30').bind(userId),
  db.prepare('SELECT amount_minor,status FROM deposit_promotions WHERE user_id=?').bind(userId)
 ]);
 const assets=['USDC','USDT'].map(asset=>{const get=(bucket:string)=>Number((balances.results as any[]).find(r=>r.asset===asset&&r.bucket===bucket)?.amount_minor||0);const principal=get('funding'),realized=get('realized'),unrealized=get('unrealized');return {asset,principalMinor:principal,realizedMinor:realized,unrealizedMinor:unrealized,cashMinor:principal+realized,portfolioValueMinor:principal+realized+unrealized}});
 const timestamps=[(entries.results[0] as any)?.effective_at,(closes.results[0] as any)?.effective_at].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a));
 const day=johannesburgDay();
 const today=(closes.results as any[]).filter(c=>c.trading_day===day);
 return {name:'ADA Ledger',asOf:timestamps[0]||null,refreshedAt:new Date().toISOString(),currency:'STABLECOINS',
  balanceUsdc:assets[0].cashMinor/1e6,balanceUsdt:assets[1].cashMinor/1e6,assets,
  daily:{tradingDay:day,timeZone:'Africa/Johannesburg',status:today.length?'reconciled':'pending',results:today.map(c=>({asset:c.asset,realizedMinor:c.realized_minor,unrealizedMinor:c.unrealized_minor,asOf:c.effective_at}))},
  entries:entries.results.map((e:any)=>({id:e.id,type:e.kind==='funding'?'verified_deposit':e.kind==='performance'?'daily_'+e.bucket:e.kind,amountUsdt:e.amount_minor/1e6,amountMinor:e.amount_minor,asset:e.asset,bucket:e.bucket,at:e.effective_at})),
  promotion:promo.results[0]||null,withdrawalRequests:withdrawals.results,withdrawalsEnabled:false,payoutsEnabled:false,
  valuationPolicy:'Asset-specific posted entries. Unrealised valuations and promotional credits are separate from settled funds.'};
}
export type VerifiedClose={id:string,tradingDay:string,asset:'USDC'|'USDT',realizedMinor:number,unrealizedMinor:number,externalReportId:string,evidenceRef:string,verifiedBy:string,effectiveAt:string,allocations:{userId:string,realizedMinor:number,unrealizedMinor:number}[]};
/** For a trusted reconciliation adapter only; SQL verifies allocation totals and journal balancing. */
export async function publishVerifiedClose(db:D1Database,close:VerifiedClose){
 if(!close.id||!/^\d{4}-\d{2}-\d{2}$/.test(close.tradingDay)||!['USDC','USDT'].includes(close.asset)||!close.externalReportId||!close.evidenceRef||!close.verifiedBy||!Number.isFinite(Date.parse(close.effectiveAt)))throw new Error('Verified close evidence required');
 const calendarDay=new Date(close.tradingDay+'T00:00:00Z');
 if(!Number.isFinite(calendarDay.getTime())||calendarDay.toISOString().slice(0,10)!==close.tradingDay||close.tradingDay>johannesburgDay()||Date.parse(close.effectiveAt)>Date.now())throw new Error('A close cannot precede its actual reporting period');
 if(!close.allocations.length||new Set(close.allocations.map(a=>a.userId)).size!==close.allocations.length)throw new Error('Distinct allocations required');
 const values=[close.realizedMinor,close.unrealizedMinor,...close.allocations.flatMap(a=>[a.realizedMinor,a.unrealizedMinor])];
 if(!values.every(Number.isSafeInteger))throw new Error('Exact integer amounts required');
 if(close.allocations.reduce((n,a)=>n+BigInt(a.realizedMinor),0n)!==BigInt(close.realizedMinor)||close.allocations.reduce((n,a)=>n+BigInt(a.unrealizedMinor),0n)!==BigInt(close.unrealizedMinor))throw new Error('Allocations do not reconcile');
 const canonical=JSON.stringify({id:close.id,tradingDay:close.tradingDay,asset:close.asset,realizedMinor:close.realizedMinor,unrealizedMinor:close.unrealizedMinor,externalReportId:close.externalReportId,evidenceRef:close.evidenceRef,verifiedBy:close.verifiedBy,effectiveAt:close.effectiveAt,allocations:[...close.allocations].sort((a,b)=>a.userId.localeCompare(b.userId)).map(a=>({userId:a.userId,realizedMinor:a.realizedMinor,unrealizedMinor:a.unrealizedMinor}))});
 const payloadHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical))),b=>b.toString(16).padStart(2,'0')).join('');
 const present=await db.prepare('SELECT payload_hash,status FROM ada_daily_closes WHERE id=?').bind(close.id).first<{payload_hash:string,status:string}>();
 if(present){if(present.payload_hash===payloadHash&&present.status==='posted')return {posted:true,replayed:true};throw new Error('Close identity conflict')}
 const writes=[db.prepare('INSERT INTO ada_daily_closes(id,trading_day,asset,realized_minor,unrealized_minor,external_report_id,payload_hash,evidence_ref,verified_by,effective_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(close.id,close.tradingDay,close.asset,close.realizedMinor,close.unrealizedMinor,close.externalReportId,payloadHash,close.evidenceRef,close.verifiedBy,close.effectiveAt),...close.allocations.map(a=>db.prepare('INSERT INTO ada_daily_allocations(close_id,user_id,realized_minor,unrealized_minor) VALUES(?,?,?,?)').bind(close.id,a.userId,a.realizedMinor,a.unrealizedMinor)),db.prepare("UPDATE ada_daily_closes SET status='posted' WHERE id=?").bind(close.id)];
 try{await db.batch(writes)}catch(error){const committed=await db.prepare('SELECT payload_hash,status FROM ada_daily_closes WHERE id=?').bind(close.id).first<{payload_hash:string,status:string}>();if(committed?.status==='posted'&&committed.payload_hash===payloadHash)return {posted:true,replayed:true};throw error}
 return {posted:true,replayed:false};
}
