export function ensureFieldMutationSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS field_mutation_receipts (
      tenant_id TEXT NOT NULL,
      agent_user_id TEXT NOT NULL,
      client_mutation_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('evidence', 'attempt', 'custody')),
      status_code INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, agent_user_id, client_mutation_id)
    );
    CREATE TRIGGER IF NOT EXISTS field_mutation_receipts_no_update
      BEFORE UPDATE ON field_mutation_receipts BEGIN SELECT RAISE(ABORT, 'field mutation receipts are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS field_mutation_receipts_no_delete
      BEFORE DELETE ON field_mutation_receipts BEGIN SELECT RAISE(ABORT, 'field mutation receipts are immutable'); END;
  `);
}

export function validateIdempotencyKey(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(String(value || '').trim())
    ? null
    : 'Send a valid Idempotency-Key between 8 and 128 safe characters.';
}

export function readFieldMutation(database, identity) {
  const row = database.prepare(`SELECT case_id, operation, status_code, response_json
    FROM field_mutation_receipts WHERE tenant_id = ? AND agent_user_id = ? AND client_mutation_id = ?`)
    .get(identity.tenantId, identity.userId, identity.key);
  if (!row) return null;
  if (row.case_id !== identity.caseId || row.operation !== identity.operation) {
    throw new Error('This idempotency key was already used for another case or operation.');
  }
  return { statusCode: row.status_code, body: JSON.parse(row.response_json) };
}

export function saveFieldMutation(database, receipt) {
  database.prepare(`INSERT INTO field_mutation_receipts
    (tenant_id, agent_user_id, client_mutation_id, case_id, operation, status_code, response_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(receipt.tenantId, receipt.userId, receipt.key, receipt.caseId, receipt.operation, receipt.statusCode, JSON.stringify(receipt.body), receipt.createdAt ?? new Date().toISOString());
}
