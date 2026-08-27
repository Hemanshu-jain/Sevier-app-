import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { hashSessionToken } from '../server/session-token.mjs';
import { requestSignInOtp, verifySignInOtp } from '../server/otp-auth.mjs';

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, mobile_e164 TEXT UNIQUE, active INTEGER NOT NULL);
    CREATE TABLE otp_challenges (id TEXT PRIMARY KEY, mobile_e164 TEXT NOT NULL, purpose TEXT NOT NULL, provider_request_id TEXT, requested_at TEXT NOT NULL, expires_at TEXT NOT NULL, verified_at TEXT, request_ip TEXT);
    CREATE TABLE auth_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);
    INSERT INTO users VALUES ('user-1', '919876543210', 1);
  `);
  return database;
}

const provider = {
  async send() { return { requestId: 'provider-request', developmentCode: '123456' }; },
  async verify() { return { verified: true }; },
};

test('requests a normalized, expiring sign-in challenge for an active user', async () => {
  const database = createDatabase();
  const now = new Date('2026-08-27T10:00:00.000Z');

  const result = await requestSignInOtp({ database, otpProvider: provider, mobile: '+91 98765 43210', requestIp: '127.0.0.1', now });
  const saved = database.prepare('SELECT * FROM otp_challenges WHERE id = ?').get(result.challengeId);

  assert.equal(saved.mobile_e164, '919876543210');
  assert.equal(saved.provider_request_id, 'provider-request');
  assert.equal(saved.expires_at, '2026-08-27T10:10:00.000Z');
  assert.equal(result.developmentCode, '123456');
  database.close();
});

test('limits repeated OTP requests per mobile number', async () => {
  const database = createDatabase();
  const now = new Date('2026-08-27T10:00:00.000Z');
  const insert = database.prepare("INSERT INTO otp_challenges VALUES (?, '919876543210', 'sign_in', NULL, ?, ?, NULL, NULL)");
  for (let index = 0; index < 5; index += 1) insert.run(`challenge-${index}`, now.toISOString(), new Date(now.getTime() + 600_000).toISOString());

  await assert.rejects(() => requestSignInOtp({ database, otpProvider: provider, mobile: '9876543210', now }), /too many OTP/i);
  database.close();
});

test('verification consumes the challenge and persists only a session-token hash', async () => {
  const database = createDatabase();
  const now = new Date('2026-08-27T10:00:00.000Z');
  const challenge = await requestSignInOtp({ database, otpProvider: provider, mobile: '9876543210', now });

  const session = await verifySignInOtp({ database, otpProvider: provider, challengeId: challenge.challengeId, mobile: '9876543210', code: '123456', now });
  const saved = database.prepare('SELECT * FROM auth_sessions WHERE id = ?').get(session.sessionId);

  assert.equal(session.userId, 'user-1');
  assert.equal(saved.token_hash, hashSessionToken(session.token));
  assert.equal(saved.token_hash.includes(session.token), false);
  await assert.rejects(() => verifySignInOtp({ database, otpProvider: provider, challengeId: challenge.challengeId, mobile: '9876543210', code: '123456', now }), /already been used/i);
  database.close();
});

test('expired OTP challenges cannot create sessions', async () => {
  const database = createDatabase();
  const requestedAt = new Date('2026-08-27T10:00:00.000Z');
  const challenge = await requestSignInOtp({ database, otpProvider: provider, mobile: '9876543210', now: requestedAt });

  await assert.rejects(() => verifySignInOtp({ database, otpProvider: provider, challengeId: challenge.challengeId, mobile: '9876543210', code: '123456', now: new Date('2026-08-27T10:11:00.000Z') }), /expired/i);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get().count, 0);
  database.close();
});
