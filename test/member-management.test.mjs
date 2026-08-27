import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createFinanceMember, setFinanceMemberActive } from '../server/member-management.mjs';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, mobile TEXT, city TEXT,
      active INTEGER NOT NULL DEFAULT 1, mobile_e164 TEXT UNIQUE
    );
    CREATE TABLE auth_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    );
    INSERT INTO users VALUES
      ('owner', 'tenant-a', 'super_admin', 'Owner', 'owner@test', 'x', '+91 90000 00001', 'Pune', 1, '919000000001'),
      ('manager', 'tenant-a', 'finance_manager', 'Manager', 'manager@test', 'x', '+91 90000 00002', 'Pune', 1, '919000000002');
  `);
  return db;
}

test('owner can add managers while managers can add staff only', () => {
  const db = database();
  const member = createFinanceMember({ database: db, tenantId: 'tenant-a', actorRole: 'super_admin', values: { name: 'Divya Shah', mobile: '9876543210', city: 'Pune', role: 'finance_manager' }, id: 'member-1' });
  assert.equal(member.role, 'finance_manager');
  assert.throws(() => createFinanceMember({ database: db, tenantId: 'tenant-a', actorRole: 'finance_manager', values: { name: 'Other Manager', mobile: '9876543211', city: 'Pune', role: 'finance_manager' } }), /managers can add finance staff only/i);
  assert.equal(createFinanceMember({ database: db, tenantId: 'tenant-a', actorRole: 'finance_manager', values: { name: 'Finance Staff', mobile: '9876543212', city: 'Pune', role: 'finance_staff' }, id: 'member-2' }).role, 'finance_staff');
});

test('member suspension preserves ownership, hierarchy, and session revocation', () => {
  const db = database();
  createFinanceMember({ database: db, tenantId: 'tenant-a', actorRole: 'finance_manager', values: { name: 'Finance Staff', mobile: '9876543212', city: 'Pune', role: 'finance_staff' }, id: 'staff' });
  assert.throws(() => setFinanceMemberActive({ database: db, tenantId: 'tenant-a', actorUserId: 'manager', actorRole: 'finance_manager', memberId: 'manager', active: false }), /your own account/i);
  assert.throws(() => setFinanceMemberActive({ database: db, tenantId: 'tenant-a', actorUserId: 'manager', actorRole: 'finance_manager', memberId: 'owner', active: false }), /owner/i);
  db.prepare("INSERT INTO auth_sessions VALUES ('session', 'staff', 'hash', '2026-08-01', '2026-09-01', NULL)").run();
  assert.equal(setFinanceMemberActive({ database: db, tenantId: 'tenant-a', actorUserId: 'manager', actorRole: 'finance_manager', memberId: 'staff', active: false, now: '2026-08-28T10:00:00.000Z' }).active, false);
  assert.equal(db.prepare("SELECT revoked_at FROM auth_sessions WHERE id = 'session'").get().revoked_at, '2026-08-28T10:00:00.000Z');
});
