import test from 'node:test';
import assert from 'node:assert/strict';
import { financeReviewCases, recoveryPipeline } from '../src/desktop-metrics.ts';

const cases = [
  { status: 'Imported' },
  { status: 'Assigned' },
  { status: 'Unable to recover' },
  { status: 'Custody review' },
  { status: 'Payment pending' },
  { status: 'Payment confirmed' },
  { status: 'Release pass printed' },
  { status: 'Closed' },
];

test('finance review queue includes every state requiring a financier decision', () => {
  assert.deepEqual(financeReviewCases(cases).map((item) => item.status), ['Imported', 'Unable to recover', 'Custody review', 'Payment pending']);
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
