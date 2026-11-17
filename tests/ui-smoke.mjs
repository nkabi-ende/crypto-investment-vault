/** Isolated mobile UI checks. Fixtures never contact a wallet, provider or production API. */
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const html=await readFile('public/index.html','utf8');
assert.equal(html.split('<script').length-1,html.split('</script>').length-1,'Scripts must have matching closing tags');
assert.equal(html.split('async function refreshSignupPayments(').length-1,1,'Only one payment refresh handler may exist');
assert.equal(html.split("$('#signupQuote').onclick=async()=>").length-1,1,'Only one checkout click handler may exist');
let lastQuoteBody;
const id='00000000-0000-4000-8000-000000000001';
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',path.startsWith('/api/')?'application/json':'text/html');
 const reply=d=>res.end(JSON.stringify(d));
 if(/^\/(civ-mark|favicon)\.svg$/.test(path)||/^\/assets\/coins\/(btc|eth|sol|xrp|bnb|ada|doge)\.svg$/.test(path)){res.setHeader('Content-Type','image/svg+xml');return res.end(await readFile('public'+path))}if(path==='/experience.js'||path==='/market-watch.js'){res.setHeader('Content-Type','application/javascript');return res.end(await readFile('public'+path))}if(!path.startsWith('/api/'))return res.end(html);
 if(path==='/api/investor/overview')await new Promise(resolve=>setTimeout(resolve,650));
 if(path==='/api/auth/register'||path==='/api/auth/login'){res.setHeader('Set-Cookie','ui_member=1; Path=/; HttpOnly; SameSite=Lax');return reply({user:{id,email:'preview@example.invalid'}})}
 if(path==='/api/me'){if(req.headers['x-ui-auth']==='0'&&!String(req.headers.cookie||'').includes('ui_member=1')){res.statusCode=401;return reply({error:'Unauthorized'})}return reply({user:{id,email:'preview@example.invalid'}})}
 if(path==='/api/investor/onboarding')return reply({name:'CIV Member',memberId:id,welcomeEmail:'awaiting_provider',activated:false,signupDeposit:{currency:'USDC_OR_USDT',requiredMinor:100000000},balances:[],promotion:{currency:'ZAR',amountMinor:50000,status:'requires_deposit',withdrawable:false},referralWallet:{amountMinor:100000,suspendedMinor:0},referral:{code:'a1b2c3d4e5',url:'https://cryptoinvestmentvault.com/r/a1b2c3d4e5',registrations:0,qualified:0,pending:0},perks:[]});
 if(path==='/api/payments/config'&&req.headers['x-ui-disabled']==='1')return reply({mode:'testnet',chainId:11142220,ready:false,liveDepositsEnabled:false,supportedTokens:['USDC'],depositPresets:[1,2]});
 if(path==='/api/payments/config')return req.headers['x-ui-sandbox']==='1'
  ?reply({mode:'testnet',chainId:11142220,ready:true,liveDepositsEnabled:false,supportedTokens:['USDC'],depositPresets:[1,2]})
  :reply({mode:'production',chainId:42220,ready:true,liveDepositsEnabled:true,supportedTokens:['USDT','USDC'],depositPresets:[100,200]});
 if(path==='/api/payments/wallet'&&req.headers['x-ui-disabled']==='1')return reply({memberId:id,chainId:11142220,ready:false,address:null});
 if(path==='/api/payments/wallet')return reply({memberId:id,chainId:42220,ready:true,address:'0x'+'2'.repeat(40)});
 if(path==='/api/payments/quotes'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;lastQuoteBody=JSON.parse(body);return reply({id:'preview-quote',purpose:'funding',chainId:req.headers['x-ui-sandbox']==='1'?11142220:42220,symbol:lastQuoteBody.symbol,amount:lastQuoteBody.amount,tokenMinor:String(lastQuoteBody.amount*1e6),expiresAt:Date.now()+300000,transaction:{to:'0x'+'3'.repeat(40),data:'0x',value:'0x0'}})}
 if(path==='/api/payments/quotes')return reply({quotes:[]});
 if(path==='/api/investor/overview')return reply({user:{id,email:'preview@example.invalid'},portfolio:{cashUsdt:0},fundingBalances:[],holdings:[],activity:[]});
 if(path==='/api/investor/ledger')return reply({balanceUsdt:0,balanceUsdc:0,entries:[],withdrawalRequests:[]});
 if(path==='/api/investor/preferences')return reply({preference:null});
 if(path==='/api/celo/config')return reply({ready:false,mode:'testnet_only'});
 if(path==='/api/celo/testnet/intents')return reply({testUsdcMinor:0,intents:[]});
 if(path==='/api/market-pulse')return reply({source:'CoinGecko',asOf:new Date().toISOString(),global:{marketCapUsd:3000000000000,volume24hUsd:120000000000,btcDominancePct:55.2,marketCapChange24hPct:1.5},trending:[{id:'bitcoin',name:'Bitcoin',symbol:'BTC',url:'https://www.coingecko.com/en/coins/bitcoin',change24hPct:1.5}]});
 if(path==='/api/headlines')return reply({source:'CryptoPanic',asOf:new Date().toISOString(),articles:[{title:'Test publisher headline - example only',url:'https://example.com/crypto-article',source:'Example Publisher',publishedAt:new Date().toISOString()}]});
 if(path==='/api/transparency')return reply({asOf:new Date().toISOString(),categories:[],verifiedPerformance:[],announcements:[]});
 if(path==='/api/markets')return reply({source:'CoinGecko',asOf:new Date().toISOString(),stale:false,assets:[['BTC',100000.25],['ETH',3450.67],['SOL',158.42],['XRP',2.14],['BNB',827.35],['ADA',0.714],['DOGE',0.24]].map(([symbol,priceUsd])=>({symbol,priceUsd,change24h:1.25,name:symbol}))});
 res.statusCode=404;return reply({error:'Not found'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
await mkdir('artifacts/ui',{recursive:true});
try{
 for(const width of [320,360,390,428,768,1280]){
  const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.addInitScript(()=>{window.ethereum={isMiniPay:true,request:async({method})=>{if(method==='eth_chainId')return '0xa4ec';if(method==='eth_accounts')return ['0x'+'1'.repeat(40)];if(method==='eth_call')return '0x3b9aca00';throw Error('Unexpected wallet request: '+method)}}});
  await page.goto(origin+'/dashboard');if(width===390){await page.locator('#vaultLoader').waitFor({state:'visible'});await page.screenshot({path:'artifacts/ui/mobile-loader.png'});}await page.locator('#vaultLoader').waitFor({state:'hidden'});
  await expect(page.locator('#quoteBTC')).toContainText('$100,000.25');
  await expect(page.locator('#quoteADA')).toContainText('$0.714');
  await expect(page.locator('#marketWatchStatus')).toContainText('CoinGecko spot prices');
  assert.equal(await page.locator('.nav .brand-mark').evaluate(img=>img.complete&&img.naturalWidth>0),true);await expect(page.locator('#fundingMembershipStatus')).toHaveText('Awaiting deposit');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Home horizontal overflow at '+width);
  await expect(page.locator('#marketPulseGrid')).toContainText('Total crypto market cap');
  await expect(page.locator('#cryptoHeadlines')).toContainText('Test publisher headline');
  for(const icon of ['btc','eth','sol','xrp','bnb','ada','doge'])assert.equal(await page.locator('.orbit-scene img[src="/assets/coins/'+icon+'.svg"]').first().evaluate(img=>img.complete&&img.naturalWidth>0),true,'Missing source-backed hero icon: '+icon);
  if(width===390)await page.screenshot({path:'artifacts/ui/mobile-home.png'});
  await page.locator('[data-vault-tab="deposits"]').click();
  await expect(page.locator('#civDepositGuide')).toBeVisible();
  await expect(page.locator('#civGuideTitle')).toContainText('Get your MiniPay wallet');
  await page.locator('#civGuideNext').click();
  await expect(page.locator('#civGuideTitle')).toContainText('Add USDC or USDT');
  await page.locator('#civGuideSkip').click();
  await expect(page.locator('#civDepositGuide')).not.toBeVisible();
  await expect(page.locator('#signupQuote')).toHaveText('Continue with MiniPay · Pilot');
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
  await page.locator('[data-vault-tab="account"]').click();await expect(page.locator('#memberId')).toHaveText('a1b2c3d4e5');await expect(page.locator('#referralBalance')).toContainText('1');assert.equal(await page.locator('#referralLink').inputValue(),'https://cryptoinvestmentvault.com/r/a1b2c3d4e5');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);if(width===390)await page.screenshot({path:'artifacts/ui/mobile-referrals.png',fullPage:true});
  assert.deepEqual(errors,[],'Uncaught UI error');await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',extraHTTPHeaders:{'x-ui-auth':'0'}});const page=await context.newPage();await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin+'/join');await page.locator('#authForm').waitFor();const authHeader=await page.locator('.auth .top').boundingBox(),authTitle=await page.locator('#authTitle').boundingBox();assert.ok(authHeader.y+authHeader.height<=authTitle.y,'Signup header must not overlap its title');assert.equal(await page.locator('.site-footer').count(),1);assert.equal(await page.locator('#signupDepositNotice').isVisible(),true);assert.match(await page.locator('#signupDepositNotice').innerText(),/No wallet or deposit required to sign up/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'artifacts/ui/mobile-signup.png'});
 await page.locator('#fullName').fill('Preview Member');await page.locator('#email').fill('preview@example.invalid');await page.locator('#password').fill('isolated-ui-fixture-password');await page.locator('#acceptTerms').check();await page.locator('#submit').click();await page.locator('#vaultLoader').waitFor({state:'visible'});await page.screenshot({path:'artifacts/ui/mobile-signup-loader.png'});await page.locator('#vaultLoader').waitFor({state:'hidden'});await expect(page.locator('#dashboard')).toBeVisible();assert.equal(await page.locator('#dashboard').getAttribute('aria-busy'),null);
 await context.clearCookies();await page.goto(origin+'/dashboard');await page.locator('#authForm').waitFor();await page.locator('#email').fill('preview@example.invalid');await page.locator('#password').fill('isolated-ui-fixture-password');await page.locator('#submit').click();await page.locator('#vaultLoader').waitFor({state:'visible'});await page.locator('#vaultLoader').waitFor({state:'hidden'});await expect(page.locator('#dashboard')).toBeVisible();await context.close();
 const sandboxContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',extraHTTPHeaders:{'x-ui-sandbox':'1'}});
 const sandboxPage=await sandboxContext.newPage();
 await sandboxPage.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await sandboxPage.addInitScript(()=>{window.ethereum={isMiniPay:true,request:async({method})=>{if(method==='eth_chainId')return '0x'+(11142220).toString(16);if(method==='eth_accounts')return ['0x'+'1'.repeat(40)];throw Error('Unexpected wallet request')}}});
 await sandboxPage.goto(origin+'/dashboard');
 await sandboxPage.locator('#vaultLoader').waitFor({state:'hidden'});
 await sandboxPage.locator('[data-vault-tab="deposits"]').click();
 await expect(sandboxPage.locator('#civDepositGuide')).toBeVisible();await sandboxPage.locator('#civGuideSkip').click();
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
 await expect(disabledPage.locator('#civDepositGuide')).toBeVisible();await disabledPage.locator('#civGuideSkip').click();
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
  await guest.locator('.civ-wallet-signup').click();
  await expect(guest.locator('#authTitle')).toHaveText('Your vault starts here.');
  await guestCtx.close();
 }
 console.log('Mobile UI passed: 320, 360, 390, 428, 768, 1280px; compact five-tab navigation, MiniPay onboarding, wallet privacy and deposits.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
