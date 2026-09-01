import test from 'node:test';
import assert from 'node:assert/strict';
import { isActivationKey, isSearchShortcut } from '../src/interaction.ts';

test('keyboard activation accepts only Enter and Space', () => {
  assert.equal(isActivationKey('Enter'), true);
  assert.equal(isActivationKey(' '), true);
  assert.equal(isActivationKey('Escape'), false);
});

test('case search shortcut supports Windows and macOS modifiers', () => {
  assert.equal(isSearchShortcut({ key: 'k', ctrlKey: true, metaKey: false, altKey: false }), true);
  assert.equal(isSearchShortcut({ key: 'K', ctrlKey: false, metaKey: true, altKey: false }), true);
  assert.equal(isSearchShortcut({ key: 'k', ctrlKey: false, metaKey: false, altKey: false }), false);
  assert.equal(isSearchShortcut({ key: 'k', ctrlKey: true, metaKey: false, altKey: true }), false);
});
