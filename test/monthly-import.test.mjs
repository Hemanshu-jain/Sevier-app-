import test from 'node:test';
import assert from 'node:assert/strict';
import { importMonthlyRows } from '../server/monthly-import.mjs';
import { query } from '../server/mysql.mjs';
import { migratedPool, makeTenant, makeUser, skipWithoutDb } from './mysql-helpers.mjs';

const skip = skipWithoutDb;
const baseRow = {
  accountNumber: 'LN-1001', borrowerName: 'Meera Iyer', borrowerMobile: '919876543210', borrowerAddress: 'Bengaluru',
  registration: 'KA 01 MQ 4281', makeModel: 'Honda Activa', vehicleType: '2-wheeler', chassis: 'ME4ABC', branch: 'HSR',
  pendingAmountPaise: 100000, overdueDays: 30, sourceRow: 2,
};

async function setup(pool) {
  const tenantId = await makeTenant(pool);
  const actorUserId = await makeUser(pool, { tenantId, role: 'super_admin' });
  return { tenantId, actorUserId };
}

test('re-import updates the open case while preserving both monthly snapshots', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { tenantId, actorUserId } = await setup(pool);
    const common = { database: pool, tenantId, actorUserId, snapshotMonth: '2026-08-01', rejectedRows: 0, now: new Date('2026-08-27T10:00:00Z') };
    const first = await importMonthlyRows({ ...common, fileName: 'august.csv', fileSha256: 'hash-1', rows: [baseRow] });
    const second = await importMonthlyRows({ ...common, fileName: 'august-corrected.csv', fileSha256: 'hash-2', rows: [{ ...baseRow, pendingAmountPaise: 225050, overdueDays: 35 }] });

    assert.deepEqual({ accepted: first.accepted, created: first.created, updated: first.updated, duplicate: first.duplicate }, { accepted: 1, created: 1, updated: 0, duplicate: false });
    assert.deepEqual({ accepted: second.accepted, created: second.created, updated: second.updated, duplicate: second.duplicate }, { accepted: 1, created: 0, updated: 1, duplicate: false });
    assert.equal((await query(pool, 'SELECT pending_amount FROM recovery_cases WHERE tenant_id = ? AND account_number = ?', [tenantId, 'LN-1001']))[0].pending_amount, 2250.5);
    const snaps = (await query(pool, 'SELECT pending_amount_paise FROM monthly_account_snapshots WHERE tenant_id = ? ORDER BY created_at, id', [tenantId])).map((r) => r.pending_amount_paise).sort((a, b) => a - b);
    assert.deepEqual(snaps, [100000, 225050]);
  } finally {
    await pool.end();
  }
});

test('duplicate source files are idempotent', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { tenantId, actorUserId } = await setup(pool);
    const values = { database: pool, tenantId, actorUserId, snapshotMonth: '2026-08-01', fileName: 'august.csv', fileSha256: `dup-${tenantId}`, rows: [baseRow], rejectedRows: 0 };
    await importMonthlyRows(values);
    const duplicate = await importMonthlyRows(values);
    assert.equal(duplicate.duplicate, true);
    assert.equal((await query(pool, 'SELECT COUNT(*) AS c FROM monthly_account_snapshots WHERE tenant_id = ?', [tenantId]))[0].c, 1);
  } finally {
    await pool.end();
  }
});

test('re-import keeps approved borrower and vehicle identity immutable', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { tenantId, actorUserId } = await setup(pool);
    const common = { database: pool, tenantId, actorUserId, rejectedRows: 0 };
    await importMonthlyRows({ ...common, snapshotMonth: '2026-08-01', fileName: 'august.csv', fileSha256: `h1-${tenantId}`, rows: [baseRow] });
    await query(pool, "UPDATE recovery_cases SET status = 'assigned', authority_approved_at = '2026-08-28T10:00:00Z' WHERE tenant_id = ?", [tenantId]);

    await importMonthlyRows({ ...common, snapshotMonth: '2026-09-01', fileName: 'september.csv', fileSha256: `h2-${tenantId}`, rows: [{ ...baseRow, borrowerName: 'Changed Name', registration: 'KA 99 ZZ 9999', pendingAmountPaise: 150000, overdueDays: 60 }] });

    const row = (await query(pool, 'SELECT borrower_name, registration, pending_amount, overdue_days FROM recovery_cases WHERE tenant_id = ?', [tenantId]))[0];
    assert.equal(row.borrower_name, 'Meera Iyer');
    assert.equal(row.registration, 'KA 01 MQ 4281');
    assert.equal(row.pending_amount, 1500);
    assert.equal(row.overdue_days, 60);
  } finally {
    await pool.end();
  }
});

test('monthly snapshots reject updates and deletes', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { tenantId, actorUserId } = await setup(pool);
    await importMonthlyRows({ database: pool, tenantId, actorUserId, snapshotMonth: '2026-08-01', fileName: 'august.csv', fileSha256: `im-${tenantId}`, rows: [baseRow], rejectedRows: 0 });
    await assert.rejects(query(pool, 'UPDATE monthly_account_snapshots SET overdue_days = 1 WHERE tenant_id = ?', [tenantId]), /immutable/i);
    await assert.rejects(query(pool, 'DELETE FROM monthly_account_snapshots WHERE tenant_id = ?', [tenantId]), /immutable/i);
  } finally {
    await pool.end();
  }
});
