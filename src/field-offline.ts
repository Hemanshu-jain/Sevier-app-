const databaseName = 'handoff-field-v1';
const storeNames = ['workspaces', 'drafts', 'evidenceBlobs', 'mutations'] as const;

export interface StoredEvidenceBlob {
  id: string;
  userId: string;
  caseId: string;
  name: string;
  type: string;
  capturedAt: string;
  location?: { latitude: number; longitude: number; capturedAt: string };
  blob: Blob;
}

export interface StoredFieldMutation {
  id: string;
  userId: string;
  caseId: string;
  operation: 'evidence' | 'attempt' | 'custody';
  status: 'pending' | 'syncing' | 'synced' | 'needs_attention';
  dependencyIds: string[];
  createdAt: string;
  payload: Record<string, unknown>;
  attemptCount?: number;
  error?: string;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      for (const name of storeNames) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getRecord<T>(storeName: typeof storeNames[number], id: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, 'readonly');
    const result = await requestResult(transaction.objectStore(storeName).get(id));
    await transactionDone(transaction);
    return result as T | undefined;
  } finally {
    database.close();
  }
}

async function getRecords<T>(storeName: typeof storeNames[number]) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, 'readonly');
    const result = await requestResult(transaction.objectStore(storeName).getAll());
    await transactionDone(transaction);
    return result as T[];
  } finally {
    database.close();
  }
}

async function putRecord(storeName: typeof storeNames[number], value: unknown) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function deleteRecords(storeName: typeof storeNames[number], ids: string[]) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    for (const id of ids) transaction.objectStore(storeName).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function saveFieldWorkspace<T>(userId: string, workspace: T) {
  await putRecord('workspaces', { id: userId, workspace, updatedAt: new Date().toISOString() });
}

export async function loadFieldWorkspace<T>(userId: string) {
  return (await getRecord<{ workspace: T }>('workspaces', userId))?.workspace ?? null;
}

export async function deleteFieldWorkspace(userId: string) {
  await deleteRecords('workspaces', [userId]);
}

export async function saveFieldDraft<T>(userId: string, caseId: string, draft: T) {
  await putRecord('drafts', { id: `${userId}:${caseId}`, draft, updatedAt: new Date().toISOString() });
}

export async function loadFieldDraft<T>(userId: string, caseId: string) {
  return (await getRecord<{ draft: T }>('drafts', `${userId}:${caseId}`))?.draft ?? null;
}

export async function deleteFieldDraft(userId: string, caseId: string) {
  await deleteRecords('drafts', [`${userId}:${caseId}`]);
}

export async function saveEvidenceBlob(record: StoredEvidenceBlob) {
  await putRecord('evidenceBlobs', record);
}

export async function loadEvidenceBlobs(ids: string[]) {
  const records = await getRecords<StoredEvidenceBlob>('evidenceBlobs');
  const wanted = new Set(ids);
  return records.filter((record) => wanted.has(record.id));
}

export async function deleteEvidenceBlobs(ids: string[]) {
  await deleteRecords('evidenceBlobs', ids);
}

export async function saveFieldMutation(record: StoredFieldMutation) {
  await putRecord('mutations', record);
}

export async function listFieldMutations(userId: string) {
  return (await getRecords<StoredFieldMutation>('mutations'))
    .filter((record) => record.userId === userId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function deleteFieldMutation(id: string) {
  await deleteRecords('mutations', [id]);
}

export function resetFieldOfflineStorage() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Field storage is still open.'));
  });
}
