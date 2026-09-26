-- Agent profile: 3-line address, typed ID proof (Aadhaar / PAN), profile photo (small data URL, resized on the phone).
ALTER TABLE users ADD COLUMN address_line1 VARCHAR(191), ADD COLUMN address_line2 VARCHAR(191), ADD COLUMN pincode VARCHAR(6),
  ADD COLUMN id_proof_type VARCHAR(16), ADD COLUMN avatar MEDIUMTEXT;

-- Per-case chat between the assigned agent and the finance company.
CREATE TABLE case_messages (
  id VARCHAR(191) PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  case_id VARCHAR(191) NOT NULL,
  sender_user_id VARCHAR(191) NOT NULL,
  body TEXT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  CONSTRAINT case_message_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT case_message_sender_fk FOREIGN KEY (sender_user_id) REFERENCES users(id),
  INDEX case_message_case_time (case_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
