-- Financer-controlled agent visibility per case, agents' advertised rates, and financer ratings of agents.
ALTER TABLE recovery_cases ADD COLUMN share_customer TINYINT(1) NOT NULL DEFAULT 1, ADD COLUMN share_vehicle TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN rate_vehicle_paise BIGINT NULL, ADD COLUMN rate_verification_paise BIGINT NULL;

-- One rating per agent per job per finance company; re-rating overwrites. Averages are public to every financer.
CREATE TABLE agent_ratings (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  agent_user_id VARCHAR(191) NOT NULL,
  job_type VARCHAR(16) NOT NULL,
  job_id VARCHAR(191) NOT NULL,
  stars TINYINT NOT NULL,
  comment TEXT,
  rated_by_user_id VARCHAR(191) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  CONSTRAINT rating_job_type_check CHECK (job_type IN ('case', 'verification')),
  CONSTRAINT rating_stars_check CHECK (stars BETWEEN 1 AND 5),
  CONSTRAINT rating_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT rating_agent_fk FOREIGN KEY (agent_user_id) REFERENCES users(id),
  UNIQUE KEY rating_once_per_job (tenant_id, job_type, job_id, agent_user_id),
  INDEX rating_agent (agent_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
