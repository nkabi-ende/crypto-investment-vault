-- ADA: immutable, balanced, asset-specific journal. No scheduled or synthetic profit credits.
CREATE TABLE ada_transactions (
 id TEXT PRIMARY KEY,
 source_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('funding','refund','legacy','performance','bonus')),
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref)>0),
 effective_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE ada_postings (
 transaction_id TEXT NOT NULL REFERENCES ada_transactions(id),
 line_no INTEGER NOT NULL,
 user_id TEXT REFERENCES users(id),
 account TEXT NOT NULL,
 asset TEXT NOT NULL CHECK(asset IN ('USDC','USDT','ZAR')),
 bucket TEXT NOT NULL CHECK(bucket IN ('funding','realized','unrealized','bonus','clearing')),
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor<>0 AND abs(amount_minor)<=9007199254740991),
 PRIMARY KEY(transaction_id,line_no)
);
CREATE INDEX idx_ada_owner ON ada_postings(user_id,asset,bucket);
CREATE TRIGGER ada_new_draft BEFORE INSERT ON ada_transactions WHEN NEW.status<>'draft'
BEGIN SELECT RAISE(ABORT,'Journal must be constructed before posting'); END;
CREATE TRIGGER ada_balanced BEFORE UPDATE OF status ON ada_transactions WHEN NEW.status='posted'
BEGIN
 SELECT RAISE(ABORT,'Journal needs counter-entries') WHERE (SELECT COUNT(*) FROM ada_postings WHERE transaction_id=NEW.id)<2;
 SELECT RAISE(ABORT,'Journal must balance per asset') WHERE EXISTS(SELECT asset FROM ada_postings WHERE transaction_id=NEW.id GROUP BY asset HAVING SUM(amount_minor)<>0);
END;
CREATE TRIGGER ada_transaction_immutable BEFORE UPDATE ON ada_transactions WHEN OLD.status='posted'
BEGIN SELECT RAISE(ABORT,'Posted journals are immutable'); END;
CREATE TRIGGER ada_transaction_no_delete BEFORE DELETE ON ada_transactions
BEGIN SELECT RAISE(ABORT,'Journal history is immutable'); END;
CREATE TRIGGER ada_posting_insert_guard BEFORE INSERT ON ada_postings WHEN (SELECT status FROM ada_transactions WHERE id=NEW.transaction_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'Posted entries are immutable'); END;
CREATE TRIGGER ada_posting_no_update BEFORE UPDATE ON ada_postings
BEGIN SELECT RAISE(ABORT,'Reverse and replace a journal instead'); END;
CREATE TRIGGER ada_posting_no_delete BEFORE DELETE ON ada_postings
BEGIN SELECT RAISE(ABORT,'Journal entries cannot be deleted'); END;
CREATE VIEW ada_balances AS
 SELECT p.user_id,p.asset,p.bucket,SUM(p.amount_minor) AS amount_minor
 FROM ada_postings p JOIN ada_transactions t ON t.id=p.transaction_id AND t.status='posted'
 WHERE p.user_id IS NOT NULL GROUP BY p.user_id,p.asset,p.bucket;
INSERT INTO ada_transactions(id,source_key,kind,evidence_ref,effective_at)
 SELECT 'funding:'||id,'funding:'||id,'funding',tx_hash,settled_at FROM funding_receipts;
INSERT INTO ada_postings(transaction_id,line_no,user_id,account,asset,bucket,amount_minor)
 SELECT 'funding:'||id,1,user_id,'customer:'||user_id,asset,'funding',amount_minor FROM funding_receipts
 UNION ALL SELECT 'funding:'||id,2,NULL,'external:settlement',asset,'clearing',-amount_minor FROM funding_receipts;
UPDATE ada_transactions SET status='posted';
CREATE TRIGGER ada_funding_receipt AFTER INSERT ON funding_receipts
BEGIN
 INSERT INTO ada_transactions(id,source_key,kind,evidence_ref,effective_at) VALUES('funding:'||NEW.id,'funding:'||NEW.id,'funding',NEW.tx_hash,NEW.settled_at);
 INSERT INTO ada_postings VALUES('funding:'||NEW.id,1,NEW.user_id,'customer:'||NEW.user_id,NEW.asset,'funding',NEW.amount_minor);
 INSERT INTO ada_postings VALUES('funding:'||NEW.id,2,NULL,'external:settlement',NEW.asset,'clearing',-NEW.amount_minor);
 UPDATE ada_transactions SET status='posted' WHERE id='funding:'||NEW.id;
END;
CREATE TABLE ada_refund_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 receipt_id TEXT NOT NULL REFERENCES funding_receipts(id),
 delta_minor INTEGER NOT NULL CHECK(delta_minor<>0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER ada_refund_post AFTER INSERT ON ada_refund_events
BEGIN
 INSERT INTO ada_transactions(id,source_key,kind,evidence_ref,effective_at) VALUES('refund:'||NEW.id,'refund:'||NEW.id,'refund',NEW.receipt_id,NEW.created_at);
 INSERT INTO ada_postings SELECT 'refund:'||NEW.id,1,user_id,'customer:'||user_id,asset,'funding',-NEW.delta_minor FROM funding_receipts WHERE id=NEW.receipt_id;
 INSERT INTO ada_postings SELECT 'refund:'||NEW.id,2,NULL,'external:refund',asset,'clearing',NEW.delta_minor FROM funding_receipts WHERE id=NEW.receipt_id;
 UPDATE ada_transactions SET status='posted' WHERE id='refund:'||NEW.id;
END;
INSERT INTO ada_refund_events(receipt_id,delta_minor) SELECT id,refunded_minor FROM funding_receipts WHERE refunded_minor>0;
CREATE TRIGGER ada_funding_refund AFTER UPDATE OF refunded_minor ON funding_receipts WHEN NEW.refunded_minor<>OLD.refunded_minor
BEGIN INSERT INTO ada_refund_events(receipt_id,delta_minor) VALUES(NEW.id,NEW.refunded_minor-OLD.refunded_minor); END;
INSERT INTO ada_transactions(id,source_key,kind,evidence_ref,effective_at)
 SELECT 'legacy:'||l.id,'legacy:'||l.event_key,'legacy',l.source_ref,l.occurred_at FROM ledger_entries l
 WHERE NOT(l.entry_type='verified_deposit' AND EXISTS(SELECT 1 FROM funding_receipts f WHERE f.id=l.source_ref OR f.tx_hash=l.source_ref));
INSERT INTO ada_postings
 SELECT t.id,1,l.user_id,'customer:'||l.user_id,l.asset,CASE WHEN l.entry_type IN ('realized_profit','realized_loss','fee') THEN 'realized' ELSE 'funding' END,l.amount_minor
 FROM ledger_entries l JOIN ada_transactions t ON t.id='legacy:'||l.id
 UNION ALL SELECT t.id,2,NULL,'external:legacy',l.asset,'clearing',-l.amount_minor FROM ledger_entries l JOIN ada_transactions t ON t.id='legacy:'||l.id;
UPDATE ada_transactions SET status='posted' WHERE status='draft';
CREATE TRIGGER ada_legacy_entry AFTER INSERT ON ledger_entries
WHEN NOT(NEW.entry_type='verified_deposit' AND EXISTS(SELECT 1 FROM funding_receipts f WHERE f.id=NEW.source_ref OR f.tx_hash=NEW.source_ref))
BEGIN
 INSERT INTO ada_transactions(id,source_key,kind,evidence_ref,effective_at) VALUES('legacy:'||NEW.id,'legacy:'||NEW.event_key,'legacy',NEW.source_ref,NEW.occurred_at);
 INSERT INTO ada_postings VALUES('legacy:'||NEW.id,1,NEW.user_id,'customer:'||NEW.user_id,NEW.asset,CASE WHEN NEW.entry_type IN ('realized_profit','realized_loss','fee') THEN 'realized' ELSE 'funding' END,NEW.amount_minor);
 INSERT INTO ada_postings VALUES('legacy:'||NEW.id,2,NULL,'external:legacy',NEW.asset,'clearing',-NEW.amount_minor);
 UPDATE ada_transactions SET status='posted' WHERE id='legacy:'||NEW.id;
END;
CREATE TRIGGER ada_legacy_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT,'Financial history requires a correcting entry'); END;
CREATE TRIGGER ada_legacy_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT,'Financial history is immutable'); END;
CREATE TABLE ada_daily_closes (
 id TEXT PRIMARY KEY,
 trading_day TEXT NOT NULL CHECK(length(trading_day)=10),
 strategy TEXT NOT NULL DEFAULT 'shaka-big-seven-v1',
 asset TEXT NOT NULL CHECK(asset IN ('USDC','USDT')),
 realized_minor INTEGER NOT NULL CHECK(typeof(realized_minor)='integer'),
 unrealized_minor INTEGER NOT NULL CHECK(typeof(unrealized_minor)='integer'),
 external_report_id TEXT NOT NULL UNIQUE CHECK(length(external_report_id)>0),
 payload_hash TEXT NOT NULL,
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref)>0),
 verified_by TEXT NOT NULL CHECK(length(verified_by)>0),
 effective_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(trading_day,strategy,asset)
);
CREATE TABLE ada_daily_allocations (
 close_id TEXT NOT NULL REFERENCES ada_daily_closes(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 realized_minor INTEGER NOT NULL CHECK(typeof(realized_minor)='integer'),
 unrealized_minor INTEGER NOT NULL CHECK(typeof(unrealized_minor)='integer'),
 PRIMARY KEY(close_id,user_id)
);
CREATE TRIGGER ada_close_new_draft BEFORE INSERT ON ada_daily_closes WHEN NEW.status<>'draft'
BEGIN SELECT RAISE(ABORT,'Daily evidence must be allocated before posting'); END;
CREATE TRIGGER ada_close_post BEFORE UPDATE OF status ON ada_daily_closes WHEN NEW.status='posted'
BEGIN
 SELECT RAISE(ABORT,'Daily close requires allocations') WHERE (SELECT COUNT(*) FROM ada_daily_allocations WHERE close_id=NEW.id)=0;
 SELECT RAISE(ABORT,'Daily allocations must reconcile to evidence') WHERE (SELECT SUM(realized_minor) FROM ada_daily_allocations WHERE close_id=NEW.id)<>NEW.realized_minor OR (SELECT SUM(unrealized_minor) FROM ada_daily_allocations WHERE close_id=NEW.id)<>NEW.unrealized_minor;
END;
CREATE TRIGGER ada_close_journal AFTER UPDATE OF status ON ada_daily_closes WHEN NEW.status='posted'
 AND EXISTS(SELECT 1 FROM ada_daily_allocations WHERE close_id=NEW.id AND (realized_minor<>0 OR unrealized_minor<>0))
BEGIN
 INSERT INTO ada_transactions(id,source_key,kind,evidence_ref,effective_at) VALUES('close:'||NEW.id,'close:'||NEW.id,'performance',NEW.evidence_ref,NEW.effective_at);
 INSERT INTO ada_postings
 SELECT 'close:'||NEW.id,ROW_NUMBER() OVER(ORDER BY user_id,bucket),user_id,'customer:'||user_id,NEW.asset,bucket,amount FROM (
 SELECT user_id,'realized' AS bucket,realized_minor AS amount FROM ada_daily_allocations WHERE close_id=NEW.id AND realized_minor<>0
 UNION ALL SELECT user_id,'unrealized',unrealized_minor FROM ada_daily_allocations WHERE close_id=NEW.id AND unrealized_minor<>0);
 INSERT INTO ada_postings SELECT 'close:'||NEW.id,-1,NULL,'external:realized',NEW.asset,'clearing',-NEW.realized_minor WHERE NEW.realized_minor<>0;
 INSERT INTO ada_postings SELECT 'close:'||NEW.id,-2,NULL,'external:valuation',NEW.asset,'clearing',-NEW.unrealized_minor WHERE NEW.unrealized_minor<>0;
 UPDATE ada_transactions SET status='posted' WHERE id='close:'||NEW.id;
END;
CREATE TRIGGER ada_close_immutable BEFORE UPDATE ON ada_daily_closes WHEN OLD.status='posted'
BEGIN SELECT RAISE(ABORT,'Daily closes are immutable'); END;
CREATE TRIGGER ada_close_no_delete BEFORE DELETE ON ada_daily_closes
BEGIN SELECT RAISE(ABORT,'Daily close evidence is immutable'); END;
CREATE TRIGGER ada_alloc_insert_guard BEFORE INSERT ON ada_daily_allocations WHEN (SELECT status FROM ada_daily_closes WHERE id=NEW.close_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'Posted allocations are immutable'); END;
CREATE TRIGGER ada_alloc_no_update BEFORE UPDATE ON ada_daily_allocations
BEGIN SELECT RAISE(ABORT,'Allocation corrections require a new documented close'); END;
CREATE TRIGGER ada_alloc_no_delete BEFORE DELETE ON ada_daily_allocations
BEGIN SELECT RAISE(ABORT,'Allocation evidence is immutable'); END;
