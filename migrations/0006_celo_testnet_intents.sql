-- Testnet-only MiniPay/Celo deposit verification and non-executable withdrawal workflow.
CREATE TABLE IF NOT EXISTS celo_testnet_deposit_intents (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor IN (100000000,200000000)),
 chain_id INTEGER NOT NULL DEFAULT 11142220 CHECK(chain_id=11142220),
 status TEXT NOT NULL DEFAULT 'awaiting_transfer' CHECK(status IN ('awaiting_transfer','observed','rejected')),
 tx_hash TEXT UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_celo_intents_user ON celo_testnet_deposit_intents(user_id,created_at DESC);
