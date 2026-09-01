import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  ensureFieldMutationSchema,
  readFieldMutation,
  saveFieldMutation,
  validateIdempotencyKey,
} from '../server/field-mutations.mjs';

test('field mutation receipts replay only the same scoped operation', () => {
  const database = new DatabaseSync(':memory:');
  ensureFieldMutationSchema(database);
  const identity = { tenantId: 't1', userId: 'u1', key: 'm-12345678', caseId: 'RC-1', operation: 'attempt' };

  saveFieldMutation(database, { ...identity, statusCode: 200, body: { ok: true } });

  assert.deepEqual(readFieldMutation(database, identity), { statusCode: 200, body: { ok: true } });
  assert.throws(() => readFieldMutation(database, { ...identity, caseId: 'RC-2' }), /another case or operation/i);
  assert.throws(() => readFieldMutation(database, { ...identity, operation: 'custody' }), /another case or operation/i);
  assert.equal(readFieldMutation(database, { ...identity, userId: 'u2' }), null);
  database.close();
});

test('field mutation receipts cannot be edited or deleted', () => {
  const database = new DatabaseSync(':memory:');
  ensureFieldMutationSchema(database);
  saveFieldMutation(database, {
    tenantId: 't1', userId: 'u1', key: 'm-12345678', caseId: 'RC-1', operation: 'evidence', statusCode: 201, body: { evidence: [] },
  });

  assert.throws(() => database.exec("UPDATE field_mutation_receipts SET status_code = 500"), /immutable/i);
  assert.throws(() => database.exec('DELETE FROM field_mutation_receipts'), /immutable/i);
  database.close();
});

test('idempotency keys are bounded and safe to store', () => {
  assert.equal(validateIdempotencyKey('m-12345678'), null);
  assert.match(validateIdempotencyKey('short'), /idempotency/i);
  assert.match(validateIdempotencyKey('unsafe key'), /idempotency/i);
});
