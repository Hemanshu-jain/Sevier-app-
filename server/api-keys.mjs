import { randomUUID } from 'node:crypto';
import { query, queryOne } from './mysql.mjs';
import { createSessionToken, hashSessionToken } from './session-token.mjs';

// Keys reuse the session-token scheme (random bytes, only the sha256 stored); the "hk_" prefix
// keeps them distinguishable from user sessions in logs and in the auth middleware.
export const API_KEY_PREFIX = 'hk_';

export async function createApiKey({ database, tenantId, userId, name, now = new Date().toISOString() }) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2 || cleanName.length > 100) throw new Error('Name the key after the system that will use it (2 to 100 characters).');
  const key = `${API_KEY_PREFIX}${createSessionToken().token}`;
  const id = `key-${randomUUID()}`;
  await query(database, 'INSERT INTO api_keys (id, tenant_id, name, key_prefix, key_hash, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, tenantId, cleanName, key.slice(0, 10), hashSessionToken(key), userId, now]);
  return { id, name: cleanName, key, keyPrefix: key.slice(0, 10), createdAt: now };
}

export async function listApiKeys(database, tenantId) {
  const rows = await query(database, 'SELECT api_keys.*, users.name AS created_by_name FROM api_keys JOIN users ON users.id = api_keys.created_by_user_id WHERE api_keys.tenant_id = ? ORDER BY api_keys.created_at DESC', [tenantId]);
  return rows.map((row) => ({ id: row.id, name: row.name, keyPrefix: row.key_prefix, createdBy: row.created_by_name, createdAt: row.created_at, lastUsedAt: row.last_used_at ?? undefined, revokedAt: row.revoked_at ?? undefined }));
}

export async function revokeApiKey({ database, tenantId, keyId, now = new Date().toISOString() }) {
  const result = await query(database, 'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL', [now, keyId, tenantId]);
  if (result.affectedRows !== 1) throw new Error('API key not found or already revoked.');
}

// Returns the active key row for a presented bearer value, or null.
export async function findActiveApiKey(database, presented) {
  if (!String(presented || '').startsWith(API_KEY_PREFIX)) return null;
  return queryOne(database, 'SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL', [hashSessionToken(presented)]);
}
