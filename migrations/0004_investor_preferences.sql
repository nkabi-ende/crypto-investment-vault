-- Non-custodial investor onboarding preferences. No deposit addresses or payment instructions.
CREATE TABLE IF NOT EXISTS investor_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 entry_tier_usd INTEGER NOT NULL CHECK(entry_tier_usd IN (100,200)),
 payout_cycle TEXT NOT NULL DEFAULT 'weekly' CHECK(payout_cycle='weekly'),
 acknowledgement_at TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_investor_preferences_tier ON investor_preferences(entry_tier_usd);
