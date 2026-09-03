import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../server/agent-management.mjs';
import { listGroups, createGroup, updateGroup, deleteGroup, broadcastToGroup } from '../server/agent-groups.mjs';
import { query } from '../server/mysql.mjs';
import { migratedPool, makeTenant, randomMobile, uid, skipWithoutDb } from './mysql-helpers.mjs';

const skip = skipWithoutDb;

async function makeRosterAgent(pool, tenantId) {
  const id = uid('agent');
  await createAgent({ database: pool, tenantId, values: { name: `Agent ${id.slice(-4)}`, mobile: randomMobile(), city: 'Pune' }, id });
  return id;
}

test('a group only accepts agents on the tenant roster', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const tenantB = await makeTenant(pool);
    const mine = await makeRosterAgent(pool, tenantA);
    const theirs = await makeRosterAgent(pool, tenantB);

    await assert.rejects(createGroup({ database: pool, tenantId: tenantA, name: 'Zone', agentIds: [theirs] }), /roster/i);
    const group = await createGroup({ database: pool, tenantId: tenantA, name: 'North zone', agentIds: [mine] });
    const listed = (await listGroups({ database: pool, tenantId: tenantA })).find((g) => g.id === group.id);
    assert.deepEqual(listed.members.map((m) => m.id), [mine]);
  } finally {
    await pool.end();
  }
});

test('broadcast fans out one notification per member and is tenant-scoped', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const a1 = await makeRosterAgent(pool, tenantA);
    const a2 = await makeRosterAgent(pool, tenantA);
    const group = await createGroup({ database: pool, tenantId: tenantA, name: 'Riders', agentIds: [a1, a2] });

    const result = await broadcastToGroup({ database: pool, tenantId: tenantA, groupId: group.id, title: 'Report to yard', detail: 'Reach the yard by 6 PM today.' });
    assert.equal(result.delivered, 2);
    const rows = await query(pool, 'SELECT recipient_user_id, title FROM notifications WHERE tenant_id = ? AND title = ?', [tenantA, 'Report to yard']);
    assert.deepEqual(rows.map((r) => r.recipient_user_id).sort(), [a1, a2].sort());

    await assert.rejects(broadcastToGroup({ database: pool, tenantId: tenantA, groupId: group.id, title: 'x', detail: 'too short subject' }), /subject/i);
  } finally {
    await pool.end();
  }
});

test('update replaces membership and delete removes the group', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const a1 = await makeRosterAgent(pool, tenantA);
    const a2 = await makeRosterAgent(pool, tenantA);
    const group = await createGroup({ database: pool, tenantId: tenantA, name: 'Team', agentIds: [a1] });

    await updateGroup({ database: pool, tenantId: tenantA, groupId: group.id, name: 'Team A', agentIds: [a2] });
    const listed = (await listGroups({ database: pool, tenantId: tenantA })).find((g) => g.id === group.id);
    assert.equal(listed.name, 'Team A');
    assert.deepEqual(listed.members.map((m) => m.id), [a2]);

    await deleteGroup({ database: pool, tenantId: tenantA, groupId: group.id });
    assert.equal((await listGroups({ database: pool, tenantId: tenantA })).find((g) => g.id === group.id), undefined);
    assert.equal((await query(pool, 'SELECT COUNT(*) AS c FROM agent_group_members WHERE group_id = ?', [group.id]))[0].c, 0);
  } finally {
    await pool.end();
  }
});
