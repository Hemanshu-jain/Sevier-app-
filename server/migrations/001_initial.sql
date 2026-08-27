BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_name TEXT,
  support_mobile TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, name)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile TEXT NOT NULL UNIQUE CHECK (mobile ~ '^91[6-9][0-9]{9}$'),
  name TEXT NOT NULL,
  email TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_admins (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  is_template BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, id)
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id),
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role_id UUID NOT NULL,
  member_type TEXT NOT NULL CHECK (member_type IN ('finance', 'agent')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id)
);

CREATE TABLE agent_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  device_fingerprint_hash TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX one_active_device_per_agent
  ON agent_devices(user_id) WHERE revoked_at IS NULL;

CREATE TABLE otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile TEXT NOT NULL CHECK (mobile ~ '^91[6-9][0-9]{9}$'),
  purpose TEXT NOT NULL CHECK (purpose IN ('sign_in', 'sign_up', 'device_change')),
  provider_request_id TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  request_ip INET
);

CREATE INDEX otp_challenges_rate_limit
  ON otp_challenges(mobile, requested_at DESC);

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  uploaded_by_membership_id UUID NOT NULL,
  source_file_name TEXT NOT NULL,
  source_file_sha256 TEXT NOT NULL,
  snapshot_month DATE NOT NULL CHECK (snapshot_month = date_trunc('month', snapshot_month)::date),
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  accepted_rows INTEGER NOT NULL DEFAULT 0 CHECK (accepted_rows >= 0),
  rejected_rows INTEGER NOT NULL DEFAULT 0 CHECK (rejected_rows >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_file_sha256),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, uploaded_by_membership_id)
    REFERENCES organization_memberships(organization_id, id)
);

CREATE TABLE loan_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  account_number TEXT NOT NULL,
  borrower_name TEXT NOT NULL,
  borrower_mobile TEXT NOT NULL,
  borrower_address TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  vehicle_make_model TEXT NOT NULL,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('2_wheeler', '4_wheeler', 'other')),
  chassis_number TEXT,
  branch TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_number),
  UNIQUE (organization_id, id)
);

CREATE TABLE monthly_account_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  loan_account_id UUID NOT NULL,
  import_batch_id UUID NOT NULL,
  snapshot_month DATE NOT NULL CHECK (snapshot_month = date_trunc('month', snapshot_month)::date),
  pending_amount_paise BIGINT NOT NULL CHECK (pending_amount_paise >= 0),
  overdue_days INTEGER NOT NULL CHECK (overdue_days >= 0),
  source_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, loan_account_id, snapshot_month),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, loan_account_id)
    REFERENCES loan_accounts(organization_id, id),
  FOREIGN KEY (organization_id, import_batch_id)
    REFERENCES import_batches(organization_id, id)
);

CREATE TABLE recovery_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  loan_account_id UUID NOT NULL,
  current_snapshot_id UUID NOT NULL,
  case_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  authority_document_key TEXT,
  authority_document_sha256 TEXT,
  authority_approved_by_membership_id UUID,
  authority_approved_at TIMESTAMPTZ,
  failure_note TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT case_status_allowed CHECK (status IN (
    'draft', 'awaiting_authority', 'ready_to_assign', 'awaiting_agent',
    'in_field', 'attempt_review', 'custody_review', 'payment_pending',
    'payment_confirmed', 'release_issued', 'closed', 'cancelled'
  )),
  CONSTRAINT authority_approval_complete CHECK (
    (authority_approved_at IS NULL AND authority_approved_by_membership_id IS NULL)
    OR (authority_approved_at IS NOT NULL AND authority_approved_by_membership_id IS NOT NULL
        AND authority_document_key IS NOT NULL AND authority_document_sha256 IS NOT NULL)
  ),
  UNIQUE (organization_id, case_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, loan_account_id)
    REFERENCES loan_accounts(organization_id, id),
  FOREIGN KEY (organization_id, current_snapshot_id)
    REFERENCES monthly_account_snapshots(organization_id, id),
  FOREIGN KEY (organization_id, authority_approved_by_membership_id)
    REFERENCES organization_memberships(organization_id, id)
);

CREATE UNIQUE INDEX one_open_case_per_account
  ON recovery_cases(organization_id, loan_account_id)
  WHERE status NOT IN ('closed', 'cancelled');

CREATE TABLE case_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  case_id UUID NOT NULL,
  agent_membership_id UUID NOT NULL,
  assigned_by_membership_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'accepted', 'declined', 'revoked')),
  decline_reason TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, case_id) REFERENCES recovery_cases(organization_id, id),
  FOREIGN KEY (organization_id, agent_membership_id) REFERENCES organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, assigned_by_membership_id) REFERENCES organization_memberships(organization_id, id)
);

CREATE UNIQUE INDEX one_active_assignment_per_case
  ON case_assignments(organization_id, case_id)
  WHERE status IN ('offered', 'accepted');

CREATE TABLE field_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  case_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('vehicle_not_found', 'details_mismatch', 'unsafe', 'customer_dispute', 'authority_issue', 'other')),
  note TEXT NOT NULL,
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  occurred_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, case_id) REFERENCES recovery_cases(organization_id, id),
  FOREIGN KEY (organization_id, assignment_id) REFERENCES case_assignments(organization_id, id)
);

CREATE TABLE evidence_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  case_id UUID NOT NULL,
  captured_by_membership_id UUID NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%' OR mime_type = 'application/pdf'),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, case_id) REFERENCES recovery_cases(organization_id, id),
  FOREIGN KEY (organization_id, captured_by_membership_id) REFERENCES organization_memberships(organization_id, id)
);

CREATE TABLE custody_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  case_id UUID NOT NULL,
  submitted_by_membership_id UUID NOT NULL,
  yard_name TEXT NOT NULL,
  arrival_time TIMESTAMPTZ NOT NULL,
  parking_rate_paise_per_day BIGINT NOT NULL CHECK (parking_rate_paise_per_day >= 0),
  inspection JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, case_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, case_id) REFERENCES recovery_cases(organization_id, id),
  FOREIGN KEY (organization_id, submitted_by_membership_id) REFERENCES organization_memberships(organization_id, id)
);

CREATE TABLE custody_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  custody_record_id UUID NOT NULL,
  reviewed_by_membership_id UUID NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  note TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, custody_record_id) REFERENCES custody_records(organization_id, id),
  FOREIGN KEY (organization_id, reviewed_by_membership_id) REFERENCES organization_memberships(organization_id, id)
);

CREATE TABLE payment_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  case_id UUID NOT NULL,
  confirmed_by_membership_id UUID NOT NULL,
  reference TEXT NOT NULL,
  amount_paise BIGINT CHECK (amount_paise IS NULL OR amount_paise >= 0),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, case_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, case_id) REFERENCES recovery_cases(organization_id, id),
  FOREIGN KEY (organization_id, confirmed_by_membership_id) REFERENCES organization_memberships(organization_id, id)
);

CREATE TABLE release_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  case_id UUID NOT NULL,
  issued_by_membership_id UUID NOT NULL,
  verification_code TEXT NOT NULL,
  borrower_name TEXT NOT NULL,
  borrower_mobile TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  vehicle_make_model TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by_membership_id UUID,
  revocation_reason TEXT,
  released_at TIMESTAMPTZ,
  released_by_membership_id UUID,
  UNIQUE (organization_id, case_id),
  UNIQUE (organization_id, verification_code),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, case_id) REFERENCES recovery_cases(organization_id, id),
  FOREIGN KEY (organization_id, issued_by_membership_id) REFERENCES organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, revoked_by_membership_id) REFERENCES organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, released_by_membership_id) REFERENCES organization_memberships(organization_id, id)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  recipient_user_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('blue', 'amber', 'green', 'red')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  case_id UUID,
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, case_id) REFERENCES recovery_cases(organization_id, id)
);

CREATE INDEX audit_events_org_time
  ON audit_events(organization_id, created_at DESC);

CREATE TABLE retention_policies (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id),
  retention_days INTEGER NOT NULL DEFAULT 1095 CHECK (retention_days >= 365),
  updated_by_membership_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, updated_by_membership_id)
    REFERENCES organization_memberships(organization_id, id)
);

CREATE TABLE legal_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  case_id UUID,
  reason TEXT NOT NULL,
  placed_by_membership_id UUID NOT NULL,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_by_membership_id UUID,
  released_at TIMESTAMPTZ,
  FOREIGN KEY (organization_id, case_id) REFERENCES recovery_cases(organization_id, id),
  FOREIGN KEY (organization_id, placed_by_membership_id) REFERENCES organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, released_by_membership_id) REFERENCES organization_memberships(organization_id, id)
);

CREATE OR REPLACE FUNCTION prevent_immutable_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER monthly_account_snapshots_immutable
  BEFORE UPDATE OR DELETE ON monthly_account_snapshots
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_change();

CREATE TRIGGER field_attempts_immutable
  BEFORE UPDATE OR DELETE ON field_attempts
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_change();

CREATE TRIGGER payment_confirmations_immutable
  BEFORE UPDATE OR DELETE ON payment_confirmations
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_change();

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_change();

COMMIT;
