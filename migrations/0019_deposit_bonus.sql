CREATE TABLE deposit_promotions_new (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 qualifying_receipt TEXT NOT NULL REFERENCES funding_receipts(id),
 currency TEXT NOT NULL DEFAULT 'ZAR' CHECK(currency='ZAR'),
 amount_minor INTEGER NOT NULL DEFAULT 100000 CHECK(amount_minor IN (50000,100000)),
 status TEXT NOT NULL DEFAULT 'pending_terms' CHECK(status IN ('pending_terms','approved','void')),
 eligible_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO deposit_promotions_new
 SELECT user_id,qualifying_receipt,currency,CASE WHEN status='pending_terms' THEN 100000 ELSE amount_minor END,status,eligible_at
 FROM deposit_promotions;
INSERT OR IGNORE INTO deposit_promotions_new(user_id,qualifying_receipt)
 SELECT f.user_id,f.id FROM funding_receipts f WHERE f.amount_minor>f.refunded_minor ORDER BY f.settled_at,f.id;
DROP TABLE deposit_promotions;
ALTER TABLE deposit_promotions_new RENAME TO deposit_promotions;
CREATE TRIGGER deposit_bonus_on_confirmation AFTER INSERT ON funding_receipts
WHEN NEW.amount_minor>NEW.refunded_minor
BEGIN
 INSERT INTO deposit_promotions(user_id,qualifying_receipt) VALUES(NEW.user_id,NEW.id) ON CONFLICT(user_id) DO NOTHING;
END;
