import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, setAgentActive, searchAgentDirectory, linkAgent } from '../server/agent-management.mjs';
import { query } from '../server/mysql.mjs';
import { migratedPool, makeTenant, makeCase, randomMobile, uid, skipWithoutDb } from './mysql-helpers.mjs';

const skip = skipWithoutDb;

test('creating an agent links them to the roster and rejects duplicate mobiles', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const tenantB = await makeTenant(pool);
    const mobile = randomMobile();
    const agentId = uid('agent');
    const agent = await createAgent({ database: pool, tenantId: tenantA, values: { name: 'Priya Shah', mobile, city: 'Pune' }, id: agentId });

    assert.equal(agent.mobile, `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`);
    const u = (await query(pool, 'SELECT tenant_id, role, mobile_e164, created_via FROM users WHERE id = ?', [agentId]))[0];
    assert.deepEqual({ tenant_id: u.tenant_id, role: u.role, mobile_e164: u.mobile_e164, created_via: u.created_via }, { tenant_id: tenantA, role: 'agent', mobile_e164: `91${mobile}`, created_via: 'finance' });
    assert.equal((await query(pool, 'SELECT COUNT(*) AS c FROM agent_memberships WHERE agent_user_id = ? AND tenant_id = ?', [agentId, tenantA]))[0].c, 1);
    await assert.rejects(createAgent({ database: pool, tenantId: tenantB, values: { name: 'Other', mobile: `91${mobile}`, city: 'Delhi' } }), /already registered/i);
  } finally {
    await pool.end();
  }
});

test('directory search finds a global agent and link adds a membership', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const mobile = randomMobile();
    const gid = uid('agent');
    await query(pool, "INSERT INTO users (id, tenant_id, role, name, email, password_hash, mobile, city, active, mobile_e164, onboarding_complete, created_via) VALUES (?, NULL, 'agent', 'Global Guy', ?, 'otp-only', ?, 'Hubballi', 1, ?, 1, 'self')",
      [gid, `${gid}@t.invalid`, `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`, `91${mobile}`]);

    const before = await searchAgentDirectory({ database: pool, tenantId: tenantA, q: 'Global Guy' });
    const hit = before.find((a) => a.id === gid);
    assert.ok(hit && hit.linked === false);

    await linkAgent({ database: pool, tenantId: tenantA, agentId: gid });
    assert.equal((await query(pool, 'SELECT active FROM agent_memberships WHERE agent_user_id = ? AND tenant_id = ?', [gid, tenantA]))[0].active, 1);
    const after = await searchAgentDirectory({ database: pool, tenantId: tenantA, q: 'Global Guy' });
    assert.equal(after.find((a) => a.id === gid).linked, true);
  } finally {
    await pool.end();
  }
});

test('per-financer suspension blocks on active assignments then removes from the roster', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const agentId = uid('agent');
    await createAgent({ database: pool, tenantId: tenantA, values: { name: 'Priya Shah', mobile: randomMobile(), city: 'Pune' }, id: agentId });
    const caseId = await makeCase(pool, { tenantId: tenantA, status: 'assigned', assignedAgentUserId: agentId });
    await query(pool, "INSERT INTO case_assignments (tenant_id, case_id, agent_user_id, assigned_at, assigned_by_user_id, active) VALUES (?, ?, ?, '2026-08-01', ?, 1)", [tenantA, caseId, agentId, agentId]);

    await assert.rejects(setAgentActive({ database: pool, tenantId: tenantA, agentId, active: false }), /active cases/i);
    await query(pool, 'UPDATE case_assignments SET active = 0 WHERE agent_user_id = ?', [agentId]);
    assert.equal((await setAgentActive({ database: pool, tenantId: tenantA, agentId, active: false })).active, false);
    assert.equal((await query(pool, 'SELECT active FROM agent_memberships WHERE agent_user_id = ? AND tenant_id = ?', [agentId, tenantA]))[0].active, 0);
  } finally {
    await pool.end();
  }
});
