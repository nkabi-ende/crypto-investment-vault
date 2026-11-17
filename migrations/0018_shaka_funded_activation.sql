CREATE TABLE shaka_sim_activations (
 user_id TEXT PRIMARY KEY REFERENCES shaka_sim_members(user_id),
 receipt_id TEXT NOT NULL UNIQUE REFERENCES funding_receipts(id),
 activated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 starts_on TEXT NOT NULL
);
CREATE INDEX shaka_sim_recent_activations ON shaka_sim_activations(activated_at DESC,user_id);
CREATE TRIGGER shaka_sim_initial_schedule AFTER INSERT ON shaka_sim_activations
WHEN NOT EXISTS (SELECT 1 FROM shaka_sim_schedules)
BEGIN
 INSERT INTO shaka_sim_schedules(scenario,rates_json,starts_on,created_by)
 SELECT 'mixed','[25,-40,15,-30,55,-20,5]',NEW.starts_on,verified_by
 FROM shaka_sim_members WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER shaka_sim_activate_on_funding AFTER INSERT ON funding_receipts
WHEN NEW.amount_minor>NEW.refunded_minor
BEGIN
 INSERT INTO shaka_sim_activations(user_id,receipt_id,starts_on)
 SELECT user_id,NEW.id,MAX(starts_on,date('now','+2 hours','+1 day'))
 FROM shaka_sim_members WHERE user_id=NEW.user_id
 ON CONFLICT(user_id) DO NOTHING;
END;
CREATE TRIGGER shaka_sim_activate_on_verification AFTER INSERT ON shaka_sim_members
BEGIN
 INSERT INTO shaka_sim_activations(user_id,receipt_id,starts_on)
 SELECT NEW.user_id,id,MAX(NEW.starts_on,date('now','+2 hours','+1 day'))
 FROM funding_receipts WHERE user_id=NEW.user_id AND amount_minor>refunded_minor
 ORDER BY settled_at,id LIMIT 1
 ON CONFLICT(user_id) DO NOTHING;
END;
INSERT INTO shaka_sim_activations(user_id,receipt_id,starts_on)
 SELECT m.user_id,f.id,MAX(m.starts_on,date('now','+2 hours','+1 day'))
 FROM shaka_sim_members m JOIN funding_receipts f ON f.id=(
  SELECT id FROM funding_receipts WHERE user_id=m.user_id AND amount_minor>refunded_minor ORDER BY settled_at,id LIMIT 1
 );
