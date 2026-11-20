ALTER TABLE users ADD COLUMN access_state TEXT NOT NULL DEFAULT 'active' CHECK(access_state IN ('active','suspended','closed'));
CREATE TABLE owner_operations (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL,
 value TEXT NOT NULL, expected TEXT NOT NULL, asset TEXT NOT NULL, reason TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX owner_operations_target ON owner_operations(target,action);
CREATE TRIGGER owner_history_update BEFORE UPDATE ON owner_operations BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER owner_history_delete BEFORE DELETE ON owner_operations BEGIN SELECT RAISE(ABORT,'immutable'); END;

CREATE TRIGGER owner_balance AFTER INSERT ON owner_operations WHEN NEW.action='balance' BEGIN
 SELECT RAISE(ABORT,'stale') WHERE NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.target)
 OR CAST(NEW.expected AS INTEGER)<>COALESCE((SELECT SUM(amount_minor) FROM ada_balances WHERE user_id=NEW.target AND asset=NEW.asset AND bucket IN ('funding','realized')),0)
 OR CAST(NEW.value AS INTEGER)<COALESCE((SELECT SUM(amount_minor) FROM withdrawal_requests WHERE user_id=NEW.target AND asset=NEW.asset AND status IN ('approved','pending_review')),0);
 INSERT INTO ada_transactions(id,source_key,kind,evidence_ref,effective_at) VALUES('correction:'||NEW.id,'correction:'||NEW.id,'legacy',NEW.id,NEW.created_at);
 INSERT INTO ada_postings VALUES('correction:'||NEW.id,1,NEW.target,'customer:'||NEW.target,NEW.asset,'realized',CAST(NEW.value AS INTEGER)-CAST(NEW.expected AS INTEGER));
 INSERT INTO ada_postings VALUES('correction:'||NEW.id,2,NULL,'control:corrections',NEW.asset,'clearing',CAST(NEW.expected AS INTEGER)-CAST(NEW.value AS INTEGER));
 UPDATE ada_transactions SET status='posted' WHERE id='correction:'||NEW.id;
END;
CREATE TRIGGER owner_account AFTER INSERT ON owner_operations WHEN NEW.action IN ('email','state','name') BEGIN
 SELECT RAISE(ABORT,'owner protected') WHERE NEW.target=NEW.actor;
 SELECT RAISE(ABORT,'stale') WHERE
 (NEW.action='email' AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.target AND email=NEW.expected)) OR
 (NEW.action='state' AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.target AND access_state=NEW.expected)) OR
 (NEW.action='name' AND NOT EXISTS(SELECT 1 FROM account_profiles WHERE user_id=NEW.target AND display_name=NEW.expected));
 UPDATE users SET email=NEW.value WHERE NEW.action='email' AND id=NEW.target AND email=NEW.expected;
 UPDATE users SET access_state=NEW.value WHERE NEW.action='state' AND id=NEW.target AND access_state=NEW.expected;
 UPDATE account_profiles SET display_name=NEW.value WHERE NEW.action='name' AND user_id=NEW.target AND display_name=NEW.expected;
 DELETE FROM sessions WHERE user_id=NEW.target AND NEW.action IN ('email','state');
END;
CREATE TRIGGER owner_attribution AFTER INSERT ON owner_operations WHEN NEW.action='referral' BEGIN
 SELECT RAISE(ABORT,'posted commission or settled deposit') WHERE EXISTS(SELECT 1 FROM referral_rewards WHERE referred_user_id=NEW.target)
 OR EXISTS(SELECT 1 FROM circle_rewards WHERE referred_user_id=NEW.target) OR EXISTS(SELECT 1 FROM funding_receipts WHERE user_id=NEW.target);
 DELETE FROM referral_attributions WHERE user_id=NEW.target AND code=NEW.expected;
 SELECT RAISE(ABORT,'stale') WHERE changes()<>1;
 INSERT INTO referral_attributions(user_id,code) SELECT NEW.target,NEW.value WHERE NEW.value<>'';
END;
CREATE TRIGGER owner_claim AFTER INSERT ON owner_operations WHEN NEW.action='claim' BEGIN
 UPDATE manual_deposit_claims SET status=NEW.value WHERE id=NEW.target AND status='pending_review' AND
 (NEW.value='rejected' OR EXISTS(SELECT 1 FROM funding_receipts f WHERE f.user_id=manual_deposit_claims.user_id AND f.tx_hash=manual_deposit_claims.tx_hash AND f.asset=manual_deposit_claims.asset AND f.chain_id=manual_deposit_claims.chain_id));
 SELECT RAISE(ABORT,'claim requires matching settlement') WHERE changes()<>1;
END;
CREATE TRIGGER owner_note AFTER INSERT ON owner_operations WHEN NEW.action='note' BEGIN
 SELECT RAISE(ABORT,'unknown receipt') WHERE NOT EXISTS(SELECT 1 FROM funding_receipts WHERE id=NEW.target);
END;
CREATE TRIGGER owner_delete_unused AFTER INSERT ON owner_operations WHEN NEW.action='delete' BEGIN
 SELECT RAISE(ABORT,'close unused account first') WHERE NEW.actor=NEW.target OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.target AND access_state='closed' AND email=NEW.value)
 OR EXISTS(SELECT 1 FROM portfolios WHERE user_id=NEW.target AND cash_usdt<>0)
 OR EXISTS(SELECT 1 FROM referral_attributions WHERE user_id=NEW.target OR code IN (SELECT code FROM referral_codes WHERE user_id=NEW.target))
 OR EXISTS(SELECT 1 FROM investor_preferences WHERE user_id=NEW.target);
 DELETE FROM portfolios WHERE user_id=NEW.target;
 DELETE FROM referral_aliases WHERE user_id=NEW.target;
 DELETE FROM users WHERE id=NEW.target;
END;
CREATE TRIGGER owner_commission AFTER INSERT ON owner_operations WHEN NEW.action='commission' BEGIN
 UPDATE circle_rewards SET review_state=NEW.value,review_reason=NEW.reason WHERE referred_user_id=NEW.target AND review_state=NEW.expected
 AND NOT EXISTS(SELECT 1 FROM circle_payout_receipts WHERE referred_user_id=NEW.target);
 SELECT RAISE(ABORT,'settled or stale commission') WHERE changes()<>1;
END;
