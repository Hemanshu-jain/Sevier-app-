import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAgent, setAgentActive } from '../server/agent-management.mjs';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tenants (id TEXT PRIMARY KEY);
    CREATE TABLE users (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), role TEXT NOT NULL,
      name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      mobile TEXT, city TEXT, active INTEGER NOT NULL DEFAULT 1, mobile_e164 TEXT UNIQUE
    );
    CREATE TABLE recovery_cases (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, assigned_agent_user_id TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE auth_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    );
    INSERT INTO tenants (id) VALUES ('tenant-a'), ('tenant-b');
  `);
  return db;
}

test('creates an OTP-ready agent inside the financer tenant', () => {
  const db = database();
  const agent = createAgent({
    database: db,
    tenantId: 'tenant-a',
    values: { name: '  Priya Shah ', mobile: '98765 43210', city: ' Pune ' },
    id: 'agent-new',
  });

  assert.deepEqual(agent, { id: 'agent-new', name: 'Priya Shah', mobile: '+91 98765 43210', city: 'Pune', active: true });
  assert.deepEqual({ ...db.prepare('SELECT tenant_id, role, mobile_e164 FROM users WHERE id = ?').get(agent.id) }, {
    tenant_id: 'tenant-a', role: 'agent', mobile_e164: '919876543210',
  });
  assert.throws(() => createAgent({ database: db, tenantId: 'tenant-b', values: { name: 'Other', mobile: '919876543210', city: 'Delhi' } }), /already registered/i);
});

test('suspension rejects active assignments and revokes sessions once clear', () => {
  const db = database();
  createAgent({ database: db, tenantId: 'tenant-a', values: { name: 'Priya Shah', mobile: '9876543210', city: 'Pune' }, id: 'agent-new' });
  db.prepare("INSERT INTO recovery_cases VALUES ('case-1', 'tenant-a', 'agent-new', 'Assigned')").run();
  assert.throws(() => setAgentActive({ database: db, tenantId: 'tenant-a', agentId: 'agent-new', active: false }), /active case/i);

  db.prepare("UPDATE recovery_cases SET status = 'Closed'").run();
  db.prepare("INSERT INTO auth_sessions VALUES ('session-1', 'agent-new', 'hash', '2026-08-01', '2026-09-01', NULL)").run();
  assert.equal(setAgentActive({ database: db, tenantId: 'tenant-a', agentId: 'agent-new', active: false, now: '2026-08-27T10:00:00.000Z' }).active, false);
  assert.equal(db.prepare("SELECT revoked_at FROM auth_sessions WHERE id = 'session-1'").get().revoked_at, '2026-08-27T10:00:00.000Z');
});
