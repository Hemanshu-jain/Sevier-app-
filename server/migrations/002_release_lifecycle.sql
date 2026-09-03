-- Release-pass signed token + append-only lifecycle events (revoke / redeem).
-- release_passes rows stay immutable; lifecycle lives in a separate immutable event log.

ALTER TABLE release_passes ADD COLUMN signed_token TEXT;
ALTER TABLE release_passes ADD COLUMN key_id VARCHAR(64);

CREATE TABLE release_pass_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(191) NOT NULL,
  release_pass_id VARCHAR(191) NOT NULL,
  case_id VARCHAR(191) NOT NULL,
  event VARCHAR(16) NOT NULL,
  actor_user_id VARCHAR(191) NOT NULL,
  reason TEXT,
  created_at VARCHAR(32) NOT NULL,
  UNIQUE KEY release_pass_event_unique (release_pass_id, event),
  CONSTRAINT rpe_event_check CHECK (event IN ('revoked', 'redeemed')),
  CONSTRAINT rpe_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT rpe_pass_fk FOREIGN KEY (release_pass_id) REFERENCES release_passes(id),
  CONSTRAINT rpe_actor_fk FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TRIGGER release_pass_events_no_update BEFORE UPDATE ON release_pass_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'release pass events are immutable';
CREATE TRIGGER release_pass_events_no_delete BEFORE DELETE ON release_pass_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'release pass events are immutable';
