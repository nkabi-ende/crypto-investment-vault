/** Read-only post-deployment checks. Does not create accounts or transfer funds. */
import assert from 'node:assert/strict';
const origin=process.env.CIV_ORIGIN||'https://cryptoinvestmentvault.com';
async function json(path){const r=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,path);return r.json()}
const status=await json('/api/status');assert.equal(status.release,'stablecoin-funding-v4');assert.equal(status.fundingEnabled,false);assert.equal(status.liveTradingEnabled,false);assert.equal(status.membershipDepositsEnabled,false);assert.equal(status.pilotOnly,true);
const ready=await json('/api/ready');assert.equal(ready.ready,true);assert.equal(ready.schema,20);
for(const path of ['/join']){
 const r=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,path);const html=await r.text();assert.ok(html.includes('id="authForm"'));assert.ok(html.includes('id="vaultLoader"'));assert.ok(html.includes('class="site-footer"'));assert.ok(html.includes('/civ-mark.svg'));assert.ok(html.includes('og-invitation-v3.png'));assert.ok(html.includes('Choose a $100 or $200 account'));assert.doesNotMatch(html.split('</head>')[0],/R1,000/);assert.ok(html.includes('id="shaka-strategy"'));assert.ok(html.includes('id="circle-leaderboard"'));assert.doesNotMatch(html,/id="asset-guide"|href="#asset-guide"/);
 assert.ok(html.includes('id="minipay-start"'),'MiniPay education must be present on signup entry');
 assert.ok(html.includes('No wallet or deposit required to sign up'),'Signup should not gate users behind a wallet');
 assert.ok(html.includes('id="openMiniPaySetup"'),'Deposit page must expose a self-service wallet setup guide');
 assert.ok(html.includes('com.opera.minipay'),'Official Android MiniPay store link must exist');
 assert.ok(html.includes('id6504087257'),'Official MiniPay iPhone store link must exist');
 assert.ok(html.includes('Check deposit availability in your dashboard.')&&html.includes('Deposits are not available for this account.'),'Do not imply customer deposits are open');assert.ok(html.includes(`property="og:url" content="${origin}${path}"`));
}
const board=await json('/api/affiliates/leaderboard?period=month');assert.ok(Array.isArray(board.rows));assert.equal(board.timeZone,'Africa/Johannesburg');for(const row of board.rows)assert.deepEqual(Object.keys(row).sort(),['alias','capitalIntroducedBand','qualifiedReferrals','rank','tier']);
const strategy=await json('/api/strategy/shaka');assert.equal(strategy.name,'Shaka');assert.ok(strategy.indicators.includes('Relative volume'));
const circleCss=await fetch(new URL('/civ-circle.css',origin));assert.equal(circleCss.status,200);assert.ok((await circleCss.text()).includes('--circle-accent:var(--civ-accent,#b5f269)'));
const circleScript=await fetch(new URL('/civ-circle.js',origin));assert.equal(circleScript.status,200);assert.ok((await circleScript.text()).includes('/api/investor/affiliates'));
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
for(const asset of ['btc','eth','sol','xrp','bnb','ada','doge']){
 const r=await fetch(new URL('/assets/coins/'+asset+'.svg',origin),{signal:AbortSignal.timeout(15000)});
 assert.equal(r.status,200,'Missing verified coin artwork: '+asset);
 assert.ok(String(r.headers.get('content-type')).startsWith('image/svg+xml'));
}
const watch=await fetch(new URL('/market-watch.js',origin));assert.equal(watch.status,200);const watchJs=await watch.text();assert.match(watchJs,/quote/);assert.match(watchJs,/marketWatchStatus/);
const experience=await fetch(new URL('/experience.js',origin));assert.equal(experience.status,200);assert.match(await experience.text(),/civ:deposit-verified/);
const image=await fetch(new URL('/og-invitation-v3.png',origin));assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);const bytes=new Uint8Array(await image.arrayBuffer());assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
for(const path of ['/api/me','/api/investor/onboarding','/api/investor/ledger']){
 const response=await fetch(new URL(path,origin));assert.equal(response.status,401,path);
}
const prices=await fetch(new URL('/api/markets',origin));const priceData=await prices.json();
assert.ok(prices.status===200||prices.status===503);
if(prices.status===200){
 assert.equal(priceData.assets.length,7);
 assert.equal(priceData.source,'CoinGecko');
 assert.ok(priceData.assets.every(a=>Number.isFinite(a.priceUsd)&&a.priceUsd>0));
}else{
 assert.ok(['PROVIDER_NOT_CONFIGURED','MARKET_REFRESHING','MARKET_RETRY_LATER','PROVIDER_RATE_LIMITED','PROVIDER_AUTH_FAILED','MARKET_DATA_UNAVAILABLE'].includes(priceData.code));
}
const payments=await json('/api/payments/config');
assert.equal(payments.mode,'production');
assert.equal(payments.pilotOnly,true);
assert.equal(payments.ready,false,'Anonymous members must never see pilot checkout enabled');
assert.equal(payments.liveDepositsEnabled,false,'Anonymous members must never collect deposits');
assert.equal(payments.chainId,42220);
assert.deepEqual(payments.supportedTokens,['USDT','USDC']);
assert.deepEqual(payments.depositPresets,[100,200]);
assert.equal(ready.liveDepositsEnabled,false);
const preflight=await fetch(new URL('/api/payments/preflight',origin));assert.equal(preflight.status,401,'Mainnet diagnostics must be private');
const anonymousQuote=await fetch(new URL('/api/payments/quotes',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:'USDC',amount:100,sender:'0x'+'1'.repeat(40)})});assert.equal(anonymousQuote.status,401,'Anonymous users cannot create mainnet quotes');
const celo=await json('/api/celo/config');assert.equal(celo.liveDepositsEnabled,false);assert.equal(celo.livePayoutsEnabled,false);
console.log('CIV production checks passed: schema 20, signup and referral HTML, PNG preview, private API boundaries, pilot-only production deposits, public collection disabled, trading and withdrawals off.');
