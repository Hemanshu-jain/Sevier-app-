import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureWorkflowIntegrity, persistCustody, persistReleasePass } from '../server/workflow-persistence.mjs';

function workflowDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE recovery_cases (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL,
      custody_id TEXT,
      release_pass_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE custody_records (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      case_id TEXT NOT NULL UNIQUE,
      yard_name TEXT NOT NULL,
      arrival_time TEXT NOT NULL,
      parking_rate INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      checklist_count INTEGER NOT NULL,
      inspection_json TEXT,
      custom_note TEXT
    );
    CREATE TABLE release_passes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      case_id TEXT NOT NULL UNIQUE,
      issued_by_user_id TEXT,
      verification_code TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      borrower_name TEXT NOT NULL,
      borrower_mobile TEXT NOT NULL,
      vehicle_registration TEXT NOT NULL,
      vehicle_model TEXT NOT NULL,
      custody_id TEXT,
      payment_reference TEXT
    );
    INSERT INTO recovery_cases VALUES ('RC-1', 'tenant-1', 'Assigned', NULL, NULL, 'before');
  `);
  return database;
}

test('custody record rolls back when its case cannot advance', () => {
  const database = workflowDatabase();
  database.exec("CREATE TRIGGER reject_case_update BEFORE UPDATE ON recovery_cases BEGIN SELECT RAISE(ABORT, 'stop'); END;");

  assert.throws(() => persistCustody(database, {
    id: 'CT-1', tenantId: 'tenant-1', caseId: 'RC-1', yardName: 'Central Yard', arrivalTime: '2026-08-29T10:00:00Z',
    parkingRate: 350, createdAt: '2026-08-29T10:05:00Z', agentName: 'Agent One', checklist: 14, inspection: { Battery: 'Present / working' },
  }), /stop/);

  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM custody_records').get().count, 0);
  const recoveryCase = database.prepare('SELECT status, custody_id FROM recovery_cases WHERE id = ?').get('RC-1');
  assert.equal(recoveryCase.status, 'Assigned');
  assert.equal(recoveryCase.custody_id, null);
  database.close();
});

test('case release state rolls back when its immutable pass cannot be recorded', () => {
  const database = workflowDatabase();
  database.prepare('INSERT INTO release_passes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('RP-1', 'tenant-1', 'OTHER', null, 'OLD', 'before', 'Other', '9000000000', 'KA 01 AA 0001', 'Vehicle', null, 'OLD-REF');

  assert.throws(() => persistReleasePass(database, {
    id: 'RP-1', tenantId: 'tenant-1', caseId: 'RC-1', issuedByUserId: 'user-1', verificationCode: 'NEWCODE', issuedAt: '2026-08-29T11:00:00Z',
    borrowerName: 'Borrower', borrowerMobile: '9876543210', vehicleRegistration: 'KA 01 AB 1234', vehicleModel: 'Vehicle', custodyId: 'CT-1', paymentReference: 'PAY-1',
  }), /UNIQUE/);

  const recoveryCase = database.prepare('SELECT status, release_pass_id FROM recovery_cases WHERE id = ?').get('RC-1');
  assert.equal(recoveryCase.status, 'Assigned');
  assert.equal(recoveryCase.release_pass_id, null);
  database.close();
});

test('custody persistence keeps the agent custom note', () => {
  const database = workflowDatabase();
  persistCustody(database, {
    id: 'CT-1', tenantId: 'tenant-1', caseId: 'RC-1', yardName: 'Central Yard', arrivalTime: '2026-08-29T10:00:00Z',
    parkingRate: 350, createdAt: '2026-08-29T10:05:00Z', agentName: 'Agent One', checklist: 14,
    inspection: { Battery: 'Present / working' }, customNote: 'Left mirror scratched.',
  });

  assert.equal(database.prepare('SELECT custom_note FROM custody_records').get().custom_note, 'Left mirror scratched.');
  database.close();
});

test('release passes and audit events reject later edits and deletion', () => {
  const database = workflowDatabase();
  database.exec('CREATE TABLE audit_events (id INTEGER PRIMARY KEY, detail TEXT NOT NULL)');
  ensureWorkflowIntegrity(database);
  database.prepare('INSERT INTO release_passes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('RP-1', 'tenant-1', 'RC-1', null, 'CODE', 'now', 'Borrower', '9000000000', 'KA 01 AB 1234', 'Vehicle', null, 'PAY-1');
  database.prepare('INSERT INTO audit_events VALUES (?, ?)').run(1, 'Recorded');

  assert.throws(() => database.exec("UPDATE release_passes SET verification_code = 'CHANGED'"), /immutable/);
  assert.throws(() => database.exec('DELETE FROM release_passes'), /immutable/);
  assert.throws(() => database.exec("UPDATE audit_events SET detail = 'Changed'"), /immutable/);
  assert.throws(() => database.exec('DELETE FROM audit_events'), /immutable/);
  database.close();
});
