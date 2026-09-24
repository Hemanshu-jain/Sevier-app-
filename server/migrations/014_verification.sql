-- House / location verification: a financer requests a field check of a customer's residence,
-- an agent visits, submits GPS + 2-4 photos and a verified / not-verified result.
-- The platform fee is billed at creation (billing_charges.item_type = 'verification') and never refunded;
-- the agent's rate is shown for comparison and paid outside the app.
CREATE TABLE verification_requests (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  reference VARCHAR(100) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_mobile VARCHAR(20) NOT NULL,
  address TEXT NOT NULL,
  landmark VARCHAR(255),
  city VARCHAR(191) NOT NULL,
  pincode VARCHAR(10),
  instructions TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  billing_locked TINYINT(1) NOT NULL DEFAULT 0,
  platform_fee_paise BIGINT NOT NULL,
  created_by_user_id VARCHAR(191) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  assigned_agent_user_id VARCHAR(191),
  assigned_by_user_id VARCHAR(191),
  assigned_at VARCHAR(32),
  agent_rate_paise BIGINT,
  result VARCHAR(16),
  result_note TEXT,
  latitude DOUBLE,
  longitude DOUBLE,
  submitted_at VARCHAR(32),
  CONSTRAINT verification_status_check CHECK (status IN ('open', 'assigned', 'submitted', 'cancelled')),
  CONSTRAINT verification_result_check CHECK (result IS NULL OR result IN ('verified', 'not_verified')),
  CONSTRAINT verification_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT verification_creator_fk FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT verification_agent_fk FOREIGN KEY (assigned_agent_user_id) REFERENCES users(id),
  INDEX verification_tenant_time (tenant_id, created_at),
  INDEX verification_agent_status (assigned_agent_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE verification_evidence (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  request_id VARCHAR(191) NOT NULL,
  agent_user_id VARCHAR(191) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  byte_size BIGINT NOT NULL,
  latitude DOUBLE NOT NULL,
  longitude DOUBLE NOT NULL,
  captured_at VARCHAR(32) NOT NULL,
  CONSTRAINT verification_evidence_request_fk FOREIGN KEY (request_id) REFERENCES verification_requests(id),
  CONSTRAINT verification_evidence_agent_fk FOREIGN KEY (agent_user_id) REFERENCES users(id),
  INDEX verification_evidence_request (tenant_id, request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Verification submissions reuse the offline idempotency receipts (case_id holds the request id).
ALTER TABLE field_mutation_receipts DROP CHECK receipts_operation_check;
ALTER TABLE field_mutation_receipts ADD CONSTRAINT receipts_operation_check CHECK (operation IN ('evidence', 'attempt', 'custody', 'verification'));
