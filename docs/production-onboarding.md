# CIV production onboarding

## Public entry points

- General signup: https://cryptoinvestmentvault.com/join
- Returning investor: https://cryptoinvestmentvault.com/dashboard
- Signed-in users receive a stable `/r/<user-id>` invitation in the dashboard.

The Worker serves complete HTML including OpenGraph/Twitter tags on invitation routes. The 1200×630 PNG is versioned at `/og-invitation-v1.png` so crawlers do not reuse the previous card. Preview caches are controlled by each sharing service. Personal links use the member’s signup UUID, record one immutable inviter at registration, and expose no names or email addresses. The UUID is a public identifier and does not grant account access. The dashboard separates joined members from those activated by a verified R500 signup deposit. No cash compensation is configured. Referral codes are public identifiers, never login credentials. Browser attribution expires after 30 days and a newer invitation replaces the previous one. Invalid codes do not block direct signup.

## Database and authentication

The existing production database is D1 `civ-db`, ID `f0a267d4-f8dc-4106-a3d8-3e7f7453dce9`. Do not create a replacement database or reset balances. Migration 0008 adds profiles, consent version/time, referral codes/attribution, transactional email outbox, and indexes. Migration 0009 removes ownerless campaign attribution, provisions links for existing members, prevents self-referrals and attribution changes, and adds signup deposit requirements and perk definitions. The obsolete campaign seed has also been removed from 0008 for new installations; existing production installations are cleaned by 0009. Valid member referral history and older compact member links are retained; compact links redirect to the full member ID. It preserves all previous data. New account, profile, zero portfolio, referral attribution, welcome event and session are created in one D1 batch transaction. Failed batches roll back without a session cookie. Existing accounts receive member links during migration 0009; they are not assigned fabricated historical consent or a verification state.

Passwords retain the existing versioned derivation for compatibility. Sessions use HttpOnly, Secure on HTTPS, SameSite=Strict cookies, rotate on login and are removed on logout. Expired sessions and old authentication-attempt records are pruned by cron. Passwords and session credentials never enter localStorage. The browser retains an invitation code only. Registration requires a name, validated email, 12–128-character password and explicit Terms/Privacy/Risk acceptance. Login supports existing passwords and rejects oversized input before derivation.

Authentication requests are limited through the `AUTH_LIMITER` binding before D1/password work, plus an atomic per-email failure lockout. Edge counters are approximate and per Cloudflare location. This is abuse protection, not a guarantee of global quotas. The public readiness endpoint validates required schema columns without returning account data. Raw database/provider errors are not sent to users.

Email ownership verification and self-service password recovery are not active. Accounts are explicitly reported as unverified. Do not use the welcome message as evidence of verification. A future verification/recovery integration must use expiring, hashed, single-use tokens with generic request responses. No real-money rails should rely on an unverified address.

## Deploy and verify

1. Run `npm ci` and `npm run check`. The tests create an isolated local D1 and apply every migration in order.
2. Deployment applies `wrangler d1 migrations apply civ-db --remote` before shipping code. Confirm the existing Cloudflare credentials and production environment are available to GitHub Actions. A failed migration stops deployment.
3. `npm run test:smoke` checks `/api/ready` (schema 10), signup/referral HTML, PNG content, unauthenticated API isolation and disabled live rails. It does not create accounts or send messages.
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

## R500 membership activation and perks

Every new registration atomically creates a ZAR 50,000-cent signup deposit requirement; existing accounts are backfilled without inventing a payment. `src/membership.ts` derives activation and referral qualification from settled production `signup_deposits`, net of refunds. A partial payment remains pending; reaching R500 activates the membership. A refund below R500 removes qualification and locks conditional perks again. The account retains dashboard access while activation is pending. Signup does not debit a wallet or credit a bonus.

Live collection is not connected. The dashboard and registration disclose this, and the API always reports `collectionEnabled:false`. There is no client-accessible confirmation endpoint. A future trusted payment adapter must authenticate the provider event (or verify mainnet finality, token, sender, treasury and account intent), validate the server-held quote, and write a settled receipt only after confirmation. Each `(provider,payment_ref)` is unique to prevent replay or cross-account claims. `amount_minor` is the actual settled ZAR value, not a raw stablecoin amount. Foreign-currency payments require a stored, verifiable conversion quote; never equate 500 USDC or test tokens with R500. Refunds update `refunded_minor` on that same receipt. Financial audit and reconciliation controls belong in the payment adapter before it goes live. This table does not credit the existing USDT investment ledger.

`member_perks` supports `activated_members` community milestones and `qualified_referrals` personal milestones. An activated member unlocks a published perk when its threshold is met. Draft and paused perks are hidden, and refund changes are reflected on the next dashboard load. No perk names, thresholds, payouts, or compensation have been invented or published. To launch a perk, add its actual terms as a draft through an authenticated operator database workflow, set the metric and positive threshold, then publish it. The current read model controls displayed eligibility; future protected perk functionality must check the same eligibility server-side on every use. There is no public administration endpoint or cash reward ledger.

## Expiring MiniPay membership quotes (migration 0010)

`src/payments.ts` supports production Celo (42220) USDT and native USDC, plus Sepolia USDC (11142220) tests. Collection defaults OFF. The server fetches the chosen token's ZAR price from CoinGecko, rejects observations older than three minutes or materially in the future, floors the price to micro-ZAR and rounds the payable token amount UP at six decimals. No fixed USD/ZAR rate or assumption that either token equals exactly one dollar is used. A quote stores its source, observation time, exact amount, payer, token, treasury, ZAR credit and five-minute expiry. Fees are additional. The quote locks the conversion value; it is not a promise of subsequent conversion into fiat rand.

Checkout requires a second action to review the payment in MiniPay. It never initiates a payment on account creation. The quote ID is appended to ERC-20 transfer calldata and checked against the actual transaction, making copied hashes unusable for another quote or account. Receipt verification requires a successful canonical finalized block, exact Transfer log, token, sender, treasury and amount. Block inclusion must be within the quote lifetime. Late transfers or failed/mismatched receipts enter review and do not create an automatic membership credit. A stable `(celo-mainnet,transaction-hash)` key, unique quote transaction constraint and transactional settlement prevent duplicate credits. Quote terms are immutable. Verification continues when new collection is paused.

The five-minute cron scans up to 20 pending quotes, at most 500 finalized blocks per quote per run, to recover transfers after the payer closes their browser. Pending transactions already submitted through the API are rechecked. Recovery scans cover seven days from quote creation; older unresolved payments require operator reconciliation. A transient RPC failure leaves the cursor for retry. RPC capacity and the pending backlog must be monitored; the public Forno RPC should be replaced with a provisioned authenticated endpoint for sustained volume.

### Operator configuration after receiving-wallet confirmation

1. Set `CELO_TEST_TREASURY_ADDRESS` to the confirmed test wallet, `PAYMENT_MODE="testnet"`, and `PAYMENTS_ENABLED="true"`. Sepolia RPC and the verified six-decimal test USDC contract are already configured. Provide a CoinGecko Demo API key as the `COINGECKO_DEMO_API_KEY` Worker secret for reliable price access. Open `/dashboard` inside MiniPay's test environment and use the USDC quote checkout. Confirm `verified_test` and no production activation.
2. Confirm control of the production receiving address, then set `CELO_MAINNET_TREASURY_ADDRESS`. Configure a production `CELO_MAINNET_RPC_URL`, retain the canonical hardcoded USDT/USDC token allowlist, and set `PAYMENT_MODE="production"`. Start with `PAYMENTS_ENABLED="false"` while reviewing settings.
3. Set `PAYMENTS_ENABLED="true"` for a controlled real-wallet canary. The wallet owner approves the transfer on their device. Check the transaction on Celo, the quote's `verified` state, the matching `signup_deposits` receipt, and the member's activated status. Check cancellation, refresh/return after payment and quote expiry as well. Do not interpret mocked tests as evidence that a real MiniPay transfer passed.
4. Review any `review` payments against chain receipts and the stored quote before resolving manually. Never ask a member to repeat a payment without reconciling their earlier transfer. Use `refunded_minor` only after an actual refund is confirmed; this system does not send refunds or payouts.
5. Deploy through the existing GitHub workflow so migrations and smoke checks run. Investment funding, payouts, withdrawals and trading remain separate and disabled. The new public config is `/api/payments/config`; `/api/celo/config` describes the legacy sandbox only.

Remaining launch dependencies: confirmed test and production receiving addresses, successful real-device transfer and cancellation/expiry checks, reliable RPC/price-provider capacity, and a staffed reconciliation process. No treasury address, seed phrase or signing key has been fabricated or stored by this change. Mainnet collection remains disabled in the committed configuration.
