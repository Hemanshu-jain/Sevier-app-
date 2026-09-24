-- Tenant API keys let an outside loan system push, list and cancel vehicle records.
-- Only the sha256 of a key is stored; the full key is shown once at creation.
CREATE TABLE api_keys (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  name VARCHAR(100) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash CHAR(64) NOT NULL UNIQUE,
  created_by_user_id VARCHAR(191) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  last_used_at VARCHAR(32),
  revoked_at VARCHAR(32),
  CONSTRAINT api_key_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT api_key_creator_fk FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX api_key_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
