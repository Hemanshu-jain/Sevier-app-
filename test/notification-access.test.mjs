import test from 'node:test';
import assert from 'node:assert/strict';
import { listNotifications, markNotificationsRead } from '../server/notification-access.mjs';
import { migratedPool, makeTenant, makeUser, uid, skipWithoutDb } from './mysql-helpers.mjs';

const skip = skipWithoutDb;

async function seed(pool) {
  const tenantId = await makeTenant(pool);
  const agent1 = await makeUser(pool, { tenantId, role: 'agent' });
  const agent2 = await makeUser(pool, { tenantId, role: 'agent' });
  const manager1 = await makeUser(pool, { tenantId, role: 'finance_manager' });
  const manager2 = await makeUser(pool, { tenantId, role: 'finance_manager' });
  const ids = {
    broadcast: uid('n'), agent1Notice: uid('n'), agent2Notice: uid('n'), manager1Direct: uid('n'),
  };
  const insert = 'INSERT INTO notifications (id, tenant_id, recipient_user_id, case_id, title, detail, created_at, tone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  await pool.query(insert, [ids.broadcast, tenantId, null, null, 'Finance', 'Shared', '2026-09-01T09:00:00Z', 'blue']);
  await pool.query(insert, [ids.agent1Notice, tenantId, agent1, 'RC-1', 'Agent', 'Direct', '2026-09-01T10:00:00Z', 'green']);
  await pool.query(insert, [ids.agent2Notice, tenantId, agent2, null, 'Other', 'Private', '2026-09-01T11:00:00Z', 'amber']);
  await pool.query(insert, [ids.manager1Direct, tenantId, manager1, null, 'Direct', 'Private', '2026-09-01T12:00:00Z', 'blue']);
  return { tenantId, agent1, manager1, manager2, ids };
}

test('agents receive only directly addressed notifications, with case ids intact', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { tenantId, agent1, ids } = await seed(pool);
    const rows = await listNotifications(pool, { id: agent1, tenantId, role: 'agent' });
    assert.deepEqual(rows.map((row) => row.id), [ids.agent1Notice]);
    assert.equal(rows[0].case_id, 'RC-1');
  } finally {
    await pool.end();
  }
});

test('finance users receive tenant broadcasts and their direct notices', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { tenantId, manager1, ids } = await seed(pool);
    const rows = await listNotifications(pool, { id: manager1, tenantId, role: 'finance_manager' });
    assert.deepEqual(rows.map((row) => row.id), [ids.manager1Direct, ids.broadcast]);
  } finally {
    await pool.end();
  }
});

test('reading a shared finance notification is per user', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { tenantId, manager1, manager2, ids } = await seed(pool);
    const one = { id: manager1, tenantId, role: 'finance_manager' };
    const two = { id: manager2, tenantId, role: 'finance_manager' };
    await markNotificationsRead(pool, one, '2026-09-01T13:00:00Z');

    const readFlag = (rows) => rows.find((row) => row.id === ids.broadcast).read;
    assert.equal(readFlag(await listNotifications(pool, one)), 1);
    assert.equal(readFlag(await listNotifications(pool, two)), 0);
  } finally {
    await pool.end();
  }
});
