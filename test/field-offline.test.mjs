import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteEvidenceBlobs,
  deleteFieldMutation,
  deleteFieldWorkspace,
  listFieldMutations,
  loadEvidenceBlobs,
  loadFieldDraft,
  loadFieldWorkspace,
  resetFieldOfflineStorage,
  saveEvidenceBlob,
  saveFieldDraft,
  saveFieldMutation,
  saveFieldWorkspace,
} from '../src/field-offline.ts';

test('workspace, drafts, and evidence blobs survive new database connections', async () => {
  await resetFieldOfflineStorage();
  const workspace = { cases: [{ id: 'RC-1' }], custody: [], agents: [], notifications: [], releasePasses: [] };
  const draft = { verified: true, customNote: 'Left mirror scratched.' };
  const blob = new Blob(['test'], { type: 'image/jpeg' });

  await saveFieldWorkspace('u1', workspace);
  await saveFieldDraft('u1', 'RC-1', draft);
  await saveEvidenceBlob({ id: 'blob-1', userId: 'u1', caseId: 'RC-1', name: 'vehicle.jpg', type: 'image/jpeg', capturedAt: '2026-09-01T10:00:00Z', blob });

  assert.deepEqual(await loadFieldWorkspace('u1'), workspace);
  assert.deepEqual(await loadFieldDraft('u1', 'RC-1'), draft);
  const storedBlobs = await loadEvidenceBlobs(['blob-1']);
  assert.equal(storedBlobs[0].blob.size, 4);
  assert.equal(storedBlobs[0].name, 'vehicle.jpg');
  await deleteEvidenceBlobs(['blob-1']);
  assert.deepEqual(await loadEvidenceBlobs(['blob-1']), []);
  await deleteFieldWorkspace('u1');
  assert.equal(await loadFieldWorkspace('u1'), null);
});

test('mutations are listed per user in creation order and can be removed', async () => {
  await resetFieldOfflineStorage();
  await saveFieldMutation({ id: 'm-2', userId: 'u1', caseId: 'RC-2', operation: 'attempt', status: 'pending', dependencyIds: [], createdAt: '2026-09-01T11:00:00Z', payload: {} });
  await saveFieldMutation({ id: 'm-1', userId: 'u1', caseId: 'RC-1', operation: 'evidence', status: 'pending', dependencyIds: [], createdAt: '2026-09-01T10:00:00Z', payload: {} });
  await saveFieldMutation({ id: 'other', userId: 'u2', caseId: 'RC-3', operation: 'attempt', status: 'pending', dependencyIds: [], createdAt: '2026-09-01T09:00:00Z', payload: {} });

  assert.deepEqual((await listFieldMutations('u1')).map((item) => item.id), ['m-1', 'm-2']);
  await deleteFieldMutation('m-1');
  assert.deepEqual((await listFieldMutations('u1')).map((item) => item.id), ['m-2']);
});
