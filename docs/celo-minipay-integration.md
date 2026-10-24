# CIV MiniPay / Celo integration

## Current scope
Celo Sepolia **testnet only**. The investor dashboard creates $100/$200 **test USDC** intents and checks a transaction receipt for the exact configured ERC-20 token, treasury destination, amount, successful status, chain ID and at least six confirmations. Transaction hashes are unique in D1. No transfer is automatically credited to the investor's real balance.

MiniPay is a wallet application. It is not itself a licensed investment-payment processor or a custody service. The website currently provides a transfer-verification sandbox; a wallet connection / transaction-request integration still needs testing on MiniPay-supported devices.

## Required Cloudflare Worker environment variables
- `CELO_SEPOLIA_RPC_URL`: HTTPS JSON-RPC endpoint for Celo Sepolia (chain ID 11142220).
- `CELO_TEST_USDC_ADDRESS`: the **verified testnet** ERC-20 token contract, with 6 decimals. Do not insert a mainnet USDC address.
- `CELO_TEST_TREASURY_ADDRESS`: a controlled testnet-only recipient wallet. Never use a mainnet treasury address.

Set these in Cloudflare Worker environment configuration. The API reports readiness at `GET /api/celo/config`. Never place a private key, mnemonic or payout signer in source code, GitHub Actions or a public frontend.

## API
- `GET /api/celo/config` — network status; public testnet addresses.
- `POST /api/celo/testnet/intents` — authenticated, body `{"amountUsd":100}` or `{"amountUsd":200}`.
- `POST /api/celo/testnet/intents/:id/verify` — authenticated, body `{"txHash":"0x..."}`; read-only chain verification.
- `GET /api/celo/testnet/intents` — authenticated user test intents.
- `GET /api/celo/payout-signer/status` — signer intentionally disabled.

## Withdrawal signer architecture (not active)
1. Verify operating entity, applicable FSCA requirements and custodial arrangements.
2. Use an isolated treasury service, not the public website Worker. Prefer MPC/HSM-backed signing with separate permissions and no exportable hot key.
3. Withdrawals require authenticated wallet ownership, address allowlisting and cooldown, available balance reservation, limits, sanctions/fraud review, two-person approvals, idempotency keys and a unique payout nonce.
4. Broadcast only from the isolated signer after approvals, verify on-chain settlement, reconcile against the journal, and support recovery for failed or replaced transactions.
5. Run end-to-end Celo Sepolia testing, independent review and operational drills before considering mainnet activation.

## Safety constraints
No live deposit address, real-money payment button, auto-generated investment yield, payout execution or investor balance credits are enabled. A receipt on a testnet is not proof of real-world investment value. The projected daily growth calculator is illustrative only.
