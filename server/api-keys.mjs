import { randomUUID } from 'node:crypto';
import { query, queryOne, tx } from './mysql.mjs';
import { chargeItems, platformSettings } from './billing.mjs';
import { createSessionToken, hashSessionToken } from './session-token.mjs';

// Keys reuse the session-token scheme (random bytes, only the sha256 stored); the "hk_" prefix
// keeps them distinguishable from user sessions in logs and in the auth middleware.
export const API_KEY_PREFIX = 'hk_';

export async function createApiKey({ database, tenantId, userId, name, now = new Date().toISOString() }) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2 || cleanName.length > 100) throw new Error('Name the key after the system that will use it (2 to 100 characters).');
  // ponytail: count-then-insert, so two simultaneous creates could exceed the limit by one; lock the tenant row if that matters.
  const { limit, active } = await keyUsage(database, tenantId);
  if (active >= limit) throw new Error(`Your account includes ${limit} API key${limit === 1 ? '' : 's'}. Request another key from Handoff to add more.`);
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

async function keyUsage(database, tenantId) {
  const tenant = await queryOne(database, 'SELECT api_key_limit FROM tenants WHERE id = ?', [tenantId]);
  const active = await queryOne(database, 'SELECT COUNT(*) AS n FROM api_keys WHERE tenant_id = ? AND revoked_at IS NULL', [tenantId]);
  return { limit: Number(tenant?.api_key_limit ?? 1), active: Number(active.n) };
}

// What the Settings card needs: how many keys are allowed/used, the extra-key fee, and any request in flight.
export async function apiKeyAllowance(database, tenantId) {
  const usage = await keyUsage(database, tenantId);
  const settings = await platformSettings(database);
  const latest = await queryOne(database, 'SELECT * FROM api_key_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1', [tenantId]);
  return { ...usage, extraKeyFeePaise: Number(settings.api_key_fee_paise), latestRequest: latest ? mapKeyRequest(latest) : null };
}

export function mapKeyRequest(row) {
  return { id: row.id, tenantId: row.tenant_id, tenantName: row.tenant_name ?? undefined, reason: row.reason, status: row.status, feePaise: row.fee_paise === null ? undefined : Number(row.fee_paise), requestedBy: row.requested_by_name ?? undefined, createdAt: row.created_at, decidedAt: row.decided_at ?? undefined };
}

export async function requestExtraApiKey({ database, tenantId, userId, reason, now = new Date().toISOString() }) {
  const text = String(reason || '').trim();
  if (text.length < 5 || text.length > 500) throw new Error('Tell Handoff what the extra key is for (5 to 500 characters).');
  if (await queryOne(database, "SELECT 1 FROM api_key_requests WHERE tenant_id = ? AND status = 'pending'", [tenantId])) throw new Error('A request for another key is already waiting for approval.');
  const id = `kr-${randomUUID()}`;
  await query(database, "INSERT INTO api_key_requests (id, tenant_id, reason, status, requested_by_user_id, created_at) VALUES (?, ?, ?, 'pending', ?, ?)", [id, tenantId, text, userId, now]);
  return { id, status: 'pending', reason: text, createdAt: now };
}

// Approval charges the fee from the wallet and raises the company's key limit by one, atomically.
export async function decideApiKeyRequest({ database, requestId, adminUserId, approve, now = new Date().toISOString() }) {
  return tx(database, async (conn) => {
    const request = await queryOne(conn, 'SELECT * FROM api_key_requests WHERE id = ? FOR UPDATE', [requestId]);
    if (!request) throw new Error('API key request not found.');
    if (request.status !== 'pending') throw new Error('This request was already decided.');
    if (!approve) {
      await query(conn, "UPDATE api_key_requests SET status = 'rejected', decided_by_user_id = ?, decided_at = ? WHERE id = ?", [adminUserId, now, requestId]);
      return { tenantId: request.tenant_id, status: 'rejected' };
    }
    const fee = Number((await platformSettings(conn)).api_key_fee_paise);
    const wallet = await queryOne(conn, 'SELECT balance_paise FROM wallets WHERE tenant_id = ? FOR UPDATE', [request.tenant_id]);
    const owing = await queryOne(conn, "SELECT 1 FROM billing_charges WHERE tenant_id = ? AND status = 'pending' LIMIT 1", [request.tenant_id]);
    if (owing || Number(wallet?.balance_paise ?? 0) < fee) throw new Error(`The company's wallet needs at least ₹${(fee / 100).toLocaleString('en-IN')} and no unpaid charges before this key can be approved.`);
    await chargeItems(conn, { tenantId: request.tenant_id, items: [{ itemType: 'api_key', itemId: request.id, lockable: false }], now });
    await query(conn, 'UPDATE tenants SET api_key_limit = api_key_limit + 1 WHERE id = ?', [request.tenant_id]);
    await query(conn, "UPDATE api_key_requests SET status = 'approved', fee_paise = ?, decided_by_user_id = ?, decided_at = ? WHERE id = ?", [fee, adminUserId, now, requestId]);
    return { tenantId: request.tenant_id, status: 'approved', feePaise: fee };
  });
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
