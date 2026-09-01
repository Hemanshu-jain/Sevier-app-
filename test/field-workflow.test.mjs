import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api.ts';
import {
  canOpenFieldStep,
  classifyFieldSyncError,
  filterCaseEvidence,
  filterAgentCases,
  nextSyncableMutation,
  removeEvidenceFile,
  validateEvidenceFiles,
} from '../src/field-workflow.ts';

test('custody waits for queued evidence', () => {
  const evidence = { id: 'evidence', status: 'pending', dependencyIds: [], createdAt: '1' };
  const custody = { id: 'custody', status: 'pending', dependencyIds: ['evidence'], createdAt: '2' };
  assert.equal(nextSyncableMutation([custody, evidence]).id, 'evidence');
  assert.equal(nextSyncableMutation([{ ...evidence, status: 'synced' }, custody]).id, 'custody');
  assert.equal(nextSyncableMutation([custody]).id, 'custody');
});

test('evidence validation enforces the field upload contract', () => {
  assert.equal(validateEvidenceFiles([{ name: 'vehicle.jpg', type: 'image/jpeg', size: 1024 }]), null);
  assert.match(validateEvidenceFiles([]), /at least one/i);
  assert.match(validateEvidenceFiles(Array.from({ length: 6 }, (_, index) => ({ name: `${index}.jpg`, type: 'image/jpeg', size: 1 }))), /five/i);
  assert.match(validateEvidenceFiles([{ name: 'vehicle.pdf', type: 'application/pdf', size: 1024 }]), /jpg|png|webp/i);
  assert.match(validateEvidenceFiles([{ name: 'large.jpg', type: 'image/jpeg', size: 16 * 1024 * 1024 }]), /15 mb/i);
});

test('an evidence file can be removed before it enters the durable queue', () => {
  const files = [{ name: 'front.jpg' }, { name: 'rear.jpg' }];
  assert.deepEqual(removeEvidenceFile(files, 0).map((item) => item.name), ['rear.jpg']);
});

test('later workflow steps stay locked until prerequisites exist', () => {
  assert.equal(canOpenFieldStep('verify', { verified: false, evidenceReady: false }), true);
  assert.equal(canOpenFieldStep('evidence', { verified: false, evidenceReady: false }), false);
  assert.equal(canOpenFieldStep('evidence', { verified: true, evidenceReady: false }), true);
  assert.equal(canOpenFieldStep('custody', { verified: true, evidenceReady: true }), true);
});

test('active and submitted agent work are separated', () => {
  const cases = [
    { id: 'active', status: 'Assigned' },
    { id: 'submitted-attempt', status: 'Unable to recover' },
    { id: 'submitted-custody', status: 'Custody review' },
  ];
  assert.deepEqual(filterAgentCases(cases, 'active').map((item) => item.id), ['active']);
  assert.deepEqual(filterAgentCases(cases, 'submitted').map((item) => item.id), ['submitted-attempt', 'submitted-custody']);
});

test('late evidence responses remain scoped to their work order', () => {
  const evidence = [{ id: 'ev-1', caseId: 'RC-1' }, { id: 'ev-2', caseId: 'RC-2' }];
  assert.deepEqual(filterCaseEvidence(evidence, 'RC-2').map((item) => item.id), ['ev-2']);
});

test('sync failures distinguish offline, authentication, validation, and retryable errors', () => {
  assert.equal(classifyFieldSyncError(new TypeError('fetch failed')), 'offline');
  assert.equal(classifyFieldSyncError(new ApiError('expired', 401)), 'authentication');
  assert.equal(classifyFieldSyncError(new ApiError('invalid', 422)), 'needs_attention');
  assert.equal(classifyFieldSyncError(new ApiError('down', 503)), 'retryable');
});
