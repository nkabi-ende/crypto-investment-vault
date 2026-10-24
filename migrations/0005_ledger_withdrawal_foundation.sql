-- Accounting foundation: no automated investment credits or payment execution.
CREATE TABLE IF NOT EXISTS ledger_entries (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 event_key TEXT NOT NULL UNIQUE,
 asset TEXT NOT NULL DEFAULT 'USDT' CHECK(asset='USDT'),
 amount_minor INTEGER NOT NULL CHECK(amount_minor<>0),
 entry_type TEXT NOT NULL CHECK(entry_type IN ('verified_deposit','verified_withdrawal','realized_profit','realized_loss','fee','reversal')),
 source_ref TEXT NOT NULL,
 occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ledger_user_time ON ledger_entries(user_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS withdrawal_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 asset TEXT NOT NULL DEFAULT 'USDT',
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 destination_network TEXT NOT NULL,
 destination_address TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_review','approved','rejected','cancelled','executed')),
 requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 executed_at TEXT,
 reviewer_id TEXT,
 transaction_hash TEXT UNIQUE,
 note TEXT
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_user ON withdrawal_requests(user_id,requested_at DESC);
