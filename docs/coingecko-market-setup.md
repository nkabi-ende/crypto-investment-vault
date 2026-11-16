# CIV CoinGecko — public Big 7 spot-price setup

The public landing-page watchlist and signed-in dashboard use the same `GET /api/markets` endpoint. The response contains seven verified CoinGecko USD spot prices and is **market reference data only**, not investment returns, portfolio valuation, settlement pricing or a quote for a deposit.

## One operator action: add the API key in Cloudflare

1. Create a **CoinGecko Demo API** account at https://www.coingecko.com/en/api/pricing → Create Free Account.
2. Open the CoinGecko Developer Dashboard → API Keys → Add New Key. Copy the key, treating it as a password.
3. In Cloudflare, select Workers & Pages → `crypto-investment-vault` → Settings → Variables and Secrets → **Production**. Add a **Secret**, not a public HTML variable:
   - Name: `COINGECKO_DEMO_API_KEY`
   - Value: your actual CoinGecko Demo API key (not pasted into GitHub or this chat)
4. Save/deploy the secret. It persists across normal Wrangler deployments.
5. Open https://cryptoinvestmentvault.com/api/markets in a new tab. Expect status 200 with `source:"CoinGecko"`, exactly 7 `assets`, positive `priceUsd`, `asOf` and `stale:false` after initial synchronization. If the first request says `MARKET_REFRESHING`, retry after several seconds.
6. Refresh the public market terminal on https://cryptoinvestmentvault.com. The seven icons and real USD prices should display, with a timestamp. If a provider outage occurs, the last confirmed snapshot is clearly labelled delayed.

## Operational guidance

- One CoinGecko `/coins/markets` call covers all seven assets. The Worker keeps a globally shared D1 snapshot for about ten minutes, with an atomic refresh lease to reduce duplicate requests from different visitors/regions.
- The API retains a validated snapshot for at most 24 hours and returns `stale:true` if an upstream call fails. The browser also retains a previously received genuine snapshot for up to 6 hours. **No invented prices or fallback estimates are ever shown**.
- Temporary provider failures back off for 45 seconds; CoinGecko 429 for two minutes; authentication rejection for five minutes. `/api/markets` identifies missing or rejected API keys without exposing the key.
- Display timestamps are essential: prices are delayed *reference* snapshots and are not millisecond-accurate streaming quotes.
- The separate `/api/market-pulse` widget needs the same secret. CoinGecko does not supply conventional crypto news headlines; those use a separate source.
- Check the CoinGecko Developer Dashboard usage/quotas when data becomes unavailable. The Demo plan has usage caps; do not add a browser-side key or turn on per-user provider polling.

## Privacy, account and payment separation

The migration `0013_market_data_cache.sql` adds **only one general market-data table** in the existing D1 database. It does not modify users, deposits, referrals, tokens, payment modes, treasury settings, ledger, or trading/withdrawal flags.

Market prices are advisory only, and no price figure from this endpoint is used to create or verify Celo payment quotes. The single-account MiniPay mainnet pilot retains all existing gates.
