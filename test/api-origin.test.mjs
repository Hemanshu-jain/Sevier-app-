import test from 'node:test';
import assert from 'node:assert/strict';
import { apiUrl } from '../src/api-origin.ts';

test('browser development keeps relative API paths', () => {
  assert.equal(apiUrl('/api/workspace', ''), '/api/workspace');
});

test('Android builds can target a configured HTTPS API origin', () => {
  assert.equal(apiUrl('/api/workspace', 'https://recovery.example.com/'), 'https://recovery.example.com/api/workspace');
  assert.throws(() => apiUrl('/api/workspace', 'javascript:alert(1)'), /http/i);
});
