/** Read-only activation model. Payment adapters must verify settlement before writing signup_deposits. */
export async function membership(db:D1Database,userId:string) {
 const [activation,referrals,perks,promo,balances]=await db.batch([
  db.prepare('SELECT required_minor,settled_minor,active FROM member_activation WHERE user_id=?').bind(userId),
  db.prepare(`SELECT COUNT(*) AS registrations,COALESCE(SUM(m.active),0) AS qualified
   FROM referral_attributions a JOIN referral_codes r ON r.code=a.code
   LEFT JOIN member_activation m ON m.user_id=a.user_id WHERE r.user_id=?`).bind(userId),
  db.prepare(`SELECT p.id,p.title,p.description,p.metric,p.threshold,
   CASE WHEN p.metric='activated_members' THEN (SELECT COUNT(*) FROM member_activation WHERE active=1)
   ELSE (SELECT COUNT(*) FROM referral_attributions a JOIN referral_codes r ON r.code=a.code
   JOIN member_activation m ON m.user_id=a.user_id WHERE r.user_id=? AND m.active=1) END AS progress
   FROM member_perks p WHERE p.status='published' ORDER BY p.threshold,p.id`).bind(userId),
  db.prepare('SELECT amount_minor,status FROM deposit_promotions WHERE user_id=?').bind(userId),
  db.prepare('SELECT asset,SUM(amount_minor-refunded_minor) AS amount_minor FROM funding_receipts WHERE user_id=? GROUP BY asset').bind(userId)
 ]);
 const a=activation.results[0] as {required_minor:number,settled_minor:number,active:number}|undefined;
 const required=a?.required_minor??100000000,settled=a?.settled_minor??0,active=a?.active===1;
 const counts=referrals.results[0] as {registrations:number,qualified:number};
 return {
  deposit:{currency:'USDC_OR_USDT',requiredMinor:required,settledMinor:settled,remainingMinor:Math.max(0,required-settled),
   status:active?'settled':settled>0?'partially_paid':'awaiting_payment',collectionEnabled:false},
  activated:active,
  balances:balances.results.map((x:any)=>({asset:x.asset,amountMinor:x.amount_minor})),
  promotion:promo.results.length?{currency:'ZAR',amountMinor:50000,status:active?(promo.results[0] as {status:string}).status:'ineligible',withdrawable:false}:{currency:'ZAR',amountMinor:50000,status:'requires_deposit',withdrawable:false},
  referral:{registrations:counts.registrations,qualified:counts.qualified,pending:counts.registrations-counts.qualified},
  perks:perks.results.map((p:any)=>({id:p.id,title:p.title,description:p.description,metric:p.metric,
   threshold:p.threshold,progress:p.progress,status:active&&p.progress>=p.threshold?'unlocked':'locked'}))
 };
}
