import test from 'node:test';
import assert from 'node:assert/strict';
import { assignVerification, cancelVerification, createVerification, validateVerificationInput, validateVerificationSubmission } from '../server/verification.mjs';
import { query, queryOne } from '../server/mysql.mjs';
import { makeTenant, makeUser, migratedPool, randomMobile, skipWithoutDb } from './mysql-helpers.mjs';

const request = { reference: 'APP-2026-001', customerName: 'Kavya Menon', customerMobile: '9844236157', address: '12, 100 Ft Road, Indiranagar', city: 'Bengaluru', pincode: '560038' };

test('verification input and submission are validated', () => {
  assert.equal(validateVerificationInput(request).error, undefined);
  assert.match(validateVerificationInput({ ...request, customerMobile: '123' }).error, /mobile/);
  assert.match(validateVerificationInput({ ...request, pincode: '5600' }).error, /PIN/);
  assert.match(validateVerificationInput({ ...request, address: 'x' }).error, /address/);
  assert.equal(validateVerificationSubmission({ result: 'verified', note: 'House matches; neighbour confirmed.', photoCount: 3 }), null);
  assert.match(validateVerificationSubmission({ result: 'verified', note: 'ok', photoCount: 1 }), /2 to 4 photos/);
  assert.match(validateVerificationSubmission({ result: 'verified', note: 'ok', photoCount: 5 }), /2 to 4 photos/);
  assert.match(validateVerificationSubmission({ result: 'maybe', note: 'ok', photoCount: 2 }), /verified/);
  assert.match(validateVerificationSubmission({ result: 'not_verified', note: ' ', photoCount: 2 }), /note/);
});

test('a verification is billed at creation, locked when unpaid, and assignable only to roster agents', { skip: skipWithoutDb }, async () => {
  const pool = await migratedPool();
  try {
    const tenantId = await makeTenant(pool);
    const financeUser = await makeUser(pool, { tenantId, role: 'finance_manager' });
    const agentId = await makeUser(pool, { tenantId: null, role: 'agent', mobileE164: `91${randomMobile()}` });
    const strangerAgent = await makeUser(pool, { tenantId: null, role: 'agent', mobileE164: `91${randomMobile()}` });
    await query(pool, 'UPDATE users SET rate_verification_paise = 50000 WHERE id = ?', [agentId]);
    await query(pool, "INSERT INTO agent_memberships (agent_user_id, tenant_id, added_at, active) VALUES (?, ?, '2026-09-24T00:00:00.000Z', 1)", [agentId, tenantId]);

    // Empty wallet: request exists but is locked and can't be assigned.
    const locked = await createVerification({ database: pool, tenantId, userId: financeUser, values: request });
    assert.equal(locked.billing.pending, 1);
    await assert.rejects(assignVerification({ database: pool, tenantId, userId: financeUser, requestId: locked.id, agentId }), /locked/);

    // Funded wallet: billed immediately; roster agent only; rate snapshotted.
    await query(pool, 'UPDATE wallets SET balance_paise = 1000000 WHERE tenant_id = ?', [tenantId]);
    await query(pool, "UPDATE billing_charges SET status = 'paid' WHERE tenant_id = ?", [tenantId]); // settle the earlier one so FIFO doesn't queue the next
    const open = await createVerification({ database: pool, tenantId, userId: financeUser, values: request });
    assert.equal(open.billing.paid, 1);
    await assert.rejects(assignVerification({ database: pool, tenantId, userId: financeUser, requestId: open.id, agentId: strangerAgent }), /roster/);
    await assignVerification({ database: pool, tenantId, userId: financeUser, requestId: open.id, agentId });
    const row = await queryOne(pool, 'SELECT status, agent_rate_paise FROM verification_requests WHERE id = ?', [open.id]);
    assert.deepEqual({ status: row.status, rate: Number(row.agent_rate_paise) }, { status: 'assigned', rate: 50000 });

    await cancelVerification({ database: pool, tenantId, requestId: open.id });
    await assert.rejects(cancelVerification({ database: pool, tenantId, requestId: open.id }), /open or assigned/);
    const charge = await queryOne(pool, "SELECT status FROM billing_charges WHERE item_id = ?", [open.id]);
    assert.equal(charge.status, 'paid', 'cancelling never refunds the platform fee');
  } finally {
    await pool.end();
  }
});
