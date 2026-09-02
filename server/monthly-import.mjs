import { randomUUID } from 'node:crypto';
import { query, queryOne, tx } from './mysql.mjs';

// import_batches and monthly_account_snapshots (with immutable triggers) live in the migration.

export async function importMonthlyRows({ database, tenantId, actorUserId, snapshotMonth, fileName, fileSha256, rows, rejectedRows, now = new Date() }) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(snapshotMonth)) throw new Error('Snapshot month must be the first day of a valid month.');
  if (!rows.length) throw new Error('The import contains no valid rows.');
  const duplicate = await queryOne(database, 'SELECT * FROM import_batches WHERE tenant_id = ? AND file_sha256 = ?', [tenantId, fileSha256]);
  if (duplicate) return { batchId: duplicate.id, accepted: duplicate.accepted_rows, rejected: duplicate.rejected_rows, created: 0, updated: 0, duplicate: true };

  const batchId = `ib-${randomUUID()}`;
  const createdAt = now.toISOString();
  let created = 0;
  let updated = 0;

  await tx(database, async (conn) => {
    await query(conn,
      `INSERT INTO import_batches (id, tenant_id, actor_user_id, file_name, file_sha256, snapshot_month, total_rows, accepted_rows, rejected_rows, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [batchId, tenantId, actorUserId, fileName, fileSha256, snapshotMonth, rows.length + rejectedRows, rows.length, rejectedRows, createdAt]);

    for (const row of rows) {
      let recoveryCase = await queryOne(conn,
        "SELECT * FROM recovery_cases WHERE tenant_id = ? AND account_number = ? AND status NOT IN ('closed', 'cancelled') ORDER BY updated_at DESC LIMIT 1",
        [tenantId, row.accountNumber]);
      if (recoveryCase) {
        if (recoveryCase.status === 'imported' && !recoveryCase.authority_approved_at) {
          await query(conn,
            `UPDATE recovery_cases SET borrower_name = ?, borrower_mobile = ?, borrower_address = ?, registration = ?, make_model = ?, chassis = ?, vehicle_type = ?, branch = ?, pending_amount = ?, overdue_days = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
            [row.borrowerName, row.borrowerMobile, row.borrowerAddress, row.registration, row.makeModel, row.chassis, row.vehicleType, row.branch, row.pendingAmountPaise / 100, row.overdueDays, createdAt, recoveryCase.id, tenantId]);
        } else {
          await query(conn, 'UPDATE recovery_cases SET pending_amount = ?, overdue_days = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
            [row.pendingAmountPaise / 100, row.overdueDays, createdAt, recoveryCase.id, tenantId]);
        }
        updated += 1;
      } else {
        const caseId = `RC-${snapshotMonth.slice(2, 7).replace('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`;
        await query(conn,
          `INSERT INTO recovery_cases (id, tenant_id, account_number, borrower_name, borrower_mobile, borrower_address, registration, make_model, chassis, vehicle_type, branch, pending_amount, overdue_days, status, updated_at, payment_cleared)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, 0)`,
          [caseId, tenantId, row.accountNumber, row.borrowerName, row.borrowerMobile, row.borrowerAddress, row.registration, row.makeModel, row.chassis, row.vehicleType, row.branch, row.pendingAmountPaise / 100, row.overdueDays, createdAt]);
        recoveryCase = { id: caseId };
        created += 1;
      }

      const snapshotId = `snap-${randomUUID()}`;
      await query(conn,
        `INSERT INTO monthly_account_snapshots (id, tenant_id, case_id, import_batch_id, snapshot_month, pending_amount_paise, overdue_days, source_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [snapshotId, tenantId, recoveryCase.id, batchId, snapshotMonth, row.pendingAmountPaise, row.overdueDays, JSON.stringify(row), createdAt]);
      await query(conn, 'UPDATE recovery_cases SET current_snapshot_id = ? WHERE id = ? AND tenant_id = ?', [snapshotId, recoveryCase.id, tenantId]);
    }
  });

  return { batchId, accepted: rows.length, rejected: rejectedRows, created, updated, duplicate: false };
}
