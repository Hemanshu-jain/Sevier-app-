import { randomUUID } from 'node:crypto';
import { normalizeImportRows } from './import-parser.mjs';
import { query, queryOne } from './mysql.mjs';

const headers = ['Account Number', 'Customer Name', 'Mobile Number', 'Address', 'Registration Number', 'Make / Model', 'Vehicle Type', 'Chassis Number', 'Branch', 'Pending Amount', 'Overdue Days'];

function normalize(values) {
  const { valid, errors } = normalizeImportRows([headers, [
    values.accountNumber, values.borrowerName, values.borrowerMobile, values.borrowerAddress,
    values.registration, values.makeModel, values.vehicleType, values.chassis, values.branch,
    values.pendingAmount, values.overdueDays,
  ]]);
  if (!valid.length) throw new Error(errors[0]?.message || 'Check the account details.');
  return valid[0];
}

async function rejectDuplicate(database, tenantId, row, excludeId = '') {
  const account = await queryOne(database, "SELECT id FROM recovery_cases WHERE tenant_id = ? AND account_number = ? AND id <> ? AND status NOT IN ('closed', 'cancelled')", [tenantId, row.accountNumber, excludeId]);
  if (account) throw new Error('An open case already uses this account number.');
  const vehicle = await queryOne(database, "SELECT id FROM recovery_cases WHERE tenant_id = ? AND registration = ? AND id <> ? AND status NOT IN ('closed', 'cancelled')", [tenantId, row.registration, excludeId]);
  if (vehicle) throw new Error('An open case already uses this vehicle registration.');
}

export async function createAccount({ database, tenantId, values, id = `RC-${new Date().toISOString().slice(2, 7).replace('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`, now = new Date().toISOString() }) {
  const row = normalize(values);
  await rejectDuplicate(database, tenantId, row);
  await query(database,
    `INSERT INTO recovery_cases (id, tenant_id, account_number, borrower_name, borrower_mobile, borrower_address, registration, make_model, chassis, vehicle_type, branch, pending_amount, overdue_days, status, updated_at, payment_cleared)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, 0)`,
    [id, tenantId, row.accountNumber, row.borrowerName, row.borrowerMobile, row.borrowerAddress, row.registration, row.makeModel, row.chassis, row.vehicleType, row.branch, row.pendingAmountPaise, row.overdueDays, now]);
  return { id, accountNumber: row.accountNumber, registration: row.registration };
}

export async function updateAccount({ database, tenantId, caseId, values, now = new Date().toISOString() }) {
  const current = await queryOne(database, 'SELECT * FROM recovery_cases WHERE id = ? AND tenant_id = ?', [caseId, tenantId]);
  if (!current) throw new Error('Account not found.');
  if (current.status !== 'imported') throw new Error('Only unassigned imported accounts can be edited.');
  if (current.authority_approved_at) throw new Error('Revoke the approved authority before changing account or vehicle details.');
  const row = normalize(values);
  await rejectDuplicate(database, tenantId, row, caseId);
  await query(database,
    `UPDATE recovery_cases SET account_number = ?, borrower_name = ?, borrower_mobile = ?, borrower_address = ?, registration = ?, make_model = ?, chassis = ?, vehicle_type = ?, branch = ?, pending_amount = ?, overdue_days = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    [row.accountNumber, row.borrowerName, row.borrowerMobile, row.borrowerAddress, row.registration, row.makeModel, row.chassis, row.vehicleType, row.branch, row.pendingAmountPaise, row.overdueDays, now, caseId, tenantId]);
  return { id: caseId, accountNumber: row.accountNumber, registration: row.registration };
}
