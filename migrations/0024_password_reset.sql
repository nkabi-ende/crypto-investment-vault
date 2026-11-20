ALTER TABLE users ADD COLUMN password_reset_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE password_resets (
 token_hash TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 requested_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX idx_password_resets_member ON password_resets(user_id, requested_at);
CREATE INDEX idx_password_resets_expiry ON password_resets(expires_at);

CREATE TRIGGER invalidate_password_resets_on_account_change
AFTER UPDATE OF email, access_state ON users
WHEN NEW.email <> OLD.email OR NEW.access_state <> OLD.access_state
BEGIN
 DELETE FROM password_resets WHERE user_id=NEW.id;
END;
