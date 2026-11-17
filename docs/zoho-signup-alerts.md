# CIV signup and account-creation alerts — Zoho Mail

## Behavior

Every new `users` row creates an `account.signup.alert.v1` email-outbox record through the `0022_signup_alert_emails.sql` database trigger, in the same SQLite transaction. The public registration form also creates its existing `account.welcome.v1` job. A failed or duplicate account insert does not generate a signup alert.

The five-minute Cloudflare Worker cron sends each eligible alert to **info@cryptoinvestmentvault.com**, subject **CIV | New account created**. The email contains the display name, email, member ID and account-creation UTC timestamp, plus a link to the restricted CIV admin page. It explicitly does not claim the member is verified, funded or approved. It never includes passwords, password hashes, session cookies, IP addresses, wallet balances or KYC documents.

`SIGNUP_ALERTS_ENABLED` and `EMAIL_DELIVERY_ENABLED` are intentionally independent. The former sends internal notifications; the latter controls **customer** welcome emails and remains disabled for now. Jobs are leased, retried with backoff and marked sent only after the provider accepts them. An alert that remains pending is not evidence of successful delivery. Once delivered, the database won't dispatch the sent job again. Zoho Mail's send API does not document a per-message idempotency key, so a timeout after acceptance could still produce a duplicate email on retry.

## One-time production setup

1. Verify **info@cryptoinvestmentvault.com** is an active Zoho Mail mailbox (or a recipient that really delivers to the intended operator). Send it a test email and confirm receipt. In Zoho Mail, check whether the browser address is `mail.zoho.com` (US), `mail.zoho.eu`, `mail.zoho.in`, etc. Set `ZOHO_REGION` in `wrangler.toml` to match: `us`, `eu`, `in`, `au`, `jp`, `ca`, `cn`, `ae`, or `sa`. The repository currently defaults to `us`, **which must be checked**.
2. As the owner of the *sending* mailbox (currently configured `ZOHO_FROM_ADDRESS="info@cryptoinvestmentvault.com"`), visit [Zoho API Console](https://api-console.zoho.com/). Create a **Self Client** for this server-to-server automation. Use the least-privileged scopes `ZohoMail.messages.CREATE,ZohoMail.accounts.READ` (the second scope is needed only to retrieve the Mail Account ID). Generate a temporary authorization code.
3. Exchange that code on your **own computer** with the correct regional `https://accounts.zoho.<region>/oauth/v2/token` endpoint, using `grant_type=authorization_code`, the Self Client ID/secret and code. Save the returned **refresh token privately**. You may use `GET https://mail.zoho.<region>/api/accounts` with the initial access token to find the Zoho **Mail Account ID**, not the organization or user ID.
4. Set **Cloudflare Worker production Secrets**, not plaintext repository variables or GitHub files, using `npx wrangler secret put <SECRET_NAME>`, for: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` and `ZOHO_MAIL_ACCOUNT_ID`. Keep `ZOHO_FROM_ADDRESS` as an email address authorized for the OAuth mailbox. Do not send OAuth credentials or tokens in chats, screenshots, logs or issue comments.
5. Check `cryptoinvestmentvault.com` Zoho MX, SPF, DKIM and DMARC settings in the Zoho Admin Console. No additional SMTP service, inbound MX record or Resend account is necessary when using the configured Zoho Mail API provider.
6. Deploy the Worker (the GitHub production workflow applies `0022` before code) and ensure `/api/ready` returns `schema: 22`. Create one **new test CIV account** with an address you control, then inspect the info@ inbox. The scheduled dispatcher runs every five minutes; a successfully accepted event should show `status='sent'` and a Zoho `provider_id` in D1. You can inspect safely with a narrowly scoped D1 query:
   ```sql
   SELECT event_type, status, attempts, last_error, created_at, sent_at
   FROM email_outbox
   WHERE event_type='account.signup.alert.v1'
   ORDER BY created_at DESC LIMIT 10;
   ```
   Don't query or copy password-related columns.

## Provider and failure behavior

- `EMAIL_PROVIDER="zoho"`: uses Zoho's HTTPS Mail API, refreshes an access token server-side and accepts only known Zoho regional hostnames. The OAuth token is never sent to the browser.
- If any required secret or regional configuration is missing, new alerts **remain queued** while account registration keeps working. No claim of live delivery should be made until a real test succeeds.
- Error codes stored in `last_error` never include provider response bodies, tokens, credentials or customer email content.
- A broken SMTP/MX setup can stop **receiving** mail even when Zoho accepted the API send. Check the recipient inbox, not just the outgoing API response.
- Previously created accounts do **not** get retroactive messages from this migration. Backfill deliberately rather than sending unapproved bulk notifications to the live operations mailbox.
- To pause notifications without changing account registration, set `SIGNUP_ALERTS_ENABLED="false"` and deploy. To enable welcome emails later, set `EMAIL_DELIVERY_ENABLED="true"` only after reviewing the existing backlog and customer-facing template.

Official documentation: [Zoho Mail sending endpoint](https://www.zoho.com/mail/help/api/post-send-an-email.html), [Zoho OAuth](https://www.zoho.com/mail/help/api/using-oauth-2.html), [Mail regional endpoints](https://www.zoho.com/mail/help/api/getting-started-with-api.html).
