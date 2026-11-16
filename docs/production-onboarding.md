# CIV member accounts and stablecoin funding

## Current product rules

CIV is a platform, not a token. Members deposit actual USDC or USDT on Celo mainnet. The minimum is 100 token units, with 200 as the next preset. Dollar labels are references to the tokens' intended dollar pegs, not a guaranteed USD or ZAR conversion. Every subsequent deposit can use either preset. Balances remain separated by asset.

The earlier R500 activation payment has been superseded. R500 is a separate deposit promotion. A member's first qualifying production deposit creates one `pending_terms` eligibility record. It is not credited to the funded balance, treated as cash, or made withdrawable. Actual terms, eligibility checks and fulfilment need to be defined before approving the promotion. Refunding qualifying funding can remove activation and eligibility. Testnet transactions never qualify.

## Public routes and membership identity

- General signup: https://cryptoinvestmentvault.com/join
- Member dashboard: https://cryptoinvestmentvault.com/dashboard
- Member invitations: `/r/<10-character-code>` (older member UUID links redirect to the same invitation)

Registration writes the user, account profile, consent, portfolio, referral code, welcome-email outbox event and session in an atomic D1 batch. Failure rolls back the whole account. The public member ID is not a password or a bearer credential. Every funding quote, verified receipt, promotion record and manual transfer claim is bound to the authenticated member ID. Referral attribution is immutable; self-referrals and campaign attribution are blocked. Compact historical member links redirect to the full ID.

D1 is the existing `civ-db`, ID `f0a267d4-f8dc-4106-a3d8-3e7f7453dce9`. Never replace the database or reset records. Migration 0011 preserves legacy ZAR receipts and changes activation to actual net stablecoin funding. Legacy R500 quote terms are retired for new verification and sent to review. Legacy non-null ZAR quote columns remain compatibility placeholders on new `purpose='funding'` rows; they are never used for price display, settlement, activation or balance calculations. `funding_minor`, `symbol` and `purpose` define new deposits.

## Deposit paths

### MiniPay: automatic verification

Members first fund their own MiniPay wallet with the regional options available through MiniPay's partners. The Deposit button links to `https://link.minipay.xyz/add_cash?tokens=USDC,USDT`. Card/bank availability, pricing, minimums and verification are controlled by those partners. A wallet top-up is not a CIV deposit and does not activate membership.

After returning, members select 100 or 200 USDC/USDT and request a five-minute payment request. No FX API is required for an exact-token-unit deposit. Checkout shows the asset, exact amount, chain and additional network fee and requires a second action to approve the transfer in MiniPay. Stablecoin fee adapters are included. A fresh request is required after expiry.

Verification requires the account-specific quote ID appended to transfer calldata, exact sender, token, treasury and amount, a successful receipt, a canonical finalized block and timely inclusion. The globally unique chain transaction and atomic D1 batch prevent duplicate or cross-account credit. USDC and USDT receipts update separate balances. Verified funding activates membership and qualifies referrals; it does not execute trades or promise returns. No wallet signing keys are held by CIV.

The five-minute cron recovers submitted transactions and scans pending quotes after browser closure, up to 20 quotes and 500 finalized blocks per quote per run, for seven days. Older unresolved payments require operator reconciliation. Monitor backlog and RPC errors. Pausing new collection does not stop verification of already sent funds. Late or mismatched payments require review; members should not repeat payment before reconciliation.

### Public receiving address: manual review

Authenticated members outside MiniPay can view/copy the configured receiving address and submit their Celo transaction hash. Inside MiniPay, raw wallet-address controls stay hidden. The transfer claim is saved against the member ID but never automatically credited. A hash alone does not establish ownership.

A staffed operator must independently verify chain/token/treasury/amount, prove the member controls the funding source, check duplicate credit and reconcile the transfer. There is no public approval or balance-editing API. A trusted manual settlement workflow must be established before promoting ordinary address transfers as a supported launch method. Prefer the automatic MiniPay flow for launch. Do not use a shared treasury address plus a copied hash to grant membership.

### Other card-to-USDC provider

No direct card checkout or third-party ramp widget is enabled. Provider acceptance of CIV's actual crypto/investment model, South African eligibility, Celo token support, minimums and signed order notifications must be confirmed first. A third-party purchase must not be passed to the MiniPay verifier as if it were the member's own transfer: sender and calldata differ. Use a separate approved order/settlement adapter, or buy into the member's own wallet and obtain a fresh CIV payment request afterwards.

## Receiving wallets and MiniPay access: remaining launch dependencies

Collection is committed OFF, with `PAYMENTS_ENABLED="false"`, `PAYMENT_MODE="testnet"`. The public mainnet receiving address is configured separately as a Worker Secret by the operator; this alone does not establish its ownership or enable funding. A testnet receiving address must also be independently configured before sandbox transfers can be tested.

1. Obtain confirmed public test and production receiving addresses from the wallet owner. Never request a seed phrase/private key. Set `CELO_TEST_TREASURY_ADDRESS` for tests and `CELO_MAINNET_TREASURY_ADDRESS` for production.
2. For **isolated testnet deployment only**, configure an independently controlled `CELO_TEST_TREASURY_ADDRESS`, check the official Celo Sepolia USDC contract (`0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B`) and 6-decimal fee adapter (`0x4822e58de6f5e485eF90df51C41CE01721331dC0`), then set `PAYMENT_MODE="testnet"`, `PAYMENTS_ENABLED="true"`. Test deposits use **1 or 2 test USDC**, distinct from the 100/200 real-token presets. Circle's faucet usually dispenses 10 test USDC per request; the small presets make a controlled test practical. The D1 production-only `funding_minor` field remains NULL for sandbox requests, and on-chain testnet receipts never create production funding, promotions or rewards. **Do not enable collection in the public Worker merely to test; prefer isolated staging with its own D1 database.**
3. For production configure a provisioned `CELO_MAINNET_RPC_URL`, the receiving wallet, then select `PAYMENT_MODE="production"`. Canonical USDT/USDC contracts are hardcoded and their decimals are checked before issuing requests. Start with collection OFF, inspect the settings, then enable only for a controlled canary.
4. MiniPay public opening requires an approved CIV MiniApp listing ID. Its current docs deprecate `/browse?url=...` for unlisted MiniApp domains. The UI therefore does not invent a Browse link. Use Settings → About → repeatedly tap version → Developer Settings → Load test page for testing. Toggle Use Testnet appropriately. Confirm the MiniApp listing/production access path before sharing with non-developer users.
5. The wallet owner approves a real controlled canary on their phone. Verify both USDC and USDT transfer behavior, cancellation, expiry, return after app closure, the on-chain receipt, the matching `funding_receipts` row, asset-specific dashboard balances and one promotion eligibility record. Mocked tests are not evidence of a successful real-wallet transfer.
6. Review late/mismatched payments and define the support process. Refund balances only after an actual on-chain refund is independently confirmed. Payouts, withdrawal execution and trading remain disabled and require separate implementation.

## Deployment and validation

Run `npm ci` and `npm run check`. The PR workflow also bundles the Worker locally with esbuild without contacting the hosting service. The integration suite uses isolated D1 and applies all migrations in order. Testnet amounts (1/2 USDC) and the official test token contract are validated without weakening the production 100/200-token funding constraints. Tests cover registration rollback, consent, sessions, lockout, referral privacy, exact 100/200 amounts, per-token balances, repeated funding, duplicate/cross-account hashes, finality, expiry, wrong amounts, cron recovery, refunds and promotion separation.

GitHub PR checks also run `node tests/ui-smoke.mjs` with isolated fixtures at 320, 390, 768 and 1280px. They check floating navigation, horizontal overflow, amount selection, quote review, member identity, MiniPay address privacy and mobile signup. Screenshots are saved as the `civ-mobile-review` workflow artifact. These tests do not contact a real wallet, transfer funds or register production users.

Deployment applies all remote migrations before code, then runs `npm run test:smoke`. Readiness reports schema 12. New collection config is `/api/payments/config`; `/api/celo/config` remains the older sandbox interface. Account and payment APIs use no-store responses, HttpOnly sessions, same-origin write checks, size limits and authentication/rate checks.

Welcome emails remain queued until a verified sending provider is configured. Email verification and self-service recovery are not yet enabled. Keep delivery disabled until ready; `src/email.ts` contains the template and opt-in Resend adapter. Five-minute cron delivery uses leases and provider idempotency keys. Do not interpret a welcome email as proof of identity or compliance.

## Referral credits

Migration 0012 assigns stable random ten-character invitation aliases to existing and new accounts without rewriting member IDs or historic attribution. Links, copy and native sharing lead directly to signup. Profile shows registrations, funded referrals, pending referrals and a separate ZAR referral wallet.

An immutable, single R1,000 promotional credit is recorded for the original inviter when the referred account reaches the verified production funding minimum of 100 USDC/USDT. A database trigger runs in the funding receipt transaction, including background reconciliation. Signup alone, testnet, pending or rejected payments do not qualify. Repeat deposits and verification retries cannot duplicate a credit. Existing eligible referrals are backfilled. Refunds suspend credits while qualifying net funding is below the minimum; the original ledger identity remains. ZAR credits do not mint stablecoins or execute transfers; withdrawals remain disabled. R500 deposit promotional eligibility remains subject to final offer terms.
