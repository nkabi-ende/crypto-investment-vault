# CIV production onboarding

## Public entry points

- General signup: https://cryptoinvestmentvault.com/join
- KZN launch attribution: https://cryptoinvestmentvault.com/r/kzn-ai
- Returning investor: https://cryptoinvestmentvault.com/dashboard
- Signed-in users receive a stable `/r/<opaque-code>` invitation in the dashboard.

The Worker serves complete HTML including OpenGraph/Twitter tags on invitation routes. The 1200×630 PNG is versioned at `/og-invitation-v1.png` so crawlers do not reuse the previous card. Preview caches are controlled by each sharing service. Personal links attribute completed registrations only, do not expose identities, and do not award compensation. Referral codes are public identifiers, never login credentials. Browser attribution expires after 30 days and a newer invitation replaces the previous one. Invalid codes do not block direct signup.

## Database and authentication

The existing production database is D1 `civ-db`, ID `f0a267d4-f8dc-4106-a3d8-3e7f7453dce9`. Do not create a replacement database or reset balances. Migration 0008 adds profiles, consent version/time, referral codes/attribution, transactional email outbox, and indexes. It preserves all previous data. New account, profile, zero portfolio, referral attribution, welcome event and session are created in one D1 batch transaction. Failed batches roll back without a session cookie. Existing accounts receive referral codes lazily; they are not assigned fabricated historical consent or a verification state.

Passwords retain the existing versioned derivation for compatibility. Sessions use HttpOnly, Secure on HTTPS, SameSite=Strict cookies, rotate on login and are removed on logout. Expired sessions and old authentication-attempt records are pruned by cron. Passwords and session credentials never enter localStorage. The browser retains an invitation code only. Registration requires a name, validated email, 12–128-character password and explicit Terms/Privacy/Risk acceptance. Login supports existing passwords and rejects oversized input before derivation.

Authentication requests are limited through the `AUTH_LIMITER` binding before D1/password work, plus an atomic per-email failure lockout. Edge counters are approximate and per Cloudflare location. This is abuse protection, not a guarantee of global quotas. The public readiness endpoint validates required schema columns without returning account data. Raw database/provider errors are not sent to users.

Email ownership verification and self-service password recovery are not active. Accounts are explicitly reported as unverified. Do not use the welcome message as evidence of verification. A future verification/recovery integration must use expiring, hashed, single-use tokens with generic request responses. No real-money rails should rely on an unverified address.

## Deploy and verify

1. Run `npm ci` and `npm run check`. The tests create an isolated local D1 and apply every migration in order.
2. Deployment applies `wrangler d1 migrations apply civ-db --remote` before shipping code. Confirm the existing Cloudflare credentials and production environment are available to GitHub Actions. A failed migration stops deployment.
3. `npm run test:smoke` checks `/api/ready` (schema 8), signup/referral HTML, PNG content, unauthenticated API isolation and disabled live rails. It does not create accounts or send messages.
4. Verify on a phone: follow the launch link, create an account, reload the dashboard, sign out/in, copy/share the personal invitation and register a second account through it. The inviter sees one registration, never the other person's email.
5. Observe 5xx/429s in Workers logs and D1 usage in Cloudflare. Paid-plan capacity and restoration retention must be checked in the account; the repository cannot prove the account's plan or quotas. Use D1 Time Travel to obtain a bookmark before manual operational migrations. Never restore production without a reviewed recovery plan.

## Welcome email: prepared, delivery disabled

Every new registration adds one `account.welcome.v1` event atomically. The dashboard accurately says delivery is awaiting connection. The branded text/HTML template is in `src/email.ts`. No provider credentials or message body are exposed via the web API.

An optional Resend adapter is included for later activation:

- Verify a sending domain with the provider.
- Set the Worker secret `RESEND_API_KEY` and a verified `EMAIL_FROM`.
- Set `EMAIL_DELIVERY_ENABLED="true"` only when ready to deliver queued welcome messages, including earlier registrations.
- The five-minute cron claims up to 10 messages, leases each job, and retries using a stable provider idempotency key, with exponential backoff and a maximum of 8 attempts. Status failures store codes only. Jobs that exhaust attempts become `failed` for operator review.
- Keep the delivery flag false while configuring. Account creation succeeds independently of provider availability. Verification and password-reset messages require a separate implementation.

## MiniPay: remaining launch configuration

The dashboard connects to the existing account-bound Celo Sepolia test-USDC intent and verification endpoints. Successful test transfers are recorded in `celo_test_credits`, separate from the real USDT ledger. The UI states the actual configuration and disables transfer controls when the treasury is missing. It does not ask for seed phrases or initiate a transfer automatically.

The production API inspected on 16 November 2026 reported `treasuryAddress:null`, `ready:false`, `liveDepositsEnabled:false`. To finish the test transfer flow, supply the intended `CELO_TEST_TREASURY_ADDRESS` as a Worker variable, confirm RPC/chain/token settings and use MiniPay developer mode. Never invent a treasury address or reuse test credits as real funds. Mainnet deposit accounting, live-asset/network configuration, verified-account funding requirements and a live treasury rollout remain separate work. This change does not enable funding, withdrawals, payouts or trading, and does not publish unprovided legal approval documents.
