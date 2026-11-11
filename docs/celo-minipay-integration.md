# CIV MiniPay / Celo integration

## Current scope
The dashboard requests a test-USDC transfer inside MiniPay. The transaction includes the account-specific intent identifier after the ERC-20 transfer arguments. The Worker verifies the exact calldata, signer, token, destination, amount, receipt event and finalized block before recording a separate test credit. The five-minute scanner recovers finalized transfers after the phone closes. Legacy intents without a sender have no automatic credit path.

## Required Cloudflare Worker environment variables
- `CELO_SEPOLIA_RPC_URL`: HTTPS JSON-RPC endpoint for Celo Sepolia (chain ID 11142220).
- `CELO_TEST_USDC_ADDRESS`: the **verified testnet** ERC-20 token contract, with 6 decimals. Do not insert a mainnet USDC address.
- `CELO_TEST_TREASURY_ADDRESS`: a controlled testnet-only recipient wallet. Never use a mainnet treasury address.

The repository supplies the public RPC and Circle test token. Set the controlled treasury as a Worker secret with `npx wrangler secret put CELO_TEST_TREASURY_ADDRESS` so subsequent deployments retain it. The API reports readiness at `GET /api/celo/config`. Never place a private key, mnemonic or payout signer in source code, GitHub Actions or a public frontend.

## API
- `GET /api/celo/config` — network status; public testnet addresses.
- `POST /api/celo/testnet/intents` — authenticated, body `{"amountUsd":100,"sender":"0x…"}` or `{"amountUsd":200,"sender":"0x…"}`.
- `POST /api/celo/testnet/intents/:id/verify` — authenticated, body `{"txHash":"0x..."}`; checks finality and records an idempotent D1 test credit.
- `GET /api/celo/testnet/intents` — authenticated user test intents.
- `GET /api/celo/payout-signer/status` — signer intentionally disabled.

## Withdrawal signer architecture (not active)
1. Verify operating entity, applicable FSCA requirements and custodial arrangements.
2. Use an isolated treasury service, not the public website Worker. Prefer MPC/HSM-backed signing with separate permissions and no exportable hot key.
3. Withdrawals require authenticated wallet ownership, address allowlisting and cooldown, available balance reservation, limits, sanctions/fraud review, two-person approvals, idempotency keys and a unique payout nonce.
4. Broadcast only from the isolated signer after approvals, verify on-chain settlement, reconcile against the journal, and support recovery for failed or replaced transactions.
5. Run end-to-end Celo Sepolia testing, independent review and operational drills before considering mainnet activation.

## Company-funded pilot acceptance

Record the company-owned funding and receiving wallets, approved asset contract and chain, per-transfer cap, cumulative cap and independent approvers before configuring a separate mainnet deployment. The operator must be able to pause new deposit instructions while continuing to account for previously broadcast transfers. Never promote test credits into the mainnet ledger.

For each pilot transfer, compare the finalized token event against the journal by chain, token, transaction hash and log index. Compare the entire treasury opening balance plus transfers in minus transfers out with the closing on-chain balance at the same finalized block. Record unsolicited transfers separately. Investigate differences before continuing. Test one controlled withdrawal including reservation, approval, signing, settlement and release on failure. Capture transaction references and the reconciliation result before raising either cap.
