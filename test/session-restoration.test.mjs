import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api.ts';
import { shouldClearStoredSession } from '../src/session-restoration.ts';

test('only confirmed authentication failures clear a stored session', () => {
  assert.equal(shouldClearStoredSession(new ApiError('expired', 401)), true);
  assert.equal(shouldClearStoredSession(new TypeError('fetch failed')), false);
  assert.equal(shouldClearStoredSession(new ApiError('server down', 503)), false);
});
