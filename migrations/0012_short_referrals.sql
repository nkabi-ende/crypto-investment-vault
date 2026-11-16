-- Short public aliases preserve canonical member attribution and historic links.
CREATE TABLE referral_aliases (
 code TEXT PRIMARY KEY CHECK(length(code)=10 AND code NOT GLOB '*[^a-f0-9]*'),
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id)
);
INSERT INTO referral_aliases(code,user_id) SELECT lower(hex(randomblob(5))),id FROM users;
CREATE TRIGGER member_short_invitation AFTER INSERT ON users
BEGIN INSERT INTO referral_aliases(code,user_id) VALUES(lower(hex(randomblob(5))),NEW.id); END;
CREATE TRIGGER referral_alias_immutable BEFORE UPDATE ON referral_aliases
BEGIN SELECT RAISE(ABORT,'Invitation aliases are immutable'); END;
-- One immutable ZAR promotional credit per referred member. Refunds suspend its availability.
CREATE TABLE referral_rewards (
 referred_user_id TEXT PRIMARY KEY REFERENCES users(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 currency TEXT NOT NULL DEFAULT 'ZAR' CHECK(currency='ZAR'),
 amount_minor INTEGER NOT NULL DEFAULT 100000 CHECK(amount_minor=100000),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(user_id<>referred_user_id)
);
CREATE INDEX idx_referral_rewards_owner ON referral_rewards(user_id);
CREATE VIEW qualified_referral_rewards AS
 SELECT r.user_id AS user_id,a.user_id AS referred_user_id FROM referral_attributions a
 JOIN referral_codes r ON r.code=a.code JOIN member_activation m ON m.user_id=a.user_id
 WHERE m.active=1 AND r.user_id<>a.user_id;
INSERT INTO referral_rewards(user_id,referred_user_id) SELECT user_id,referred_user_id FROM qualified_referral_rewards;
CREATE TRIGGER reward_verified_deposit AFTER INSERT ON funding_receipts
BEGIN INSERT OR IGNORE INTO referral_rewards(user_id,referred_user_id)
 SELECT user_id,referred_user_id FROM qualified_referral_rewards WHERE referred_user_id=NEW.user_id; END;
CREATE TRIGGER reward_immutable BEFORE UPDATE ON referral_rewards
BEGIN SELECT RAISE(ABORT,'Referral reward identity is immutable'); END;
CREATE VIEW referral_wallet AS
 SELECT r.user_id,r.referred_user_id,r.currency,r.amount_minor,r.created_at,
 CASE WHEN m.active=1 THEN 'credited' ELSE 'suspended' END AS status
 FROM referral_rewards r JOIN member_activation m ON m.user_id=r.referred_user_id;
