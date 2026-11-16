/** Isolated mobile UI checks. Fixtures never contact a wallet, provider or production API. */
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const html=await readFile('public/index.html','utf8');
let lastQuoteBody;
const id='00000000-0000-4000-8000-000000000001';
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',path.startsWith('/api/')?'application/json':'text/html');
 const reply=d=>res.end(JSON.stringify(d));
 if(!path.startsWith('/api/'))return res.end(html);
 if(path==='/api/me'){if(req.headers['x-ui-auth']==='0'){res.statusCode=401;return reply({error:'Unauthorized'})}return reply({user:{id,email:'preview@example.invalid'}})}
 if(path==='/api/investor/onboarding')return reply({name:'CIV Member',memberId:id,welcomeEmail:'awaiting_provider',activated:false,signupDeposit:{currency:'USDC_OR_USDT',requiredMinor:100000000},balances:[],promotion:{currency:'ZAR',amountMinor:50000,status:'requires_deposit',withdrawable:false},referral:{url:'https://cryptoinvestmentvault.com/r/'+id,registrations:0,qualified:0,pending:0},perks:[]});
 if(path==='/api/payments/config')return reply({mode:'production',chainId:42220,ready:true,liveDepositsEnabled:true,supportedTokens:['USDT','USDC']});
 if(path==='/api/payments/wallet')return reply({memberId:id,chainId:42220,ready:true,address:'0x'+'2'.repeat(40)});
 if(path==='/api/payments/quotes'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;lastQuoteBody=JSON.parse(body);return reply({id:'preview-quote',purpose:'funding',chainId:42220,symbol:lastQuoteBody.symbol,amount:lastQuoteBody.amount,tokenMinor:String(lastQuoteBody.amount*1e6),expiresAt:Date.now()+300000,transaction:{to:'0x'+'3'.repeat(40),data:'0x',value:'0x0'}})}
 if(path==='/api/payments/quotes')return reply({quotes:[]});
 if(path==='/api/investor/overview')return reply({user:{id,email:'preview@example.invalid'},portfolio:{cashUsdt:0},fundingBalances:[],holdings:[],activity:[]});
 if(path==='/api/investor/ledger')return reply({balanceUsdt:0,balanceUsdc:0,entries:[],withdrawalRequests:[]});
 if(path==='/api/investor/preferences')return reply({preference:null});
 if(path==='/api/celo/config')return reply({ready:false,mode:'testnet_only'});
 if(path==='/api/celo/testnet/intents')return reply({testUsdcMinor:0,intents:[]});
 if(path==='/api/transparency')return reply({asOf:new Date().toISOString(),categories:[],verifiedPerformance:[],announcements:[]});
 if(path==='/api/markets')return reply({asOf:new Date().toISOString(),assets:[]});
 res.statusCode=404;return reply({error:'Not found'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
await mkdir('artifacts/ui',{recursive:true});
try{
 for(const width of [320,390,768,1280]){
  const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.addInitScript(()=>{window.ethereum={isMiniPay:true,request:async({method})=>{if(method==='eth_chainId')return '0xa4ec';if(method==='eth_accounts')return ['0x'+'1'.repeat(40)];if(method==='eth_call')return '0x3b9aca00';throw Error('Unexpected wallet request: '+method)}}});
  await page.goto(origin+'/dashboard');await expect(page.locator('#fundingMembershipStatus')).toHaveText('Awaiting deposit');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Home horizontal overflow at '+width);
  if(width===390)await page.screenshot({path:'artifacts/ui/mobile-home.png'});
  await page.locator('[data-vault-tab="deposits"]').click();await expect(page.locator('#signupQuote')).toHaveText('Continue with MiniPay');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Deposit horizontal overflow at '+width);
  if(width<=700){const nav=await page.locator('.vault-nav').boundingBox();assert.ok(nav.y+nav.height<=844&&nav.y>650);assert.equal(await page.locator('.vault-nav button').count(),5)}
  await page.locator('[data-deposit-amount="200"]').click();await page.locator('#signupQuote').click();await expect(page.locator('#paymentQuoteSummary')).toContainText('200.000000 USDC');assert.equal(lastQuoteBody.amount,200);assert.equal(lastQuoteBody.symbol,'USDC');
  assert.match(await page.locator('#externalWalletDetails').getAttribute('class'),/hidden/);assert.equal(await page.locator('#receivingWallet').inputValue(),'','MiniPay must not expose a raw wallet address');
  if(width===390){await page.screenshot({path:'artifacts/ui/mobile-deposit-full.png',fullPage:true});await page.locator('#signupCheckout').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/ui/mobile-deposit.png'})}
  await page.locator('[data-vault-tab="account"]').click();await expect(page.locator('#memberId')).toHaveText(id);
  assert.deepEqual(errors,[],'Uncaught UI error');await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',extraHTTPHeaders:{'x-ui-auth':'0'}});const page=await context.newPage();await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin+'/join');await page.locator('#authForm').waitFor();const authHeader=await page.locator('.auth .top').boundingBox(),authTitle=await page.locator('#authTitle').boundingBox();assert.ok(authHeader.y+authHeader.height<=authTitle.y,'Signup header must not overlap its title');assert.equal(await page.locator('#signupDepositNotice').isVisible(),true);assert.match(await page.locator('#signupDepositNotice').innerText(),/Minimum deposit: 100/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'artifacts/ui/mobile-signup.png'});await context.close();
 console.log('Mobile UI passed: 320, 390, 768, 1280px; navigation, amount selection, wallet privacy, signup and quote review.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
