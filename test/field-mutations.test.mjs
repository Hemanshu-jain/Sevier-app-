import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPool, migrate, query } from '../server/mysql.mjs';
import { readFieldMutation, saveFieldMutation, validateIdempotencyKey } from '../server/field-mutations.mjs';

// ponytail: unique tenant per test = natural isolation on the shared dev DB (no teardown,
// and the receipts table is immutable so it can't be cleaned anyway).
const skip = process.env.DATABASE_URL ? false : 'set DATABASE_URL to run MySQL tests';

test('field mutation receipts replay only the same scoped operation', { skip }, async () => {
  const pool = createPool();
  try {
    await migrate(pool);
    const identity = { tenantId: `t-${randomUUID()}`, userId: 'u1', key: `m-${randomUUID().slice(0, 10)}`, caseId: 'RC-1', operation: 'attempt' };
    await saveFieldMutation(pool, { ...identity, statusCode: 200, body: { ok: true } });

    assert.deepEqual(await readFieldMutation(pool, identity), { statusCode: 200, body: { ok: true } });
    await assert.rejects(readFieldMutation(pool, { ...identity, caseId: 'RC-2' }), /another case or operation/i);
    await assert.rejects(readFieldMutation(pool, { ...identity, operation: 'custody' }), /another case or operation/i);
    assert.equal(await readFieldMutation(pool, { ...identity, userId: 'u2' }), null);
  } finally {
    await pool.end();
  }
});

test('field mutation receipts cannot be edited or deleted', { skip }, async () => {
  const pool = createPool();
  try {
    await migrate(pool);
    const tenantId = `t-${randomUUID()}`;
    await saveFieldMutation(pool, { tenantId, userId: 'u1', key: `m-${randomUUID().slice(0, 10)}`, caseId: 'RC-1', operation: 'evidence', statusCode: 201, body: { evidence: [] } });

    await assert.rejects(query(pool, 'UPDATE field_mutation_receipts SET status_code = 500 WHERE tenant_id = ?', [tenantId]), /immutable/i);
    await assert.rejects(query(pool, 'DELETE FROM field_mutation_receipts WHERE tenant_id = ?', [tenantId]), /immutable/i);
  } finally {
    await pool.end();
  }
});

test('idempotency keys are bounded and safe to store', () => {
  assert.equal(validateIdempotencyKey('m-12345678'), null);
  assert.match(validateIdempotencyKey('short'), /idempotency/i);
  assert.match(validateIdempotencyKey('unsafe key'), /idempotency/i);
});
