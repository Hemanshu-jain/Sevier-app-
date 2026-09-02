import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, setAgentActive } from '../server/agent-management.mjs';
import { query } from '../server/mysql.mjs';
import { migratedPool, makeTenant, makeCase, randomMobile, uid, skipWithoutDb } from './mysql-helpers.mjs';

const skip = skipWithoutDb;

test('creates an OTP-ready agent inside the financer tenant', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const tenantB = await makeTenant(pool);
    const mobile = randomMobile();
    const agentId = uid('agent');
    const agent = await createAgent({ database: pool, tenantId: tenantA, values: { name: '  Priya Shah ', mobile: `${mobile.slice(0, 5)} ${mobile.slice(5)}`, city: ' Pune ' }, id: agentId });

    assert.deepEqual(agent, { id: agentId, name: 'Priya Shah', mobile: `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`, city: 'Pune', active: true });
    const row = (await query(pool, 'SELECT tenant_id, role, mobile_e164 FROM users WHERE id = ?', [agent.id]))[0];
    assert.deepEqual({ tenant_id: row.tenant_id, role: row.role, mobile_e164: row.mobile_e164 }, { tenant_id: tenantA, role: 'agent', mobile_e164: `91${mobile}` });
    await assert.rejects(createAgent({ database: pool, tenantId: tenantB, values: { name: 'Other', mobile: `91${mobile}`, city: 'Delhi' } }), /already registered/i);
  } finally {
    await pool.end();
  }
});

test('suspension rejects active assignments and revokes sessions once clear', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const agentId = uid('agent');
    await createAgent({ database: pool, tenantId: tenantA, values: { name: 'Priya Shah', mobile: randomMobile(), city: 'Pune' }, id: agentId });
    const caseId = await makeCase(pool, { tenantId: tenantA, status: 'assigned', assignedAgentUserId: agentId });
    await assert.rejects(setAgentActive({ database: pool, tenantId: tenantA, agentId, active: false }), /active case/i);

    await query(pool, "UPDATE recovery_cases SET status = 'closed' WHERE id = ?", [caseId]);
    const sessionId = uid('session');
    await query(pool, "INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, '2026-08-01', '2026-09-01')", [sessionId, agentId, `hash-${sessionId}`]);
    assert.equal((await setAgentActive({ database: pool, tenantId: tenantA, agentId, active: false, now: '2026-08-27T10:00:00.000Z' })).active, false);
    assert.equal((await query(pool, 'SELECT revoked_at FROM auth_sessions WHERE id = ?', [sessionId]))[0].revoked_at, '2026-08-27T10:00:00.000Z');
  } finally {
    await pool.end();
  }
});
