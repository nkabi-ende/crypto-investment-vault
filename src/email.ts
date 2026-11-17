/** Transactional mail integration. Delivery is opt-in; signup never depends on a provider. */
export type MailEnvironment = {
 DB: D1Database;
 APP_ORIGIN: string;
 EMAIL_DELIVERY_ENABLED?: string;
 RESEND_API_KEY?: string;
 EMAIL_FROM?: string;
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
export async function deliverEmails(env: MailEnvironment) {
 if (env.EMAIL_DELIVERY_ENABLED !== 'true' || !env.RESEND_API_KEY || !env.EMAIL_FROM) return;
 // Claim each job with a lease. Retries use the same provider idempotency key.
 const now = Date.now();
 const jobs = await env.DB.prepare("SELECT id FROM email_outbox WHERE attempts<8 AND available_at<=? AND (status='pending' OR (status='sending' AND lease_until<?)) ORDER BY available_at LIMIT 10").bind(now, now).all<{id:string}>();
 for (const job of jobs.results) {
  const claimed = await env.DB.prepare("UPDATE email_outbox SET status='sending',lease_until=?,attempts=attempts+1 WHERE id=? AND attempts<8 AND (status='pending' OR (status='sending' AND lease_until<?)) RETURNING user_id,attempts").bind(now+60000, job.id, now).first<{user_id:string,attempts:number}>();
  if (!claimed) continue;
  try {
   const account = await env.DB.prepare('SELECT u.email,p.display_name FROM users u LEFT JOIN account_profiles p ON p.user_id=u.id WHERE u.id=?').bind(claimed.user_id).first<{email:string,display_name:string|null}>();
   if (!account) throw Error('ACCOUNT_UNAVAILABLE');
   const message = welcomeEmail(account.display_name || 'there', env.APP_ORIGIN);
   const response = await fetch('https://api.resend.com/emails', {
    method:'POST', headers:{'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','User-Agent':'CIV/1.0','Idempotency-Key':job.id},
    body:JSON.stringify({from:env.EMAIL_FROM,to:[account.email],...message}), signal:AbortSignal.timeout(10000)
   });
   if (!response.ok) throw Error(`PROVIDER_HTTP_${response.status}`);
   const result = await response.json() as {id:string};
   await env.DB.prepare("UPDATE email_outbox SET status='sent',sent_at=CURRENT_TIMESTAMP,provider_id=?,lease_until=NULL,last_error=NULL WHERE id=?").bind(result.id,job.id).run();
  } catch (error) {
   // Only store a code, never a provider body, credential, address or email contents.
   const code = error instanceof Error && /^(PROVIDER_HTTP_\d+|ACCOUNT_UNAVAILABLE)$/.test(error.message) ? error.message : 'DELIVERY_UNAVAILABLE';
   await env.DB.prepare("UPDATE email_outbox SET status=?,available_at=?,lease_until=NULL,last_error=? WHERE id=?").bind(claimed.attempts>=8?'failed':'pending',Date.now()+Math.min(3600000,60000*2**claimed.attempts),code,job.id).run();
  }
 }
}
