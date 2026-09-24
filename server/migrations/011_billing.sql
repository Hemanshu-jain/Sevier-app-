-- Prepaid wallet billing. Every billable item (imported/added/API vehicle row, verification request)
-- gets one billing_charges row. If the wallet can't cover it the charge stays 'pending' and the item
-- is billing_locked until a confirmed top-up settles pending charges oldest-first (by id).
CREATE TABLE platform_settings (
  id TINYINT PRIMARY KEY,
  vehicle_row_paise BIGINT NOT NULL,
  verification_fee_paise BIGINT NOT NULL,
  payment_instructions TEXT,
  updated_at VARCHAR(32) NOT NULL,
  CONSTRAINT platform_settings_single_row CHECK (id = 1),
  CONSTRAINT platform_settings_prices CHECK (vehicle_row_paise >= 0 AND verification_fee_paise >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO platform_settings (id, vehicle_row_paise, verification_fee_paise, payment_instructions, updated_at)
VALUES (1, 2000, 10000, NULL, '2026-09-24T00:00:00.000Z');

CREATE TABLE wallets (
  tenant_id VARCHAR(191) PRIMARY KEY,
  balance_paise BIGINT NOT NULL DEFAULT 0,
  updated_at VARCHAR(32) NOT NULL,
  CONSTRAINT wallet_balance_check CHECK (balance_paise >= 0),
  CONSTRAINT wallet_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE topup_requests (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  amount_paise BIGINT NOT NULL,
  reference VARCHAR(191) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  requested_by_user_id VARCHAR(191) NOT NULL,
  decided_by_user_id VARCHAR(191),
  created_at VARCHAR(32) NOT NULL,
  decided_at VARCHAR(32),
  CONSTRAINT topup_amount_check CHECK (amount_paise IN (200000, 500000, 1000000)),
  CONSTRAINT topup_status_check CHECK (status IN ('pending', 'confirmed', 'rejected')),
  CONSTRAINT topup_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT topup_requester_fk FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  INDEX topup_status_time (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE billing_charges (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  item_type VARCHAR(32) NOT NULL,
  item_id VARCHAR(191) NOT NULL,
  import_batch_id VARCHAR(191),
  amount_paise BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  paid_at VARCHAR(32),
  CONSTRAINT charge_type_check CHECK (item_type IN ('case_import', 'case_manual', 'case_api', 'verification')),
  CONSTRAINT charge_status_check CHECK (status IN ('paid', 'pending')),
  CONSTRAINT charge_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX charge_tenant_status (tenant_id, status, id),
  INDEX charge_tenant_item (tenant_id, item_id),
  INDEX charge_tenant_time (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE wallet_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  amount_paise BIGINT NOT NULL,
  balance_after_paise BIGINT NOT NULL,
  charge_id BIGINT,
  topup_id VARCHAR(191),
  created_at VARCHAR(32) NOT NULL,
  CONSTRAINT wallet_tx_kind_check CHECK (kind IN ('topup', 'charge')),
  CONSTRAINT wallet_tx_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX wallet_tx_tenant_time (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE recovery_cases ADD COLUMN billing_locked TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE users DROP CHECK users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'finance_manager', 'finance_staff', 'agent', 'platform_admin'));
