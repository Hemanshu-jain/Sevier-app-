import { createHash, randomBytes } from 'node:crypto';

export function hashSessionToken(token) {
  if (!token) throw new Error('A session token is required.');
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashSessionToken(token) };
}
