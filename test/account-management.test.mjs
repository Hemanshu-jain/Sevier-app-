import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAccount, updateAccount } from '../server/account-management.mjs';

const values = {
  accountNumber: 'LN-5001', borrowerName: 'Anita Rao', borrowerMobile: '9876543210', borrowerAddress: 'Pune',
  registration: 'mh 12 ab 1234', makeModel: 'Tata Nexon', vehicleType: '4W', chassis: 'MAT123', branch: 'Pune',
  pendingAmount: '84500', overdueDays: '62',
};

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE recovery_cases (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, account_number TEXT NOT NULL, borrower_name TEXT NOT NULL,
    borrower_mobile TEXT NOT NULL, borrower_address TEXT NOT NULL, registration TEXT NOT NULL, make_model TEXT NOT NULL,
    chassis TEXT NOT NULL, vehicle_type TEXT NOT NULL, branch TEXT NOT NULL, pending_amount REAL NOT NULL,
    overdue_days INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, payment_cleared INTEGER NOT NULL,
    authority_approved_at TEXT
  )`);
  return db;
}

test('creates a validated manual account and rejects open duplicates', () => {
  const db = database();
  const created = createAccount({ database: db, tenantId: 'tenant-a', values, id: 'case-1', now: '2026-08-27T10:00:00.000Z' });
  assert.deepEqual(created, { id: 'case-1', accountNumber: 'LN-5001', registration: 'MH 12 AB 1234' });
  assert.equal(db.prepare("SELECT pending_amount FROM recovery_cases WHERE id = 'case-1'").get().pending_amount, 84500);
  assert.throws(() => createAccount({ database: db, tenantId: 'tenant-a', values: { ...values, registration: 'MH 12 ZZ 9999' } }), /account number/i);
});

test('edits only imported accounts that have no approved authority', () => {
  const db = database();
  createAccount({ database: db, tenantId: 'tenant-a', values, id: 'case-1' });
  updateAccount({ database: db, tenantId: 'tenant-a', caseId: 'case-1', values: { ...values, pendingAmount: '80000', overdueDays: '70' } });
  assert.deepEqual({ ...db.prepare("SELECT pending_amount, overdue_days FROM recovery_cases WHERE id = 'case-1'").get() }, { pending_amount: 80000, overdue_days: 70 });

  db.prepare("UPDATE recovery_cases SET authority_approved_at = '2026-08-27' WHERE id = 'case-1'").run();
  assert.throws(() => updateAccount({ database: db, tenantId: 'tenant-a', caseId: 'case-1', values }), /authority/i);
});
