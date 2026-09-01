import { randomUUID } from 'node:crypto';
import { runTransaction } from './sqlite-transaction.mjs';

export function ensureMonthlyImportSchema(database) {
  const caseColumns = database.prepare('PRAGMA table_info(recovery_cases)').all().map((column) => column.name);
  if (!caseColumns.includes('current_snapshot_id')) database.exec('ALTER TABLE recovery_cases ADD COLUMN current_snapshot_id TEXT');
  database.exec(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      file_name TEXT NOT NULL,
      file_sha256 TEXT NOT NULL,
      snapshot_month TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      accepted_rows INTEGER NOT NULL,
      rejected_rows INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (tenant_id, file_sha256)
    );
    CREATE TABLE IF NOT EXISTS monthly_account_snapshots (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      case_id TEXT NOT NULL REFERENCES recovery_cases(id),
      import_batch_id TEXT NOT NULL REFERENCES import_batches(id),
      snapshot_month TEXT NOT NULL,
      pending_amount_paise INTEGER NOT NULL CHECK(pending_amount_paise >= 0),
      overdue_days INTEGER NOT NULL CHECK(overdue_days >= 0),
      source_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS monthly_snapshots_case_month ON monthly_account_snapshots(tenant_id, case_id, snapshot_month);
    CREATE TRIGGER IF NOT EXISTS monthly_snapshots_no_update
      BEFORE UPDATE ON monthly_account_snapshots BEGIN SELECT RAISE(ABORT, 'monthly snapshots are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS monthly_snapshots_no_delete
      BEFORE DELETE ON monthly_account_snapshots BEGIN SELECT RAISE(ABORT, 'monthly snapshots are immutable'); END;
  `);
}

export function importMonthlyRows({ database, tenantId, actorUserId, snapshotMonth, fileName, fileSha256, rows, rejectedRows, now = new Date() }) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(snapshotMonth)) throw new Error('Snapshot month must be the first day of a valid month.');
  if (!rows.length) throw new Error('The import contains no valid rows.');
  const duplicate = database.prepare('SELECT * FROM import_batches WHERE tenant_id = ? AND file_sha256 = ?').get(tenantId, fileSha256);
  if (duplicate) return { batchId: duplicate.id, accepted: duplicate.accepted_rows, rejected: duplicate.rejected_rows, created: 0, updated: 0, duplicate: true };

  const batchId = `ib-${randomUUID()}`;
  const createdAt = now.toISOString();
  let created = 0;
  let updated = 0;

  runTransaction(database, () => {
    database.prepare(`INSERT INTO import_batches (id, tenant_id, actor_user_id, file_name, file_sha256, snapshot_month, total_rows, accepted_rows, rejected_rows, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(batchId, tenantId, actorUserId, fileName, fileSha256, snapshotMonth, rows.length + rejectedRows, rows.length, rejectedRows, createdAt);

    for (const row of rows) {
      let recoveryCase = database.prepare(`SELECT * FROM recovery_cases WHERE tenant_id = ? AND account_number = ? AND status NOT IN ('Closed', 'Cancelled') ORDER BY updated_at DESC LIMIT 1`).get(tenantId, row.accountNumber);
      if (recoveryCase) {
        if (recoveryCase.status === 'Imported' && !recoveryCase.authority_approved_at) {
          database.prepare(`UPDATE recovery_cases SET borrower_name = ?, borrower_mobile = ?, borrower_address = ?, registration = ?, make_model = ?, chassis = ?, vehicle_type = ?, branch = ?, pending_amount = ?, overdue_days = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(row.borrowerName, row.borrowerMobile, row.borrowerAddress, row.registration, row.makeModel, row.chassis, row.vehicleType, row.branch, row.pendingAmountPaise / 100, row.overdueDays, createdAt, recoveryCase.id, tenantId);
        } else {
          database.prepare('UPDATE recovery_cases SET pending_amount = ?, overdue_days = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(row.pendingAmountPaise / 100, row.overdueDays, createdAt, recoveryCase.id, tenantId);
        }
        updated += 1;
      } else {
        const caseId = `RC-${snapshotMonth.slice(2, 7).replace('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`;
        database.prepare(`INSERT INTO recovery_cases (id, tenant_id, account_number, borrower_name, borrower_mobile, borrower_address, registration, make_model, chassis, vehicle_type, branch, pending_amount, overdue_days, status, updated_at, payment_cleared)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Imported', ?, 0)`).run(caseId, tenantId, row.accountNumber, row.borrowerName, row.borrowerMobile, row.borrowerAddress, row.registration, row.makeModel, row.chassis, row.vehicleType, row.branch, row.pendingAmountPaise / 100, row.overdueDays, createdAt);
        recoveryCase = { id: caseId };
        created += 1;
      }

      const snapshotId = `snap-${randomUUID()}`;
      database.prepare(`INSERT INTO monthly_account_snapshots (id, tenant_id, case_id, import_batch_id, snapshot_month, pending_amount_paise, overdue_days, source_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(snapshotId, tenantId, recoveryCase.id, batchId, snapshotMonth, row.pendingAmountPaise, row.overdueDays, JSON.stringify(row), createdAt);
      database.prepare('UPDATE recovery_cases SET current_snapshot_id = ? WHERE id = ? AND tenant_id = ?').run(snapshotId, recoveryCase.id, tenantId);
    }
  });

  return { batchId, accepted: rows.length, rejected: rejectedRows, created, updated, duplicate: false };
}
