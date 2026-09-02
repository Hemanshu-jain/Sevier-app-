import { randomUUID } from 'node:crypto';
import { normalizeIndiaMobile } from './otp-service.mjs';
import { query, queryOne } from './mysql.mjs';

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function displayMobile(mobile) {
  return `+91 ${mobile.slice(2, 7)} ${mobile.slice(7)}`;
}

export async function createAgent({ database, tenantId, values, id = `agent-${randomUUID()}` }) {
  const name = clean(values.name);
  const city = clean(values.city);
  if (name.length < 2 || name.length > 100) throw new Error('Enter the agent name.');
  if (city.length < 2 || city.length > 100) throw new Error('Enter the agent city.');

  let mobile;
  try { mobile = normalizeIndiaMobile(values.mobile); } catch { throw new Error('Enter a valid Indian mobile number.'); }
  if (await queryOne(database, 'SELECT 1 AS x FROM users WHERE mobile_e164 = ?', [mobile])) throw new Error('This mobile number is already registered.');

  const displayedMobile = displayMobile(mobile);
  await query(database,
    `INSERT INTO users (id, tenant_id, role, name, email, password_hash, mobile, city, active, mobile_e164)
     VALUES (?, ?, 'agent', ?, ?, 'otp-only', ?, ?, 1, ?)`,
    [id, tenantId, name, `agent+${id}@handoff.invalid`, displayedMobile, city, mobile]);
  return { id, name, mobile: displayedMobile, city, active: true };
}

export async function setAgentActive({ database, tenantId, agentId, active, now = new Date().toISOString() }) {
  const agent = await queryOne(database, "SELECT * FROM users WHERE id = ? AND tenant_id = ? AND role = 'agent'", [agentId, tenantId]);
  if (!agent) throw new Error('Agent not found.');
  if (!active) {
    const assigned = await queryOne(database, "SELECT COUNT(*) AS count FROM recovery_cases WHERE tenant_id = ? AND assigned_agent_user_id = ? AND status NOT IN ('closed', 'cancelled')", [tenantId, agentId]);
    if (assigned.count > 0) throw new Error('Reassign or close the agent’s active cases before suspension.');
  }
  await query(database, 'UPDATE users SET active = ? WHERE id = ? AND tenant_id = ?', [active ? 1 : 0, agentId, tenantId]);
  if (!active) await query(database, 'UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now, agentId]);
  return { id: agent.id, name: agent.name, mobile: agent.mobile, city: agent.city, active: Boolean(active) };
}
