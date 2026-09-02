import test from 'node:test';
import assert from 'node:assert/strict';
import { financeReviewCases, recoveryPipeline } from '../src/desktop-metrics.ts';

const cases = [
  { status: 'imported' },
  { status: 'assigned' },
  { status: 'unable_to_recover' },
  { status: 'custody_review' },
  { status: 'payment_pending' },
  { status: 'payment_confirmed' },
  { status: 'release_pass_printed' },
  { status: 'closed' },
];

test('finance review queue includes every state requiring a financier decision', () => {
  assert.deepEqual(financeReviewCases(cases).map((item) => item.status), ['imported', 'unable_to_recover', 'custody_review', 'payment_pending']);
});

test('recovery pipeline reports real case counts instead of static progress', () => {
  assert.deepEqual(recoveryPipeline(cases), [
    { label: 'Import', count: 1 },
    { label: 'Field work', count: 2 },
    { label: 'Custody', count: 1 },
    { label: 'Payment', count: 2 },
    { label: 'Release', count: 2 },
  ]);
});
