-- Legacy sessions deliberately require a fresh login under the hardened cookie policy.
-- User accounts, balances, documents and history are preserved.
ALTER TABLE sessions ADD COLUMN security_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN authenticated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_session_expiry ON sessions(expires_at);
