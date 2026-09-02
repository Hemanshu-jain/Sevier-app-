import { query, queryOne } from './mysql.mjs';

// The field_mutation_receipts table (and its immutable triggers) live in the migration.

export function validateIdempotencyKey(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(String(value || '').trim())
    ? null
    : 'Send a valid Idempotency-Key between 8 and 128 safe characters.';
}

export async function readFieldMutation(executor, identity) {
  const row = await queryOne(executor,
    `SELECT case_id, operation, status_code, response_json
       FROM field_mutation_receipts
      WHERE tenant_id = ? AND agent_user_id = ? AND client_mutation_id = ?`,
    [identity.tenantId, identity.userId, identity.key]);
  if (!row) return null;
  if (row.case_id !== identity.caseId || row.operation !== identity.operation) {
    throw new Error('This idempotency key was already used for another case or operation.');
  }
  // mysql2 returns JSON columns already parsed.
  const body = typeof row.response_json === 'string' ? JSON.parse(row.response_json) : row.response_json;
  return { statusCode: row.status_code, body };
}

export async function saveFieldMutation(executor, receipt) {
  await query(executor,
    `INSERT INTO field_mutation_receipts
       (tenant_id, agent_user_id, client_mutation_id, case_id, operation, status_code, response_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [receipt.tenantId, receipt.userId, receipt.key, receipt.caseId, receipt.operation,
     receipt.statusCode, JSON.stringify(receipt.body), receipt.createdAt ?? new Date().toISOString()]);
}
