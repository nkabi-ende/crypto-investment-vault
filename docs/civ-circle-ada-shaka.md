# CIV Circle, ADA and Shaka

Implemented product rules, 17 November 2026. All account options remain $100 and $200 (100/200 USDC or USDT on Celo); R500 is a separate customer promotion. This release does not enable public collection, venue trading or cash payouts.

## Distribution and commissions

| Tier | Qualified direct referrals over the preceding 90 days | $100 account | $200 account |
| --- | ---: | ---: | ---: |
| Circle | 0-4 | R200 | R300 |
| Gold | 5-14 | R225 | R350 |
| Platinum | 15+ | R250 | R400 |

Migration 0014 retires only the old reward-creation trigger. It preserves all historical R1,000 records and creates a separate immutable, versioned Circle reward contract for new qualifying first deposits. Repeated funding cannot earn another acquisition commission. The first deposit determines the account amount for this acquisition; later $100/$200 funding does not replace that contract. The price is locked using the tier at confirmation. Tiers apply prospectively.

New contracts undergo 30 days of validation. A reused funding sender flags review rather than proving misconduct. `clear`, `hold` and `rejected` reviews are auditable. Ordinary withdrawals are not implemented by this release and must not be represented as fraud or an automatic commission reversal. A refund of the qualifying receipt suspends an unpaid reward. A previously paid reward remains recorded as paid; a subsequent refund is an operator reconciliation issue. Qualification metrics exclude refunded or held/rejected cases.

Statuses are pending, review, suspended, void, approved and paid. No public payout-writing or reward-editing API exists. `circle_payout_receipts` requires an approved contract, exact ZAR amount, unique payout reference and independent settlement evidence. It records a completed external payout, not an instruction to transfer funds. Keep payout execution disabled until the actual provider and reserve process are implemented. Registration and verified funding do not verify that one person has only one account: identity checks and operator review remain necessary before scaling or paying cash.

### Public participation

Every participating inviter gets a random public alias when their first invitation is accepted. There is no opt-out switch for affiliate leaderboard participation. The alias is independent of the invitation code, private name, email and user ID. The website and signed-in profile show the same monthly, all-time and newcomer boards. Monthly periods use Africa/Johannesburg time. Newcomers remain eligible for their first 90 days so the 30-day validation period does not eliminate them before they can qualify. Rank is determined by qualified direct account count; ties share rank. Current tier is separately based on trailing 90-day qualification.

Public rows contain only rank, alias, tier, qualified referral count and capital-introduced band. The API never publishes customer identities, quote IDs, wallets, individual balances or exact financial aggregates. Capital bands appear after five qualified referrals and represent first qualifying nominal USDC/USDT funding, net of refunds, excluding gains, bonuses and repeat funding. They do not represent assets managed by the affiliate, current AUM, income or guaranteed USD value. An empty board remains empty; there are no manufactured partners.

### Incentive design

- Reward validated direct customer acquisition, not raw clicks, account registrations or downstream recruitment.
- Publish deterministic rates and statuses and retain earned historical terms.
- Show progress to five and fifteen qualified customers; rolling 90-day qualification is explicit.
- Give newcomer and monthly recognition alongside all-time recognition. Ranking is not weighted by account size.
- The customer R500 benefit and partner compensation are separately disclosed.
- Track actual contribution, not just funding volume: collected CIV fees less direct costs, bonus cost, commissions and acquisition costs.

With ten $100 and ten $200 customers, maximum Platinum commissions are R6,500. Add R10,000 in customer bonus provision and R1,500 operational support for an R18,000 pilot provision. The $3,000 of customer principal is not revenue. The R500 promotion's cash/credit, reserve and redemption policy still needs final fulfilment terms.

## Durable referral attribution

The canonical `/r/<alias>` route records a 30-day opaque, HttpOnly, Secure, SameSite=Lax invitation cookie backed by a hashed server claim. The first valid claim is preserved across subsequent invitation clicks. Registration uses that claim even when browser storage is missing; an explicitly edited invitation field can correct attribution before account creation. Attribution is then immutable through user APIs. After successful registration the anonymous claim is consumed. Cron removes expired claims.

Browser storage is an additional first-valid-link fallback, not the source of truth. Register before leaving to install or top up MiniPay. Sign into the same CIV account on return or on another device; deposit verification is bound to that account. Neither arbitrary MiniPay return parameters nor unsupported browse URLs are required. Before registration there is no way to recover attribution on a wholly different device without carrying an invitation code or other identifier. Email-based recovery links must not be added until secure account verification/recovery exists.

## ADA Ledger

Migration 0015 implements a signed double-entry journal on the existing D1 database so verified receipts and journal entries commit together. This updates the earlier proposed separate-PostgreSQL approach: there is one current database authority and no distributed dual-write. A later PostgreSQL move requires a reconciled, versioned cut-over; it is not provisioned by this release.

A journal is built as a draft and posted only when it contains counter-entries and sums to zero per asset. Posted headers and lines cannot be changed or deleted. Exact integer minor units are used, with USDC and USDT separate. Existing verified receipts, refund offsets and unmatched legacy entries are imported without manufacturing growth. An insert or change to actual funding receipts creates the corresponding balanced journal in the receipt transaction. Legacy entries already tied to an imported receipt are not counted again. The R500 promotion and Circle reward states remain separate from stablecoin balances.

`GET /api/investor/ledger` reads ADA rather than adding a second independently mutable balance. It separates funding, realised results and unrealised valuations. The cash balance excludes unrealised values. The daily result uses Africa/Johannesburg dates and remains pending until an actual close exists; no cron applies a daily percentage.

`publishVerifiedClose` is an internal integration function with no public route. It requires the external report ID, evidence reference, verifier, period, exact amounts and customer allocations. Allocation totals must reconcile to the report. A payload fingerprint rejects conflicting replays, and unique report/day constraints plus an atomic batch prevent duplicate credit. This function is not an independent verifier: the actual venue/custody reconciliation adapter and access controls must supply trustworthy evidence before using it in production. `allocateByUnits` provides deterministic largest-remainder allocation over actual invested units, for positive, zero or negative results. It does not infer invested units from deposits or choose an investment return. Daily-close amendments and a fully reconciled custody/withdrawal engine remain separate integration work; do not mutate posted evidence.

## Shaka methodology and implementation

`src/shaka.ts` implements a reference signal evaluator over closed OHLCV candles:

1. Map prior price-structure candidate accumulation/support and distribution/resistance zones.
2. Use Accumulation/Distribution money-flow pressure as a confirmation input. It is a technical proxy, not evidence of institutional activity.
3. Compare current closed-candle volume to the average of previous candles, excluding the current candle from the baseline.
4. Calculate Wilder-smoothed ATR and an asset-specific index `100 * ATR / close`. This is a realised range-based proxy; it is not Cboe's S&P 500 implied-volatility VIX.
5. Require configured volume and volatility conditions plus zone/price-direction confluence.
6. Derive reference stop and reward/risk distances. Trailing stops tighten only: they cannot widen the previous stop.

The implementation rejects stale, malformed, future-dated or unclosed data. It outputs a candidate or wait condition, never an executed order. Defaults are reference parameters, not an optimised or verified live strategy. Shorts are candidates only and require an approved venue/product before execution. No broker credentials, leverage, position sizing or live order adapter are invented. A production engine also requires position/exposure controls, spread and liquidity checks, drawdown limits, durable order idempotency and an execution/reconciliation service.

The public strategy section explains the methodology and the actual connection status. The strategy endpoint returns null measured performance/latency values until real evidence exists. Event-driven execution is the target design; fast or low-latency performance must be measured end to end before numerical claims. Stops can slip, gap or fail to execute at their reference price. The objective is defined risk and favourable reward relative to risk, not a claim of low-risk guaranteed high returns.

## API and release

- `GET /api/referrals/claim`: current public invitation alias only; not authentication.
- `GET /api/affiliates/leaderboard?period=month|all|newcomers`: sanitised aggregate board.
- `GET /api/investor/affiliates`: authenticated own commissions, tier progress and aggregates.
- `GET /api/strategy/shaka`: methodology and honest integration/measurement status.
- `GET /api/investor/ledger`: authenticated own ADA balances, daily status and journal.
- Readiness schema: 15. Apply migrations 0014 and 0015 before releasing the Worker.

Run `npm run check`, bundle the Worker and run `node tests/ui-smoke.mjs`. The UI test accepts `CIV_CHROMIUM_PATH` for a system browser when a bundled browser cannot be installed. All tests use isolated data, wallets and provider fixtures; no live money moves. Inspect real MiniPay handoff, venue credentials, reserve funding and payout settlement separately before enabling those integrations.
