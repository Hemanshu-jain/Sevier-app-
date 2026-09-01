import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureNotificationAccessSchema, listNotifications, markNotificationsRead } from '../server/notification-access.mjs';

function notificationDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      recipient_user_id TEXT,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      tone TEXT NOT NULL
    );
    INSERT INTO notifications VALUES
      ('finance-notice', 't1', NULL, 'Finance', 'Shared', '2026-09-01T09:00:00Z', 0, 'blue'),
      ('agent-notice', 't1', 'agent-1', 'Agent', 'Direct', '2026-09-01T10:00:00Z', 0, 'green'),
      ('other-agent-notice', 't1', 'agent-2', 'Other', 'Private', '2026-09-01T11:00:00Z', 0, 'amber'),
      ('other-tenant', 't2', NULL, 'Other tenant', 'Private', '2026-09-01T12:00:00Z', 0, 'red');
  `);
  ensureNotificationAccessSchema(database);
  return database;
}

test('agents receive only directly addressed notifications', () => {
  const database = notificationDatabase();
  const rows = listNotifications(database, { id: 'agent-1', tenantId: 't1', role: 'agent' });
  assert.deepEqual(rows.map((row) => row.id), ['agent-notice']);
  database.close();
});

test('finance users receive tenant broadcasts and their direct notices', () => {
  const database = notificationDatabase();
  database.prepare("INSERT INTO notifications (id, tenant_id, recipient_user_id, title, detail, created_at, tone) VALUES ('manager-direct', 't1', 'manager-1', 'Direct', 'Private', '2026-09-01T12:00:00Z', 'blue')").run();
  const rows = listNotifications(database, { id: 'manager-1', tenantId: 't1', role: 'finance_manager' });
  assert.deepEqual(rows.map((row) => row.id), ['manager-direct', 'finance-notice']);
  database.close();
});

test('reading a shared finance notification is per user', () => {
  const database = notificationDatabase();
  const managerOne = { id: 'manager-1', tenantId: 't1', role: 'finance_manager' };
  const managerTwo = { id: 'manager-2', tenantId: 't1', role: 'finance_manager' };

  markNotificationsRead(database, managerOne, '2026-09-01T10:00:00Z');

  assert.equal(listNotifications(database, managerOne)[0].read, 1);
  assert.equal(listNotifications(database, managerTwo)[0].read, 0);
  database.close();
});

test('case-linked notifications retain their case identifier', () => {
  const database = notificationDatabase();
  database.prepare("UPDATE notifications SET case_id = 'RC-1' WHERE id = 'agent-notice'").run();
  assert.equal(listNotifications(database, { id: 'agent-1', tenantId: 't1', role: 'agent' })[0].case_id, 'RC-1');
  database.close();
});
