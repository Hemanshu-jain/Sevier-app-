import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, updateAccount } from '../server/account-management.mjs';
import { query } from '../server/mysql.mjs';
import { migratedPool, makeTenant, uid, skipWithoutDb } from './mysql-helpers.mjs';

const skip = skipWithoutDb;
const values = {
  accountNumber: 'LN-5001', borrowerName: 'Anita Rao', borrowerMobile: '9876543210', borrowerAddress: 'Pune',
  registration: 'mh 12 ab 1234', makeModel: 'Tata Nexon', vehicleType: '4W', chassis: 'MAT123', branch: 'Pune',
  pendingAmount: '84500', overdueDays: '62',
};

test('creates a validated manual account and rejects open duplicates', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantId = await makeTenant(pool);
    const caseId = uid('case');
    const created = await createAccount({ database: pool, tenantId, values, id: caseId, now: '2026-08-27T10:00:00.000Z' });
    assert.deepEqual(created, { id: caseId, accountNumber: 'LN-5001', registration: 'MH 12 AB 1234' });
    assert.equal((await query(pool, 'SELECT pending_amount FROM recovery_cases WHERE id = ?', [caseId]))[0].pending_amount, 84500);
    await assert.rejects(createAccount({ database: pool, tenantId, values: { ...values, registration: 'MH 12 ZZ 9999' } }), /account number/i);
  } finally {
    await pool.end();
  }
});

test('edits only imported accounts that have no approved authority', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantId = await makeTenant(pool);
    const caseId = uid('case');
    await createAccount({ database: pool, tenantId, values, id: caseId });
    await updateAccount({ database: pool, tenantId, caseId, values: { ...values, pendingAmount: '80000', overdueDays: '70' } });
    const row = (await query(pool, 'SELECT pending_amount, overdue_days FROM recovery_cases WHERE id = ?', [caseId]))[0];
    assert.equal(row.pending_amount, 80000);
    assert.equal(row.overdue_days, 70);

    await query(pool, "UPDATE recovery_cases SET authority_approved_at = '2026-08-27' WHERE id = ?", [caseId]);
    await assert.rejects(updateAccount({ database: pool, tenantId, caseId, values }), /authority/i);
  } finally {
    await pool.end();
  }
});
