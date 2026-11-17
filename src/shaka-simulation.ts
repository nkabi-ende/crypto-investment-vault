import { johannesburgDay } from './ada';
import { bigSevenSymbols } from './market-prices';

const scenarios = [
 { id:'rising', label:'Rising market', rates:[35,60,-20,95,45,-15,80] },
 { id:'mixed', label:'Mixed market', rates:[25,-40,15,-30,55,-20,5] },
 { id:'falling', label:'Falling market', rates:[-90,-35,20,-65,-40,15,-75] },
 { id:'stress', label:'Extreme stress test', rates:[-7500,7500,-1500,2000,0,-500,500] },
 { id:'flat', label:'Flat market', rates:[0] }
];
const termDays = 365;
export const simulationTomorrow = (now=new Date()) => johannesburgDay(new Date(now.getTime()+86400000));

export async function closeShakaSimulation(db:D1Database, now:Date) {
 // One statement selects the schedule and publishes a contiguous batch of completed days.
 return db.prepare(`
  WITH RECURSIVE days(day,n) AS (
   SELECT COALESCE(date(MAX(trading_day),'+1 day'),(SELECT MIN(starts_on) FROM shaka_sim_schedules)),1
   FROM shaka_sim_closes
   UNION ALL
   SELECT date(day,'+1 day'),n+1 FROM days WHERE n<31 AND date(day,'+1 day')<?
  ), selected(day,schedule_id) AS (
   SELECT day,(SELECT id FROM shaka_sim_schedules WHERE starts_on<=day ORDER BY starts_on DESC,id DESC LIMIT 1)
   FROM days WHERE day<?
  )
  INSERT INTO shaka_sim_closes(trading_day,schedule_id,rate_bps)
  SELECT day,s.id,CAST(s.rates_json ->> (
   CAST(julianday(day)-julianday(s.starts_on) AS INTEGER)%json_array_length(s.rates_json)
  ) AS INTEGER)
  FROM selected JOIN shaka_sim_schedules s ON s.id=schedule_id WHERE 1
  ON CONFLICT(trading_day) DO NOTHING`).bind(johannesburgDay(now),johannesburgDay(now)).run();
}

export async function scheduleSimulation(db:D1Database, adminId:string, scenarioId:unknown, now=new Date()) {
 const scenario = scenarios.find(s=>s.id===scenarioId);
 if (!scenario) return null;
 const startsOn = simulationTomorrow(now);
 await db.prepare('INSERT INTO shaka_sim_schedules(scenario,rates_json,starts_on,created_by) VALUES(?,?,?,?)')
  .bind(scenario.id,JSON.stringify(scenario.rates),startsOn,adminId).run();
 return { scenario:scenario.id, startsOn };
}

export async function verifySimulationMember(db:D1Database, adminId:string, userId:string) {
 await db.prepare(`INSERT INTO shaka_sim_members(user_id,verified_by,starts_on)
  SELECT id,?,? FROM users WHERE id=? ON CONFLICT(user_id) DO NOTHING`)
  .bind(adminId,simulationTomorrow(),userId).run();
 return db.prepare('SELECT starts_on AS startsOn FROM shaka_sim_members WHERE user_id=?')
  .bind(userId).first<{startsOn:string}>();
}

export async function simulationAdmin(db:D1Database) {
 const [schedules,latest,activations] = await Promise.all([
  db.prepare('SELECT scenario,starts_on AS startsOn,created_at AS createdAt,created_by AS createdBy FROM shaka_sim_schedules ORDER BY id DESC LIMIT 10').all(),
  db.prepare('SELECT MAX(trading_day) AS tradingDay FROM shaka_sim_closes').first<{tradingDay:string|null}>(),
  db.prepare('SELECT user_id AS userId,activated_at AS activatedAt,starts_on AS startsOn FROM shaka_sim_activations ORDER BY activated_at DESC,user_id LIMIT 30').all()
 ]);
 return { mode:'simulation', scenarios, schedules:schedules.results, lastClose:latest?.tradingDay ?? null, activations:activations.results };
}

export async function simulationLedger(db:D1Database, userId:string) {
 const member = await db.prepare(`SELECT a.starts_on,r.amount_minor,r.asset,p.amount_minor AS bonus_minor,
  CASE WHEN v.active=1 THEN p.status ELSE 'ineligible' END AS bonus_status FROM shaka_sim_members m
  LEFT JOIN shaka_sim_activations a ON a.user_id=m.user_id
  LEFT JOIN funding_receipts r ON r.id=a.receipt_id AND r.user_id=m.user_id
  LEFT JOIN deposit_promotions p ON p.user_id=m.user_id
  LEFT JOIN member_activation v ON v.user_id=m.user_id
  WHERE m.user_id=?`).bind(userId).first<{
   starts_on:string|null,amount_minor:number|null,asset:string|null,bonus_minor:number|null,bonus_status:string|null
  }>();
 const common = { mode:'simulation', currency:'USD', withdrawable:false, basket:bigSevenSymbols, timeZone:'Africa/Johannesburg' };
 if (!member) return { ...common, status:'verification_required' };
 if (!member.starts_on || member.amount_minor===null) return { ...common, status:'deposit_required' };
 // The activating receipt stores the selected tier in six-decimal units.
 const startingCents = BigInt(member.amount_minor)/10000n;

 const {results} = await db.prepare(`
  SELECT c.trading_day AS tradingDay,c.rate_bps AS rateBps,s.scenario
  FROM shaka_sim_closes c JOIN shaka_sim_schedules s ON c.schedule_id=s.id
  WHERE c.trading_day>=? ORDER BY c.trading_day LIMIT ?`)
  .bind(member.starts_on,termDays).all<{tradingDay:string,rateBps:number,scenario:string}>();

 let balance = startingCents;
 const journal = results.map(row=>{
  const opening = balance;
  balance = opening * BigInt(10000+row.rateBps) / 10000n;
  return { ...row, openingCents:opening.toString(), changeCents:(balance-opening).toString(), closingCents:balance.toString() };
 });
 return { ...common, status:journal.length===termDays?'complete':journal.length?'active':'pending',
  startsOn:member.starts_on, startingCents:Number(startingCents), balanceCents:balance.toString(), termDays,
  confirmedDeposit:{ amountMinor:member.amount_minor, asset:member.asset },
  bonus:member.bonus_minor!==null?{ amountMinor:member.bonus_minor, status:member.bonus_status }:null,
  latest:journal.at(-1) ?? null, entries:journal.slice(-30).reverse() };
}
