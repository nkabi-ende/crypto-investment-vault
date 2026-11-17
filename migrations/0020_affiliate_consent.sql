CREATE TABLE affiliate_consents (
 user_id TEXT PRIMARY KEY REFERENCES affiliate_profiles(user_id),
 terms_version TEXT NOT NULL,
 accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER paper_portfolio_on_identity_approval AFTER UPDATE OF status ON kyc_submissions
WHEN NEW.status='approved' AND OLD.status='pending'
BEGIN
 INSERT INTO shaka_sim_members(user_id,verified_by,starts_on)
 VALUES(NEW.user_id,NEW.reviewer_id,date('now','+2 hours','+1 day'))
 ON CONFLICT(user_id) DO NOTHING;
END;
INSERT OR IGNORE INTO shaka_sim_members(user_id,verified_by,starts_on)
 SELECT user_id,reviewer_id,date('now','+2 hours','+1 day') FROM kyc_submissions
 WHERE status='approved' AND datetime(expires_at)>CURRENT_TIMESTAMP AND reviewer_id IS NOT NULL;
