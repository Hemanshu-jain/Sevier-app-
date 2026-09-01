export function ensureNotificationAccessSchema(database) {
  const columns = database.prepare('PRAGMA table_info(notifications)').all().map((column) => column.name);
  if (!columns.includes('case_id')) database.exec('ALTER TABLE notifications ADD COLUMN case_id TEXT');
  database.exec(`
    CREATE TABLE IF NOT EXISTS notification_reads (
      notification_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (notification_id, user_id)
    );
  `);
}

function visibility(user) {
  return user.role === 'agent'
    ? { sql: 'notifications.recipient_user_id = ?', values: [user.id] }
    : { sql: '(notifications.recipient_user_id IS NULL OR notifications.recipient_user_id = ?)', values: [user.id] };
}

export function listNotifications(database, user) {
  const visible = visibility(user);
  return database.prepare(`SELECT notifications.*, CASE WHEN notification_reads.user_id IS NULL THEN 0 ELSE 1 END AS read
    FROM notifications
    LEFT JOIN notification_reads ON notification_reads.notification_id = notifications.id AND notification_reads.user_id = ?
    WHERE notifications.tenant_id = ? AND ${visible.sql}
    ORDER BY notifications.created_at DESC, notifications.id DESC LIMIT 50`)
    .all(user.id, user.tenantId, ...visible.values);
}

export function markNotificationsRead(database, user, readAt) {
  const visible = visibility(user);
  return database.prepare(`INSERT OR IGNORE INTO notification_reads (notification_id, user_id, read_at)
    SELECT notifications.id, ?, ? FROM notifications
    WHERE notifications.tenant_id = ? AND ${visible.sql}`)
    .run(user.id, readAt, user.tenantId, ...visible.values);
}
