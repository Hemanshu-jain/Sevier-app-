import { randomUUID } from 'node:crypto';
import { query, queryOne, tx } from './mysql.mjs';

// Agent groups are tenant-scoped shortcuts for bulk messaging. Members must be agents
// on this financer's active roster. A broadcast fans out one notification per member
// (individual delivery), so each agent still gets their own notice.

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

// The tenant's active roster, as a Set of agent user ids — the only agents a group may hold.
async function rosterIds(database, tenantId) {
  const rows = await query(database, 'SELECT agent_user_id FROM agent_memberships WHERE tenant_id = ? AND active = 1', [tenantId]);
  return new Set(rows.map((row) => row.agent_user_id));
}

// Validate requested member ids against the roster; returns the clean, de-duped list or throws.
async function validateMembers(database, tenantId, agentIds) {
  const ids = [...new Set((Array.isArray(agentIds) ? agentIds : []).map((id) => String(id)))];
  if (ids.length === 0) return [];
  const roster = await rosterIds(database, tenantId);
  const invalid = ids.filter((id) => !roster.has(id));
  if (invalid.length) throw new Error('Only agents on your roster can be added to a group.');
  return ids;
}

async function loadGroup(database, tenantId, groupId) {
  const group = await queryOne(database, 'SELECT id, name, created_at FROM agent_groups WHERE id = ? AND tenant_id = ?', [groupId, tenantId]);
  if (!group) throw new Error('Group not found.');
  return group;
}

async function replaceMembers(conn, groupId, agentIds) {
  await query(conn, 'DELETE FROM agent_group_members WHERE group_id = ?', [groupId]);
  for (const agentId of agentIds) {
    await query(conn, 'INSERT INTO agent_group_members (group_id, agent_user_id) VALUES (?, ?)', [groupId, agentId]);
  }
}

// List this tenant's groups with their members ([{id, name}]).
export async function listGroups({ database, tenantId }) {
  const groups = await query(database, 'SELECT id, name, created_at FROM agent_groups WHERE tenant_id = ? ORDER BY name', [tenantId]);
  if (groups.length === 0) return [];
  const members = await query(database,
    `SELECT gm.group_id, users.id, users.name FROM agent_group_members gm
       JOIN users ON users.id = gm.agent_user_id
       JOIN agent_groups g ON g.id = gm.group_id
      WHERE g.tenant_id = ? ORDER BY users.name`,
    [tenantId]);
  const byGroup = new Map();
  for (const row of members) { const list = byGroup.get(row.group_id) || []; list.push({ id: row.id, name: row.name }); byGroup.set(row.group_id, list); }
  return groups.map((group) => ({ id: group.id, name: group.name, createdAt: group.created_at, members: byGroup.get(group.id) || [] }));
}

export async function createGroup({ database, tenantId, name, agentIds = [], id = `grp-${randomUUID()}`, now = new Date().toISOString() }) {
  const cleanName = clean(name);
  if (cleanName.length < 2 || cleanName.length > 100) throw new Error('Enter a group name.');
  const members = await validateMembers(database, tenantId, agentIds);
  await tx(database, async (conn) => {
    await query(conn, 'INSERT INTO agent_groups (id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)', [id, tenantId, cleanName, now]);
    await replaceMembers(conn, id, members);
  });
  return { id, name: cleanName, createdAt: now, members: [] };
}

// Update name and/or membership; agentIds (when given) replaces the full member set.
export async function updateGroup({ database, tenantId, groupId, name, agentIds }) {
  await loadGroup(database, tenantId, groupId);
  const nextName = name === undefined ? undefined : clean(name);
  if (nextName !== undefined && (nextName.length < 2 || nextName.length > 100)) throw new Error('Enter a group name.');
  const members = agentIds === undefined ? undefined : await validateMembers(database, tenantId, agentIds);
  await tx(database, async (conn) => {
    if (nextName !== undefined) await query(conn, 'UPDATE agent_groups SET name = ? WHERE id = ? AND tenant_id = ?', [nextName, groupId, tenantId]);
    if (members !== undefined) await replaceMembers(conn, groupId, members);
  });
}

export async function deleteGroup({ database, tenantId, groupId }) {
  await loadGroup(database, tenantId, groupId);
  await tx(database, async (conn) => {
    await query(conn, 'DELETE FROM agent_group_members WHERE group_id = ?', [groupId]);
    await query(conn, 'DELETE FROM agent_groups WHERE id = ? AND tenant_id = ?', [groupId, tenantId]);
  });
}

// Fan out one notification per member; returns how many were delivered.
export async function broadcastToGroup({ database, tenantId, groupId, title, detail, now = new Date().toISOString() }) {
  const cleanTitle = clean(title);
  const cleanDetail = String(detail || '').trim();
  if (cleanTitle.length < 2 || cleanTitle.length > 120) throw new Error('Enter a message subject.');
  if (cleanDetail.length < 2 || cleanDetail.length > 1000) throw new Error('Enter a message.');
  await loadGroup(database, tenantId, groupId);
  const members = await query(database, 'SELECT agent_user_id FROM agent_group_members WHERE group_id = ?', [groupId]);
  if (members.length === 0) throw new Error('This group has no members yet.');
  await tx(database, async (conn) => {
    for (const member of members) {
      await query(conn, 'INSERT INTO notifications (id, tenant_id, recipient_user_id, case_id, title, detail, created_at, `read`, tone) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?)',
        [`n-${randomUUID()}`, tenantId, member.agent_user_id, cleanTitle, cleanDetail, now, 'blue']);
    }
  });
  return { delivered: members.length };
}
