-- Archived companies are hidden from the platform-admin console but keep their (immutable) history.
ALTER TABLE tenants ADD COLUMN archived_at VARCHAR(32);
