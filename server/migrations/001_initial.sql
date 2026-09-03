-- Handoff MySQL baseline (fresh — replaces the old fictional PostgreSQL 001).
-- Faithful port of the live SQLite model with canonical snake_case statuses,
-- foreign keys, and immutable-history triggers. InnoDB + utf8mb4.
-- ponytail: timestamps are ISO-8601 strings in VARCHAR (matches current app data);
--   money stays as the app's current mix (cases in rupees, snapshots in paise).
--   Both are deliberate follow-up changes with their own tests, not this port.

CREATE TABLE tenants (
  id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  role VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  mobile VARCHAR(32),
  city VARCHAR(191),
  active TINYINT(1) NOT NULL DEFAULT 1,
  mobile_e164 VARCHAR(20) UNIQUE,
  CONSTRAINT users_role_check CHECK (role IN ('super_admin','finance_manager','finance_staff','agent')),
  CONSTRAINT users_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE recovery_cases (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  account_number VARCHAR(191) NOT NULL,
  borrower_name VARCHAR(255) NOT NULL,
  borrower_mobile VARCHAR(32) NOT NULL,
  borrower_address TEXT NOT NULL,
  registration VARCHAR(64) NOT NULL,
  make_model VARCHAR(255) NOT NULL,
  chassis VARCHAR(191) NOT NULL,
  vehicle_type VARCHAR(16) NOT NULL,
  branch VARCHAR(191) NOT NULL,
  pending_amount BIGINT NOT NULL, -- paise (integer); API converts to rupees for display
  overdue_days INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  assigned_agent_user_id VARCHAR(191),
  assigned_at VARCHAR(32),
  updated_at VARCHAR(32) NOT NULL,
  custody_id VARCHAR(191),
  failure_reason VARCHAR(64),
  failure_note TEXT,
  failure_recorded_at VARCHAR(32),
  payment_cleared TINYINT(1) NOT NULL DEFAULT 0,
  release_pass_id VARCHAR(191),
  payment_reference VARCHAR(255),
  payment_confirmed_at VARCHAR(32),
  payment_confirmed_by_user_id VARCHAR(191),
  authority_document_file_name VARCHAR(255),
  authority_document_original_name VARCHAR(255),
  authority_document_mime_type VARCHAR(128),
  authority_document_byte_size BIGINT,
  authority_document_sha256 VARCHAR(64),
  authority_approved_at VARCHAR(32),
  authority_approved_by_user_id VARCHAR(191),
  assignment_note TEXT,
  current_snapshot_id VARCHAR(191),
  CONSTRAINT cases_vehicle_type_check CHECK (vehicle_type IN ('2-wheeler','4-wheeler')),
  CONSTRAINT cases_status_check CHECK (status IN ('imported','assigned','unable_to_recover','custody_review','payment_pending','payment_confirmed','release_pass_printed','closed','cancelled')),
  CONSTRAINT cases_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT cases_agent_fk FOREIGN KEY (assigned_agent_user_id) REFERENCES users(id),
  INDEX cases_tenant_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE custody_records (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  case_id VARCHAR(191) NOT NULL UNIQUE,
  yard_name VARCHAR(255) NOT NULL,
  arrival_time VARCHAR(32) NOT NULL,
  parking_rate BIGINT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  agent_name VARCHAR(255) NOT NULL,
  checklist_count INT NOT NULL,
  inspection_json JSON,
  finance_reviewed_at VARCHAR(32),
  finance_reviewed_by_user_id VARCHAR(191),
  finance_review_note TEXT,
  custom_note TEXT,
  CONSTRAINT custody_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT custody_case_fk FOREIGN KEY (case_id) REFERENCES recovery_cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notifications (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  recipient_user_id VARCHAR(191),
  case_id VARCHAR(191),
  title VARCHAR(255) NOT NULL,
  detail TEXT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  `read` TINYINT(1) NOT NULL DEFAULT 0,
  tone VARCHAR(16) NOT NULL,
  CONSTRAINT notifications_tone_check CHECK (tone IN ('blue','amber','green','red')),
  CONSTRAINT notifications_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT notifications_recipient_fk FOREIGN KEY (recipient_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  case_id VARCHAR(191),
  actor_user_id VARCHAR(191) NOT NULL,
  action VARCHAR(128) NOT NULL,
  detail TEXT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  CONSTRAINT audit_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT audit_actor_fk FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE evidence (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  case_id VARCHAR(191) NOT NULL,
  agent_user_id VARCHAR(191) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  byte_size BIGINT NOT NULL,
  latitude DOUBLE,
  longitude DOUBLE,
  captured_at VARCHAR(32) NOT NULL,
  CONSTRAINT evidence_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT evidence_case_fk FOREIGN KEY (case_id) REFERENCES recovery_cases(id),
  CONSTRAINT evidence_agent_fk FOREIGN KEY (agent_user_id) REFERENCES users(id),
  INDEX evidence_case_index (tenant_id, case_id, captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE release_passes (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  case_id VARCHAR(191) NOT NULL UNIQUE,
  issued_by_user_id VARCHAR(191),
  verification_code VARCHAR(64) NOT NULL,
  issued_at VARCHAR(32) NOT NULL,
  borrower_name VARCHAR(255) NOT NULL,
  borrower_mobile VARCHAR(32) NOT NULL,
  vehicle_registration VARCHAR(64) NOT NULL,
  vehicle_model VARCHAR(255) NOT NULL,
  custody_id VARCHAR(191),
  payment_reference VARCHAR(255),
  CONSTRAINT release_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT release_case_fk FOREIGN KEY (case_id) REFERENCES recovery_cases(id),
  CONSTRAINT release_issuer_fk FOREIGN KEY (issued_by_user_id) REFERENCES users(id),
  INDEX release_tenant_index (tenant_id, issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE otp_challenges (
  id VARCHAR(191) PRIMARY KEY,
  mobile_e164 VARCHAR(20) NOT NULL,
  purpose VARCHAR(16) NOT NULL DEFAULT 'sign_in',
  provider_request_id VARCHAR(191),
  requested_at VARCHAR(32) NOT NULL,
  expires_at VARCHAR(32) NOT NULL,
  verified_at VARCHAR(32),
  request_ip VARCHAR(64),
  CONSTRAINT otp_purpose_check CHECK (purpose IN ('sign_in','sign_up')),
  INDEX otp_mobile_time (mobile_e164, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE auth_sessions (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  token_hash VARCHAR(191) NOT NULL UNIQUE,
  created_at VARCHAR(32) NOT NULL,
  expires_at VARCHAR(32) NOT NULL,
  revoked_at VARCHAR(32),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notification_reads (
  notification_id VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  read_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (notification_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE field_mutation_receipts (
  tenant_id VARCHAR(191) NOT NULL,
  agent_user_id VARCHAR(191) NOT NULL,
  client_mutation_id VARCHAR(191) NOT NULL,
  case_id VARCHAR(191) NOT NULL,
  operation VARCHAR(16) NOT NULL,
  status_code INT NOT NULL,
  response_json JSON NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (tenant_id, agent_user_id, client_mutation_id),
  CONSTRAINT receipts_operation_check CHECK (operation IN ('evidence','attempt','custody'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE import_batches (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  actor_user_id VARCHAR(191) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_sha256 VARCHAR(64) NOT NULL,
  snapshot_month VARCHAR(10) NOT NULL,
  total_rows INT NOT NULL,
  accepted_rows INT NOT NULL,
  rejected_rows INT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  UNIQUE KEY import_file_unique (tenant_id, file_sha256),
  CONSTRAINT import_actor_fk FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE monthly_account_snapshots (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  case_id VARCHAR(191) NOT NULL,
  import_batch_id VARCHAR(191) NOT NULL,
  snapshot_month VARCHAR(10) NOT NULL,
  pending_amount_paise BIGINT NOT NULL,
  overdue_days INT NOT NULL,
  source_json JSON NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  CONSTRAINT snapshot_amount_check CHECK (pending_amount_paise >= 0),
  CONSTRAINT snapshot_overdue_check CHECK (overdue_days >= 0),
  CONSTRAINT snapshot_case_fk FOREIGN KEY (case_id) REFERENCES recovery_cases(id),
  CONSTRAINT snapshot_batch_fk FOREIGN KEY (import_batch_id) REFERENCES import_batches(id),
  INDEX snapshot_case_month (tenant_id, case_id, snapshot_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Immutable history: block UPDATE/DELETE on audit, release, receipts, snapshots.
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events are immutable';
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events are immutable';
CREATE TRIGGER release_passes_no_update BEFORE UPDATE ON release_passes FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'release_passes are immutable';
CREATE TRIGGER release_passes_no_delete BEFORE DELETE ON release_passes FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'release_passes are immutable';
CREATE TRIGGER field_mutation_receipts_no_update BEFORE UPDATE ON field_mutation_receipts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'field mutation receipts are immutable';
CREATE TRIGGER field_mutation_receipts_no_delete BEFORE DELETE ON field_mutation_receipts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'field mutation receipts are immutable';
CREATE TRIGGER monthly_snapshots_no_update BEFORE UPDATE ON monthly_account_snapshots FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'monthly snapshots are immutable';
CREATE TRIGGER monthly_snapshots_no_delete BEFORE DELETE ON monthly_account_snapshots FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'monthly snapshots are immutable';
