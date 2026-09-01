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
  assert.equal(financeCaseAction({ status: 'Imported', hasAuthority: false }, managerPermissions), 'authority');
  assert.equal(financeCaseAction({ status: 'Imported', hasAuthority: true }, managerPermissions), 'assign');
  assert.equal(financeCaseAction({ status: 'Custody review', hasCustody: true }, managerPermissions), 'custody-review');
  assert.equal(financeCaseAction({ status: 'Payment pending', hasCustody: true }, managerPermissions), 'payment');
  assert.equal(financeCaseAction({ status: 'Payment confirmed', hasCustody: true }, managerPermissions), 'release');
  assert.equal(financeCaseAction({ status: 'Release pass printed', hasReleasePass: true }, managerPermissions), 'print-close');
  assert.equal(financeCaseAction({ status: 'Closed' }, managerPermissions), 'closed');
});

test('finance action hides approval controls from intake-only staff', () => {
  assert.equal(financeCaseAction({ status: 'Imported', hasAuthority: false }, []), 'restricted');
  assert.equal(financeCaseAction({ status: 'Custody review', hasCustody: true }, []), 'restricted');
  assert.equal(financeCaseAction({ status: 'Payment pending', hasCustody: true }, []), 'restricted');
  assert.equal(financeCaseAction({ status: 'Payment confirmed', hasCustody: true }, []), 'restricted');
  assert.equal(financeCaseAction({ status: 'Release pass printed', hasReleasePass: true }, []), 'restricted');
});

test('finance action keeps active field work and incomplete custody waiting', () => {
  assert.equal(financeCaseAction({ status: 'Assigned' }, managerPermissions), 'waiting-field');
  assert.equal(financeCaseAction({ status: 'Recovered', hasCustody: false }, managerPermissions), 'waiting-custody');
  assert.equal(financeCaseAction({ status: 'Custody certificate issued', hasCustody: true }, managerPermissions), 'custody-review');
});
