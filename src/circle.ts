export const circleVersion='circle-2026-11-17';
export const circleRates={circle:{100:20000,200:30000},gold:{100:22500,200:35000},platinum:{100:25000,200:40000}} as const;
type Tier=keyof typeof circleRates;
export function tierFor(count:number):Tier{return count>=15?'platinum':count>=5?'gold':'circle'}
export function capitalBand(count:number,units:number){
 if(count<5)return 'Building circle';
 if(units<1000)return 'Under 1,000 units';
 if(units<2500)return '1,000–2,499 units';
 if(units<5000)return '2,500–4,999 units';
 if(units<10000)return '5,000–9,999 units';
 return '10,000+ units';
}
export async function affiliateSummary(db:D1Database,userId:string){
 const [profile,tier,items,legacy,capital]=await db.batch([
  db.prepare('SELECT public_alias,joined_at FROM affiliate_profiles WHERE user_id=?').bind(userId),
  db.prepare('SELECT qualified_90d,tier FROM circle_tiers WHERE user_id=?').bind(userId),
  db.prepare('SELECT receipt_id,amount_minor,tier,account_usd,version,status,created_at,eligible_at,paid_at,review_reason FROM circle_wallet WHERE user_id=? ORDER BY created_at DESC,receipt_id LIMIT 100').bind(userId),
  db.prepare('SELECT amount_minor,status,created_at FROM referral_wallet WHERE user_id=? ORDER BY created_at DESC').bind(userId),
  db.prepare('SELECT asset,SUM(introduced_minor) AS amount_minor FROM circle_qualified_customers WHERE user_id=? GROUP BY asset').bind(userId)
 ]);
 const t=tier.results[0] as {qualified_90d:number,tier:Tier}|undefined;
 const current=t?.tier||'circle',qualified=t?.qualified_90d||0,next=current==='circle'?5:current==='gold'?15:null;
 // Aggregate all rewards, not just the last 100 visible activity rows.
 const totals=await db.prepare('SELECT status,SUM(amount_minor) AS amount_minor FROM circle_wallet WHERE user_id=? GROUP BY status').bind(userId).all<{status:string,amount_minor:number}>();
 const amounts:Record<string,number>={pending:0,approved:0,paid:0,review:0,suspended:0,void:0};
 for(const row of totals.results)amounts[row.status]=Number(row.amount_minor);
 const historical={credited:0,suspended:0};
 for(const row of legacy.results as any[])historical[row.status as keyof typeof historical]+=Number(row.amount_minor);
 return {version:circleVersion,publication:'automatic_public_alias',profile:profile.results[0]||null,tier:current,
  qualified90d:qualified,nextTier:next===5?'gold':next===15?'platinum':null,nextThreshold:next,remaining:next===null?0:Math.max(0,next-qualified),
  rates:circleRates[current],tiers:circleRates,validationDays:30,payoutSchedule:'Monthly after validation and settlement approval',
  currency:'ZAR',amounts,legacy:historical,withdrawable:false,
  capitalIntroduced:capital.results.map((r:any)=>({asset:r.asset,amountMinor:Number(r.amount_minor)})),
  rewards:items.results.map((r:any)=>({reference:r.receipt_id,amountMinor:r.amount_minor,accountUsd:r.account_usd,tier:r.tier,version:r.version,status:r.status,createdAt:r.created_at,eligibleAt:r.eligible_at,paidAt:r.paid_at,reviewReason:r.review_reason})),
  customerBonusMinor:50000,accountOptionsUsd:[100,200]};
}
export async function leaderboard(db:D1Database,period:'month'|'all'|'newcomers'){
 const result=await db.prepare(`SELECT p.public_alias,t.tier,COUNT(q.referred_user_id) AS qualified,
 COALESCE(SUM(q.introduced_minor),0) AS introduced_minor
 FROM affiliate_profiles p JOIN circle_tiers t ON t.user_id=p.user_id
 LEFT JOIN circle_qualified_customers q ON q.user_id=p.user_id
 AND (?<>'month' OR datetime(q.qualified_at)>=datetime('now','start of month'))
 WHERE (?<>'newcomers' OR datetime(p.joined_at)>=datetime('now','-30 days'))
 GROUP BY p.user_id ORDER BY qualified DESC,p.public_alias LIMIT 50`).bind(period,period).all<{public_alias:string,tier:Tier,qualified:number,introduced_minor:number}>();
 let previous=-1,rank=0;
 const rows=result.results.map((r,i)=>{if(r.qualified!==previous){rank=i+1;previous=r.qualified}return {rank,alias:r.public_alias,tier:r.tier,qualifiedReferrals:Number(r.qualified),capitalIntroducedBand:capitalBand(r.qualified,r.introduced_minor/1e6)}});
 return {period,asOf:new Date().toISOString(),rankingMetric:'Qualified direct referrals',capitalLabel:'Capital introduced',capitalBasis:'First eligible USDC/USDT deposits, net of refunds, in nominal token units. Excludes bonuses, gains and repeat deposits.',rows};
}
