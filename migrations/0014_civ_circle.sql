-- Versioned direct-referral commissions; existing R1,000 rewards are untouched.
DROP TRIGGER reward_verified_deposit;
CREATE TABLE affiliate_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 public_alias TEXT NOT NULL UNIQUE DEFAULT ('Circle-' || upper(hex(randomblob(5)))),
 joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 publication_policy TEXT NOT NULL DEFAULT 'automatic_alias_v1' CHECK(publication_policy='automatic_alias_v1')
);
INSERT INTO affiliate_profiles(user_id) SELECT DISTINCT r.user_id FROM referral_attributions a JOIN referral_codes r ON r.code=a.code WHERE r.user_id IS NOT NULL;
CREATE TRIGGER affiliate_profile_for_inviter AFTER INSERT ON referral_attributions
BEGIN
 INSERT OR IGNORE INTO affiliate_profiles(user_id) SELECT user_id FROM referral_codes WHERE code=NEW.code;
END;
CREATE TRIGGER affiliate_alias_immutable BEFORE UPDATE ON affiliate_profiles
BEGIN SELECT RAISE(ABORT,'Public partner identity is immutable'); END;
CREATE TABLE circle_rates (
 version TEXT NOT NULL,
 tier TEXT NOT NULL CHECK(tier IN ('circle','gold','platinum')),
 account_usd INTEGER NOT NULL CHECK(account_usd IN (100,200)),
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0),
 PRIMARY KEY(version,tier,account_usd)
);
INSERT INTO circle_rates VALUES
 ('circle-2026-11-17','circle',100,20000),('circle-2026-11-17','circle',200,30000),
 ('circle-2026-11-17','gold',100,22500),('circle-2026-11-17','gold',200,35000),
 ('circle-2026-11-17','platinum',100,25000),('circle-2026-11-17','platinum',200,40000);
CREATE TRIGGER circle_rates_no_update BEFORE UPDATE ON circle_rates
BEGIN SELECT RAISE(ABORT,'Publish a new commission rule version'); END;
CREATE TRIGGER circle_rates_no_delete BEFORE DELETE ON circle_rates
BEGIN SELECT RAISE(ABORT,'Commission rules are historical evidence'); END;
CREATE TABLE circle_rewards (
 referred_user_id TEXT PRIMARY KEY REFERENCES users(id),
 user_id TEXT NOT NULL REFERENCES affiliate_profiles(user_id),
 receipt_id TEXT NOT NULL UNIQUE REFERENCES funding_receipts(id),
 version TEXT NOT NULL,
 tier TEXT NOT NULL,
 account_usd INTEGER NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0),
 currency TEXT NOT NULL DEFAULT 'ZAR' CHECK(currency='ZAR'),
 review_state TEXT NOT NULL DEFAULT 'clear' CHECK(review_state IN ('clear','hold','rejected')),
 review_reason TEXT,
 eligible_at TEXT NOT NULL DEFAULT (datetime('now','+30 days')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(version,tier,account_usd) REFERENCES circle_rates(version,tier,account_usd),
 CHECK(user_id<>referred_user_id)
);
CREATE INDEX idx_circle_rewards_owner ON circle_rewards(user_id,eligible_at);
CREATE TABLE circle_payout_receipts (
 referred_user_id TEXT PRIMARY KEY REFERENCES circle_rewards(referred_user_id),
 payout_ref TEXT NOT NULL UNIQUE CHECK(length(payout_ref)>0),
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0),
 currency TEXT NOT NULL DEFAULT 'ZAR' CHECK(currency='ZAR'),
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref)>0),
 settled_at TEXT NOT NULL
);
CREATE VIEW circle_wallet AS
 SELECT r.*,CASE
 WHEN p.referred_user_id IS NOT NULL THEN 'paid'
 WHEN r.review_state='rejected' THEN 'void'
 WHEN f.refunded_minor>0 THEN 'suspended'
 WHEN r.review_state='hold' THEN 'review'
 WHEN datetime(r.eligible_at)<=datetime('now') THEN 'approved'
 ELSE 'pending' END AS status,
 p.settled_at AS paid_at
 FROM circle_rewards r JOIN funding_receipts f ON f.id=r.receipt_id
 LEFT JOIN circle_payout_receipts p ON p.referred_user_id=r.referred_user_id;
CREATE VIEW circle_qualified_customers AS
 SELECT r.user_id,r.referred_user_id,r.created_at AS qualified_at,
 (SELECT asset FROM funding_receipts f WHERE f.user_id=r.referred_user_id ORDER BY f.created_at,f.id LIMIT 1) AS asset,
 (SELECT amount_minor-refunded_minor FROM funding_receipts f WHERE f.user_id=r.referred_user_id ORDER BY f.created_at,f.id LIMIT 1) AS introduced_minor
 FROM referral_wallet r WHERE r.status='credited'
 UNION ALL
 SELECT w.user_id,w.referred_user_id,w.eligible_at AS qualified_at,f.asset,f.amount_minor-f.refunded_minor
 FROM circle_wallet w JOIN funding_receipts f ON f.id=w.receipt_id
 WHERE w.status IN ('approved','paid') AND f.refunded_minor=0 AND w.review_state='clear';
CREATE VIEW circle_tiers AS
 SELECT p.user_id,COUNT(q.referred_user_id) AS qualified_90d,
 CASE WHEN COUNT(q.referred_user_id)>=15 THEN 'platinum' WHEN COUNT(q.referred_user_id)>=5 THEN 'gold' ELSE 'circle' END AS tier
 FROM affiliate_profiles p LEFT JOIN circle_qualified_customers q ON q.user_id=p.user_id AND datetime(q.qualified_at)>=datetime('now','-90 days')
 GROUP BY p.user_id;
CREATE TRIGGER circle_reward_matches_source BEFORE INSERT ON circle_rewards
BEGIN
 SELECT RAISE(ABORT,'Commission must match a verified direct referral and rate') WHERE NOT EXISTS (
  SELECT 1 FROM funding_receipts f JOIN referral_attributions a ON a.user_id=f.user_id JOIN referral_codes r ON r.code=a.code
  JOIN circle_rates rate ON rate.version=NEW.version AND rate.tier=NEW.tier AND rate.account_usd=NEW.account_usd
  WHERE f.id=NEW.receipt_id AND f.user_id=NEW.referred_user_id AND r.user_id=NEW.user_id
  AND f.amount_minor=NEW.account_usd*1000000 AND f.refunded_minor=0 AND rate.amount_minor=NEW.amount_minor
  AND NOT EXISTS(SELECT 1 FROM referral_rewards old WHERE old.referred_user_id=NEW.referred_user_id)
 );
END;
CREATE TRIGGER circle_reward_verified_deposit AFTER INSERT ON funding_receipts
WHEN NEW.amount_minor IN (100000000,200000000) AND NEW.refunded_minor=0
 AND (SELECT COUNT(*) FROM funding_receipts WHERE user_id=NEW.user_id)=1
BEGIN
 INSERT OR IGNORE INTO circle_rewards(referred_user_id,user_id,receipt_id,version,tier,account_usd,amount_minor,review_state,review_reason)
 SELECT NEW.user_id,r.user_id,NEW.id,rate.version,t.tier,rate.account_usd,rate.amount_minor,
 CASE WHEN EXISTS(SELECT 1 FROM circle_rewards prior JOIN payment_quotes pq ON pq.id=prior.receipt_id JOIN payment_quotes nq ON nq.id=NEW.id WHERE lower(pq.sender)=lower(nq.sender)) THEN 'hold' ELSE 'clear' END,
 CASE WHEN EXISTS(SELECT 1 FROM circle_rewards prior JOIN payment_quotes pq ON pq.id=prior.receipt_id JOIN payment_quotes nq ON nq.id=NEW.id WHERE lower(pq.sender)=lower(nq.sender)) THEN 'Funding source used by another referred account; review required' ELSE NULL END
 FROM referral_attributions a JOIN referral_codes r ON r.code=a.code JOIN circle_tiers t ON t.user_id=r.user_id
 JOIN circle_rates rate ON rate.version='circle-2026-11-17' AND rate.tier=t.tier AND rate.account_usd=NEW.amount_minor/1000000
 WHERE a.user_id=NEW.user_id AND r.user_id<>NEW.user_id
 AND NOT EXISTS(SELECT 1 FROM referral_rewards old WHERE old.referred_user_id=NEW.user_id);
END;
CREATE TRIGGER circle_reward_identity_immutable BEFORE UPDATE OF referred_user_id,user_id,receipt_id,version,tier,account_usd,amount_minor,currency,eligible_at,created_at ON circle_rewards
BEGIN SELECT RAISE(ABORT,'Commission contract is immutable'); END;
CREATE TRIGGER circle_reward_no_delete BEFORE DELETE ON circle_rewards
BEGIN SELECT RAISE(ABORT,'Commission history is immutable'); END;
CREATE TRIGGER circle_review_audit AFTER UPDATE OF review_state,review_reason ON circle_rewards
BEGIN INSERT INTO audit_events(id,user_id,event_type,detail) VALUES(lower(hex(randomblob(16))),NEW.user_id,'circle_review_changed',json_object('referredUserId',NEW.referred_user_id,'state',NEW.review_state,'reason',NEW.review_reason)); END;
CREATE TRIGGER circle_payout_valid BEFORE INSERT ON circle_payout_receipts
BEGIN
 SELECT RAISE(ABORT,'Only an approved commission can be settled') WHERE NOT EXISTS(SELECT 1 FROM circle_wallet w WHERE w.referred_user_id=NEW.referred_user_id AND w.status='approved' AND w.amount_minor=NEW.amount_minor)
;
END;
CREATE TRIGGER circle_payout_no_update BEFORE UPDATE ON circle_payout_receipts
BEGIN SELECT RAISE(ABORT,'Payout receipts are immutable'); END;
CREATE TRIGGER circle_payout_no_delete BEFORE DELETE ON circle_payout_receipts
BEGIN SELECT RAISE(ABORT,'Payout receipts are immutable'); END;
CREATE TABLE referral_click_claims (
 token_hash TEXT PRIMARY KEY,
 code TEXT NOT NULL REFERENCES referral_codes(code),
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
