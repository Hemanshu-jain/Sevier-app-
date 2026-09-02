import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSessionToken } from '../server/session-token.mjs';
import { requestSignInOtp, verifySignInOtp } from '../server/otp-auth.mjs';
import { query } from '../server/mysql.mjs';
import { migratedPool, makeTenant, makeUser, randomMobile, uid, skipWithoutDb } from './mysql-helpers.mjs';

const skip = skipWithoutDb;
const provider = {
  async send() { return { requestId: 'provider-request', developmentCode: '123456' }; },
  async verify() { return { verified: true }; },
};

async function seedUser(pool) {
  const tenantId = await makeTenant(pool);
  const mobile = randomMobile();
  const userId = await makeUser(pool, { tenantId, role: 'agent', mobileE164: `91${mobile}` });
  return { userId, mobile };
}

test('requests a normalized, expiring sign-in challenge for an active user', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { mobile } = await seedUser(pool);
    const now = new Date('2026-08-27T10:00:00.000Z');
    const result = await requestSignInOtp({ database: pool, otpProvider: provider, mobile, requestIp: '127.0.0.1', now });
    const saved = (await query(pool, 'SELECT * FROM otp_challenges WHERE id = ?', [result.challengeId]))[0];

    assert.equal(saved.mobile_e164, `91${mobile}`);
    assert.equal(saved.provider_request_id, 'provider-request');
    assert.equal(saved.expires_at, '2026-08-27T10:10:00.000Z');
    assert.equal(result.developmentCode, '123456');
  } finally {
    await pool.end();
  }
});

test('limits repeated OTP requests per mobile number', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { mobile } = await seedUser(pool);
    const now = new Date('2026-08-27T10:00:00.000Z');
    const e164 = `91${mobile}`;
    for (let i = 0; i < 5; i += 1) {
      await query(pool, "INSERT INTO otp_challenges (id, mobile_e164, purpose, requested_at, expires_at) VALUES (?, ?, 'sign_in', ?, ?)",
        [uid('ch'), e164, now.toISOString(), new Date(now.getTime() + 600_000).toISOString()]);
    }
    await assert.rejects(requestSignInOtp({ database: pool, otpProvider: provider, mobile, now }), /too many OTP/i);
  } finally {
    await pool.end();
  }
});

test('verification consumes the challenge and persists only a session-token hash', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { userId, mobile } = await seedUser(pool);
    const now = new Date('2026-08-27T10:00:00.000Z');
    const challenge = await requestSignInOtp({ database: pool, otpProvider: provider, mobile, now });
    const session = await verifySignInOtp({ database: pool, otpProvider: provider, challengeId: challenge.challengeId, mobile, code: '123456', now });
    const saved = (await query(pool, 'SELECT * FROM auth_sessions WHERE id = ?', [session.sessionId]))[0];

    assert.equal(session.userId, userId);
    assert.equal(saved.token_hash, hashSessionToken(session.token));
    assert.equal(saved.token_hash.includes(session.token), false);
    await assert.rejects(verifySignInOtp({ database: pool, otpProvider: provider, challengeId: challenge.challengeId, mobile, code: '123456', now }), /already been used/i);
  } finally {
    await pool.end();
  }
});

test('expired OTP challenges cannot create sessions', { skip }, async () => {
  const pool = await migratedPool();
  try {
    const { userId, mobile } = await seedUser(pool);
    const requestedAt = new Date('2026-08-27T10:00:00.000Z');
    const challenge = await requestSignInOtp({ database: pool, otpProvider: provider, mobile, now: requestedAt });
    await assert.rejects(verifySignInOtp({ database: pool, otpProvider: provider, challengeId: challenge.challengeId, mobile, code: '123456', now: new Date('2026-08-27T10:11:00.000Z') }), /expired/i);
    assert.equal((await query(pool, 'SELECT COUNT(*) AS c FROM auth_sessions WHERE user_id = ?', [userId]))[0].c, 0);
  } finally {
    await pool.end();
  }
});
