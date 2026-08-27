import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAttempt, validateCustody, validateFieldCase } from '../server/field-validation.mjs';

const activeCase = { status: 'Assigned' };

test('field actions are limited to active assignments', () => {
  assert.equal(validateFieldCase(activeCase), null);
  assert.match(validateFieldCase({ status: 'Closed' }), /active assignment/i);
  assert.match(validateAttempt({ status: 'Payment confirmed' }, { reason: 'Other', note: 'Test' }), /active assignment/i);
});

test('attempts require an allowed reason and bounded factual note', () => {
  assert.equal(validateAttempt(activeCase, { reason: 'Vehicle not found', note: 'Address checked.' }), null);
  assert.match(validateAttempt(activeCase, { reason: 'Made up', note: 'Address checked.' }), /reason/i);
  assert.match(validateAttempt(activeCase, { reason: 'Other', note: '' }), /note/i);
});

test('custody requires evidence and the complete known inspection checklist', () => {
  const inspection = Object.fromEntries(['Battery', 'Spare tyre', 'Fuel level', 'Matting', 'Keys and key number', 'Meter / odometer', 'Existing damages', 'Self motor', 'Wiper / motor', 'Stereo / infotainment', 'Ignition coil', 'Speakers', 'Side mirrors', 'Tyre condition'].map((item) => [item, 'Present / working']));
  const values = { yardName: 'Central Yard', arrivalTime: '2026-08-28T10:00', parkingRate: 350, checklist: 14, inspection, evidenceCount: 1 };
  assert.equal(validateCustody(activeCase, values), null);
  assert.match(validateCustody(activeCase, { ...values, evidenceCount: 0 }), /evidence/i);
  assert.match(validateCustody(activeCase, { ...values, inspection: { ...inspection, Battery: 'Unknown' } }), /condition check/i);
});
