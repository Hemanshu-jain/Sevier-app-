import test from 'node:test';
import assert from 'node:assert/strict';
import { loginDefaults } from '../src/runtime-mode.ts';

test('production login never exposes local demo identities', () => {
  assert.deepEqual(loginDefaults(false), { mobile: '', showDemoAccounts: false });
});

test('development login keeps the local owner shortcut', () => {
  assert.deepEqual(loginDefaults(true), { mobile: '+91 98450 11111', showDemoAccounts: true });
});
