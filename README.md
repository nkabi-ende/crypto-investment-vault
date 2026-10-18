# CIV — Crypto Investment Vault / The Big 7

Cloudflare Workers + D1 + static assets starter. Database-backed authentication, session cookies and CoinGecko market data. **Deposits, withdrawals and live trading are disabled server-side.** No guaranteed returns.

## Deployment
1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create civ-db` and replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.toml`.
4. `npm run db:migrate:local` then `npm run dev`.
5. `npm run db:migrate:remote` then `npm run deploy`.
6. Configure `APP_ORIGIN` and your Cloudflare custom domain.

## Security work before public launch
- Add Turnstile, rate limiting, email verification, password reset, MFA, account lockout, CSRF protection, monitoring, backups, and independent security review.
- CoinGecko public API may rate-limit; add provider caching/fallback and monitoring.
- Funding endpoints always reject requests regardless of `FUNDING_ENABLED`; custody, compliance, ledger and reconciliation are not implemented.
- USDT and USD are different assets. Do not assume a fixed USDT/ZAR conversion.
- D1 is used for the starter account database, not a production financial ledger.

## Twelve Data market data
Set the Twelve Data key as a **Worker secret**, never in the frontend or wrangler.toml:
```sh
npx wrangler secret put TWELVE_DATA_API_KEY
```
For local development, create a gitignored `.dev.vars` file containing `TWELVE_DATA_API_KEY=...`.
The Worker requests the `/quote` endpoint for BTC/USD, ETH/USD, SOL/USD, XRP/USD, BNB/USD, ADA/USD, and DOGE/USD. Quotes are cached at the edge for 60 seconds. Seven upstream quote requests per refresh can exceed some Twelve Data plan limits; check entitlement and use a bulk endpoint if available. Market availability and symbol formats must be validated with your plan. No key is needed in the browser.

## Authentication status
Registration, login, secure HttpOnly SameSite cookies, database-backed session storage and temporary per-email login lockouts are implemented. Apply both D1 migrations before testing. This is **not yet production-approved**: add IP-based WAF rate limiting, bot protection/Turnstile, email verification, password recovery, MFA, CSRF tokens or strict origin policy for every mutating endpoint, account lifecycle controls, monitoring, tests, and security review. Current login lockouts alone are not a substitute for edge rate limiting.
