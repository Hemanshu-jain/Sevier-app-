import { query } from './mysql.mjs';

// notifications.case_id and the notification_reads table live in the migration.

function visibility(user) {
  return user.role === 'agent'
    ? { sql: 'notifications.recipient_user_id = ?', values: [user.id] }
    : { sql: '(notifications.recipient_user_id IS NULL OR notifications.recipient_user_id = ?)', values: [user.id] };
}

export async function listNotifications(executor, user) {
  const visible = visibility(user);
  return query(executor,
    `SELECT notifications.id, notifications.tenant_id, notifications.recipient_user_id, notifications.case_id,
            notifications.title, notifications.detail, notifications.created_at, notifications.tone,
            CASE WHEN notification_reads.user_id IS NULL THEN 0 ELSE 1 END AS \`read\`
       FROM notifications
       LEFT JOIN notification_reads
         ON notification_reads.notification_id = notifications.id AND notification_reads.user_id = ?
      WHERE notifications.tenant_id = ? AND ${visible.sql}
      ORDER BY notifications.created_at DESC, notifications.id DESC
      LIMIT 50`,
    [user.id, user.tenantId, ...visible.values]);
}

export async function markNotificationsRead(executor, user, readAt) {
  const visible = visibility(user);
  return query(executor,
    `INSERT IGNORE INTO notification_reads (notification_id, user_id, read_at)
     SELECT notifications.id, ?, ? FROM notifications
      WHERE notifications.tenant_id = ? AND ${visible.sql}`,
    [user.id, readAt, user.tenantId, ...visible.values]);
}
