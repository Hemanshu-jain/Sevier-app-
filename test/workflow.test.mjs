import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_STATUS, PERMISSIONS, caseStatusLabel } from '../shared/contracts.mjs';

test('canonical case statuses are lowercase snake_case', () => {
  for (const value of Object.values(CASE_STATUS)) assert.match(value, /^[a-z]+(?:_[a-z]+)*$/);
});

test('status label reproduces the human display strings', () => {
  assert.equal(caseStatusLabel(CASE_STATUS.IMPORTED), 'Imported');
  assert.equal(caseStatusLabel(CASE_STATUS.CUSTODY_REVIEW), 'Custody review');
  assert.equal(caseStatusLabel(CASE_STATUS.RELEASE_PASS_PRINTED), 'Release pass printed');
  assert.equal(caseStatusLabel(CASE_STATUS.UNABLE_TO_RECOVER), 'Unable to recover');
});

test('permission contract includes every sensitive approval boundary', () => {
  assert.deepEqual(
    [PERMISSIONS.AUTHORITY_APPROVE, PERMISSIONS.CASE_ASSIGN, PERMISSIONS.CUSTODY_REVIEW, PERMISSIONS.PAYMENT_CONFIRM, PERMISSIONS.RELEASE_ISSUE, PERMISSIONS.RELEASE_CLOSE, PERMISSIONS.AUDIT_VIEW, PERMISSIONS.RETENTION_MANAGE],
    ['authority.approve', 'case.assign', 'custody.review', 'payment.confirm', 'release.issue', 'release.close', 'audit.view', 'retention.manage'],
  );
});
