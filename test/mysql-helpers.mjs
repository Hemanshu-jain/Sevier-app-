import { randomUUID } from 'node:crypto';
import { createPool, migrate } from '../server/mysql.mjs';

// ponytail: each test owns a pool it ends in finally (a shared pool would keep
// connections open and hang the test runner). Unique ids = isolation on the shared DB.
export const skipWithoutDb = process.env.DATABASE_URL ? false : 'set DATABASE_URL to run MySQL tests';

export async function migratedPool() {
  const pool = createPool();
  await migrate(pool);
  return pool;
}

export function uid(prefix = 'id') {
  return `${prefix}-${randomUUID()}`;
}

export async function makeTenant(executor, id = uid('t')) {
  await executor.query('INSERT INTO tenants (id, name) VALUES (?, ?)', [id, `Test ${id}`]);
  return id;
}

export async function makeUser(executor, { tenantId, id = uid('u'), role = 'agent', mobileE164 = null }) {
  await executor.query(
    `INSERT INTO users (id, tenant_id, role, name, email, password_hash, mobile, city, active, mobile_e164)
     VALUES (?, ?, ?, ?, ?, 'x', ?, 'City', 1, ?)`,
    [id, tenantId, role, `User ${id}`, `${id}@test.invalid`, mobileE164 && `+91 ${mobileE164}`, mobileE164],
  );
  return id;
}

export function randomMobile() {
  return `9${Math.floor(100000000 + Math.random() * 900000000)}`; // 10-digit Indian mobile
}

export async function makeCase(executor, { tenantId, id = uid('RC'), status = 'assigned', assignedAgentUserId = null }) {
  await executor.query(
    `INSERT INTO recovery_cases (id, tenant_id, account_number, borrower_name, borrower_mobile, borrower_address,
       registration, make_model, chassis, vehicle_type, branch, pending_amount, overdue_days, status, assigned_agent_user_id, updated_at)
     VALUES (?, ?, ?, 'Borrower', '919876543210', 'Addr', ?, 'Model', 'CHASSIS', '4-wheeler', 'Branch', 100000, 30, ?, ?, '2026-08-01T00:00:00.000Z')`,
    [id, tenantId, uid('LN'), uid('KA'), status, assignedAgentUserId],
  );
  return id;
}
