import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldCacheRequest } from '../public/sw-policy.mjs';

test('offline cache accepts only same-origin public GET assets', () => {
  const origin = 'https://handoff.example';
  assert.equal(shouldCacheRequest({ method: 'GET', url: `${origin}/assets/app.js`, origin }), true);
  assert.equal(shouldCacheRequest({ method: 'GET', url: `${origin}/manifest.webmanifest`, origin }), true);
  assert.equal(shouldCacheRequest({ method: 'POST', url: `${origin}/`, origin }), false);
  assert.equal(shouldCacheRequest({ method: 'GET', url: 'https://cdn.example/app.js', origin }), false);
});

test('offline cache never stores authenticated API or evidence responses', () => {
  const origin = 'https://handoff.example';
  assert.equal(shouldCacheRequest({ method: 'GET', url: `${origin}/api`, origin }), false);
  assert.equal(shouldCacheRequest({ method: 'GET', url: `${origin}/api/workspace`, origin }), false);
  assert.equal(shouldCacheRequest({ method: 'GET', url: `${origin}/api/evidence/ev-1/file`, origin }), false);
});
