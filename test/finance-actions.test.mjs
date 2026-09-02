import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS } from '../shared/contracts.mjs';
import { financeCaseAction } from '../src/finance-case-action.ts';

const managerPermissions = [
  PERMISSIONS.AUTHORITY_APPROVE,
  PERMISSIONS.CASE_ASSIGN,
  PERMISSIONS.CUSTODY_REVIEW,
  PERMISSIONS.PAYMENT_CONFIRM,
  PERMISSIONS.RELEASE_ISSUE,
  PERMISSIONS.RELEASE_CLOSE,
];

test('finance action exposes every approved desktop workflow gate', () => {
  assert.equal(financeCaseAction({ status: 'imported', hasAuthority: false }, managerPermissions), 'authority');
  assert.equal(financeCaseAction({ status: 'imported', hasAuthority: true }, managerPermissions), 'assign');
  assert.equal(financeCaseAction({ status: 'custody_review', hasCustody: true }, managerPermissions), 'custody-review');
  assert.equal(financeCaseAction({ status: 'payment_pending', hasCustody: true }, managerPermissions), 'payment');
  assert.equal(financeCaseAction({ status: 'payment_confirmed', hasCustody: true }, managerPermissions), 'release');
  assert.equal(financeCaseAction({ status: 'release_pass_printed', hasReleasePass: true }, managerPermissions), 'print-close');
  assert.equal(financeCaseAction({ status: 'closed' }, managerPermissions), 'closed');
});

test('finance action hides approval controls from intake-only staff', () => {
  assert.equal(financeCaseAction({ status: 'imported', hasAuthority: false }, []), 'restricted');
  assert.equal(financeCaseAction({ status: 'custody_review', hasCustody: true }, []), 'restricted');
  assert.equal(financeCaseAction({ status: 'payment_pending', hasCustody: true }, []), 'restricted');
  assert.equal(financeCaseAction({ status: 'payment_confirmed', hasCustody: true }, []), 'restricted');
  assert.equal(financeCaseAction({ status: 'release_pass_printed', hasReleasePass: true }, []), 'restricted');
});

test('finance action keeps active field work waiting on the agent', () => {
  assert.equal(financeCaseAction({ status: 'assigned' }, managerPermissions), 'waiting-field');
  assert.equal(financeCaseAction({ status: 'unable_to_recover' }, managerPermissions), 'assign');
});
