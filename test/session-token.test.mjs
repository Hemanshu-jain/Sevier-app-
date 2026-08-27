import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, hashSessionToken } from '../server/session-token.mjs';

test('issues unique opaque session tokens and stores only their hashes', () => {
  const first = createSessionToken();
  const second = createSessionToken();

  assert.notEqual(first.token, second.token);
  assert.notEqual(first.token, first.hash);
  assert.equal(first.hash, hashSessionToken(first.token));
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
});

test('rejects empty bearer tokens before hashing', () => {
  assert.throws(() => hashSessionToken(''), /session token/i);
});
