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
- CoinGecko Demo API may rate-limit; five-minute edge caching is implemented. Add monitoring and a verified stale-quote policy before scale.
- Funding endpoints always reject requests regardless of `FUNDING_ENABLED`; custody, compliance, ledger and reconciliation are not implemented.
- USDT and USD are different assets. Do not assume a fixed USDT/ZAR conversion.
- D1 is used for the starter account database, not a production financial ledger.

## CoinGecko Demo market data
Set the CoinGecko Demo key as a **Cloudflare Worker secret** named `COINGECKO_DEMO_API_KEY`, never in browser code, `wrangler.toml`, or the GitHub repository:

```sh
npx wrangler secret put COINGECKO_DEMO_API_KEY
```

The Worker requests `/api/v3/coins/markets` from `api.coingecko.com` with the `x-cg-demo-api-key` header, retrieving BTC, ETH, SOL, XRP, BNB, ADA, DOGE in **one** request. Successful responses are cached at the Cloudflare edge for five minutes. The public Big 7 watchlist and logged-in dashboard use the same `/api/markets` endpoint. Prices are indicative **USD spot** quotes, while the embedded TradingView charts use exchange **USDT pairs** and may differ slightly.

If the key is missing or the provider is unavailable, the endpoint responds with HTTP 503 and a safe error code; the UI displays an unavailable state instead of inventing prices. The API key must never be returned to the browser. Check CoinGecko's current Demo tier, commercial licensing, attribution and rate limits before a wider launch. Remove the obsolete `TWELVE_DATA_API_KEY` secret from Cloudflare if it exists.

### Verification after deployment
1. Visit `https://cryptoinvestmentvault.com/api/status` and confirm both funding and live trading are disabled.
2. Visit `https://cryptoinvestmentvault.com/api/markets` and confirm `source: "CoinGecko"`, seven assets and an `asOf` timestamp. If HTTP 503, check the Worker secret and Cloudflare logs.
3. Visit the homepage and confirm seven USD quotes load on the market terminal while TradingView charts remain usable.
4. Register/login with a test account, confirm the investor dashboard, account activity and logout; never use demo portfolio figures as real holdings.
5. Confirm GitHub Actions deployed the latest commit, D1 migrations succeeded, and the custom domain routes to this Worker.

## Authentication status
Registration, login, secure HttpOnly SameSite cookies, database-backed session storage and temporary per-email login lockouts are implemented. Apply both D1 migrations before testing. This is **not yet production-approved**: add IP-based WAF rate limiting, bot protection/Turnstile, email verification, password recovery, MFA, CSRF tokens or strict origin policy for every mutating endpoint, account lifecycle controls, monitoring, tests, and security review. Current login lockouts alone are not a substitute for edge rate limiting.

## Public investor transparency
Migration `0003_transparency.sql` adds:
- `disclosures`: category-specific legal, custody, fee, risk, management, withdrawal and performance evidence
- `strategy_performance`: historical performance records requiring a verification URL and verifier before appearing publicly
- `platform_announcements`: published operational updates

`GET /api/transparency` powers the website's public disclosure register. Empty categories explicitly show **Not published**. The database is initially empty: no regulatory status, audit, custody arrangement, strategy track record or team credential is invented.

**Publishing policy:** No public admin editing interface exists yet. Publish records only through a controlled, audited operational workflow after verifying evidence. This endpoint alone does not validate the authenticity of external verification links. Do not expose direct D1 write access or use the presence of a record as proof of compliance. An authenticated, role-restricted publishing workflow with approval history is a remaining production task.

Run `npm run db:migrate:local` or `npm run db:migrate:remote` to apply all three migrations before testing the transparency endpoint.
