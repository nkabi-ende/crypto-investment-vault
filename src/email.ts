/** Transactional mail integration. Delivery is opt-in; signup never depends on a provider. */
export type MailEnvironment = {
 DB: D1Database;
 APP_ORIGIN: string;
 EMAIL_DELIVERY_ENABLED?: string;
 RESEND_API_KEY?: string;
 EMAIL_FROM?: string;
 EMAIL_PROVIDER?: 'resend' | 'zoho';
 SIGNUP_ALERTS_ENABLED?: string;
 SIGNUP_ALERT_TO?: string;
 ZOHO_REGION?: string;
 ZOHO_MAIL_ACCOUNT_ID?: string;
 ZOHO_FROM_ADDRESS?: string;
 ZOHO_CLIENT_ID?: string;
 ZOHO_CLIENT_SECRET?: string;
 ZOHO_REFRESH_TOKEN?: string;
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function welcomeEmail(name: string, origin: string) {
 const dashboard = new URL('/dashboard', origin).href;
 return {
  subject: 'Welcome to your CIV vault',
  text: `Hi ${name},\n\nYour Crypto Investment Vault account is ready. Sign in to view your dashboard, account activity and MiniPay availability. Your member ID is your referral code. The minimum deposit is 100 USDC or USDT, with 200 as the next option. CIV is a platform, not a token. R1,000 is a separate deposit promotion with terms pending; it is not an activation fee.\n\n${dashboard}\n\nOnly use the payment network and status shown in your dashboard. Test tokens have no monetary value. CIV will never ask for your password or wallet recovery phrase.\n\nCrypto Investment Vault`,
  html: `<div style="background:#0b1011;padding:40px 24px;font-family:Arial,sans-serif;color:#f4f8f5;max-width:560px"><p style="color:#b5f269;font-weight:bold;letter-spacing:3px">CIV / CRYPTO INVESTMENT VAULT</p><h1>Your vault is ready.</h1><p>Hi ${escapeHtml(name)}, welcome to CIV.</p><p>View your dashboard, account activity and MiniPay availability. Your member ID is your referral code. The minimum deposit is 100 USDC or USDT, with 200 as the next option. CIV is a platform, not a token. R1,000 is a separate deposit promotion with terms pending; it is not an activation fee.</p><p style="padding:20px 0"><a href="${escapeHtml(dashboard)}" style="background:#b5f269;color:#0b1011;padding:15px 22px;border-radius:12px;text-decoration:none;font-weight:bold">Open my vault →</a></p><p style="color:#b2bfb7;font-size:13px">Only use the payment network and status shown in your dashboard. Test tokens have no monetary value. We will never ask for your password or wallet recovery phrase.</p></div>`
 };
}

const zohoRegions: Record<string,{accounts:string,mail:string}> = {
 us:{accounts:'accounts.zoho.com',mail:'mail.zoho.com'},
 eu:{accounts:'accounts.zoho.eu',mail:'mail.zoho.eu'},
 in:{accounts:'accounts.zoho.in',mail:'mail.zoho.in'},
 au:{accounts:'accounts.zoho.com.au',mail:'mail.zoho.com.au'},
 jp:{accounts:'accounts.zoho.jp',mail:'mail.zoho.jp'},
 ca:{accounts:'accounts.zohocloud.ca',mail:'mail.zohocloud.ca'},
 cn:{accounts:'accounts.zoho.com.cn',mail:'mail.zoho.com.cn'},
 ae:{accounts:'accounts.zoho.ae',mail:'mail.zoho.ae'},
 sa:{accounts:'accounts.zoho.sa',mail:'mail.zoho.sa'}
};
const emailAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const alertAddress = (env:MailEnvironment) => env.SIGNUP_ALERT_TO || 'info@cryptoinvestmentvault.com';

export function emailProviderReady(env:MailEnvironment):boolean {
 if(env.EMAIL_PROVIDER==='zoho')return Boolean(
  zohoRegions[env.ZOHO_REGION||'us'] &&
  env.ZOHO_MAIL_ACCOUNT_ID && /^\d+$/.test(env.ZOHO_MAIL_ACCOUNT_ID) &&
  env.ZOHO_FROM_ADDRESS && emailAddress.test(env.ZOHO_FROM_ADDRESS) &&
  env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET && env.ZOHO_REFRESH_TOKEN
 );
 return (env.EMAIL_PROVIDER===undefined||env.EMAIL_PROVIDER==='resend') && Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export function signupAlertEmail(name:string,email:string,memberId:string,origin:string,createdAt:string) {
 const admin = new URL('/admin',origin).href;
 const details = 'Member: '+name+'\nEmail: '+email+'\nMember ID: '+memberId+'\nAccount created (UTC): '+createdAt;
 return {
  subject:'CIV | New account created',
  text:'A new Crypto Investment Vault account has been created.\n\n'+details+'\n\nThis records registration only, not email verification or funding.\n\nCIV admin: '+admin+'\n\nAutomated operational notification.',
  html:'<div style="font-family:Arial,sans-serif;max-width:580px;padding:30px;background:#0b1011;color:#f4f8f5">'
   +'<p style="color:#b5f269;font-weight:bold;letter-spacing:2px">CIV / MEMBER OPERATIONS</p>'
   +'<h1>New account created</h1><p>A new member successfully registered on Crypto Investment Vault.</p>'
   +'<table style="color:#f4f8f5;border-collapse:collapse;line-height:1.9">'
   +'<tr><td style="padding-right:22px">Name</td><td>'+escapeHtml(name)+'</td></tr>'
   +'<tr><td style="padding-right:22px">Email</td><td>'+escapeHtml(email)+'</td></tr>'
   +'<tr><td style="padding-right:22px">Member ID</td><td>'+escapeHtml(memberId)+'</td></tr>'
   +'<tr><td style="padding-right:22px">Created (UTC)</td><td>'+escapeHtml(createdAt)+'</td></tr>'
   +'</table><p style="color:#b5bfb7">Registration only. Email identity and deposits have not been verified by this alert.</p>'
   +'<p><a href="'+escapeHtml(admin)+'" style="color:#b5f269">Open CIV admin</a></p></div>'
 };
}
type OutboundMessage={subject:string;text:string;html:string};
async function zohoAccessToken(env:MailEnvironment):Promise<string> {
 const host=zohoRegions[env.ZOHO_REGION||'us'].accounts;
 const body=new URLSearchParams({
  grant_type:'refresh_token',
  client_id:env.ZOHO_CLIENT_ID!,
  client_secret:env.ZOHO_CLIENT_SECRET!,
  refresh_token:env.ZOHO_REFRESH_TOKEN!
 });
 const response=await fetch('https://'+host+'/oauth/v2/token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:body.toString(),signal:AbortSignal.timeout(10000)
 });
 if(!response.ok)throw Error('OAUTH_HTTP_'+response.status);
 const result=await response.json() as {access_token?:string};
 if(!result.access_token)throw Error('OAUTH_TOKEN_INVALID');
 return result.access_token;
}
async function sendEmail(env:MailEnvironment,jobId:string,to:string,message:OutboundMessage,getZohoToken:()=>Promise<string>):Promise<string> {
 if(env.EMAIL_PROVIDER==='zoho'){
  const token=await getZohoToken(),host=zohoRegions[env.ZOHO_REGION||'us'].mail;
  const response=await fetch('https://'+host+'/api/accounts/'+env.ZOHO_MAIL_ACCOUNT_ID+'/messages',{
   method:'POST',
   headers:{'Authorization':'Zoho-oauthtoken '+token,'Content-Type':'application/json','Accept':'application/json'},
   body:JSON.stringify({fromAddress:env.ZOHO_FROM_ADDRESS,toAddress:to,subject:message.subject,content:message.html,mailFormat:'html'}),
   signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw Error('PROVIDER_HTTP_'+response.status);
  const result=await response.json() as {status?:{code:number|string},data?:{messageId?:string}};
  if(Number(result.status?.code)!==200 || !result.data?.messageId)throw Error('ZOHO_RESPONSE_INVALID');
  return String(result.data.messageId);
 }
 const response=await fetch('https://api.resend.com/emails',{
  method:'POST',headers:{'Authorization':'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','User-Agent':'CIV/1.0','Idempotency-Key':jobId},
  body:JSON.stringify({from:env.EMAIL_FROM,to:[to],...message}),signal:AbortSignal.timeout(10000)
 });
 if(!response.ok)throw Error('PROVIDER_HTTP_'+response.status);
 const result=await response.json() as {id?:string};
 if(!result.id)throw Error('PROVIDER_RESPONSE_INVALID');
 return result.id;
}

export async function sendPasswordReset(env:MailEnvironment, to:string, token:string) {
 const resetPage = new URL('/reset-password', env.APP_ORIGIN);
 // A fragment keeps the token out of HTTP request URLs and access logs.
 resetPage.hash = token;
 await sendEmail(env, crypto.randomUUID(), to, {
  subject: 'Reset your CIV password',
  text: 'Use this link within 30 minutes to reset your CIV password. If you did not request this, you can ignore this email.\n\n' + resetPage.href,
  html: '<h1>Reset your CIV password</h1><p>Use this link within 30 minutes.</p><p><a href="' + escapeHtml(resetPage.href) + '">Choose a new password</a></p><p>If you did not request this, you can ignore this email.</p>'
 }, () => zohoAccessToken(env));
}

/** Process opted-in outbox event types. No third-party delivery is required for signup success. */
export async function deliverEmails(env:MailEnvironment) {
 if(!emailProviderReady(env))return;
 const enabled:string[]=[];
 if(env.EMAIL_DELIVERY_ENABLED==='true')enabled.push('account.welcome.v1');
 if(env.SIGNUP_ALERTS_ENABLED==='true'&&emailAddress.test(alertAddress(env)))enabled.push('account.signup.alert.v1');
 if(!enabled.length)return;
 const now=Date.now();
 const placeholders=enabled.map(()=>'?').join(',');
 const jobs=await env.DB.prepare("SELECT id FROM email_outbox WHERE event_type IN ("+placeholders+") AND attempts<8 AND available_at<=? AND (status='pending' OR (status='sending' AND lease_until<?)) ORDER BY available_at LIMIT 10")
  .bind(...enabled,now,now).all<{id:string}>();
 let token:Promise<string>|undefined;
 const getZohoToken=()=>token ??= zohoAccessToken(env);
 for(const job of jobs.results) {
  const claimed=await env.DB.prepare("UPDATE email_outbox SET status='sending',lease_until=?,attempts=attempts+1 WHERE id=? AND attempts<8 AND (status='pending' OR (status='sending' AND lease_until<?)) RETURNING user_id,event_type,created_at,attempts")
   .bind(now+60000,job.id,now).first<{user_id:string,event_type:string,created_at:string,attempts:number}>();
  if(!claimed)continue;
  try{
   const account=await env.DB.prepare('SELECT u.email,p.display_name FROM users u LEFT JOIN account_profiles p ON p.user_id=u.id WHERE u.id=?')
    .bind(claimed.user_id).first<{email:string,display_name:string|null}>();
   if(!account)throw Error('ACCOUNT_UNAVAILABLE');
   const isAlert=claimed.event_type==='account.signup.alert.v1';
   const to=isAlert?alertAddress(env):account.email;
   const message=isAlert
    ?signupAlertEmail(account.display_name||'Member',account.email,claimed.user_id,env.APP_ORIGIN,claimed.created_at)
    :welcomeEmail(account.display_name||'there',env.APP_ORIGIN);
   const providerId=await sendEmail(env,job.id,to,message,getZohoToken);
   await env.DB.prepare("UPDATE email_outbox SET status='sent',sent_at=CURRENT_TIMESTAMP,provider_id=?,lease_until=NULL,last_error=NULL WHERE id=?")
    .bind(providerId,job.id).run();
  }catch(error){
   // No provider response bodies, emails, tokens or passwords are persisted in diagnostic logs.
   const code=error instanceof Error && /^(PROVIDER_HTTP_\d+|OAUTH_HTTP_\d+|ACCOUNT_UNAVAILABLE|OAUTH_TOKEN_INVALID|ZOHO_RESPONSE_INVALID|PROVIDER_RESPONSE_INVALID)$/.test(error.message)
    ?error.message:'DELIVERY_UNAVAILABLE';
   await env.DB.prepare("UPDATE email_outbox SET status=?,available_at=?,lease_until=NULL,last_error=? WHERE id=?")
    .bind(claimed.attempts>=8?'failed':'pending',Date.now()+Math.min(3600000,60000*2**claimed.attempts),code,job.id).run();
  }
 }
}
