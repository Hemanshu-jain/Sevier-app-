-- Shared agent directory + co-assignment.
-- Agents stay as users rows but may be global (no home tenant); financers link them
-- via agent_memberships, and a case can hold several active agents via case_assignments.

ALTER TABLE users MODIFY COLUMN tenant_id VARCHAR(191) NULL;
ALTER TABLE users ADD COLUMN id_proof VARCHAR(191);
ALTER TABLE users ADD COLUMN onboarding_complete TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN created_via VARCHAR(16) NOT NULL DEFAULT 'finance';

CREATE TABLE agent_memberships (
  agent_user_id VARCHAR(191) NOT NULL,
  tenant_id VARCHAR(191) NOT NULL,
  added_at VARCHAR(32) NOT NULL,
  added_by_user_id VARCHAR(191),
  PRIMARY KEY (agent_user_id, tenant_id),
  CONSTRAINT am_agent_fk FOREIGN KEY (agent_user_id) REFERENCES users(id),
  CONSTRAINT am_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE case_assignments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  case_id VARCHAR(191) NOT NULL,
  agent_user_id VARCHAR(191) NOT NULL,
  assigned_at VARCHAR(32) NOT NULL,
  assigned_by_user_id VARCHAR(191) NOT NULL,
  note TEXT,
  active TINYINT(1) NOT NULL DEFAULT 1,
  unassigned_at VARCHAR(32),
  CONSTRAINT ca_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT ca_case_fk FOREIGN KEY (case_id) REFERENCES recovery_cases(id),
  CONSTRAINT ca_agent_fk FOREIGN KEY (agent_user_id) REFERENCES users(id),
  INDEX ca_case_active (tenant_id, case_id, active),
  INDEX ca_agent_active (agent_user_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE agent_groups (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  name VARCHAR(191) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  CONSTRAINT ag_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE agent_group_members (
  group_id VARCHAR(191) NOT NULL,
  agent_user_id VARCHAR(191) NOT NULL,
  PRIMARY KEY (group_id, agent_user_id),
  CONSTRAINT agm_group_fk FOREIGN KEY (group_id) REFERENCES agent_groups(id),
  CONSTRAINT agm_agent_fk FOREIGN KEY (agent_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
