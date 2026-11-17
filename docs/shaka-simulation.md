# Shaka Big 7 simulation

The dashboard models the same seven-asset universe as the market watch. Each scenario defines a repeating series of hypothetical daily returns for the whole basket. The Shaka signal methodology is a strategy reference. Real-time candle data, exchange orders, positions and venue returns are outside this model.

## Account and journal

- The member endpoint uses the signed-in session's user ID. Access requires an administrator's verification record and a confirmed mainnet funding receipt. D1 creates one activation when both exist, regardless of order. The first eligible day is the following Johannesburg calendar day. Existing qualifying accounts are enrolled at migration time with a prospective start date.
- The activating receipt sets the starting paper portfolio to 100 or 200 credits, matching the confirmed deposit selection. Existing portfolios recalculate from that original receipt. Later deposits do not change the starting credits. The journal compounds each daily basket rate against the previous closing value for up to 365 closes. The engine stores rates as integer basis points and rounds closing values down to hundredths of a credit. The API returns the latest close and up to 30 journal rows.
- Simulation closes and schedule revisions are immutable D1 records. The member journal is derived from those closes and the member's start date. Verified ADA, funding, commissions and withdrawals use their existing records and endpoints.

## Cloudflare operations

1. Apply D1 migrations `0017_shaka_simulation.sql` and `0018_shaka_funded_activation.sql` before deploying the Worker. The project deployment workflow already applies migrations before publishing the Worker.
2. Set the Worker secret `SHAKA_SIM_ADMIN_IDS` to a comma-separated list of existing administrator user IDs. Admin routes are closed until a matching signed-in user is configured.
3. On the dashboard overview, choose a simulation scenario and confirm access for verified members by account ID. Members can find their ID in the Account tab. Schedule edits start the next Johannesburg day. The latest revision for that date takes precedence. The flat scenario produces zero change. The extreme stress scenario includes both a 75% loss and a 75% gain as hypothetical shocks.
4. The existing five-minute cron closes completed Johannesburg days. It writes at most 31 overdue dates per invocation and can resume from the last close after interruptions. Concurrent and repeated invocations preserve one close per day. The first result can appear after midnight following the initial eligible day. [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

The first qualifying activation starts the mixed scenario if an administrator has yet to select one. Administrators receive activation notices in the dashboard feed. The feed updates when the dashboard opens and once a minute while visible. The private dashboard mirror is served by the Worker to allowlisted administrators only and contains example navigation and public asset names.

Migration `0019_deposit_bonus.sql` records a single R1,000 promotional entitlement from the first qualifying receipt. The verified ledger, deposit page and paper mirror read that entitlement. Pending legacy offers are updated to R1,000. Approved and void legacy records keep their original amounts. The bonus is separate from principal and does not compound.

The signed-in dashboard and paper mirror share a browser-level USD/ZAR preference. Reference equivalents use the dated Frankfurter rate. The dashboard continues to show verified balances, payment instructions and receipts in their original asset units. [Frankfurter API](https://frankfurter.dev/v1/)
