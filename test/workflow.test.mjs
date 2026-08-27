import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_STATUS, PERMISSIONS, canTransition } from '../shared/contracts.mjs';

test('case workflow allows the approved forward path', () => {
  const path = [
    CASE_STATUS.DRAFT,
    CASE_STATUS.AWAITING_AUTHORITY,
    CASE_STATUS.READY_TO_ASSIGN,
    CASE_STATUS.AWAITING_AGENT,
    CASE_STATUS.IN_FIELD,
    CASE_STATUS.CUSTODY_REVIEW,
    CASE_STATUS.PAYMENT_PENDING,
    CASE_STATUS.PAYMENT_CONFIRMED,
    CASE_STATUS.RELEASE_ISSUED,
    CASE_STATUS.CLOSED,
  ];

  for (let index = 0; index < path.length - 1; index += 1) {
    assert.equal(canTransition(path[index], path[index + 1]), true);
  }
});

test('case workflow rejects skipping finance approvals', () => {
  assert.equal(canTransition(CASE_STATUS.IN_FIELD, CASE_STATUS.PAYMENT_PENDING), false);
  assert.equal(canTransition(CASE_STATUS.CUSTODY_REVIEW, CASE_STATUS.RELEASE_ISSUED), false);
});

test('case workflow supports audited retry and revocation paths', () => {
  assert.equal(canTransition(CASE_STATUS.AWAITING_AGENT, CASE_STATUS.READY_TO_ASSIGN), true);
  assert.equal(canTransition(CASE_STATUS.ATTEMPT_REVIEW, CASE_STATUS.READY_TO_ASSIGN), true);
  assert.equal(canTransition(CASE_STATUS.CUSTODY_REVIEW, CASE_STATUS.IN_FIELD), true);
  assert.equal(canTransition(CASE_STATUS.RELEASE_ISSUED, CASE_STATUS.PAYMENT_CONFIRMED), true);
});

test('permission contract includes every sensitive approval boundary', () => {
  assert.deepEqual(
    [
      PERMISSIONS.AUTHORITY_APPROVE,
      PERMISSIONS.CASE_ASSIGN,
      PERMISSIONS.CUSTODY_REVIEW,
      PERMISSIONS.PAYMENT_CONFIRM,
      PERMISSIONS.RELEASE_ISSUE,
      PERMISSIONS.RELEASE_CLOSE,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.RETENTION_MANAGE,
    ],
    [
      'authority.approve',
      'case.assign',
      'custody.review',
      'payment.confirm',
      'release.issue',
      'release.close',
      'audit.view',
      'retention.manage',
    ],
  );
});
