import { query, tx } from './mysql.mjs';

// The immutable triggers (release_passes, audit_events) live in the migration.
// ponytail: mysql2 enables CLIENT_FOUND_ROWS by default, so affectedRows counts
// matched rows (like SQLite's changes) — a missing case yields 0 and we throw.

export async function persistCustody(pool, record) {
  return tx(pool, async (conn) => {
    await query(conn,
      `INSERT INTO custody_records (id, tenant_id, case_id, yard_name, arrival_time, parking_rate, created_at, agent_name, checklist_count, inspection_json, custom_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.tenantId, record.caseId, record.yardName, record.arrivalTime, record.parkingRate,
       record.createdAt, record.agentName, record.checklist, JSON.stringify(record.inspection), record.customNote || null]);
    const result = await query(conn,
      "UPDATE recovery_cases SET status = 'custody_review', custody_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
      [record.id, record.createdAt, record.caseId, record.tenantId]);
    if (result.affectedRows !== 1) throw new Error('The assigned recovery case could not be updated.');
  });
}

export async function persistReleasePass(pool, record) {
  return tx(pool, async (conn) => {
    const result = await query(conn,
      "UPDATE recovery_cases SET status = 'release_pass_printed', release_pass_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
      [record.id, record.issuedAt, record.caseId, record.tenantId]);
    if (result.affectedRows !== 1) throw new Error('The recovery case could not be updated for release.');
    await query(conn,
      `INSERT INTO release_passes (id, tenant_id, case_id, issued_by_user_id, verification_code, issued_at, borrower_name, borrower_mobile, vehicle_registration, vehicle_model, custody_id, payment_reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.tenantId, record.caseId, record.issuedByUserId, record.verificationCode, record.issuedAt,
       record.borrowerName, record.borrowerMobile, record.vehicleRegistration, record.vehicleModel, record.custodyId, record.paymentReference]);
  });
}
