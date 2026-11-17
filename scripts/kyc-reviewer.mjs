/** Run only as an authorised operator using the existing Cloudflare CLI connection. */
import {spawnSync} from 'node:child_process';
const [action,userId]=process.argv.slice(2);
if(!['grant','revoke'].includes(action)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId||'')){console.error('Usage: node scripts/kyc-reviewer.mjs grant|revoke ACCOUNT_UUID');process.exit(1)}
const sql=action==='grant'?`INSERT INTO kyc_reviewers(user_id,granted_by) SELECT id,'authorised Cloudflare operator' FROM users WHERE id='${userId}' ON CONFLICT(user_id) DO UPDATE SET enabled=1,granted_by=excluded.granted_by; SELECT user_id,enabled FROM kyc_reviewers WHERE user_id='${userId}';`:`UPDATE kyc_reviewers SET enabled=0 WHERE user_id='${userId}'; SELECT user_id,enabled FROM kyc_reviewers WHERE user_id='${userId}';`;
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','civ-db','--remote','--command',sql],{stdio:'inherit'});process.exit(result.status??1);
