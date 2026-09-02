import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceMember, setFinanceMemberActive } from '../server/member-management.mjs';
import { query } from '../server/mysql.mjs';
import { migratedPool, makeTenant, makeUser, randomMobile, uid, skipWithoutDb } from './mysql-helpers.mjs';

const skip = skipWithoutDb;

test('owner can add managers while managers can add staff only', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantId = await makeTenant(pool);
    const member = await createFinanceMember({ database: pool, tenantId, actorRole: 'super_admin', values: { name: 'Divya Shah', mobile: randomMobile(), city: 'Pune', role: 'finance_manager' }, id: uid('member') });
    assert.equal(member.role, 'finance_manager');
    await assert.rejects(createFinanceMember({ database: pool, tenantId, actorRole: 'finance_manager', values: { name: 'Other Manager', mobile: randomMobile(), city: 'Pune', role: 'finance_manager' } }), /finance staff only/i);
    const staff = await createFinanceMember({ database: pool, tenantId, actorRole: 'finance_manager', values: { name: 'Finance Staff', mobile: randomMobile(), city: 'Pune', role: 'finance_staff' }, id: uid('member') });
    assert.equal(staff.role, 'finance_staff');
  } finally {
    await pool.end();
  }
});

test('member suspension preserves ownership, hierarchy, and session revocation', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantId = await makeTenant(pool);
    const owner = await makeUser(pool, { tenantId, role: 'super_admin', mobileE164: `91${randomMobile()}` });
    const manager = await makeUser(pool, { tenantId, role: 'finance_manager', mobileE164: `91${randomMobile()}` });
    const staff = await createFinanceMember({ database: pool, tenantId, actorRole: 'finance_manager', values: { name: 'Finance Staff', mobile: randomMobile(), city: 'Pune', role: 'finance_staff' }, id: uid('staff') });

    await assert.rejects(setFinanceMemberActive({ database: pool, tenantId, actorUserId: manager, actorRole: 'finance_manager', memberId: manager, active: false }), /your own account/i);
    await assert.rejects(setFinanceMemberActive({ database: pool, tenantId, actorUserId: manager, actorRole: 'finance_manager', memberId: owner, active: false }), /owner/i);

    const sessionId = uid('session');
    await query(pool, "INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, '2026-08-01', '2026-09-01')", [sessionId, staff.id, `hash-${sessionId}`]);
    assert.equal((await setFinanceMemberActive({ database: pool, tenantId, actorUserId: manager, actorRole: 'finance_manager', memberId: staff.id, active: false, now: '2026-08-28T10:00:00.000Z' })).active, false);
    assert.equal((await query(pool, 'SELECT revoked_at FROM auth_sessions WHERE id = ?', [sessionId]))[0].revoked_at, '2026-08-28T10:00:00.000Z');
  } finally {
    await pool.end();
  }
});
