CREATE TABLE shaka_sim_members (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 verified_by TEXT NOT NULL REFERENCES users(id),
 verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 starts_on TEXT NOT NULL
);
CREATE TABLE shaka_sim_schedules (
 id INTEGER PRIMARY KEY,
 scenario TEXT NOT NULL,
 rates_json TEXT NOT NULL,
 starts_on TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX shaka_sim_schedule_day ON shaka_sim_schedules(starts_on DESC,id DESC);
CREATE TABLE shaka_sim_closes (
 trading_day TEXT PRIMARY KEY,
 schedule_id INTEGER NOT NULL REFERENCES shaka_sim_schedules(id),
 rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN -10000 AND 7500)
);
CREATE TRIGGER shaka_sim_close_no_update BEFORE UPDATE ON shaka_sim_closes
BEGIN SELECT RAISE(ABORT,'Simulation closes are immutable'); END;
CREATE TRIGGER shaka_sim_close_no_delete BEFORE DELETE ON shaka_sim_closes
BEGIN SELECT RAISE(ABORT,'Simulation closes are immutable'); END;
CREATE TRIGGER shaka_sim_schedule_no_update BEFORE UPDATE ON shaka_sim_schedules
BEGIN SELECT RAISE(ABORT,'Simulation schedules are immutable'); END;
CREATE TRIGGER shaka_sim_schedule_no_delete BEFORE DELETE ON shaka_sim_schedules
BEGIN SELECT RAISE(ABORT,'Simulation schedules are immutable'); END;
