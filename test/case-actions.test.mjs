import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaseAction } from '../server/case-actions.mjs';

test('assignment requires finance authority approval', () => {
  const imported = { status: 'imported', authority_approved_at: null };
  assert.match(validateCaseAction('assign', imported), /authority document/i);
  assert.equal(validateCaseAction('assign', { ...imported, authority_approved_at: '2026-08-27T10:00:00Z' }), null);
  assert.match(validateCaseAction('assign', { ...imported, authority_approved_at: '2026-08-27T10:00:00Z' }, { assignmentNote: 'x'.repeat(2001) }), /2,000/);
});

test('authority approval requires an imported case and a document', () => {
  assert.match(validateCaseAction('approve_authority', { status: 'imported' }), /document/i);
  assert.equal(validateCaseAction('approve_authority', { status: 'imported' }, { hasDocument: true }), null);
  assert.match(validateCaseAction('approve_authority', { status: 'assigned' }, { hasDocument: true }), /imported case/i);
});

test('custody review must precede payment confirmation', () => {
  assert.equal(validateCaseAction('approve_custody', { status: 'custody_review' }), null);
  assert.match(validateCaseAction('approve_custody', { status: 'assigned' }), /custody report/i);
  assert.match(validateCaseAction('confirm_payment', { status: 'custody_review' }), /approve custody/i);
  assert.equal(validateCaseAction('confirm_payment', { status: 'payment_pending' }), null);
});

test('release issuance and closure keep their financial gates', () => {
  assert.match(validateCaseAction('issue_release', { status: 'payment_pending', payment_cleared: 0 }), /payment/i);
  assert.equal(validateCaseAction('issue_release', { status: 'payment_confirmed', payment_cleared: 1 }), null);
  assert.match(validateCaseAction('close', { status: 'payment_confirmed', release_pass_id: null }), /release pass/i);
  assert.equal(validateCaseAction('close', { status: 'release_pass_printed', release_pass_id: 'RP-1' }), null);
});
