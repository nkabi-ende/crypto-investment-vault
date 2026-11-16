-- Quotes contain exact token amounts and the ZAR value agreed before payment.
CREATE TABLE payment_quotes (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES signup_deposit_requirements(user_id),
 chain_id INTEGER NOT NULL CHECK(chain_id IN (42220,11142220)),
 symbol TEXT NOT NULL CHECK(symbol IN ('USDT','USDC')),
 token TEXT NOT NULL,
 treasury TEXT NOT NULL,
 sender TEXT NOT NULL,
 token_minor INTEGER NOT NULL CHECK(typeof(token_minor)='integer' AND token_minor>0),
 zar_minor INTEGER NOT NULL CHECK(zar_minor>0 AND zar_minor<=50000),
 rate_micro_zar INTEGER NOT NULL CHECK(rate_micro_zar>0),
 rate_source TEXT NOT NULL,
 rate_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 next_block INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK(status IN ('awaiting_payment','submitted','verified','verified_test','review')),
 tx_hash TEXT,
 verified_at INTEGER,
 review_reason TEXT,
 updated_at INTEGER NOT NULL
);
CREATE INDEX idx_payment_quotes_user ON payment_quotes(user_id,created_at DESC);
CREATE INDEX idx_payment_quotes_pending ON payment_quotes(status,updated_at);
CREATE UNIQUE INDEX idx_payment_quotes_tx ON payment_quotes(chain_id,tx_hash) WHERE tx_hash IS NOT NULL;
CREATE TRIGGER quote_terms_immutable BEFORE UPDATE OF user_id,chain_id,symbol,token,treasury,sender,token_minor,zar_minor,rate_micro_zar,rate_source,rate_at,created_at,expires_at ON payment_quotes
BEGIN SELECT RAISE(ABORT,'Quote terms are immutable'); END;
