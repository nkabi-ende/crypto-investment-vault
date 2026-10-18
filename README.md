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
