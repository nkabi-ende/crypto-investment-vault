-- Additive migration; existing accounts, balances and test credits are preserved.
CREATE TABLE account_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 2 AND 80),
 terms_version TEXT NOT NULL,
 terms_accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE referral_codes (
 code TEXT PRIMARY KEY,
 user_id TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 label TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO referral_codes(code,label) VALUES('kzn-ai','KZN AI Solutions launch');
CREATE TABLE referral_attributions (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 code TEXT NOT NULL REFERENCES referral_codes(code),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_referral_attributions_code ON referral_attributions(code);
-- Private service messages, never exposed by an API or sent before provider activation.
CREATE TABLE email_outbox (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_type TEXT NOT NULL CHECK(event_type='account.welcome.v1'),
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
CREATE INDEX idx_email_outbox_ready ON email_outbox(status,available_at);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX idx_auth_attempts_window ON auth_attempts(window_start);
CREATE INDEX idx_audit_user_created ON audit_events(user_id,created_at DESC);
