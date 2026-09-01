import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureMonthlyImportSchema, importMonthlyRows } from '../server/monthly-import.mjs';

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('user-1');
    CREATE TABLE recovery_cases (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, account_number TEXT NOT NULL,
      borrower_name TEXT NOT NULL, borrower_mobile TEXT NOT NULL, borrower_address TEXT NOT NULL,
      registration TEXT NOT NULL, make_model TEXT NOT NULL, chassis TEXT NOT NULL,
      vehicle_type TEXT NOT NULL, branch TEXT NOT NULL, pending_amount NUMERIC NOT NULL,
      overdue_days INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL,
      authority_approved_at TEXT,
      payment_cleared INTEGER NOT NULL DEFAULT 0,
      UNIQUE (tenant_id, account_number)
    );
  `);
  ensureMonthlyImportSchema(database);
  return database;
}

const row = {
  accountNumber: 'LN-1001', borrowerName: 'Meera Iyer', borrowerMobile: '919876543210', borrowerAddress: 'Bengaluru',
  registration: 'KA 01 MQ 4281', makeModel: 'Honda Activa', vehicleType: '2-wheeler', chassis: 'ME4ABC', branch: 'HSR',
  pendingAmountPaise: 100000, overdueDays: 30, sourceRow: 2,
};

test('re-import updates the open case while preserving both monthly snapshots', () => {
  const database = createDatabase();
  const common = { database, tenantId: 'tenant-1', actorUserId: 'user-1', snapshotMonth: '2026-08-01', rejectedRows: 0, now: new Date('2026-08-27T10:00:00Z') };

  const first = importMonthlyRows({ ...common, fileName: 'august.csv', fileSha256: 'hash-1', rows: [row] });
  const second = importMonthlyRows({ ...common, fileName: 'august-corrected.csv', fileSha256: 'hash-2', rows: [{ ...row, pendingAmountPaise: 225050, overdueDays: 35 }] });

  assert.deepEqual({ accepted: first.accepted, created: first.created, updated: first.updated, duplicate: first.duplicate }, { accepted: 1, created: 1, updated: 0, duplicate: false });
  assert.deepEqual({ accepted: second.accepted, created: second.created, updated: second.updated, duplicate: second.duplicate }, { accepted: 1, created: 0, updated: 1, duplicate: false });
  assert.equal(database.prepare('SELECT pending_amount FROM recovery_cases WHERE account_number = ?').get('LN-1001').pending_amount, 2250.5);
  assert.deepEqual(database.prepare('SELECT pending_amount_paise FROM monthly_account_snapshots ORDER BY created_at, id').all().map((item) => item.pending_amount_paise).sort((a, b) => a - b), [100000, 225050]);
  database.close();
});

test('duplicate source files are idempotent', () => {
  const database = createDatabase();
  const values = { database, tenantId: 'tenant-1', actorUserId: 'user-1', snapshotMonth: '2026-08-01', fileName: 'august.csv', fileSha256: 'same-hash', rows: [row], rejectedRows: 0 };

  importMonthlyRows(values);
  const duplicate = importMonthlyRows(values);

  assert.equal(duplicate.duplicate, true);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM monthly_account_snapshots').get().count, 1);
  database.close();
});

test('re-import keeps approved borrower and vehicle identity immutable', () => {
  const database = createDatabase();
  const common = { database, tenantId: 'tenant-1', actorUserId: 'user-1', rejectedRows: 0 };
  importMonthlyRows({ ...common, snapshotMonth: '2026-08-01', fileName: 'august.csv', fileSha256: 'hash-1', rows: [row] });
  database.exec("UPDATE recovery_cases SET status = 'Assigned', authority_approved_at = '2026-08-28T10:00:00Z'");

  importMonthlyRows({
    ...common,
    snapshotMonth: '2026-09-01',
    fileName: 'september.csv',
    fileSha256: 'hash-2',
    rows: [{ ...row, borrowerName: 'Changed Name', registration: 'KA 99 ZZ 9999', pendingAmountPaise: 150000, overdueDays: 60 }],
  });

  const recoveryCase = database.prepare('SELECT borrower_name, registration, pending_amount, overdue_days FROM recovery_cases').get();
  assert.equal(recoveryCase.borrower_name, 'Meera Iyer');
  assert.equal(recoveryCase.registration, 'KA 01 MQ 4281');
  assert.equal(recoveryCase.pending_amount, 1500);
  assert.equal(recoveryCase.overdue_days, 60);
  database.close();
});

test('monthly snapshots reject updates and deletes', () => {
  const database = createDatabase();
  importMonthlyRows({ database, tenantId: 'tenant-1', actorUserId: 'user-1', snapshotMonth: '2026-08-01', fileName: 'august.csv', fileSha256: 'hash-1', rows: [row], rejectedRows: 0 });

  assert.throws(() => database.exec('UPDATE monthly_account_snapshots SET overdue_days = 1'), /immutable/);
  assert.throws(() => database.exec('DELETE FROM monthly_account_snapshots'), /immutable/);
  database.close();
});
