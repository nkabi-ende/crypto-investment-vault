ALTER TABLE celo_testnet_deposit_intents ADD COLUMN sender TEXT;
ALTER TABLE celo_testnet_deposit_intents ADD COLUMN token TEXT;
ALTER TABLE celo_testnet_deposit_intents ADD COLUMN treasury TEXT;

CREATE TABLE celo_test_credits (
 intent_id TEXT PRIMARY KEY REFERENCES celo_testnet_deposit_intents(id),
 chain_id INTEGER NOT NULL CHECK(chain_id=11142220),
 token TEXT NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), block_hash TEXT NOT NULL,
 UNIQUE(chain_id,tx_hash,log_index)
);
CREATE TABLE celo_scan_cursor (
 token TEXT NOT NULL, treasury TEXT NOT NULL, next_block INTEGER NOT NULL,
 PRIMARY KEY(token,treasury)
);
