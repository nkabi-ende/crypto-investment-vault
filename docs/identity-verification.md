# Identity verification and withdrawal requests

Migration 0016 adds member-bound ID/photo and proof-of-address storage, an immutable review history, reviewer roles and idempotent withdrawal requests. Registration and existing deposit eligibility are independent of KYC. Documents are submitted to a review queue; receiving files is not a completed identity check. A verified badge is derived only from an approved, unexpired server record.

## Storage and access

Documents are stored privately in D1 in 256 KiB BLOB chunks, with SHA-256, MIME type, size, category and the authenticated member UUID in their metadata. No bucket, public URL, third-party KYC service or new credential is needed for uploads. D1 provides platform-managed encryption at rest and TLS in transit: https://developers.cloudflare.com/d1/reference/data-security/. The chunks stay below D1's per-row limit: https://developers.cloudflare.com/d1/platform/limits/.

Each file is limited to 5 MiB, with at most ten uploads per member per day and a 20 MiB stored-document quota per member. Both declared MIME and signature must agree. ID documents accept JPG/PNG; address documents accept JPG/PNG/PDF, with an additional active-PDF-content check. This is not a malware scanner or an automated document-authenticity service. Raw originals and filenames never appear in public or general account APIs. Only explicitly assigned reviewers can retrieve submitted evidence, over authenticated, no-store, attachment-only routes. Access and decisions are audited. Pending or currently approved evidence cannot be replaced. Rejected cases can be resubmitted as a new revision; historical evidence is preserved.

No reviewer is granted automatically by email or by signing up. Assign the exact existing account UUID using an authorised Cloudflare operator session:

```sh
node scripts/kyc-reviewer.mjs grant ACCOUNT_UUID
node scripts/kyc-reviewer.mjs revoke ACCOUNT_UUID
```

The member UUID is distinct from the short referral/invitation code. Confirm the intended account before granting sensitive evidence access. Reviewer roles do not allow self-approval. Reviewers sign into their normal CIV account and visit `/review-identity.html`. They must open both documents, record identity/address/validity checks and a decision note. The database rejects decisions without evidence access or with a stale revision. Approval is valid for 365 days; expired checks require new documents. Reviewer provisioning, operational document review and any external identity-authenticity checks remain operator responsibilities.

## Withdrawal requests

`GET /api/investor/withdrawals` returns available settled USDC/USDT, verification eligibility and previous request statuses. `POST` requires approved unexpired KYC, an exact integer token amount, a Celo address and a UUID idempotency key. A single conditional database insert checks and reserves available settled funds against pending/approved requests; concurrent requests cannot oversubscribe that balance. Unrealised values and promotional/referral credits are excluded. Retrying the same payload and key returns the same request; changing the payload with a used key is rejected.

Requests enter `pending_review`. No signing keys, transfer execution, automatic payout or synthetic daily return is added. Existing `withdrawalsEnabled`/`payoutsEnabled` flags continue to describe payment execution; `withdrawalRequestsEnabled` explicitly describes the KYC-gated request workflow. Custody reconciliation, treasury approval and executed-payout journal posting must be implemented before a request can be paid. Retention/deletion operations and backup access must follow CIV's adopted privacy policy; do not treat an upload or internal review as a regulatory certification.

## Verification

Run `npm run check`. Identity tests cover anonymous/cross-origin access, type/size checks, member ownership, pending locks, consent, reviewer restrictions, evidence access, approval/rejection, immutable audit, resubmission, idempotency and concurrent balance reservations. Browser fixtures contain synthetic data only; never put actual customer identity documents in tests, screenshots, repository assets or CI artifacts.
