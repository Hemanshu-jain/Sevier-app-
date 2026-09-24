import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTopup, platformSettings, requestTopup } from '../server/billing.mjs';
import { importMonthlyRows } from '../server/monthly-import.mjs';
import { createAccount } from '../server/account-management.mjs';
import { query, queryOne } from '../server/mysql.mjs';
import { migratedPool, makeTenant, makeUser, skipWithoutDb, uid } from './mysql-helpers.mjs';

const skip = skipWithoutDb;
const row = (accountNumber) => ({
  accountNumber, borrowerName: 'Meera Iyer', borrowerMobile: '919876543210', borrowerAddress: 'Bengaluru',
  registration: `KA 01 ${accountNumber}`, makeModel: 'Honda Activa', vehicleType: '2-wheeler', chassis: 'ME4ABC', branch: 'HSR',
  pendingAmountPaise: 100000, overdueDays: 30, sourceRow: 2,
});

async function setup(pool, balancePaise) {
  const tenantId = await makeTenant(pool);
  const actorUserId = await makeUser(pool, { tenantId, role: 'super_admin' });
  await pool.query('INSERT INTO wallets (tenant_id, balance_paise, updated_at) VALUES (?, ?, ?)', [tenantId, balancePaise, '2026-09-01T00:00:00.000Z']);
  const price = Number((await platformSettings(pool)).vehicle_row_paise);
  return { tenantId, actorUserId, price };
}

const locked = async (pool, tenantId, accountNumber) => Boolean((await queryOne(pool, 'SELECT billing_locked FROM recovery_cases WHERE tenant_id = ? AND account_number = ?', [tenantId, accountNumber])).billing_locked);
const balance = async (pool, tenantId) => Number((await queryOne(pool, 'SELECT balance_paise FROM wallets WHERE tenant_id = ?', [tenantId])).balance_paise);
const chargeCount = async (pool, tenantId) => Number((await queryOne(pool, 'SELECT COUNT(*) AS n FROM billing_charges WHERE tenant_id = ?', [tenantId])).n);

test('a short wallet imports every row, locks the unpaid ones, and a top-up unlocks them oldest first', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const setupResult = await setup(pool, 0);
    const { tenantId, actorUserId, price } = setupResult;
    await pool.query('UPDATE wallets SET balance_paise = ? WHERE tenant_id = ?', [price * 2, tenantId]);
    const common = { database: pool, tenantId, actorUserId, snapshotMonth: '2026-09-01', rejectedRows: 0 };

    const first = await importMonthlyRows({ ...common, fileName: 'sept.csv', fileSha256: uid('sha'), rows: [row('A1'), row('A2'), row('A3')] });
    assert.deepEqual({ created: first.created, paid: first.billing.paid, pending: first.billing.pending }, { created: 3, paid: 2, pending: 1 });
    assert.deepEqual([await locked(pool, tenantId, 'A1'), await locked(pool, tenantId, 'A2'), await locked(pool, tenantId, 'A3')], [false, false, true]);
    assert.equal(await balance(pool, tenantId), 0, 'balance never goes negative');

    // Same file again: no new rows, no new charges.
    const duplicateSha = (await queryOne(pool, 'SELECT file_sha256 FROM import_batches WHERE id = ?', [first.batchId])).file_sha256;
    const duplicate = await importMonthlyRows({ ...common, fileName: 'sept.csv', fileSha256: duplicateSha, rows: [row('A1')] });
    assert.equal(duplicate.duplicate, true);
    assert.equal(await chargeCount(pool, tenantId), 3);

    // A corrected file re-bills A1; it queues behind A3 (strict FIFO) and locks the still-unassigned case.
    const reimport = await importMonthlyRows({ ...common, fileName: 'sept-v2.csv', fileSha256: uid('sha'), rows: [row('A1')] });
    assert.deepEqual({ updated: reimport.updated, pending: reimport.billing.pending }, { updated: 1, pending: 1 });
    assert.equal(await locked(pool, tenantId, 'A1'), true);

    // Rejecting a top-up changes nothing; confirming one settles both pending charges in order and unlocks.
    const rejected = await requestTopup({ database: pool, tenantId, userId: actorUserId, amountPaise: 200000, reference: 'UTR-REJECT-1' });
    await decideTopup({ database: pool, topupId: rejected.id, adminUserId: actorUserId, approve: false });
    assert.equal(await balance(pool, tenantId), 0);
    await assert.rejects(decideTopup({ database: pool, topupId: rejected.id, adminUserId: actorUserId, approve: true }), /already decided/);

    const topup = await requestTopup({ database: pool, tenantId, userId: actorUserId, amountPaise: 200000, reference: 'UTR-CONFIRM-1' });
    const decision = await decideTopup({ database: pool, topupId: topup.id, adminUserId: actorUserId, approve: true });
    assert.equal(decision.settled, 2);
    assert.deepEqual([await locked(pool, tenantId, 'A1'), await locked(pool, tenantId, 'A3')], [false, false]);
    assert.equal(await balance(pool, tenantId), 200000 - price * 2);

    const ledger = await queryOne(pool, 'SELECT SUM(amount_paise) AS total FROM wallet_transactions WHERE tenant_id = ?', [tenantId]);
    assert.equal(Number(ledger.total) + price * 2, await balance(pool, tenantId), 'ledger reconciles with the seeded opening balance');
    const settledOrder = await query(pool, "SELECT item_id FROM billing_charges WHERE tenant_id = ? AND paid_at IS NOT NULL ORDER BY paid_at, id", [tenantId]);
    assert.equal(settledOrder.length, 4);
  } finally {
    await pool.end();
  }
});

test('a manual account on an empty wallet is created locked; recharges only accept the fixed amounts', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { tenantId, actorUserId } = await setup(pool, 0);
    const account = await createAccount({ database: pool, tenantId, values: { accountNumber: 'M1', borrowerName: 'Arjun Nair', borrowerMobile: '9876543210', borrowerAddress: 'Mysuru', registration: 'KA 09 M 1', makeModel: 'Nexon', vehicleType: '4-wheeler', pendingAmount: '5000', overdueDays: '40' } });
    assert.equal(account.billing.pending, 1);
    assert.equal(await locked(pool, tenantId, 'M1'), true);
    await assert.rejects(requestTopup({ database: pool, tenantId, userId: actorUserId, amountPaise: 300000, reference: 'UTR-1234' }), /₹2,000, ₹5,000 or ₹10,000/);
    await assert.rejects(requestTopup({ database: pool, tenantId, userId: actorUserId, amountPaise: 200000, reference: 'x' }), /payment reference/);
  } finally {
    await pool.end();
  }
});
