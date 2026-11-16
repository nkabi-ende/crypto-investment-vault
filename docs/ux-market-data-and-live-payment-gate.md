# CIV UX and real-money launch gate — 16 November 2026

## What is implemented
- Seven authentic BTC / ETH / SOL / XRP / BNB / ADA / DOGE icons from the CC0-licensed [cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) source repository, checked into `public/assets/coins` and rendered as local SVG assets in the hero.
- The 1200 × 630 PNG social preview is generated from those exact SVGs at deployment. New `og-invitation-v3.png` URL distinguishes the refreshed design from old social-cache versions.
- Optional five-step native `<dialog>` deposit guide. Each member may skip it and reopen it from the Deposit tab. Dialog has keyboard/focus and reduced-motion support without blocking normal sign-in.
- Wallet-approval vs verified-payment state distinction, on-chain CeloScan transaction link, and recovery of an already submitted quote after returning to the dashboard.
- Dashboard CoinGecko global market pulse and trending assets via a server-side, 5-minute cached proxy. These statistics do **not** change account balances or investment returns.
- Optional source-linked CryptoPanic headlines, with a safe empty state until a separate news API token is activated. CoinGecko does **not** provide conventional article/news headlines.

## Modern library review
- **Cryptocurrency icons** — CC0 vector library, deliberately vendored to avoid network dependency and brand-icon approximation. The newer `@token-icons/core` is a candidate for broader token coverage once needed; it is not necessary for just the Big 7.
- **Driver.js** — actively maintained, lightweight vanilla-JS product tours, MIT licensed. Evaluated for onboarding, but native `<dialog>` was selected for this focused financial walkthrough to avoid third-party JS dependency and guarantee local fail-safe operation.
- **Motion** — `motion/mini` is roughly 3 KB, suitable if richer animations are justified. The current CSS transitions and reduced-motion settings avoid loading animation code for a five-step deposit flow.
- **Floating UI** — good primitives for anchored tooltips/popovers. Defer until the dashboard genuinely needs complex contextual floating elements; native dialog works better for transaction guidance.
- **Lucide** — established tree-shakeable UI icon system for non-token controls, useful when the frontend gets a build pipeline. It is *not* a replacement for actual token trademarks/graphics.

## Production deposit readiness — not yet authorized
Production remains `PAYMENTS_ENABLED=false`, `PAYMENT_MODE=testnet`, `FUNDING_ENABLED=false`. A mainnet receiving wallet has been supplied by the operator, but this does not establish custody, compliance, successful payment signing or safety.

Before a real $100/100-USDC deposit:
1. Verify production treasury wallet custody, ability to transfer out, asset and fee adapter addresses, fee balance, and RPC health.
2. Confirm use of a **separate paying wallet**: the receiving MiniPay wallet cannot pay itself through the quote flow.
3. Verify the exact request, address, chain ID 42220, token decimals, fee adapter and five-minute quote on a physical MiniPay device.
4. Confirm all customer terms and custody/withdrawal rules are actually approved and disclosed; prohibited trading and withdrawals remain disabled.
5. Complete an observed mainnet canary. Confirm the same transaction hash, receiver and token amount on CeloScan, matching D1 funding receipt and dashboard credit. Verify timeout, cancellation, repeat, refund and review paths.
6. Only then make a separately reviewed activation change. This release does not turn payments on.

## Optional provider configuration
- Add the CoinGecko **Demo API** key as a secret named `COINGECKO_DEMO_API_KEY`; never expose it in client HTML. Calls are cached server-side for 300s.
- News is a different product. Register a CryptoPanic API plan and add `CRYPTOPANIC_API_TOKEN` only if licensing, rate limits and public embedding rights permit it. Calls are cached server-side for 900s. No token means a transparent placeholder, never fabricated articles.
- Keep provider endpoints nonessential to signup, payment verification and financial records.
