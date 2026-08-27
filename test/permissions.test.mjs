import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, ROLE_TEMPLATES, hasPermission } from '../shared/contracts.mjs';

test('owner template receives every permission', () => {
  assert.deepEqual(new Set(ROLE_TEMPLATES.owner), new Set(Object.values(PERMISSIONS)));
});

test('manager can run operations but cannot change owner controls', () => {
  assert.equal(hasPermission(ROLE_TEMPLATES.manager, PERMISSIONS.AUTHORITY_APPROVE), true);
  assert.equal(hasPermission(ROLE_TEMPLATES.manager, PERMISSIONS.RELEASE_ISSUE), true);
  assert.equal(hasPermission(ROLE_TEMPLATES.manager, PERMISSIONS.ORGANIZATION_MANAGE), false);
  assert.equal(hasPermission(ROLE_TEMPLATES.manager, PERMISSIONS.ROLE_MANAGE), false);
  assert.equal(hasPermission(ROLE_TEMPLATES.manager, PERMISSIONS.RETENTION_MANAGE), false);
});

test('staff and agent templates stop at their assigned responsibilities', () => {
  assert.equal(hasPermission(ROLE_TEMPLATES.staff, PERMISSIONS.IMPORT_MANAGE), true);
  assert.equal(hasPermission(ROLE_TEMPLATES.staff, PERMISSIONS.AUTHORITY_APPROVE), false);
  assert.equal(hasPermission(ROLE_TEMPLATES.agent, PERMISSIONS.ASSIGNMENT_RESPOND), true);
  assert.equal(hasPermission(ROLE_TEMPLATES.agent, PERMISSIONS.CUSTODY_SUBMIT), true);
  assert.equal(hasPermission(ROLE_TEMPLATES.agent, PERMISSIONS.PAYMENT_CONFIRM), false);
});

test('custom roles use their stored permission list exactly', () => {
  const customPermissions = [PERMISSIONS.CASE_ASSIGN];
  assert.equal(hasPermission(customPermissions, PERMISSIONS.CASE_ASSIGN), true);
  assert.equal(hasPermission(customPermissions, PERMISSIONS.CUSTODY_REVIEW), false);
  assert.equal(hasPermission(null, PERMISSIONS.CASE_ASSIGN), false);
});
