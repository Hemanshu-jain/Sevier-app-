ALTER TABLE custody_records ADD COLUMN custom_note TEXT;
ALTER TABLE notifications ADD COLUMN case_id TEXT REFERENCES recovery_cases(id);

CREATE TABLE field_mutation_receipts (
  tenant_id TEXT NOT NULL,
  agent_user_id TEXT NOT NULL,
  client_mutation_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('evidence', 'attempt', 'custody')),
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, agent_user_id, client_mutation_id)
);

CREATE TRIGGER field_mutation_receipts_no_update
  BEFORE UPDATE ON field_mutation_receipts BEGIN SELECT RAISE(ABORT, 'field mutation receipts are immutable'); END;
CREATE TRIGGER field_mutation_receipts_no_delete
  BEFORE DELETE ON field_mutation_receipts BEGIN SELECT RAISE(ABORT, 'field mutation receipts are immutable'); END;

CREATE TABLE notification_reads (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (notification_id, user_id)
);
