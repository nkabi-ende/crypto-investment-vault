-- Private identity evidence; document bodies never enter public account responses.
CREATE TABLE kyc_documents (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('identity','address')),
 content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','application/pdf')),
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 32 AND 5242880),
 sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_kyc_documents_user ON kyc_documents(user_id,created_at);
CREATE TABLE kyc_document_chunks (
 document_id TEXT NOT NULL REFERENCES kyc_documents(id) ON DELETE CASCADE,
 part INTEGER NOT NULL CHECK(part>=0),
 body BLOB NOT NULL CHECK(length(body)<=262144),
 PRIMARY KEY(document_id,part)
);
CREATE TABLE kyc_upload_slots (
 user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('identity','address')),
 document_id TEXT NOT NULL UNIQUE REFERENCES kyc_documents(id),
 PRIMARY KEY(user_id,kind)
);
CREATE TABLE kyc_reviewers (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 granted_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE kyc_submissions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 revision INTEGER NOT NULL CHECK(revision>0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 identity_document_id TEXT NOT NULL REFERENCES kyc_documents(id),
 address_document_id TEXT NOT NULL REFERENCES kyc_documents(id),
 consent_version TEXT NOT NULL,
 submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewer_id TEXT REFERENCES users(id),
 reviewed_at TEXT,
 expires_at TEXT,
 review_note TEXT,
 identity_matched INTEGER NOT NULL DEFAULT 0,
 address_matched INTEGER NOT NULL DEFAULT 0,
 validity_checked INTEGER NOT NULL DEFAULT 0,
 UNIQUE(user_id,revision)
);
CREATE UNIQUE INDEX idx_kyc_one_pending ON kyc_submissions(user_id) WHERE status='pending';
CREATE INDEX idx_kyc_review_queue ON kyc_submissions(status,submitted_at);
CREATE TABLE kyc_events (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 submission_id TEXT REFERENCES kyc_submissions(id),
 document_id TEXT REFERENCES kyc_documents(id),
 action TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_kyc_evidence_access ON kyc_events(actor_id,submission_id,document_id,action);
CREATE TRIGGER kyc_slots_insert_guard BEFORE INSERT ON kyc_upload_slots BEGIN
 SELECT RAISE(ABORT,'KYC_DOCUMENT_OWNER_MISMATCH') WHERE NOT EXISTS(SELECT 1 FROM kyc_documents d WHERE d.id=NEW.document_id AND d.user_id=NEW.user_id AND d.kind=NEW.kind);
 SELECT RAISE(ABORT,'KYC_REVIEW_LOCKED') WHERE EXISTS(SELECT 1 FROM kyc_submissions WHERE user_id=NEW.user_id AND (status='pending' OR (status='approved' AND julianday(expires_at)>julianday('now'))));
END;
CREATE TRIGGER kyc_slots_update_guard BEFORE UPDATE ON kyc_upload_slots BEGIN
 SELECT RAISE(ABORT,'KYC_DOCUMENT_OWNER_MISMATCH') WHERE NEW.user_id<>OLD.user_id OR NEW.kind<>OLD.kind OR NOT EXISTS(SELECT 1 FROM kyc_documents d WHERE d.id=NEW.document_id AND d.user_id=NEW.user_id AND d.kind=NEW.kind);
 SELECT RAISE(ABORT,'KYC_REVIEW_LOCKED') WHERE EXISTS(SELECT 1 FROM kyc_submissions WHERE user_id=NEW.user_id AND (status='pending' OR (status='approved' AND julianday(expires_at)>julianday('now'))));
END;
CREATE TRIGGER kyc_submission_insert_guard BEFORE INSERT ON kyc_submissions BEGIN
 SELECT RAISE(ABORT,'KYC_REVIEW_REQUIRED') WHERE NEW.status<>'pending' OR NEW.reviewer_id IS NOT NULL OR NEW.expires_at IS NOT NULL;
 SELECT RAISE(ABORT,'KYC_REVIEW_LOCKED') WHERE EXISTS(SELECT 1 FROM kyc_submissions WHERE user_id=NEW.user_id AND (status='pending' OR (status='approved' AND julianday(expires_at)>julianday('now'))));
 SELECT RAISE(ABORT,'KYC_BOTH_DOCUMENTS_REQUIRED') WHERE NOT EXISTS(SELECT 1 FROM kyc_upload_slots WHERE user_id=NEW.user_id AND kind='identity' AND document_id=NEW.identity_document_id) OR NOT EXISTS(SELECT 1 FROM kyc_upload_slots WHERE user_id=NEW.user_id AND kind='address' AND document_id=NEW.address_document_id);
END;
CREATE TRIGGER kyc_decision_guard BEFORE UPDATE ON kyc_submissions BEGIN
 SELECT RAISE(ABORT,'KYC_SUBMISSION_IMMUTABLE') WHERE NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.revision<>OLD.revision OR NEW.identity_document_id<>OLD.identity_document_id OR NEW.address_document_id<>OLD.address_document_id OR NEW.consent_version<>OLD.consent_version OR NEW.submitted_at<>OLD.submitted_at;
 SELECT RAISE(ABORT,'KYC_REVIEWER_REQUIRED') WHERE OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR NEW.reviewer_id=NEW.user_id OR NOT EXISTS(SELECT 1 FROM kyc_reviewers WHERE user_id=NEW.reviewer_id AND enabled=1);
 SELECT RAISE(ABORT,'KYC_DECISION_REASON_REQUIRED') WHERE NEW.reviewed_at IS NULL OR length(trim(COALESCE(NEW.review_note,'')))<10;
 SELECT RAISE(ABORT,'KYC_CHECKS_REQUIRED') WHERE NEW.status='approved' AND (NEW.identity_matched<>1 OR NEW.address_matched<>1 OR NEW.validity_checked<>1 OR julianday(NEW.expires_at)<=julianday('now') OR NEW.expires_at IS NULL);
 SELECT RAISE(ABORT,'KYC_EVIDENCE_REVIEW_REQUIRED') WHERE NOT EXISTS(SELECT 1 FROM kyc_events WHERE actor_id=NEW.reviewer_id AND submission_id=NEW.id AND document_id=NEW.identity_document_id AND action='document_accessed') OR NOT EXISTS(SELECT 1 FROM kyc_events WHERE actor_id=NEW.reviewer_id AND submission_id=NEW.id AND document_id=NEW.address_document_id AND action='document_accessed');
END;
CREATE TRIGGER kyc_submission_audit AFTER INSERT ON kyc_submissions BEGIN
 INSERT INTO kyc_events(id,user_id,actor_id,submission_id,action) VALUES(lower(hex(randomblob(16))),NEW.user_id,NEW.user_id,NEW.id,'submitted');
END;
CREATE TRIGGER kyc_decision_audit AFTER UPDATE ON kyc_submissions BEGIN
 INSERT INTO kyc_events(id,user_id,actor_id,submission_id,action) VALUES(lower(hex(randomblob(16))),NEW.user_id,NEW.reviewer_id,NEW.id,NEW.status);
END;
CREATE TRIGGER kyc_event_immutable_update BEFORE UPDATE ON kyc_events BEGIN SELECT RAISE(ABORT,'KYC_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER kyc_event_immutable_delete BEFORE DELETE ON kyc_events BEGIN SELECT RAISE(ABORT,'KYC_AUDIT_IMMUTABLE'); END;
ALTER TABLE withdrawal_requests ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_withdrawal_idempotency ON withdrawal_requests(user_id,idempotency_key);
CREATE TRIGGER withdrawal_identity_gate BEFORE INSERT ON withdrawal_requests BEGIN
 SELECT RAISE(ABORT,'WITHDRAWAL_ASSET_NOT_SUPPORTED') WHERE NEW.asset NOT IN ('USDC','USDT') OR NEW.destination_network<>'celo';
 SELECT RAISE(ABORT,'IDENTITY_VERIFICATION_REQUIRED') WHERE NOT EXISTS(SELECT 1 FROM kyc_submissions WHERE user_id=NEW.user_id AND status='approved' AND julianday(expires_at)>julianday('now'));
END;

CREATE TRIGGER kyc_document_storage_guard BEFORE INSERT ON kyc_documents BEGIN
 SELECT RAISE(ABORT,'KYC_STORAGE_LIMIT') WHERE NEW.byte_size+COALESCE((SELECT SUM(byte_size) FROM kyc_documents WHERE user_id=NEW.user_id),0)>20971520;
END;
CREATE TRIGGER withdrawal_request_audit AFTER INSERT ON withdrawal_requests BEGIN
 INSERT INTO audit_events(id,user_id,event_type,detail) VALUES(lower(hex(randomblob(16))),NEW.user_id,'withdrawal_requested',NEW.id);
END;
