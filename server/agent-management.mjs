import { randomUUID } from 'node:crypto';
import { normalizeIndiaMobile } from './otp-service.mjs';
import { query, queryOne, tx } from './mysql.mjs';

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function displayMobile(mobile) {
  return `+91 ${mobile.slice(2, 7)} ${mobile.slice(7)}`;
}

// Create a brand-new agent and link them to this financer's roster.
export async function createAgent({ database, tenantId, values, addedByUserId = null, id = `agent-${randomUUID()}`, now = new Date().toISOString() }) {
  const name = clean(values.name);
  const city = clean(values.city);
  if (name.length < 2 || name.length > 100) throw new Error('Enter the agent name.');
  if (city.length < 2 || city.length > 100) throw new Error('Enter the agent city.');
  let mobile;
  try { mobile = normalizeIndiaMobile(values.mobile); } catch { throw new Error('Enter a valid Indian mobile number.'); }
  if (await queryOne(database, 'SELECT 1 AS x FROM users WHERE mobile_e164 = ?', [mobile])) throw new Error('This mobile number is already registered.');

  const displayedMobile = displayMobile(mobile);
  await tx(database, async (conn) => {
    await query(conn,
      `INSERT INTO users (id, tenant_id, role, name, email, password_hash, mobile, city, active, mobile_e164, onboarding_complete, created_via)
       VALUES (?, ?, 'agent', ?, ?, 'otp-only', ?, ?, 1, ?, 1, 'finance')`,
      [id, tenantId, name, `agent+${id}@handoff.invalid`, displayedMobile, city, mobile]);
    await query(conn, 'INSERT INTO agent_memberships (agent_user_id, tenant_id, added_at, added_by_user_id, active) VALUES (?, ?, ?, ?, 1)', [id, tenantId, now, addedByUserId]);
  });
  return { id, name, mobile: displayedMobile, city, active: true };
}

// Search the global agent directory; `linked` says whether they're already in this roster.
export async function searchAgentDirectory({ database, tenantId, q = '' }) {
  const like = `%${String(q).trim()}%`;
  const rows = await query(database,
    `SELECT users.id, users.name, users.mobile, users.city, users.created_via,
       CASE WHEN m.agent_user_id IS NULL THEN 0 ELSE m.active END AS linked
     FROM users
     LEFT JOIN agent_memberships m ON m.agent_user_id = users.id AND m.tenant_id = ?
     WHERE users.role = 'agent' AND users.active = 1 AND users.onboarding_complete = 1
       AND (users.name LIKE ? OR users.mobile LIKE ? OR users.city LIKE ? OR users.mobile_e164 LIKE ?)
     ORDER BY users.name LIMIT 25`,
    [tenantId, like, like, like, like]);
  return rows.map((row) => ({ id: row.id, name: row.name, mobile: row.mobile, city: row.city, createdVia: row.created_via, linked: Boolean(row.linked) }));
}

// Add an existing directory agent to this financer's roster (idempotent; reactivates if removed).
export async function linkAgent({ database, tenantId, agentId, addedByUserId = null, now = new Date().toISOString() }) {
  const agent = await queryOne(database, "SELECT id, name, mobile, city FROM users WHERE id = ? AND role = 'agent' AND active = 1", [agentId]);
  if (!agent) throw new Error('Agent not found in the directory.');
  const existing = await queryOne(database, 'SELECT active FROM agent_memberships WHERE agent_user_id = ? AND tenant_id = ?', [agentId, tenantId]);
  if (existing) {
    if (!existing.active) await query(database, 'UPDATE agent_memberships SET active = 1 WHERE agent_user_id = ? AND tenant_id = ?', [agentId, tenantId]);
  } else {
    await query(database, 'INSERT INTO agent_memberships (agent_user_id, tenant_id, added_at, added_by_user_id, active) VALUES (?, ?, ?, ?, 1)', [agentId, tenantId, now, addedByUserId]);
  }
  return { id: agent.id, name: agent.name, mobile: agent.mobile, city: agent.city, active: true };
}

// Enable/disable an agent in this financer's roster (per-membership, not global).
export async function setAgentActive({ database, tenantId, agentId, active }) {
  const membership = await queryOne(database,
    'SELECT users.id, users.name, users.mobile, users.city FROM agent_memberships m JOIN users ON users.id = m.agent_user_id WHERE m.agent_user_id = ? AND m.tenant_id = ?',
    [agentId, tenantId]);
  if (!membership) throw new Error('Agent not found.');
  if (!active) {
    const assigned = await queryOne(database, 'SELECT COUNT(*) AS count FROM case_assignments WHERE tenant_id = ? AND agent_user_id = ? AND active = 1', [tenantId, agentId]);
    if (assigned.count > 0) throw new Error('Reassign or close the agent’s active cases before removing them.');
  }
  await query(database, 'UPDATE agent_memberships SET active = ? WHERE agent_user_id = ? AND tenant_id = ?', [active ? 1 : 0, agentId, tenantId]);
  return { id: membership.id, name: membership.name, mobile: membership.mobile, city: membership.city, active: Boolean(active) };
}
