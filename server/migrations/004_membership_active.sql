-- A financer enables/disables an agent in their own roster without affecting the
-- global agent (who may serve other financers). Suspension is per-membership.
ALTER TABLE agent_memberships ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1;
