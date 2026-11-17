/** Isolated mobile UI checks. Fixtures never contact a wallet, provider or production API. */
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const securityModule=await build({entryPoints:['src/security.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {contentSecurityPolicy}=await import('data:text/javascript;base64,'+Buffer.from(securityModule.outputFiles[0].text).toString('base64'));
const adminModule=await build({entryPoints:['src/admin-page.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {adminPage}=await import('data:text/javascript;base64,'+Buffer.from(adminModule.outputFiles[0].text).toString('base64'));
const cspNonce='civ-ui-security-fixture';
const html=await readFile('public/index.html','utf8');
assert.doesNotMatch(html,/id="asset-guide"|href="#asset-guide"/,'Retired crypto explainer and navigation must be removed');
assert.equal(html.split('<script').length-1,html.split('</script>').length-1,'Scripts must have matching closing tags');
assert.equal(html.split('async function refreshSignupPayments(').length-1,1,'Only one payment refresh handler may exist');
assert.equal(html.split("$('#signupQuote').onclick=async()=>").length-1,1,'Only one checkout click handler may exist');
let lastQuoteBody;
let fixtureKycState="not_started",fixtureKycDocuments=[];
const id='00000000-0000-4000-8000-000000000001';
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',path.startsWith('/api/')?'application/json':'text/html');
 const reply=d=>res.end(JSON.stringify(d));
 if(path==='/admin'){res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");return res.end(adminPage(true,false))}
 if(path==='/shaka-simulation.js'){res.setHeader('Content-Type','application/javascript');return res.end(await readFile('public'+path))}
 if(/^\/(civ-mark|favicon)\.svg$/.test(path)||/^\/assets\/coins\/(btc|eth|sol|xrp|bnb|ada|doge)\.svg$/.test(path)){res.setHeader('Content-Type','image/svg+xml');return res.end(await readFile('public'+path))}if(path==='/experience.js'||path==='/market-watch.js'||path==='/asset-explorer.js'||path==='/civ-circle.js'||path==='/homepage-updates.js'||path==='/member-experience.js'||path==='/fund-scenarios.js'||path==='/session-guard.js'){res.setHeader('Content-Type','application/javascript');return res.end(await readFile('public'+path))}if(path==='/admin.css'||path==='/asset-explorer.css'||path==='/civ-circle.css'||path==='/homepage.css'||path==='/member-experience.css'||path==='/fund-scenarios.css'){res.setHeader('Content-Type','text/css');return res.end(await readFile('public'+path))}if(!path.startsWith('/api/')){if(req.headers['x-ui-csp']==='1'){res.setHeader('Content-Security-Policy',contentSecurityPolicy(cspNonce,true));return res.end(html.replace(/<script\b/g,'<script nonce=\"'+cspNonce+'\"'))}return res.end(html)}
 const kycPayload=()=>{const status=req.headers['x-ui-kyc']==='flow'?fixtureKycState:req.headers['x-ui-kyc']==='approved'?'approved':'not_started';return {status,verified:status==='approved',revision:status==='not_started'?0:1,submissionId:status==='not_started'?null:'11111111-1111-4111-8111-111111111111',documents:req.headers['x-ui-kyc']==='flow'?fixtureKycDocuments:[],consentVersion:'kyc-2026-11-17',maxFileBytes:5242880,withdrawalRequestsEnabled:status==='approved',payoutExecutionEnabled:false}};
 if(path==='/api/investor/kyc')return reply(kycPayload());
 if(path.startsWith('/api/investor/kyc/documents/')&&req.method==='POST'){for await(const chunk of req){}const kind=path.split('/').at(-1);fixtureKycDocuments=fixtureKycDocuments.filter(d=>d.kind!==kind);const document={id:kind+'-fixture-id',kind,content_type:'image/png',byte_size:68,created_at:new Date().toISOString()};fixtureKycDocuments.push(document);res.statusCode=201;return reply({document,kyc:kycPayload()})}
 if(path==='/api/investor/kyc/submit'&&req.method==='POST'){for await(const chunk of req){}fixtureKycState='pending';res.statusCode=202;return reply(kycPayload())}
 if(path==='/api/investor/withdrawals')return reply({identityVerified:req.headers['x-ui-kyc']==='approved',requestsEnabled:req.headers['x-ui-kyc']==='approved',payoutExecutionEnabled:false,balances:[{asset:'USDC',available_minor:0},{asset:'USDT',available_minor:0}],requests:[]});
 if(path==='/api/investor/overview')await new Promise(resolve=>setTimeout(resolve,650));
 if(path==='/api/auth/logout'){res.setHeader('Set-Cookie','ui_member=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');return reply({ok:true})}
 if(path==='/api/auth/register'||path==='/api/auth/login'){res.setHeader('Set-Cookie','ui_member=1; Path=/; HttpOnly; SameSite=Lax');return reply({user:{id,email:'preview@example.invalid'}})}
 if(path==='/api/me'){if(req.headers['x-ui-auth']==='0'&&!String(req.headers.cookie||'').includes('ui_member=1')){res.statusCode=401;return reply({error:'Unauthorized'})}return reply({user:{id,email:'preview@example.invalid'}})}
 if(path==='/api/referrals/claim')return reply({code:null});
 if(path==='/api/affiliates/leaderboard')return reply({asOf:new Date().toISOString(),rows:[{rank:1,alias:'Circle-TEST12345',tier:'gold',qualifiedReferrals:5,capitalIntroducedBand:'Under 1,000 units'}]});
 if(path==='/api/investor/affiliates')return reply({publication:'automatic_public_alias',profile:{public_alias:'Circle-TEST12345'},tier:'gold',qualified90d:5,nextTier:'platinum',nextThreshold:15,remaining:10,rates:{100:22500,200:35000},amounts:{pending:42500,approved:22500,paid:0},legacy:{credited:100000},capitalIntroduced:[{asset:'USDC',amountMinor:500000000}],rewards:[{amountMinor:22500,accountUsd:100,tier:'gold',status:'pending',eligibleAt:'2026-12-17 12:00:00'}],payoutSchedule:'Monthly after validation and settlement approval'});
 if(path==='/api/investor/onboarding')return reply({name:'CIV Member',memberId:id,welcomeEmail:'awaiting_provider',activated:false,signupDeposit:{currency:'USDC_OR_USDT',requiredMinor:100000000},balances:[],promotion:{currency:'ZAR',amountMinor:100000,status:'pending_terms',withdrawable:false},referralWallet:{amountMinor:100000,suspendedMinor:0},referral:{code:'a1b2c3d4e5',url:'https://cryptoinvestmentvault.com/r/a1b2c3d4e5',registrations:0,qualified:0,pending:0},perks:[]});
 if(path==='/api/payments/config'&&req.headers['x-ui-disabled']==='1')return reply({mode:'testnet',chainId:11142220,ready:false,liveDepositsEnabled:false,supportedTokens:['USDC'],depositPresets:[1,2]});
 if(path==='/api/payments/config')return req.headers['x-ui-sandbox']==='1'
  ?reply({mode:'testnet',chainId:11142220,ready:true,liveDepositsEnabled:false,supportedTokens:['USDC'],depositPresets:[1,2]})
  :reply({mode:'production',chainId:42220,ready:true,liveDepositsEnabled:true,supportedTokens:['USDT','USDC'],depositPresets:[100,200]});
 if(path==='/api/payments/wallet'&&req.headers['x-ui-disabled']==='1')return reply({memberId:id,chainId:11142220,ready:false,address:null});
 if(path==='/api/payments/wallet')return reply({memberId:id,chainId:42220,ready:true,address:'0x'+'2'.repeat(40)});
 if(path==='/api/payments/quotes'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;lastQuoteBody=JSON.parse(body);return reply({id:'preview-quote',purpose:'funding',chainId:req.headers['x-ui-sandbox']==='1'?11142220:42220,symbol:lastQuoteBody.symbol,amount:lastQuoteBody.amount,tokenMinor:String(lastQuoteBody.amount*1e6),expiresAt:Date.now()+300000,transaction:{to:'0x'+'3'.repeat(40),data:'0x',value:'0x0'}})}
 if(path==='/api/payments/quotes')return reply({quotes:[]});
 if(path==='/api/investor/overview')return reply({user:{id,email:'preview@example.invalid'},portfolio:{cashUsdt:0},fundingBalances:[],holdings:[],activity:[]});
 if(path==='/api/investor/ledger')return reply({balanceUsdt:0,balanceUsdc:100,assets:[{asset:'USDC',principalMinor:100000000}],promotion:{amount_minor:100000,status:'pending_terms'},entries:[],withdrawalRequests:[],daily:{status:'pending',tradingDay:'2026-11-17',results:[]}});
 if(path==='/api/investor/shaka-simulation'){
  const close={tradingDay:'2026-11-17',scenario:'rising',rateBps:35,changeCents:'35',closingCents:'10035'};
  return reply({mode:'simulation',status:'active',confirmedDeposit:{amountMinor:100000000,asset:'USDC'},bonus:{amountMinor:100000,status:'pending_terms'},balanceCents:close.closingCents,basket:['BTC','ETH','SOL','XRP','BNB','ADA','DOGE'],latest:close,entries:[close]});
 }
 if(path==='/api/admin/shaka-simulation'){
  if(req.headers['x-ui-paper-admin']==='1')return reply({scenarios:[{id:'mixed',label:'Mixed market',rates:[-40,55]}],schedules:[],lastClose:'2026-11-17',activations:[]});
  res.statusCode=403;return reply({error:'Forbidden'});
 }
 if(path==='/api/investor/preferences')return reply({preference:null});
 if(path==='/api/celo/config')return reply({ready:false,mode:'testnet_only'});
 if(path==='/api/celo/testnet/intents')return reply({testUsdcMinor:0,intents:[]});
 if(path==='/api/market-pulse')return reply({source:'CoinGecko',asOf:new Date().toISOString(),global:{marketCapUsd:3000000000000,volume24hUsd:120000000000,btcDominancePct:55.2,marketCapChange24hPct:1.5},trending:[{id:'bitcoin',name:'Bitcoin',symbol:'BTC',url:'https://www.coingecko.com/en/coins/bitcoin',change24hPct:1.5}]});
 if(path==='/api/headlines')return reply({source:'CryptoPanic',asOf:new Date().toISOString(),articles:[{title:'Test publisher headline - example only',url:'https://example.com/crypto-article',source:'Example Publisher',publishedAt:new Date().toISOString()}]});
 if(path==='/api/transparency')return reply({asOf:new Date().toISOString(),categories:[],verifiedPerformance:[],announcements:[]});
 if(/^\/api\/markets\/[A-Z]+\/ytd$/.test(path)){const symbol=path.split('/')[3];if(symbol==='DOGE')return reply({symbol,year:new Date().getUTCFullYear(),changePct:null});if(symbol==='SOL')await new Promise(r=>setTimeout(r,250));return reply({symbol,year:new Date().getUTCFullYear(),asOf:new Date().toISOString(),priceUsd:100,startPriceUsd:80,changePct:symbol==='ETH'?-12.5:25,stale:symbol==='ADA'})}
 if(path==='/api/markets/usd-zar')return reply({rate:18,date:'2026-11-17'});
 if(path==='/api/markets')return reply({source:'CoinGecko',asOf:new Date().toISOString(),stale:false,assets:[['BTC',100000.25],['ETH',3450.67],['SOL',158.42],['XRP',2.14],['BNB',827.35],['ADA',0.714],['DOGE',0.24]].map(([symbol,priceUsd])=>({symbol,priceUsd,change24h:1.25,name:symbol}))});
 res.statusCode=404;return reply({error:'Not found'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CIV_CHROMIUM_PATH?{executablePath:process.env.CIV_CHROMIUM_PATH}:{})});
await mkdir('artifacts/ui',{recursive:true});
try{
 for(const width of [320,360,390,428,768,1280]){
  const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce',...(width===320||width===1280?{extraHTTPHeaders:{'x-ui-paper-admin':'1'}}:{})});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.addInitScript(()=>{window.ethereum={isMiniPay:true,request:async({method})=>{if(method==='eth_chainId')return '0xa4ec';if(method==='eth_accounts')return ['0x'+'1'.repeat(40)];if(method==='eth_call')return '0x3b9aca00';throw Error('Unexpected wallet request: '+method)}}});
  await page.goto(origin+'/dashboard');if(width===390){await page.locator('#vaultLoader').waitFor({state:'visible'});await page.screenshot({path:'artifacts/ui/mobile-loader.png'});}await page.locator('#vaultLoader').waitFor({state:'hidden'});
  await expect(page.locator('#quoteBTC')).toContainText('$100,000.25');
  await expect(page.locator('#quoteADA')).toContainText('$0.714');
  await expect(page.locator('#marketWatchStatus')).toContainText('CoinGecko spot prices');
  await expect(page.locator('#shakaSimBalance')).toHaveText('100.35 credits');
  await expect(page.locator('#shakaSimDaily')).toHaveText('0.35 credits (+0.35%)');
  await expect(page.locator('#shakaSimulation h2')).toHaveText('Shaka Big 7 paper portfolio mirror');
  await expect(page.locator('#shakaSimulation')).toContainText('Paper credits have no cash value.');
  await expect(page.locator('#shakaSimDeposit')).toHaveText('100.00 USDC');
  if(width===390){
   await page.getByRole('button',{name:'Find CIV Circle partner tools'}).click();
   await expect(page.getByRole('heading',{name:'CIV Circle partner dashboard'})).toBeVisible();
   await expect(page.locator('#circlePartnerDetails')).toBeVisible();
   await page.locator('[data-vault-tab="overview"]').click();
   const currency=page.locator('#shakaSimCurrency');
   const accountCurrency=page.locator('#vaultDisplayCurrency');
   await accountCurrency.getByRole('button',{name:'ZAR'}).click();
   await expect(currency.getByRole('button',{name:'ZAR'})).toHaveAttribute('aria-pressed','true');
   await expect(page.locator('#shakaSimBalance')).toContainText('equivalent');
   await expect(page.locator('#shakaSimBonus')).toHaveText(/R\s*1\s000,00/);
   await expect(page.locator('#verifiedDepositReference')).toContainText(/R\s*1\s800,00/);
   await expect(page.locator('#verifiedLedgerBalance')).toContainText('100.00 USDC');
   await currency.dispatchEvent('pointerdown',{pointerType:'touch',clientX:90});
   await currency.dispatchEvent('pointerup',{pointerType:'touch',clientX:30});
   await expect(currency.getByRole('button',{name:'USD'})).toHaveAttribute('aria-pressed','true');
   await expect(accountCurrency.getByRole('button',{name:'USD'})).toHaveAttribute('aria-pressed','true');
   await expect(page.locator('#shakaSimBalance')).toHaveText('100.35 credits');
  }
  if(width===320||width===1280){
   const admin=page.locator('#shakaSimulationAdmin');
   await expect(admin.getByText('Latest close on 2026-11-17')).toBeVisible();
   const button=admin.getByRole('button',{name:'Schedule for tomorrow'});
   assert.ok((await button.boundingBox()).height>=44);
   assert.equal(await admin.evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Paper portfolio admin overflows at '+width);
  }else await expect(page.locator('#shakaSimulationAdmin')).toBeHidden();
  assert.equal(await page.locator('.nav .brand-mark').evaluate(img=>img.complete&&img.naturalWidth>0),true);await expect(page.locator('#fundingMembershipStatus')).toHaveText('Awaiting deposit');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Home horizontal overflow at '+width);
  await expect(page.locator('#marketPulseGrid')).toContainText('Total crypto market cap');
  await expect(page.locator('#cryptoHeadlines')).toContainText('Test publisher headline');
  for(const icon of ['btc','eth','sol','xrp','bnb','ada','doge'])assert.equal(await page.locator('.orbit-scene img[src="/assets/coins/'+icon+'.svg"]').first().evaluate(img=>img.complete&&img.naturalWidth>0),true,'Missing source-backed hero icon: '+icon);
  if(width===390)await page.screenshot({path:'artifacts/ui/mobile-home.png'});
  await page.locator('[data-vault-tab="deposits"]').click();
  await expect(page.locator('#civDepositGuide')).not.toBeVisible();
  await page.locator('#openDepositGuide').click();
  await expect(page.locator('#civDepositGuide')).toBeVisible();
  await expect(page.locator('#civGuideTitle')).toContainText('Get your MiniPay wallet');
  await page.locator('#civGuideNext').click();
  await expect(page.locator('#civGuideTitle')).toContainText('Add USDC or USDT');
  await page.locator('#civGuideSkip').click();
  await expect(page.locator('#civDepositGuide')).not.toBeVisible();
  await expect(page.locator('#signupQuote')).toHaveText('Continue with MiniPay');
  await expect(page.locator('#openMiniPaySetup')).toBeVisible();
  await page.locator('#openMiniPaySetup').click();
  await expect(page.locator('#civGuideTitle')).toContainText('Get your MiniPay wallet');
  await page.locator('#civGuideSkip').click();
  await expect(page.locator('.deposit-aside')).toContainText('MiniPay');
  await expect(page.locator('.deposit-aside a[href*="play.google.com/store/apps/details"]')).toHaveCount(1);
  await expect(page.locator('.deposit-aside a[href*="apps.apple.com/za/app/"]')).toHaveCount(1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Deposit horizontal overflow at '+width);
  if(width<=700){
   const nav=await page.locator('.vault-nav').boundingBox();
   assert.ok(nav.y+nav.height<=844&&nav.y>700,'Bottom bar must be compact and visible');
   assert.ok(nav.height<=75,'Bottom bar must not be oversized: '+nav.height);
   assert.ok(nav.x>=-1&&nav.x+nav.width<=width+1,'Bottom bar must fit viewport');
   assert.equal(await page.locator('.vault-nav button').count(),5);
   assert.equal(await page.locator('.vault-nav').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,'Bottom bar must not scroll horizontally');
   for(const item of await page.locator('.vault-nav button').all()){
    const box=await item.boundingBox();
    assert.ok(box.width>35&&box.x>=nav.x-1&&box.x+box.width<=nav.x+nav.width+1,'All five tabs must fit in the visible bar');
   }
   for(const selector of ['.shell','.nav','.deposit-layout','.funding-card','.deposit-aside','.vault-nav']){
    const box=await page.locator(selector).first().boundingBox();
    if(box&&box.width>0)assert.ok(box.x>=-2&&box.x+box.width<=width+2,selector+' crosses viewport at '+width+': '+JSON.stringify(box));
   }
  }
  await page.locator('[data-deposit-amount="200"]').click();await page.locator('#signupQuote').click();await expect(page.locator('#paymentQuoteSummary')).toContainText('200.000000 USDC');assert.equal(lastQuoteBody.amount,200);assert.equal(lastQuoteBody.symbol,'USDC');
  assert.match(await page.locator('#externalWalletDetails').getAttribute('class'),/hidden/);assert.equal(await page.locator('#receivingWallet').inputValue(),'','MiniPay must not expose a raw wallet address');
  if(width===390){await page.screenshot({path:'artifacts/ui/mobile-deposit-full.png',fullPage:true});await page.locator('#signupCheckout').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/ui/mobile-deposit.png'})}
  await page.locator('[data-vault-tab="account"]').click();await expect(page.locator('#memberId')).toHaveText('a1b2c3d4e5');await expect(page.locator('#referralBalance')).toContainText('1');assert.equal(await page.locator('#referralLink').inputValue(),'https://cryptoinvestmentvault.com/r/a1b2c3d4e5');await expect(page.locator('#circleTier')).toHaveText('Gold Circle');await expect(page.locator('#circleTier')).toHaveAttribute('data-tier','gold');await expect(page.locator('#circlePending')).toContainText('425');await expect(page.locator('#circleRate100')).toContainText('225');await expect(page.locator('#circleDashboardBoard .circle-person')).toContainText('Circle-TEST12345');await page.locator('#circleDashboardBoard [data-circle-period=all]').click();await expect(page.locator('#circleDashboardBoard [data-circle-period=all]')).toHaveAttribute('aria-pressed','true');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);if(width===390)await page.screenshot({path:'artifacts/ui/mobile-referrals.png',fullPage:true});
  assert.deepEqual(errors,[],'Uncaught UI error');await context.close();
 }
 for (const width of [320, 360, 390, 428, 768, 1280]) {
  const context = await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce',extraHTTPHeaders:{'x-ui-auth':'0'}});
  const page = await context.newPage(), errors = [], projectionRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if(request.url().includes('/api/investor/projection')) projectionRequests.push(request.url())});
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin + '/#fund-scenarios');
  await expect(page.locator('#fund-scenarios')).toBeVisible();
  await expect(page.locator('[data-fund="100"] .fund-ending-value')).toHaveText('$107.21');
  await expect(page.locator('[data-fund="200"] .fund-ending-value')).toHaveText('$214.43');
  await expect(page.locator('[data-fund="100"] .fund-change-value')).toHaveText('+7.21%');
  await expect(page.locator('[data-fund="100"] .fund-daily-profit')).toHaveText('+$1.06');
  await page.locator('[data-fund="100"] .fund-chart').press('Home');
  await expect(page.locator('[data-fund="100"] .fund-day-balance')).toHaveText('$100.00');
  await page.locator('[data-fund="100"] .fund-chart').press('ArrowRight');
  await expect(page.locator('[data-fund="200"] .fund-day-balance')).toHaveText('$202.00');
  await page.locator('#fundDailyRate').fill('-10'); await page.locator('#fundDuration').fill('2');
  await expect(page.locator('[data-fund="100"] .fund-ending-value')).toHaveText('$81.00');
  await expect(page.locator('[data-fund="200"] .fund-change-value')).toHaveText('-19%');
  await expect(page.locator('[data-fund="100"] .fund-daily-profit')).toHaveText('-$9.00');
  await page.locator('#fundDailyBreakdown summary').click();
  await expect(page.locator('#fundDailyRows tr')).toHaveCount(3);
  await expect(page.locator('#fundDailyRows tr').last()).toContainText('$162.00');
  await page.locator('#fundDailyBreakdown summary').click();
  await page.locator('#fundDailyRate').fill('0');
  await expect(page.locator('[data-fund="200"] .fund-ending-value')).toHaveText('$200.00');
  await page.locator('#fundDailyRate').fill('100');await page.locator('[data-fund-days="90"]').click();
  await expect(page.locator('[data-fund="100"] .fund-ending-value')).not.toContainText('Infinity');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Fund overflow at maximum values: ' + width);
  await page.locator('#fundDailyRate').fill('101');
  await expect(page.locator('#fundCalculatorFeedback')).toContainText('−100% to 100%');
  await page.locator('#fundScenarioReset').click();
  await expect(page.locator('[data-fund="100"] .fund-ending-value')).toHaveText('$107.21');
  await page.locator('#fundDurationSlider').press('ArrowRight');
  await expect(page.locator('#fundDuration')).toHaveValue('8');
  await page.locator('#fundDailySlider').press('Home');
  await expect(page.locator('[data-fund="200"] .fund-ending-value')).toHaveText('$0.00');
  await expect(page.locator('[data-fund="200"] .fund-change-value')).toHaveText('-100%');
  await page.locator('#fundScenarioReset').click();
  await page.locator('#fund-scenarios').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Fund horizontal overflow at ' + width);
  if(width===390 || width===1280) await page.screenshot({path:'artifacts/ui/fund-scenarios-' + width + '.png',fullPage:true});
  assert.deepEqual(projectionRequests, [], 'The public calculator must not call the account projection API');
  assert.deepEqual(errors, [], 'Fund calculator client exceptions at ' + width);
  await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',extraHTTPHeaders:{'x-ui-auth':'0'}});const page=await context.newPage();await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin+'/join');await page.locator('#authForm').waitFor();const authHeader=await page.locator('.auth .top').boundingBox(),authTitle=await page.locator('#authTitle').boundingBox();assert.ok(authHeader.y+authHeader.height<=authTitle.y,'Signup header must not overlap its title');assert.equal(await page.locator('.site-footer').count(),1);assert.equal(await page.locator('#signupDepositNotice').isVisible(),true);assert.match(await page.locator('#signupDepositNotice').innerText(),/No wallet or deposit required to sign up/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'artifacts/ui/mobile-signup.png'});
 await page.locator('#fullName').fill('Preview Member');await page.locator('#email').fill('preview@example.invalid');await page.locator('#password').fill('isolated-ui-fixture-password');await page.locator('#acceptTerms').check();await page.locator('#submit').click();await page.locator('#vaultLoader').waitFor({state:'visible'});await page.screenshot({path:'artifacts/ui/mobile-signup-loader.png'});await page.locator('#vaultLoader').waitFor({state:'hidden'});await expect(page.locator('#dashboard')).toBeVisible();assert.equal(await page.locator('#dashboard').getAttribute('aria-busy'),null);
 await context.clearCookies();await page.goto(origin+'/dashboard');await page.locator('#authForm').waitFor();await page.locator('#email').fill('preview@example.invalid');await page.locator('#password').fill('isolated-ui-fixture-password');await page.locator('#submit').click();await page.locator('#vaultLoader').waitFor({state:'visible'});await page.locator('#vaultLoader').waitFor({state:'hidden'});await expect(page.locator('#dashboard')).toBeVisible();await context.close();
 const securityContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',extraHTTPHeaders:{'x-ui-auth':'0','x-ui-csp':'1'}});
 const securityPage=await securityContext.newPage(),securityErrors=[],policyErrors=[];
 securityPage.on('pageerror',error=>securityErrors.push(error.message));
 securityPage.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|Refused to execute|Refused to load the script/i.test(message.text()))policyErrors.push(message.text())});
 await securityPage.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await securityPage.goto(origin+'/join');await securityPage.locator('#fullName').fill('Security Fixture');await securityPage.locator('#email').fill('preview@example.invalid');await securityPage.locator('#password').fill('isolated-ui-security-password');await securityPage.locator('#acceptTerms').check();await securityPage.locator('#submit').click();await expect(securityPage.locator('#dashboard')).toBeVisible();
 const secondTab=await securityContext.newPage();await secondTab.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await secondTab.goto(origin+'/dashboard');await expect(secondTab.locator('#dashboard')).toBeVisible();
 await securityPage.evaluate(()=>localStorage.setItem('civ:pending-quote-v1',JSON.stringify({quoteId:'synthetic-fixture',txHash:'0x'+'1'.repeat(64)})));
 await securityPage.locator('[data-vault-tab="account"]').click();await securityPage.locator('#logout').click();
 await expect(securityPage.locator('#landing')).toBeVisible();await expect(secondTab.locator('#authForm')).toBeVisible();
 assert.equal(await securityPage.evaluate(()=>localStorage.getItem('civ:pending-quote-v1')),null);
 assert.equal(await securityPage.locator('#dashboard').evaluate(node=>node.textContent.includes('preview@example.invalid')),false);
 assert.equal(await secondTab.locator('#dashboard').evaluate(node=>node.textContent.includes('preview@example.invalid')),false);
 await securityPage.locator('#fund-scenarios').scrollIntoViewIfNeeded();await expect(securityPage.locator('[data-fund="100"] .fund-ending-value')).toHaveText('$107.21');
 assert.deepEqual(policyErrors,[],'The enforced CSP must permit CIV scripts');assert.deepEqual(securityErrors,[],'Logout and cache guards must not raise client errors');await securityContext.close();
 const sandboxContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',extraHTTPHeaders:{'x-ui-sandbox':'1'}});
 const sandboxPage=await sandboxContext.newPage();
 await sandboxPage.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await sandboxPage.addInitScript(()=>{window.ethereum={isMiniPay:true,request:async({method})=>{if(method==='eth_chainId')return '0x'+(11142220).toString(16);if(method==='eth_accounts')return ['0x'+'1'.repeat(40)];throw Error('Unexpected wallet request')}}});
 await sandboxPage.goto(origin+'/dashboard');
 await sandboxPage.locator('#vaultLoader').waitFor({state:'hidden'});
 await sandboxPage.locator('[data-vault-tab="deposits"]').click();
 await expect(sandboxPage.locator('#civDepositGuide')).not.toBeVisible();await sandboxPage.locator('#openDepositGuide').click();await expect(sandboxPage.locator('#civDepositGuide')).toBeVisible();await sandboxPage.locator('#civGuideSkip').click();
 await expect(sandboxPage.locator('#depositAmountHeadline')).toContainText('Test with 1 or 2 USDC');
 await expect(sandboxPage.locator('[data-deposit-amount="1"]')).toContainText('TEST USDC');
 await expect(sandboxPage.locator('#collectionHelp')).toContainText('real deposits remain disabled');
 await sandboxPage.locator('[data-deposit-amount="2"]').click();
 await sandboxPage.locator('#signupQuote').click();
 await expect(sandboxPage.locator('#paymentQuoteSummary')).toContainText('TEST ONLY: 2.000000 USDC');
 assert.equal(lastQuoteBody.amount,2);assert.equal(lastQuoteBody.symbol,'USDC');
 assert.equal(await sandboxPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await sandboxPage.screenshot({path:'artifacts/ui/mobile-testnet-deposit.png'});
 await sandboxContext.close();
 const disabledContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',extraHTTPHeaders:{'x-ui-disabled':'1'}});
 const disabledPage=await disabledContext.newPage();
 await disabledPage.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await disabledPage.goto(origin+'/dashboard');
 await disabledPage.locator('#vaultLoader').waitFor({state:'hidden'});
 await disabledPage.locator('[data-vault-tab="deposits"]').click();
 await expect(disabledPage.locator('#civDepositGuide')).not.toBeVisible();await disabledPage.locator('#openDepositGuide').click();await expect(disabledPage.locator('#civDepositGuide')).toBeVisible();await disabledPage.locator('#civGuideSkip').click();
 await expect(disabledPage.locator('#depositAmountHeadline')).toHaveText('Start with $100.');
 await expect(disabledPage.locator('[data-deposit-amount="100"]')).toContainText('$100');
 await expect(disabledPage.locator('[data-deposit-amount="200"]')).toContainText('$200');
 await expect(disabledPage.locator('#signupQuote')).toBeDisabled();
 assert.equal(await disabledPage.locator('[data-deposit-amount="1"]').count(),0,'Disabled sandbox must not masquerade as an active deposit offer');
 await disabledContext.close();
 const guestWidths=[320,390,428];
 for(const width of guestWidths){
  const guestCtx=await browser.newContext({viewport:{width,height:844},extraHTTPHeaders:{'x-ui-auth':'0'},reducedMotion:'reduce'});
  const guest=await guestCtx.newPage();
  await guest.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await guest.goto(origin+'/');
  await expect(guest.locator('#minipay-start')).toBeVisible();
  await expect(guest.locator('.civ-wallet-step')).toHaveCount(3);
  await expect(guest.locator('.civ-wallet-section')).toContainText('You don\'t need MiniPay to register');
  await expect(guest.locator('.civ-wallet-section .civ-wallet-links a[href*="play.google.com"]')).toHaveCount(1);
  const card=await guest.locator('.civ-wallet-section').boundingBox();
  assert.ok(card.x>=-2&&card.x+card.width<=width+2,'MiniPay guide must not overflow a '+width+'px phone');
  const overflow=await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  assert.equal(overflow,false,'Public page must not require horizontal scrolling at '+width);
  if(width===390)await guest.screenshot({path:'artifacts/ui/mobile-wallet-guide.png',fullPage:true});
  await guest.locator('[data-asset="ETH"]').click();
  await expect(guest.locator('#assetDetailName')).toHaveText('Ethereum');
  await expect(guest.locator('#assetDetailAbout')).toContainText('smart contracts');
  await expect(guest.locator('#assetDetailYtd')).toHaveText('-12.50%');
  await expect(guest.locator('#assetDetailYtd')).toHaveAttribute('data-direction','down');
  await guest.locator('[data-asset="SOL"]').click();await guest.locator('[data-asset="BTC"]').click();
  await expect(guest.locator('#assetDetailName')).toHaveText('Bitcoin');
  await expect(guest.locator('#assetDetailYtd')).toHaveText('+25.00%');
  await guest.waitForTimeout(300);await expect(guest.locator('#assetDetailName')).toHaveText('Bitcoin');
  await guest.locator('[data-asset="ADA"]').click();await expect(guest.locator('#assetDetailStatus')).toContainText('Delayed');
  await guest.locator('[data-asset="DOGE"]').click();await expect(guest.locator('#assetDetailYtd')).toHaveText('—');await expect(guest.locator('#assetDetailRetry')).toBeVisible();
  await guest.locator('[data-asset="ETH"]').click();await guest.locator('[data-asset="ETH"]').press('ArrowRight');await expect(guest.locator('[data-asset="SOL"]')).toBeFocused();await expect(guest.locator('[data-asset="SOL"]')).toHaveAttribute('aria-pressed','true');
  for(const button of await guest.locator('#strategy .coin').all()){const b=await button.boundingBox();assert.ok(b.height>=44&&b.height<=48,'Compact accessible crypto pills');assert.equal(await button.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Pill contents must fit')}
  assert.equal(await guest.locator('#strategy .coins').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  if(width===390){await guest.locator('#strategy').scrollIntoViewIfNeeded();await guest.screenshot({path:'artifacts/ui/mobile-asset-explorer.png'})}await expect(guest.locator('#shaka-strategy')).toContainText('ATR-based');assert.equal(await guest.locator('#shaka-strategy .shaka-lines li').count(),3);await expect(guest.locator('#ada-ledger')).toContainText('USDC and USDT');assert.equal(await guest.evaluate(()=>Boolean(document.querySelector('#strategy').compareDocumentPosition(document.querySelector('#shaka-strategy'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);assert.equal(await guest.locator('#circle-leaderboard [data-circle-period=month]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(181, 242, 105)');await expect(guest.locator('#circle-leaderboard .circle-board')).toContainText('Circle-TEST12345');if(width===390){await guest.locator('#shaka-strategy').scrollIntoViewIfNeeded();await guest.screenshot({path:'artifacts/ui/mobile-shaka.png'});await guest.locator('#circle-leaderboard').scrollIntoViewIfNeeded();await guest.screenshot({path:'artifacts/ui/mobile-public-leaderboard.png'})}
  await guest.locator('#assetDetailChart').click();await expect(guest.locator('[data-market="SOL"]')).toHaveAttribute('aria-selected','true');
  await guest.locator('.civ-wallet-signup').click();
  await expect(guest.locator('#authTitle')).toHaveText('Your vault starts here.');
  await guestCtx.close();
 }
 console.log('Mobile UI passed: 320, 360, 390, 428, 768, 1280px; compact five-tab navigation, MiniPay onboarding, wallet privacy and deposits.');

 for(const width of [320,390,1280]){
  const adminContext=await browser.newContext({viewport:{width,height:844}}),page=await adminContext.newPage();await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin+'/admin');
  await expect(page.getByRole('heading',{name:'Vault control.'})).toBeVisible();await expect(page.getByRole('link',{name:'Open identity review'})).toBeVisible();assert.equal(await page.locator('a[href="/dashboard/mirror"]').count(),0);assert.equal(await page.locator('.admin-brand img').evaluate(el=>el.complete&&el.naturalWidth>0),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Admin must fit '+width+'px');await adminContext.close();
 }
 for(const target of ['/admin','https://untrusted.invalid/admin']){
  const context=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'x-ui-auth':'0','x-ui-csp':'1'}}),page=await context.newPage();await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin+'/join?returnTo='+encodeURIComponent(target));await expect(page.locator('#modal')).toBeVisible();
  if(target==='/admin')await expect(page.locator('#authTitle')).toHaveText('Welcome back.');else await page.locator('#switchMode').click();
  await page.locator('#email').fill('admin-fixture@example.invalid');await page.locator('#password').fill('synthetic-test-password');await page.locator('#submit').click();await expect(page).toHaveURL(origin+(target==='/admin'?'/admin':'/dashboard'));await context.close();
 }
 console.log('Branded admin UI passed at 320, 390 and 1280px; sign-in returns to allowlisted destinations and rejects external redirects.');
 const identityContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',extraHTTPHeaders:{'x-ui-kyc':'flow'}});
 const identityPage=await identityContext.newPage();const identityErrors=[];identityPage.on('pageerror',e=>identityErrors.push(e.message));await identityPage.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await identityPage.goto(origin+'/dashboard');await identityPage.locator('#vaultLoader').waitFor({state:'hidden'});
 await expect(identityPage.locator('#memberVerifiedBadge')).not.toBeVisible();await identityPage.locator('.identity-prompt [data-open-kyc]').click();await expect(identityPage.locator('#identityDialog')).toBeVisible();
 const syntheticPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=','base64');
 for(const input of ['identityFile','addressFile'])await identityPage.locator('#'+input).setInputFiles({name:'synthetic-test-document.png',mimeType:'image/png',buffer:syntheticPng});
 await identityPage.locator('#identityConsent').check();await identityPage.locator('#identitySubmit').click();await expect(identityPage.locator('#identityTitle')).toHaveText('Documents received.');await expect(identityPage.locator('#identityDialog')).toContainText('in review');await expect(identityPage.locator('#memberVerifiedBadge')).not.toBeVisible();assert.equal(await identityPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await identityPage.screenshot({path:'artifacts/ui/mobile-identity-pending.png'});await identityContext.close();
 const approvedContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',extraHTTPHeaders:{'x-ui-kyc':'approved'}});const approvedPage=await approvedContext.newPage();await approvedPage.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await approvedPage.goto(origin+'/dashboard');await approvedPage.locator('#vaultLoader').waitFor({state:'hidden'});await expect(approvedPage.locator('#memberVerifiedBadge')).toBeVisible();await expect(approvedPage.locator('#withdrawalAccessTitle')).toHaveText('Ready to request');await approvedPage.locator('.identity-prompt [data-open-kyc]').click();await expect(approvedPage.locator('#identityTitle')).toHaveText('Your identity. Verified.');await approvedPage.screenshot({path:'artifacts/ui/mobile-identity-approved.png'});await approvedPage.getByRole('button',{name:'Back to my vault',exact:true}).click();await approvedPage.locator('#withdrawalAccessButton').click();await expect(approvedPage.locator('#withdrawalDialog')).toBeVisible();await expect(approvedPage.locator('#withdrawalSubmit')).toBeDisabled();await expect(approvedPage.locator('#withdrawalAvailable')).toContainText('Available / 0');await approvedContext.close();assert.deepEqual(identityErrors,[],'Identity workflow must not raise client exceptions');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
