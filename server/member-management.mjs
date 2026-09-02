import { randomUUID } from 'node:crypto';
import { normalizeIndiaMobile } from './otp-service.mjs';
import { query, queryOne } from './mysql.mjs';

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export async function createFinanceMember({ database, tenantId, actorRole, values, id = `member-${randomUUID()}` }) {
  const role = String(values.role || '');
  if (!['finance_manager', 'finance_staff'].includes(role)) throw new Error('Choose finance manager or finance staff.');
  if (actorRole === 'finance_manager' && role !== 'finance_staff') throw new Error('Finance managers can add finance staff only.');
  const name = clean(values.name);
  const city = clean(values.city);
  if (name.length < 2 || name.length > 100) throw new Error('Enter the team member name.');
  if (city.length < 2 || city.length > 100) throw new Error('Enter the team member city.');
  let mobile;
  try { mobile = normalizeIndiaMobile(values.mobile); } catch { throw new Error('Enter a valid Indian mobile number.'); }
  if (await queryOne(database, 'SELECT 1 AS x FROM users WHERE mobile_e164 = ?', [mobile])) throw new Error('This mobile number is already registered.');
  const displayedMobile = `+91 ${mobile.slice(2, 7)} ${mobile.slice(7)}`;
  await query(database,
    `INSERT INTO users (id, tenant_id, role, name, email, password_hash, mobile, city, active, mobile_e164)
     VALUES (?, ?, ?, ?, ?, 'otp-only', ?, ?, 1, ?)`,
    [id, tenantId, role, name, `member+${id}@handoff.invalid`, displayedMobile, city, mobile]);
  return { id, name, mobile: displayedMobile, city, role, active: true };
}

export async function setFinanceMemberActive({ database, tenantId, actorUserId, actorRole, memberId, active, now = new Date().toISOString() }) {
  const member = await queryOne(database, "SELECT * FROM users WHERE id = ? AND tenant_id = ? AND role <> 'agent'", [memberId, tenantId]);
  if (!member) throw new Error('Finance team member not found.');
  if (member.id === actorUserId) throw new Error('You cannot change your own account status.');
  if (member.role === 'super_admin') throw new Error('The finance owner account cannot be suspended.');
  if (actorRole === 'finance_manager' && member.role !== 'finance_staff') throw new Error('Finance managers can manage finance staff only.');
  await query(database, 'UPDATE users SET active = ? WHERE id = ? AND tenant_id = ?', [active ? 1 : 0, memberId, tenantId]);
  if (!active) await query(database, 'UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now, memberId]);
  return { id: member.id, name: member.name, mobile: member.mobile, city: member.city, role: member.role, active: Boolean(active) };
}
