# CIV administrator access

Entry: https://cryptoinvestmentvault.com/admin

Use an existing CIV account's email and password. There is no separate shared administrator credential, default password or automatic first-user administrator. Stored password hashes cannot be retrieved as passwords. The hub redirects unsigned visitors to sign-in and returns them to `/admin` after authentication. Only a short allowlist of internal return destinations is accepted.

The hub uses the CIV logo, favicon and black/lime palette. Signed-in accounts without an assigned role receive a branded access-required page with HTTP 403. It contains no account/customer data. Every destination independently checks permission on the server.

| Tool | Server authority | Direct URL |
| --- | --- | --- |
| Identity review | Enabled `kyc_reviewers` database row for the signed-in account UUID | `/review-identity` |
| Shaka paper-portfolio controls | Account UUID in the Cloudflare `SHAKA_SIM_ADMIN_IDS` secret | `/dashboard` |
| Read-only dashboard mirror | Same paper-portfolio operator allowlist | `/dashboard/mirror` |

A reviewer cannot approve their own KYC case. Neither role grants the other role. Neither role enables production trading, public deposits or payout execution.

## Assign or revoke an identity reviewer

An existing repository operator with permission to run production workflows can use **Actions → CIV reviewer access → Run workflow** on `main`:

1. The intended reviewer signs into CIV and opens **Profile → Account information → Member ID**. Copy the full account UUID (36 characters with hyphens). The invitation code is a separate value and cannot be used here.
2. Enter that UUID in `member_id` and choose `grant` or `revoke`.
3. Review the selected account and run the workflow using the repository's existing Cloudflare deployment secrets. The workflow uses the `production` environment; configure environment reviewers if that repository requires a second approver.
4. A successful result means the exact existing account was updated. The CLI fails for invalid input, an unknown account, failed Cloudflare authentication or an unexpected database result. It creates no user and changes no password.
5. The reviewer signs in again and opens `/admin`. Revocation takes effect on the next server-authorized request. The database audit records the action and the GitHub actor; workflow history records who ran it.

The equivalent command for an already authenticated Cloudflare operator is `node scripts/kyc-reviewer.mjs grant ACCOUNT_UUID` (or `revoke`). Do not paste API tokens into a command, chat or frontend file.

Paper-portfolio access remains a separate Cloudflare secret assignment. Add the intended UUID to `SHAKA_SIM_ADMIN_IDS` while preserving any existing operator IDs; do not overwrite the allowlist blindly. There is no client-side setting or URL parameter that grants this access.

## Verified scope and outstanding work

Isolated tests cover anonymous rejection, ordinary member denial, role-separated links, private caching, the strict script-free hub policy, account-bound grants, audit records, revocation and invalid/injected account identifiers. Browser checks cover small/large layouts and sign-in redirects. Post-deployment smoke checks assert the public admin entry redirects to sign-in and the branded stylesheet is served.

This change does not assert that a specific production account has been granted either role. Role assignment requires authenticated production database/configuration access. No authenticated Cloudflare session was available during this change. Application reviewer MFA remains a priority before routine sensitive-document operations; it is not implemented by this access workflow. See [security-hardening.md](security-hardening.md) for the broader review and remaining operational controls.
