-- Read-only market snapshot cache shared by every Cloudflare location.
-- Separate from all member, funding and payment ledgers.
CREATE TABLE IF NOT EXISTS market_data_cache (
  cache_key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL DEFAULT 0,
  lease_until_ms INTEGER NOT NULL DEFAULT 0,
  next_attempt_ms INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO market_data_cache(cache_key) VALUES ('big7-usd-v1');
