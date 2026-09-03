import { query } from './mysql.mjs';

// notifications.case_id and the notification_reads table live in the migration.
// Agents are global (may serve several financers), so their notices are matched by
// recipient only — not tenant. Finance users stay tenant-scoped (broadcast + direct).

const COLUMNS = `notifications.id, notifications.tenant_id, notifications.recipient_user_id, notifications.case_id,
       notifications.title, notifications.detail, notifications.created_at, notifications.tone,
       CASE WHEN notification_reads.user_id IS NULL THEN 0 ELSE 1 END AS \`read\``;

export async function listNotifications(executor, user) {
  if (user.role === 'agent') {
    return query(executor,
      `SELECT ${COLUMNS} FROM notifications
        LEFT JOIN notification_reads ON notification_reads.notification_id = notifications.id AND notification_reads.user_id = ?
       WHERE notifications.recipient_user_id = ?
       ORDER BY notifications.created_at DESC, notifications.id DESC LIMIT 50`,
      [user.id, user.id]);
  }
  return query(executor,
    `SELECT ${COLUMNS} FROM notifications
      LEFT JOIN notification_reads ON notification_reads.notification_id = notifications.id AND notification_reads.user_id = ?
     WHERE notifications.tenant_id = ? AND (notifications.recipient_user_id IS NULL OR notifications.recipient_user_id = ?)
     ORDER BY notifications.created_at DESC, notifications.id DESC LIMIT 50`,
    [user.id, user.tenantId, user.id]);
}

export async function markNotificationsRead(executor, user, readAt) {
  if (user.role === 'agent') {
    return query(executor,
      `INSERT IGNORE INTO notification_reads (notification_id, user_id, read_at)
       SELECT notifications.id, ?, ? FROM notifications WHERE notifications.recipient_user_id = ?`,
      [user.id, readAt, user.id]);
  }
  return query(executor,
    `INSERT IGNORE INTO notification_reads (notification_id, user_id, read_at)
     SELECT notifications.id, ?, ? FROM notifications
      WHERE notifications.tenant_id = ? AND (notifications.recipient_user_id IS NULL OR notifications.recipient_user_id = ?)`,
    [user.id, readAt, user.tenantId, user.id]);
}
