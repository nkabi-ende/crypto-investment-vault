-- Retire campaign attribution; retain valid member-to-member history and old member URLs.
DELETE FROM referral_attributions WHERE code IN (SELECT code FROM referral_codes WHERE user_id IS NULL);
DELETE FROM referral_codes WHERE user_id IS NULL;
UPDATE referral_codes SET label=NULL;
INSERT OR IGNORE INTO referral_codes(code,user_id) SELECT id,id FROM users;
DELETE FROM referral_attributions WHERE user_id IN (SELECT r.user_id FROM referral_codes r WHERE r.code=referral_attributions.code);
CREATE TRIGGER referral_member_only BEFORE INSERT ON referral_codes
WHEN NEW.user_id IS NULL OR (NEW.code<>NEW.user_id AND NEW.code<>replace(NEW.user_id,'-',''))
BEGIN SELECT RAISE(ABORT,'Member ID required'); END;
CREATE TRIGGER referral_identity_immutable BEFORE UPDATE OF code,user_id ON referral_codes
BEGIN SELECT RAISE(ABORT,'Referral identity is immutable'); END;
CREATE TRIGGER referral_no_self BEFORE INSERT ON referral_attributions
WHEN NEW.user_id=(SELECT user_id FROM referral_codes WHERE code=NEW.code)
BEGIN SELECT RAISE(ABORT,'Self referral is not allowed'); END;
CREATE TRIGGER referral_attribution_immutable BEFORE UPDATE ON referral_attributions
BEGIN SELECT RAISE(ABORT,'Referral attribution is immutable'); END;

CREATE TABLE signup_deposit_requirements (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 currency TEXT NOT NULL DEFAULT 'ZAR' CHECK(currency='ZAR'),
 required_minor INTEGER NOT NULL DEFAULT 50000 CHECK(required_minor=50000),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO signup_deposit_requirements(user_id) SELECT id FROM users;
-- Cover registrations made by the preceding Worker during the deploy transition.
CREATE TRIGGER signup_requirement_on_user AFTER INSERT ON users
BEGIN INSERT OR IGNORE INTO signup_deposit_requirements(user_id) VALUES(NEW.id); END;
-- Trusted settlement adapters only. No browser endpoint can write payment confirmation.
-- Each settled payment has one globally unique provider reference; reversals retain history.
CREATE TABLE signup_deposits (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES signup_deposit_requirements(user_id),
 provider TEXT NOT NULL,
 payment_ref TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(currency='ZAR'),
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0 AND amount_minor<=9007199254740991),
 refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK(typeof(refunded_minor)='integer' AND refunded_minor>=0 AND refunded_minor<=amount_minor),
 environment TEXT NOT NULL CHECK(environment='production'),
 settled_at TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(provider,payment_ref)
);
CREATE INDEX idx_signup_deposits_user ON signup_deposits(user_id);
CREATE TRIGGER signup_payment_identity_immutable BEFORE UPDATE OF id,user_id,provider,payment_ref,currency,amount_minor,environment,settled_at ON signup_deposits
BEGIN SELECT RAISE(ABORT,'Settled payment identity is immutable'); END;
CREATE TRIGGER signup_payment_refund_updated AFTER UPDATE OF refunded_minor ON signup_deposits
BEGIN UPDATE signup_deposits SET updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id; END;
CREATE VIEW member_activation AS
 SELECT r.user_id,r.required_minor,COALESCE(SUM(d.amount_minor-d.refunded_minor),0) AS settled_minor,
 CASE WHEN COALESCE(SUM(d.amount_minor-d.refunded_minor),0)>=r.required_minor THEN 1 ELSE 0 END AS active
 FROM signup_deposit_requirements r LEFT JOIN signup_deposits d ON d.user_id=r.user_id GROUP BY r.user_id;
-- Perks are published individually once their terms and milestones are defined.
CREATE TABLE member_perks (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
 description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 500),
 metric TEXT NOT NULL CHECK(metric IN ('activated_members','qualified_referrals')),
 threshold INTEGER NOT NULL CHECK(typeof(threshold)='integer' AND threshold>0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','paused')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
