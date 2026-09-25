import test from 'node:test';
import assert from 'node:assert/strict';
import { apiKeyAllowance, createApiKey, decideApiKeyRequest, findActiveApiKey, listApiKeys, requestExtraApiKey, revokeApiKey } from '../server/api-keys.mjs';
import { platformSettings } from '../server/billing.mjs';
import { normalizeAccountRows } from '../server/account-management.mjs';
import { queryOne } from '../server/mysql.mjs';
import { migratedPool, makeTenant, makeUser, skipWithoutDb } from './mysql-helpers.mjs';

test('an API key is shown once, stored only as a hash, and stops working when revoked', { skip: skipWithoutDb }, async () => {
  const pool = await migratedPool();
  try {
    const tenantId = await makeTenant(pool);
    const userId = await makeUser(pool, { tenantId, role: 'super_admin' });
    const created = await createApiKey({ database: pool, tenantId, userId, name: 'Loan system' });
    assert.match(created.key, /^hk_/);

    const stored = await queryOne(pool, 'SELECT * FROM api_keys WHERE id = ?', [created.id]);
    assert.notEqual(stored.key_hash, created.key, 'the raw key is never stored');
    assert.equal((await findActiveApiKey(pool, created.key)).tenant_id, tenantId);
    assert.equal(await findActiveApiKey(pool, 'hk_not-a-real-key'), null);
    assert.equal(await findActiveApiKey(pool, 'plain-session-token'), null, 'session tokens are not API keys');
    assert.equal((await listApiKeys(pool, tenantId))[0].keyPrefix, created.key.slice(0, 10));

    await revokeApiKey({ database: pool, tenantId, keyId: created.id });
    assert.equal(await findActiveApiKey(pool, created.key), null);
    await assert.rejects(revokeApiKey({ database: pool, tenantId, keyId: created.id }), /already revoked/);
    await assert.rejects(createApiKey({ database: pool, tenantId, userId, name: 'x' }), /Name the key/);
  } finally {
    await pool.end();
  }
});

test('API rows use the import validation and report errors per row', () => {
  const good = { accountNumber: 'LN-1', borrowerName: 'Anita', borrowerMobile: 9876543210, borrowerAddress: 'Pune', registration: 'mh12ab1234', makeModel: 'Nexon', vehicleType: '4W', pendingAmount: 84500, overdueDays: 62 };
  const { valid, errors } = normalizeAccountRows([good, { ...good, borrowerMobile: '12' }]);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].pendingAmountPaise, 8450000, 'numbers are accepted, not only strings');
  assert.deepEqual(errors.map((error) => error.row), [3], 'second object = sheet row 3 = API index 1');
});

test('one API key is free; another needs an approved request that charges the wallet', { skip: skipWithoutDb }, async () => {
  const pool = await migratedPool();
  try {
    const tenantId = await makeTenant(pool);
    const owner = await makeUser(pool, { tenantId, role: 'super_admin' });
    await createApiKey({ database: pool, tenantId, userId: owner, name: 'LMS production' });
    await assert.rejects(createApiKey({ database: pool, tenantId, userId: owner, name: 'LMS staging' }), /includes 1 API key/);

    const request = await requestExtraApiKey({ database: pool, tenantId, userId: owner, reason: 'Staging system for our LMS' });
    await assert.rejects(requestExtraApiKey({ database: pool, tenantId, userId: owner, reason: 'Another one please' }), /already waiting/);
    await assert.rejects(decideApiKeyRequest({ database: pool, requestId: request.id, adminUserId: owner, approve: true }), /wallet needs at least/);

    const fee = Number((await platformSettings(pool)).api_key_fee_paise);
    await pool.query('INSERT INTO wallets (tenant_id, balance_paise, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE balance_paise = VALUES(balance_paise)', [tenantId, fee + 100, '2026-09-25T00:00:00.000Z']);
    await decideApiKeyRequest({ database: pool, requestId: request.id, adminUserId: owner, approve: true });
    assert.equal(Number((await queryOne(pool, 'SELECT balance_paise FROM wallets WHERE tenant_id = ?', [tenantId])).balance_paise), 100, 'the fee is deducted from the wallet');
    assert.equal((await apiKeyAllowance(pool, tenantId)).limit, 2);
    await createApiKey({ database: pool, tenantId, userId: owner, name: 'LMS staging' });
    await assert.rejects(decideApiKeyRequest({ database: pool, requestId: request.id, adminUserId: owner, approve: true }), /already decided/);
  } finally {
    await pool.end();
  }
});
