import { randomUUID } from 'node:crypto';
import { normalizeIndiaMobile } from './otp-service.mjs';
import { createSessionToken } from './session-token.mjs';
import { runTransaction } from './sqlite-transaction.mjs';

export async function requestSignInOtp({ database, otpProvider, mobile, requestIp = null, now = new Date() }) {
  const mobileE164 = normalizeIndiaMobile(mobile);
  const user = database.prepare('SELECT id FROM users WHERE mobile_e164 = ? AND active = 1').get(mobileE164);
  if (!user) throw new Error('No active account uses this mobile number.');

  const since = new Date(now.getTime() - 15 * 60_000).toISOString();
  const recent = database.prepare('SELECT COUNT(*) AS count FROM otp_challenges WHERE mobile_e164 = ? AND requested_at >= ?').get(mobileE164, since).count;
  if (recent >= 5) throw new Error('Too many OTP requests. Try again in 15 minutes.');

  const providerResult = await otpProvider.send(mobileE164);
  const challengeId = randomUUID();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  database.prepare(`INSERT INTO otp_challenges (id, mobile_e164, purpose, provider_request_id, requested_at, expires_at, request_ip)
    VALUES (?, ?, 'sign_in', ?, ?, ?, ?)`).run(challengeId, mobileE164, providerResult.requestId, now.toISOString(), expiresAt, requestIp);
  return { challengeId, expiresAt, ...(providerResult.developmentCode ? { developmentCode: providerResult.developmentCode } : {}) };
}

export async function verifySignInOtp({ database, otpProvider, challengeId, mobile, code, now = new Date() }) {
  const mobileE164 = normalizeIndiaMobile(mobile);
  const challenge = database.prepare("SELECT * FROM otp_challenges WHERE id = ? AND mobile_e164 = ? AND purpose = 'sign_in'").get(challengeId, mobileE164);
  if (!challenge) throw new Error('The OTP request is invalid.');
  if (challenge.verified_at) throw new Error('This OTP has already been used.');
  if (new Date(challenge.expires_at) <= now) throw new Error('This OTP has expired.');

  await otpProvider.verify(mobileE164, code);
  const user = database.prepare('SELECT id FROM users WHERE mobile_e164 = ? AND active = 1').get(mobileE164);
  if (!user) throw new Error('This account is no longer active.');

  const sessionId = randomUUID();
  const { token, hash } = createSessionToken();
  const expiresAt = new Date(now.getTime() + 8 * 60 * 60_000).toISOString();
  runTransaction(database, () => {
    database.prepare('UPDATE otp_challenges SET verified_at = ? WHERE id = ?').run(now.toISOString(), challenge.id);
    database.prepare('INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(sessionId, user.id, hash, now.toISOString(), expiresAt);
  });
  return { sessionId, token, expiresAt, userId: user.id };
}
