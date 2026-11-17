/** Run only as an authorised operator using the existing Cloudflare CLI connection. */
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function reviewerSql(action,userId,actor='authorised Cloudflare operator'){
 if(!['grant','revoke'].includes(action)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId||''))throw new Error('Usage: node scripts/kyc-reviewer.mjs grant|revoke ACCOUNT_UUID');
 const enabled=action==='grant'?1:0;
 const label=String(actor).slice(0,150).replace(/'/g,"''");
 return `INSERT INTO kyc_reviewers(user_id,enabled,granted_by) SELECT id,${enabled},'${label}' FROM users WHERE id='${userId}' ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,granted_by=excluded.granted_by;
INSERT INTO audit_events(id,user_id,event_type,detail) SELECT lower(hex(randomblob(16))),id,'kyc_reviewer_${action}','${label}' FROM users WHERE id='${userId}';
SELECT user_id,enabled FROM kyc_reviewers WHERE user_id='${userId}';`;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [action,userId]=process.argv.slice(2);
  const actor=process.env.GITHUB_ACTOR?'GitHub Actions: '+process.env.GITHUB_ACTOR:'authorised Cloudflare operator';
  const sql=reviewerSql(action,userId,actor);
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','civ-db','--remote','--json','--command',sql],{encoding:'utf8',maxBuffer:1024*1024});
  if(result.status!==0)throw new Error('Cloudflare rejected the access update. Check the workflow credentials and D1 permissions.');
  const statements=JSON.parse(result.stdout),row=statements.at(-1)?.results?.[0];
  if(!row||row.user_id.toLowerCase()!==userId.toLowerCase()||row.enabled!==(action==='grant'?1:0))throw new Error('No matching existing account was updated. Use the account UUID from My profile, not the invitation code.');
  console.log('Reviewer access '+(action==='grant'?'granted':'revoked')+' for the selected existing account.');
 }catch(error){console.error(error.message);process.exitCode=1}
}
