/** Exact-amount MiniPay payments. Receiving only: this Worker holds no wallet signing keys. */
export type PaymentEnv={DB:D1Database;PAYMENTS_ENABLED?:string;PAYMENT_MODE?:string;CELO_MAINNET_RPC_URL?:string;CELO_MAINNET_TREASURY_ADDRESS?:string;CELO_SEPOLIA_RPC_URL?:string;CELO_TEST_TREASURY_ADDRESS?:string;CELO_TEST_USDC_ADDRESS?:string;COINGECKO_DEMO_API_KEY?:string};
const address=/^0x[a-f0-9]{40}$/i;
export const validWallet=(value:unknown):value is string=>typeof value==='string'&&address.test(value)&&!/^0x0{40}$/i.test(value);
const tokens={USDT:'0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e',USDC:'0xceba9300f2b948710d2653dd7b07f33a8b32118c'};
const feeAdapters={USDT:'0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72',USDC:'0x2f25deb3848c207fc8e0c34035b3ba7fc157602b'};
// Official Celo Sepolia USDC used by MiniPay (not a third-party sandbox token).
export const testUSDC='0x2f25deb3848c207fc8e0c34035b3ba7fc157602b';
const transferTopic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const padAddress=(a:string)=>'0x'+a.slice(2).padStart(64,'0');
export function paymentConfig(env:PaymentEnv){
 const production=env.PAYMENT_MODE==='production',chainId=production?42220:11142220;
 const treasury=production?env.CELO_MAINNET_TREASURY_ADDRESS:env.CELO_TEST_TREASURY_ADDRESS;
 const rpc=production?env.CELO_MAINNET_RPC_URL:env.CELO_SEPOLIA_RPC_URL;
 const ready=env.PAYMENTS_ENABLED==='true'&&validWallet(treasury)&&!!rpc?.startsWith('https://');
 return {mode:production?'production':'testnet',chainId,ready,liveDepositsEnabled:production&&ready,
  supportedTokens:production?['USDT','USDC']:['USDC'],quoteLifetimeSeconds:300,minimumDeposit:production?100:1,depositPresets:production?[100,200]:[1,2],depositCurrency:'USDC_OR_USDT',platformToken:false,
  treasury:validWallet(treasury)?treasury.toLowerCase():null,rpc};
}
export function paymentData(q:any){return '0xa9059cbb'+q.treasury.slice(2).padStart(64,'0')+BigInt(q.token_minor).toString(16).padStart(64,'0')+q.id.replaceAll('-','')}
async function rpc(env:PaymentEnv,chain:number,method:string,params:any[]):Promise<any>{
 const url=chain===42220?env.CELO_MAINNET_RPC_URL:chain===11142220?env.CELO_SEPOLIA_RPC_URL:undefined;
 if(!url?.startsWith('https://'))throw Error('Payment RPC not configured');
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Payment RPC unavailable');const d:any=await r.json();if(d.error)throw Error('Payment RPC error');return d.result;
}
async function chainCheck(env:PaymentEnv,chain:number){if(Number(await rpc(env,chain,'eth_chainId',[]))!==chain)throw Error('Unexpected payment network')}
export function presentQuote(q:any){return {id:q.id,chainId:q.chain_id,symbol:q.symbol,amount:q.token_minor/1e6,tokenMinor:String(q.token_minor),purpose:q.purpose,depositAmount:(q.funding_minor??q.token_minor)/1e6,pricing:q.purpose==='funding'?'exact_token_units':'legacy_zar_quote',expiresAt:q.expires_at,status:q.status,txHash:q.tx_hash,reviewReason:q.review_reason,transaction:{to:q.token,data:paymentData(q),value:'0x0',feeCurrency:q.chain_id===42220?feeAdapters[q.symbol as keyof typeof feeAdapters]:'0x4822e58de6f5e485ef90df51c41ce01721331dc0'}}}
export async function createQuote(env:PaymentEnv,userId:string,symbol:string,sender:string,amount=100){
 const config=paymentConfig(env);
 if(!config.ready)throw Error('Payment collection is awaiting configuration');
 if(!config.depositPresets.includes(amount))throw Error('Select a supported deposit amount for the active network');
 if(!config.supportedTokens.includes(symbol)||!validWallet(sender)||sender.toLowerCase()===config.treasury)throw Error('Choose a supported token and paying wallet');
 const member=await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(userId).first();if(!member)throw Error('Membership record unavailable');
 const now=Date.now();
 const pending=await env.DB.prepare("SELECT id FROM payment_quotes WHERE user_id=? AND chain_id=? AND status='submitted' LIMIT 1").bind(userId,config.chainId).first();if(pending)throw Error('A payment is awaiting verification');
 const existing=await env.DB.prepare("SELECT * FROM payment_quotes WHERE user_id=? AND chain_id=? AND purpose='funding' AND COALESCE(funding_minor,token_minor)=? AND symbol=? AND sender=? AND treasury=? AND expires_at>? AND status='awaiting_payment' ORDER BY created_at DESC LIMIT 1").bind(userId,config.chainId,amount*1000000,symbol,sender.toLowerCase(),config.treasury,now+30000).first();if(existing)return presentQuote(existing);
 await chainCheck(env,config.chainId);
 if(config.chainId!==42220&&env.CELO_TEST_USDC_ADDRESS?.toLowerCase()!==testUSDC)throw Error('Testnet token configuration is missing or incorrect');
 const token=config.chainId===42220?tokens[symbol as keyof typeof tokens]:testUSDC;
 const decimals=await rpc(env,config.chainId,'eth_call',[{to:token,data:'0x313ce567'},'latest']);if(Number(decimals)!==6)throw Error('Unexpected token decimals');
 const block=Number(await rpc(env,config.chainId,'eth_blockNumber',[]));
 if(!Number.isSafeInteger(block)||block<1)throw Error('Payment network unavailable');
 const q={id:crypto.randomUUID(),chain_id:config.chainId,symbol,token,treasury:config.treasury,sender:sender.toLowerCase(),token_minor:amount*1000000,zar_minor:1,rate_micro_zar:1,rate_source:'token_units',rate_at:now,created_at:now,expires_at:now+300000,next_block:block,status:'awaiting_payment',tx_hash:null};
 await env.DB.prepare('INSERT INTO payment_quotes(id,user_id,chain_id,symbol,token,treasury,sender,token_minor,zar_minor,rate_micro_zar,rate_source,rate_at,created_at,expires_at,next_block,updated_at,purpose,funding_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(q.id,userId,q.chain_id,q.symbol,q.token,q.treasury,q.sender,q.token_minor,q.zar_minor,q.rate_micro_zar,q.rate_source,q.rate_at,now,q.expires_at,block,now,'funding',config.chainId===42220?q.token_minor:null).run();
 return presentQuote({...q,purpose:'funding',funding_minor:config.chainId===42220?q.token_minor:null});
}
export async function verifyQuote(env:PaymentEnv,q:any,hash:string){
 const realFunding=q.chain_id===42220&&q.funding_minor===q.token_minor&&[100000000,200000000].includes(q.token_minor);
 const sandboxFunding=q.chain_id===11142220&&q.funding_minor===null&&q.symbol==='USDC'&&q.token?.toLowerCase()===testUSDC&&[1000000,2000000].includes(q.token_minor);
 if(q.purpose!=='funding'||(!realFunding&&!sandboxFunding)){await env.DB.prepare("UPDATE payment_quotes SET status='review',review_reason='legacy_quote_retired' WHERE id=? AND status NOT IN ('verified','verified_test')").bind(q.id).run();return {status:'review',reviewReason:'legacy_quote_retired'}}
 if(q.status==='verified'||q.status==='verified_test'||q.status==='review')return presentQuote(q);
 await chainCheck(env,q.chain_id);
 const tx=await rpc(env,q.chain_id,'eth_getTransactionByHash',[hash]);
 if(!tx)return {status:'pending'};
 if(tx.hash?.toLowerCase()!==hash||tx.from?.toLowerCase()!==q.sender||tx.to?.toLowerCase()!==q.token||tx.input?.toLowerCase()!==paymentData(q)||BigInt(tx.value||'0x0')!==0n)return {status:'mismatch'};
 await env.DB.prepare("UPDATE payment_quotes SET tx_hash=?,status='submitted',updated_at=? WHERE id=? AND tx_hash IS NULL AND status='awaiting_payment'").bind(hash,Date.now(),q.id).run();
 const pinned=await env.DB.prepare('SELECT tx_hash FROM payment_quotes WHERE id=?').bind(q.id).first<{tx_hash:string}>();if(pinned?.tx_hash!==hash)return {status:'mismatch'};
 const receipt=await rpc(env,q.chain_id,'eth_getTransactionReceipt',[hash]);if(!receipt)return {status:'pending'};
 if(receipt.status!=='0x1'){
  await env.DB.prepare("UPDATE payment_quotes SET status='review',review_reason='transaction_failed',updated_at=? WHERE id=? AND status='submitted'").bind(Date.now(),q.id).run();return {status:'review'};
 }
 const final=await rpc(env,q.chain_id,'eth_getBlockByNumber',['finalized',false]);
 if(!final?.number||Number(receipt.blockNumber)>Number(final.number))return {status:'pending'};
 const block=await rpc(env,q.chain_id,'eth_getBlockByNumber',[receipt.blockNumber,false]);
 if(!block?.hash||block.hash.toLowerCase()!==receipt.blockHash?.toLowerCase())return {status:'pending'};
 const log=receipt.logs?.find((x:any)=>!x.removed&&x.address?.toLowerCase()===q.token&&x.topics?.[0]===transferTopic&&x.topics[1]?.toLowerCase()===padAddress(q.sender)&&x.topics[2]?.toLowerCase()===padAddress(q.treasury)&&BigInt(x.data)===BigInt(q.token_minor));
 const paidAt=Number(block.timestamp)*1000;
 const reason=!log?'transfer_mismatch':!Number.isFinite(paidAt)||paidAt<q.created_at-30000||paidAt>q.expires_at?'quote_expired':null;
 if(reason){await env.DB.prepare("UPDATE payment_quotes SET status='review',review_reason=?,updated_at=? WHERE id=? AND status='submitted'").bind(reason,Date.now(),q.id).run();return {status:'review',reviewReason:reason}}
 const writes=[env.DB.prepare("UPDATE payment_quotes SET status=?,verified_at=?,updated_at=? WHERE id=? AND tx_hash=? AND status='submitted'").bind(q.chain_id===42220?'verified':'verified_test',Date.now(),Date.now(),q.id,hash)];
 if(q.chain_id===42220){
  writes.push(env.DB.prepare(`INSERT INTO funding_receipts(id,user_id,asset,amount_minor,chain_id,tx_hash,settled_at)
   SELECT id,user_id,symbol,funding_minor,chain_id,?,? FROM payment_quotes WHERE id=? AND status='verified' AND purpose='funding' AND tx_hash=? ON CONFLICT(tx_hash) DO NOTHING`).bind(hash,new Date(paidAt).toISOString(),q.id,hash));
  writes.push(env.DB.prepare(`INSERT OR IGNORE INTO deposit_promotions(user_id,qualifying_receipt) SELECT user_id,id FROM funding_receipts WHERE id=?`).bind(q.id));
  writes.push(env.DB.prepare("INSERT INTO audit_events(id,user_id,event_type,detail) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING").bind('deposit:'+q.id,q.user_id,'funding_verified',JSON.stringify({quoteId:q.id,chainId:q.chain_id,txHash:hash,asset:q.symbol,amountMinor:q.token_minor})));

 }
 await env.DB.batch(writes);
 return {status:q.chain_id===42220?'verified':'verified_test'};
}
export async function reconcilePayments(env:PaymentEnv){
 // Verification remains enabled when collection is paused, so already sent funds can settle.
 const rows=await env.DB.prepare("SELECT * FROM payment_quotes WHERE status IN ('awaiting_payment','submitted') AND created_at>? ORDER BY updated_at LIMIT 20").bind(Date.now()-7*86400000).all<any>();
 for(const q of rows.results){try{
  if(q.tx_hash){await verifyQuote(env,q,q.tx_hash);continue}
  await chainCheck(env,q.chain_id);const final=await rpc(env,q.chain_id,'eth_getBlockByNumber',['finalized',false]);if(!final?.number)continue;
  const end=Math.min(q.next_block+499,Number(final.number));if(end<q.next_block)continue;
  const logs=await rpc(env,q.chain_id,'eth_getLogs',[{address:q.token,fromBlock:'0x'+q.next_block.toString(16),toBlock:'0x'+end.toString(16),topics:[transferTopic,padAddress(q.sender),padAddress(q.treasury)]}]);
  for(const log of logs){if(!log.removed){const result=await verifyQuote(env,q,log.transactionHash.toLowerCase());if(result.status!=='mismatch'&&result.status!=='pending')break}}
  await env.DB.prepare('UPDATE payment_quotes SET next_block=?,updated_at=? WHERE id=?').bind(end+1,Date.now(),q.id).run();
 }catch{console.error('Payment reconciliation deferred',q.id)}}
}
