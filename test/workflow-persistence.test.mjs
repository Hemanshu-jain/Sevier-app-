import test from 'node:test';
import assert from 'node:assert/strict';
import { persistCustody, persistReleasePass } from '../server/workflow-persistence.mjs';
import { query } from '../server/mysql.mjs';
import { migratedPool, makeTenant, makeUser, makeCase, uid, skipWithoutDb } from './mysql-helpers.mjs';

const skip = skipWithoutDb;

test('custody persistence rolls back when the case cannot be updated', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const tenantB = await makeTenant(pool);
    const caseId = await makeCase(pool, { tenantId: tenantA, status: 'assigned' });
    const custodyId = uid('CT');
    // Wrong tenant: custody insert satisfies FKs, but the case UPDATE matches 0 rows → throw → rollback.
    await assert.rejects(persistCustody(pool, {
      id: custodyId, tenantId: tenantB, caseId, yardName: 'Yard', arrivalTime: '2026-08-29T10:00:00Z',
      parkingRate: 350, createdAt: '2026-08-29T10:05:00Z', agentName: 'Agent', checklist: 14, inspection: { Battery: 'Present / working' },
    }), /could not be updated/i);

    assert.equal((await query(pool, 'SELECT COUNT(*) AS c FROM custody_records WHERE id = ?', [custodyId]))[0].c, 0);
    const row = (await query(pool, 'SELECT status, custody_id FROM recovery_cases WHERE id = ?', [caseId]))[0];
    assert.equal(row.status, 'assigned');
    assert.equal(row.custody_id, null);
  } finally {
    await pool.end();
  }
});

test('custody persistence advances the case and keeps the agent custom note', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const caseId = await makeCase(pool, { tenantId: tenantA, status: 'assigned' });
    const custodyId = uid('CT');
    await persistCustody(pool, {
      id: custodyId, tenantId: tenantA, caseId, yardName: 'Yard', arrivalTime: '2026-08-29T10:00:00Z',
      parkingRate: 350, createdAt: '2026-08-29T10:05:00Z', agentName: 'Agent', checklist: 14,
      inspection: { Battery: 'Present / working' }, customNote: 'Left mirror scratched.',
    });
    assert.equal((await query(pool, 'SELECT custom_note FROM custody_records WHERE id = ?', [custodyId]))[0].custom_note, 'Left mirror scratched.');
    assert.equal((await query(pool, 'SELECT status FROM recovery_cases WHERE id = ?', [caseId]))[0].status, 'custody_review');
  } finally {
    await pool.end();
  }
});

test('release pass persistence rolls back the case when the pass cannot be recorded', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const case1 = await makeCase(pool, { tenantId: tenantA, status: 'assigned' });
    const case2 = await makeCase(pool, { tenantId: tenantA, status: 'assigned' });
    const passId = uid('RP');
    await query(pool,
      `INSERT INTO release_passes (id, tenant_id, case_id, verification_code, issued_at, borrower_name, borrower_mobile, vehicle_registration, vehicle_model)
       VALUES (?, ?, ?, 'OLD', '2026-01-01', 'B', '919', 'KA', 'M')`, [passId, tenantA, case2]);

    // Same pass id for a different case: case UPDATE succeeds, pass INSERT hits the PK → rollback.
    await assert.rejects(persistReleasePass(pool, {
      id: passId, tenantId: tenantA, caseId: case1, issuedByUserId: null, verificationCode: 'NEW', issuedAt: '2026-08-29T11:00:00Z',
      borrowerName: 'B', borrowerMobile: '9876543210', vehicleRegistration: 'KA 01 AB 1234', vehicleModel: 'V', custodyId: null, paymentReference: 'PAY',
    }), /duplicate/i);

    const row = (await query(pool, 'SELECT status, release_pass_id FROM recovery_cases WHERE id = ?', [case1]))[0];
    assert.equal(row.status, 'assigned');
    assert.equal(row.release_pass_id, null);
  } finally {
    await pool.end();
  }
});

test('release passes and audit events reject later edits and deletion', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const tenantA = await makeTenant(pool);
    const actor = await makeUser(pool, { tenantId: tenantA, role: 'super_admin' });
    const caseId = await makeCase(pool, { tenantId: tenantA });
    const passId = uid('RP');
    await query(pool,
      `INSERT INTO release_passes (id, tenant_id, case_id, verification_code, issued_at, borrower_name, borrower_mobile, vehicle_registration, vehicle_model)
       VALUES (?, ?, ?, 'CODE', 'now', 'B', '919', 'KA', 'M')`, [passId, tenantA, caseId]);
    await query(pool, "INSERT INTO audit_events (tenant_id, actor_user_id, action, detail, created_at) VALUES (?, ?, 'act', 'detail', 'now')", [tenantA, actor]);

    await assert.rejects(query(pool, "UPDATE release_passes SET verification_code = 'X' WHERE id = ?", [passId]), /immutable/i);
    await assert.rejects(query(pool, 'DELETE FROM release_passes WHERE id = ?', [passId]), /immutable/i);
    await assert.rejects(query(pool, "UPDATE audit_events SET detail = 'X' WHERE tenant_id = ?", [tenantA]), /immutable/i);
    await assert.rejects(query(pool, 'DELETE FROM audit_events WHERE tenant_id = ?', [tenantA]), /immutable/i);
  } finally {
    await pool.end();
  }
});
