/** Read-only post-deployment checks. Does not create accounts or transfer funds. */
import assert from 'node:assert/strict';
const origin=process.env.CIV_ORIGIN||'https://cryptoinvestmentvault.com';
async function json(path){const r=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,path);return r.json()}
const status=await json('/api/status');assert.equal(status.release,'onboarding-v1');assert.equal(status.fundingEnabled,false);assert.equal(status.liveTradingEnabled,false);
const ready=await json('/api/ready');assert.equal(ready.ready,true);assert.equal(ready.schema,8);
for(const path of ['/join','/r/kzn-ai']){
 const r=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,path);const html=await r.text();assert.ok(html.includes('id="authForm"'));assert.ok(html.includes('og-invitation-v1.png'));assert.ok(html.includes(`property="og:url" content="${origin}${path}"`));
}
const image=await fetch(new URL('/og-invitation-v1.png',origin));assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);const bytes=new Uint8Array(await image.arrayBuffer());assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
for(const path of ['/api/me','/api/investor/onboarding','/api/investor/ledger']){
 const response=await fetch(new URL(path,origin));assert.equal(response.status,401,path);
}
const celo=await json('/api/celo/config');assert.equal(celo.liveDepositsEnabled,false);assert.equal(celo.livePayoutsEnabled,false);
console.log('CIV production checks passed: schema 8, signup and referral HTML, PNG preview, private API boundaries, disabled live rails.');
