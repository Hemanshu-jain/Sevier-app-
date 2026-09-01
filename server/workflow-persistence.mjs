import { runTransaction } from './sqlite-transaction.mjs';

export function ensureWorkflowIntegrity(database) {
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS release_passes_no_update
      BEFORE UPDATE ON release_passes BEGIN SELECT RAISE(ABORT, 'release_passes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS release_passes_no_delete
      BEFORE DELETE ON release_passes BEGIN SELECT RAISE(ABORT, 'release_passes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_no_update
      BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
      BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events are immutable'); END;
  `);
}

export function persistCustody(database, record) {
  return runTransaction(database, () => {
    database.prepare('INSERT INTO custody_records (id, tenant_id, case_id, yard_name, arrival_time, parking_rate, created_at, agent_name, checklist_count, inspection_json, custom_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(record.id, record.tenantId, record.caseId, record.yardName, record.arrivalTime, record.parkingRate, record.createdAt, record.agentName, record.checklist, JSON.stringify(record.inspection), record.customNote || null);
    const result = database.prepare("UPDATE recovery_cases SET status = 'Custody review', custody_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(record.id, record.createdAt, record.caseId, record.tenantId);
    if (result.changes !== 1) throw new Error('The assigned recovery case could not be updated.');
  });
}

export function persistReleasePass(database, record) {
  return runTransaction(database, () => {
    const result = database.prepare("UPDATE recovery_cases SET status = 'Release pass printed', release_pass_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(record.id, record.issuedAt, record.caseId, record.tenantId);
    if (result.changes !== 1) throw new Error('The recovery case could not be updated for release.');
    database.prepare('INSERT INTO release_passes (id, tenant_id, case_id, issued_by_user_id, verification_code, issued_at, borrower_name, borrower_mobile, vehicle_registration, vehicle_model, custody_id, payment_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(record.id, record.tenantId, record.caseId, record.issuedByUserId, record.verificationCode, record.issuedAt, record.borrowerName, record.borrowerMobile, record.vehicleRegistration, record.vehicleModel, record.custodyId, record.paymentReference);
  });
}
