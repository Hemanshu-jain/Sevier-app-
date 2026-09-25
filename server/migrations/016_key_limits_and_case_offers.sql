-- One free API key per company; extra keys need platform-admin approval and a wallet-charged fee.
ALTER TABLE tenants ADD COLUMN api_key_limit INT NOT NULL DEFAULT 1;
ALTER TABLE platform_settings ADD COLUMN api_key_fee_paise BIGINT NOT NULL DEFAULT 50000;

CREATE TABLE api_key_requests (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  fee_paise BIGINT,
  requested_by_user_id VARCHAR(191) NOT NULL,
  decided_by_user_id VARCHAR(191),
  created_at VARCHAR(32) NOT NULL,
  decided_at VARCHAR(32),
  CONSTRAINT key_request_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT key_request_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT key_request_requester_fk FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  INDEX key_request_status_time (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE billing_charges DROP CHECK charge_type_check;
ALTER TABLE billing_charges ADD CONSTRAINT charge_type_check CHECK (item_type IN ('case_import', 'case_manual', 'case_api', 'verification', 'api_key'));

-- A financer can offer an unassigned case to every active roster agent; the first to accept gets it.
ALTER TABLE recovery_cases ADD COLUMN open_offer_at VARCHAR(32), ADD COLUMN open_offer_by_user_id VARCHAR(191);
