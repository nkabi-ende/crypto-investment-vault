CREATE TABLE IF NOT EXISTS disclosures (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('performance','custody','legal','fees','risk','team','withdrawals')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','verified')),
  evidence_url TEXT,
  verified_by TEXT,
  verified_at TEXT,
  published_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_disclosures_category ON disclosures(category,status);
CREATE TABLE IF NOT EXISTS strategy_performance (
  id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  net_return_pct REAL,
  max_drawdown_pct REAL,
  fees_pct REAL,
  verification_url TEXT,
  verified_by TEXT,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (period_end >= period_start),
  CHECK (net_return_pct IS NULL OR (net_return_pct >= -100 AND net_return_pct <= 100000))
);
CREATE TABLE IF NOT EXISTS platform_announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
