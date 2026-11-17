-- Preserve existing queued and sent messages while adding the internal registration event.
-- Rebuilding is necessary because SQLite cannot alter a table-level CHECK constraint.
CREATE TABLE email_outbox_v2 (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_type TEXT NOT NULL CHECK(event_type IN ('account.welcome.v1','account.signup.alert.v1')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 available_at INTEGER NOT NULL,
 lease_until INTEGER,
 sent_at TEXT,
 provider_id TEXT,
 last_error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,event_type)
);
INSERT INTO email_outbox_v2
 (id,user_id,event_type,status,attempts,available_at,lease_until,sent_at,provider_id,last_error,created_at)
SELECT id,user_id,event_type,status,attempts,available_at,lease_until,sent_at,provider_id,last_error,created_at FROM email_outbox;
DROP TABLE email_outbox;
ALTER TABLE email_outbox_v2 RENAME TO email_outbox;
CREATE INDEX idx_email_outbox_ready ON email_outbox(status,available_at);

-- Server/database inserts, including provisioned accounts, get exactly one event.
-- The trigger runs in the same transaction as the user insert and rolls back with it.
CREATE TRIGGER queue_signup_alert_after_user_insert AFTER INSERT ON users
BEGIN
 INSERT OR IGNORE INTO email_outbox(id,user_id,event_type,available_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,'account.signup.alert.v1',CAST(strftime('%s','now') AS INTEGER)*1000);
END;
