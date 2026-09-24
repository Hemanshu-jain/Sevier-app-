-- Per-entry counting needs each case's creation time (it only had updated_at).
-- Custody GPS is now stored on the record, not just written into the audit text.
ALTER TABLE recovery_cases ADD COLUMN created_at VARCHAR(32);
UPDATE recovery_cases c SET created_at = COALESCE(
  (SELECT MIN(s.created_at) FROM monthly_account_snapshots s WHERE s.case_id = c.id),
  c.updated_at);
ALTER TABLE custody_records ADD COLUMN latitude DOUBLE, ADD COLUMN longitude DOUBLE;
