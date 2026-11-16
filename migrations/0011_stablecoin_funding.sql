-- Preserve historic ZAR receipts. New funding uses the actual stablecoin and six-decimal units.
ALTER TABLE payment_quotes ADD COLUMN purpose TEXT NOT NULL DEFAULT 'legacy_activation';
ALTER TABLE payment_quotes ADD COLUMN funding_minor INTEGER CHECK(funding_minor IS NULL OR funding_minor IN (100000000,200000000));
CREATE TRIGGER quote_funding_terms_immutable BEFORE UPDATE OF purpose,funding_minor ON payment_quotes
BEGIN SELECT RAISE(ABORT,'Funding terms are immutable'); END;
CREATE TABLE funding_receipts (
 id TEXT PRIMARY KEY REFERENCES payment_quotes(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 asset TEXT NOT NULL CHECK(asset IN ('USDC','USDT')),
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>=100000000),
 refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK(typeof(refunded_minor)='integer' AND refunded_minor>=0 AND refunded_minor<=amount_minor),
 chain_id INTEGER NOT NULL CHECK(chain_id=42220),
 tx_hash TEXT NOT NULL UNIQUE,
 settled_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_funding_user ON funding_receipts(user_id,created_at);
CREATE TRIGGER funding_identity_immutable BEFORE UPDATE OF id,user_id,asset,amount_minor,chain_id,tx_hash,settled_at ON funding_receipts
BEGIN SELECT RAISE(ABORT,'Funding identity is immutable'); END;
CREATE TABLE deposit_promotions (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 qualifying_receipt TEXT NOT NULL REFERENCES funding_receipts(id),
 currency TEXT NOT NULL DEFAULT 'ZAR' CHECK(currency='ZAR'),
 amount_minor INTEGER NOT NULL DEFAULT 50000 CHECK(amount_minor=50000),
 status TEXT NOT NULL DEFAULT 'pending_terms' CHECK(status IN ('pending_terms','approved','void')),
 eligible_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE manual_deposit_claims (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 chain_id INTEGER NOT NULL CHECK(chain_id=42220),
 asset TEXT NOT NULL CHECK(asset IN ('USDC','USDT')),
 tx_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','resolved','rejected')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,tx_hash)
);
-- Activation and referral qualification now follow deposited funds, never the promo or test tokens.
DROP VIEW member_activation;
CREATE VIEW member_activation AS
 SELECT u.id AS user_id,100000000 AS required_minor,COALESCE(SUM(f.amount_minor-f.refunded_minor),0) AS settled_minor,
 CASE WHEN COALESCE(SUM(f.amount_minor-f.refunded_minor),0)>=100000000 THEN 1 ELSE 0 END AS active
 FROM users u LEFT JOIN funding_receipts f ON f.user_id=u.id GROUP BY u.id;
