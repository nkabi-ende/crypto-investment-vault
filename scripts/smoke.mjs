/** Read-only post-deployment checks. Does not create accounts or transfer funds. */
import assert from 'node:assert/strict';
const origin=process.env.CIV_ORIGIN||'https://cryptoinvestmentvault.com';
async function json(path){const r=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,path);return r.json()}
const status=await json('/api/status');assert.equal(status.release,'stablecoin-funding-v4');assert.equal(status.fundingEnabled,false);assert.equal(status.liveTradingEnabled,false);
const ready=await json('/api/ready');assert.equal(ready.ready,true);assert.equal(ready.schema,12);
for(const path of ['/join']){
 const r=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,path);const html=await r.text();assert.ok(html.includes('id="authForm"'));assert.ok(html.includes('id="vaultLoader"'));assert.ok(html.includes('class="site-footer"'));assert.ok(html.includes('/civ-mark.svg'));assert.ok(html.includes('og-invitation-v2.png'));assert.ok(html.includes(`property="og:url" content="${origin}${path}"`));
}
const mark=await fetch(new URL('/civ-mark.svg',origin));assert.equal(mark.status,200);assert.match(mark.headers.get('content-type'),/image\/svg\+xml/);assert.ok((await mark.text()).includes('#b5f269'));
for(const path of ['/legal/terms.html','/legal/privacy.html','/legal/risk.html']){
 const r=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000)});
 assert.equal(r.status,200,path);
 const html=await r.text();
 assert.ok(html.includes('mailto:info@cryptoinvestmentvault.com'),path);
 assert.ok(html.includes('mailto:dev@cryptoinvestmentvault.com'),path);
 assert.doesNotMatch(html, /@gmail[.]com/i,path);
}
const retired=await fetch(new URL('/r/kzn-ai',origin));assert.equal(retired.status,404);await retired.text();
const image=await fetch(new URL('/og-invitation-v2.png',origin));assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);const bytes=new Uint8Array(await image.arrayBuffer());assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
for(const path of ['/api/me','/api/investor/onboarding','/api/investor/ledger']){
 const response=await fetch(new URL(path,origin));assert.equal(response.status,401,path);
}
const payments=await json('/api/payments/config');assert.equal(payments.liveDepositsEnabled,payments.ready&&payments.mode==='production');if(payments.liveDepositsEnabled){assert.equal(payments.chainId,42220);assert.deepEqual(payments.supportedTokens,['USDT','USDC'])}
const celo=await json('/api/celo/config');assert.equal(celo.liveDepositsEnabled,false);assert.equal(celo.livePayoutsEnabled,false);
console.log('CIV production checks passed: schema 12, signup and referral HTML, PNG preview, private API boundaries, disabled live rails.');
