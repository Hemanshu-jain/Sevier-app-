import test from 'node:test';
import assert from 'node:assert/strict';
import { readLocation, validateAttempt, validateCustody, validateFieldCase } from '../server/field-validation.mjs';

const activeCase = { status: 'assigned' };

test('field actions are limited to active assignments', () => {
  assert.equal(validateFieldCase(activeCase), null);
  assert.match(validateFieldCase({ status: 'closed' }), /active assignment/i);
  assert.match(validateAttempt({ status: 'payment_confirmed' }, { reason: 'Other', note: 'Test' }), /active assignment/i);
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
  assert.equal(validateCustody(activeCase, { ...values, customNote: 'Left mirror scratched.' }), null);
  assert.match(validateCustody(activeCase, { ...values, customNote: 'x'.repeat(2001) }), /note/i);
});

test('field submissions require a real GPS fix', () => {
  assert.deepEqual(readLocation({ latitude: '12.9716', longitude: '77.5946' }), { latitude: 12.9716, longitude: 77.5946 });
  assert.ok(readLocation({}).error, 'missing location is rejected');
  assert.ok(readLocation({ latitude: '', longitude: '' }).error, 'blank values must not coerce to 0,0');
  assert.ok(readLocation({ latitude: 'abc', longitude: '77' }).error);
  assert.ok(readLocation({ latitude: 91, longitude: 77 }).error, 'latitude out of range');
  assert.ok(readLocation({ latitude: 12, longitude: 181 }).error, 'longitude out of range');
});
