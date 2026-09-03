import { randomUUID } from 'node:crypto';
import { normalizeIndiaMobile } from './otp-service.mjs';
import { createSessionToken } from './session-token.mjs';
import { query, queryOne, tx } from './mysql.mjs';

export async function requestSignInOtp({ database, otpProvider, mobile, requestIp = null, now = new Date() }) {
  const mobileE164 = normalizeIndiaMobile(mobile);
  const user = await queryOne(database, 'SELECT id FROM users WHERE mobile_e164 = ? AND active = 1', [mobileE164]);
  if (!user) throw new Error('No active account uses this mobile number.');

  const since = new Date(now.getTime() - 15 * 60_000).toISOString();
  const recent = (await queryOne(database, 'SELECT COUNT(*) AS count FROM otp_challenges WHERE mobile_e164 = ? AND requested_at >= ?', [mobileE164, since])).count;
  if (recent >= 5) throw new Error('Too many OTP requests. Try again in 15 minutes.');

  const providerResult = await otpProvider.send(mobileE164);
  const challengeId = randomUUID();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  await query(database,
    `INSERT INTO otp_challenges (id, mobile_e164, purpose, provider_request_id, requested_at, expires_at, request_ip)
     VALUES (?, ?, 'sign_in', ?, ?, ?, ?)`,
    [challengeId, mobileE164, providerResult.requestId, now.toISOString(), expiresAt, requestIp]);
  return { challengeId, expiresAt, ...(providerResult.developmentCode ? { developmentCode: providerResult.developmentCode } : {}) };
}

export async function verifySignInOtp({ database, otpProvider, challengeId, mobile, code, now = new Date() }) {
  const mobileE164 = normalizeIndiaMobile(mobile);
  const challenge = await queryOne(database, "SELECT * FROM otp_challenges WHERE id = ? AND mobile_e164 = ? AND purpose = 'sign_in'", [challengeId, mobileE164]);
  if (!challenge) throw new Error('The OTP request is invalid.');
  if (challenge.verified_at) throw new Error('This OTP has already been used.');
  if (new Date(challenge.expires_at) <= now) throw new Error('This OTP has expired.');

  await otpProvider.verify(mobileE164, code);
  const user = await queryOne(database, 'SELECT id FROM users WHERE mobile_e164 = ? AND active = 1', [mobileE164]);
  if (!user) throw new Error('This account is no longer active.');

  const sessionId = randomUUID();
  const { token, hash } = createSessionToken();
  const expiresAt = new Date(now.getTime() + 8 * 60 * 60_000).toISOString();
  await tx(database, async (conn) => {
    await query(conn, 'UPDATE otp_challenges SET verified_at = ? WHERE id = ?', [now.toISOString(), challenge.id]);
    await query(conn, 'INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [sessionId, user.id, hash, now.toISOString(), expiresAt]);
  });
  return { sessionId, token, expiresAt, userId: user.id };
}

// Self-registration for a brand-new field agent (no existing account for the mobile).
export async function requestSignUpOtp({ database, otpProvider, mobile, requestIp = null, now = new Date() }) {
  const mobileE164 = normalizeIndiaMobile(mobile);
  if (await queryOne(database, 'SELECT id FROM users WHERE mobile_e164 = ?', [mobileE164])) {
    throw new Error('This mobile already has an account. Sign in instead.');
  }
  const since = new Date(now.getTime() - 15 * 60_000).toISOString();
  const recent = (await queryOne(database, 'SELECT COUNT(*) AS count FROM otp_challenges WHERE mobile_e164 = ? AND requested_at >= ?', [mobileE164, since])).count;
  if (recent >= 5) throw new Error('Too many OTP requests. Try again in 15 minutes.');

  const providerResult = await otpProvider.send(mobileE164);
  const challengeId = randomUUID();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  await query(database,
    `INSERT INTO otp_challenges (id, mobile_e164, purpose, provider_request_id, requested_at, expires_at, request_ip)
     VALUES (?, ?, 'sign_up', ?, ?, ?, ?)`,
    [challengeId, mobileE164, providerResult.requestId, now.toISOString(), expiresAt, requestIp]);
  return { challengeId, expiresAt, ...(providerResult.developmentCode ? { developmentCode: providerResult.developmentCode } : {}) };
}

export async function verifySignUpOtp({ database, otpProvider, challengeId, mobile, code, now = new Date() }) {
  const mobileE164 = normalizeIndiaMobile(mobile);
  const challenge = await queryOne(database, "SELECT * FROM otp_challenges WHERE id = ? AND mobile_e164 = ? AND purpose = 'sign_up'", [challengeId, mobileE164]);
  if (!challenge) throw new Error('The sign-up request is invalid.');
  if (challenge.verified_at) throw new Error('This OTP has already been used.');
  if (new Date(challenge.expires_at) <= now) throw new Error('This OTP has expired.');

  await otpProvider.verify(mobileE164, code);
  const userId = `agent-${randomUUID()}`;
  const sessionId = randomUUID();
  const { token, hash } = createSessionToken();
  const expiresAt = new Date(now.getTime() + 8 * 60 * 60_000).toISOString();
  const displayMobile = `+91 ${mobileE164.slice(2, 7)} ${mobileE164.slice(7)}`;
  await tx(database, async (conn) => {
    await query(conn, 'UPDATE otp_challenges SET verified_at = ? WHERE id = ?', [now.toISOString(), challenge.id]);
    await query(conn,
      `INSERT INTO users (id, tenant_id, role, name, email, password_hash, mobile, city, active, mobile_e164, onboarding_complete, created_via)
       VALUES (?, NULL, 'agent', 'New agent', ?, 'otp-only', ?, '', 1, ?, 0, 'self')`,
      [userId, `${userId}@handoff.invalid`, displayMobile, mobileE164]);
    await query(conn, 'INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [sessionId, userId, hash, now.toISOString(), expiresAt]);
  });
  return { sessionId, token, expiresAt, userId };
}
