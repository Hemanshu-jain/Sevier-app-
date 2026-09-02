// MySQL backups are handled by mysqldump or the managed provider's snapshots, not
// an app command. ponytail: real backup/PITR belongs to the hosting phase; for local
// dev use `mysqldump -u handoff -p handoff_dev > backup.sql`.
console.log('DB backup is a MySQL operation now. Use mysqldump (dev) or managed backups (prod). See server/backup.mjs.');
