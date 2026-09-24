import test from 'node:test';
import assert from 'node:assert/strict';
import { rateAgent, ratingSummaries } from '../server/agent-ratings.mjs';
import { redactForAgent } from '../server/case-actions.mjs';
import { query } from '../server/mysql.mjs';
import { makeCase, makeTenant, makeUser, migratedPool, skipWithoutDb } from './mysql-helpers.mjs';

test('hidden customer and vehicle details never reach the agent; registration always does', () => {
  const item = {
    accountNumber: 'LN-1', borrower: { name: 'Meera', mobile: '+91 98765 43210', address: 'HSR Layout' }, pendingAmount: 38400, overdueDays: 97,
    vehicle: { registration: 'KA 01 MQ 4281', makeModel: 'Activa', chassis: 'ME4', type: '2-wheeler' },
  };
  const hidden = redactForAgent({ ...item, agentVisibility: { customer: false, vehicle: false } });
  assert.deepEqual(hidden.borrower, { name: 'Meera', mobile: '', address: '' });
  assert.equal(hidden.accountNumber, '');
  assert.equal(hidden.pendingAmount, 0);
  assert.deepEqual(hidden.vehicle, { registration: 'KA 01 MQ 4281', makeModel: '', chassis: '', type: '2-wheeler' });
  const shown = redactForAgent({ ...item, agentVisibility: { customer: true, vehicle: true } });
  assert.deepEqual(shown.borrower, item.borrower);
  assert.deepEqual(shown.vehicle, item.vehicle);
});

test('agents can be rated only after a field outcome, re-rating overwrites, and the average is shared', { skip: skipWithoutDb }, async () => {
  const pool = await migratedPool();
  try {
    const tenantId = await makeTenant(pool);
    const otherTenant = await makeTenant(pool);
    const financeUser = await makeUser(pool, { tenantId, role: 'finance_manager' });
    const otherFinance = await makeUser(pool, { tenantId: otherTenant, role: 'finance_manager' });
    const agentId = await makeUser(pool, { tenantId: null, role: 'agent' });
    const caseId = await makeCase(pool, { tenantId, assignedAgentUserId: agentId });
    const otherCase = await makeCase(pool, { tenantId: otherTenant, assignedAgentUserId: agentId });

    await assert.rejects(rateAgent({ database: pool, tenantId, userId: financeUser, caseId, agentId, stars: 5 }), /after they submit a field outcome/);
    const outcome = "INSERT INTO audit_events (tenant_id, case_id, actor_user_id, action, detail, created_at) VALUES (?, ?, ?, 'custody.created', 'x', '2026-09-24T00:00:00.000Z')";
    await query(pool, outcome, [tenantId, caseId, agentId]);
    await query(pool, outcome, [otherTenant, otherCase, agentId]);

    await assert.rejects(rateAgent({ database: pool, tenantId, userId: financeUser, caseId, agentId, stars: 6 }), /1 to 5/);
    await rateAgent({ database: pool, tenantId, userId: financeUser, caseId, agentId, stars: 2 });
    await rateAgent({ database: pool, tenantId, userId: financeUser, caseId, agentId, stars: 4, comment: 'Fast and careful' });
    await rateAgent({ database: pool, tenantId: otherTenant, userId: otherFinance, caseId: otherCase, agentId, stars: 5 });
    assert.deepEqual((await ratingSummaries(pool, [agentId])).get(agentId), { average: 4.5, count: 2 });
  } finally {
    await pool.end();
  }
});
