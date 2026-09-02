const allowedEvidenceTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']);
const activeStatuses = new Set(['assigned']);

export type FieldStep = 'verify' | 'evidence' | 'custody';
export type FieldMutationStatus = 'pending' | 'syncing' | 'synced' | 'needs_attention';

export interface FieldMutation {
  id: string;
  status: FieldMutationStatus;
  dependencyIds: string[];
  createdAt: string;
}

export function validateEvidenceFiles(files: Array<{ name: string; type: string; size: number }>) {
  if (!files.length) return 'Capture at least one photo or video.';
  if (files.length > 5) return 'Choose no more than five evidence files.';
  if (files.some((file) => !allowedEvidenceTypes.has(file.type))) return 'Use JPG, PNG, WebP, MP4, or WebM evidence only.';
  if (files.some((file) => file.size > 15 * 1024 * 1024)) return 'Keep every evidence file at or below 15 MB.';
  return null;
}

export function removeEvidenceFile<T>(files: T[], index: number) {
  return files.filter((_, currentIndex) => currentIndex !== index);
}

export function canOpenFieldStep(step: FieldStep, state: { verified: boolean; evidenceReady: boolean }) {
  if (step === 'verify') return true;
  if (step === 'evidence') return state.verified;
  return state.verified && state.evidenceReady;
}

export function nextSyncableMutation<T extends FieldMutation>(mutations: T[]) {
  const byId = new Map(mutations.map((item) => [item.id, item]));
  return [...mutations]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .find((item) => item.status === 'pending' && item.dependencyIds.every((id) => !byId.has(id) || byId.get(id)?.status === 'synced')) ?? null;
}

export function classifyFieldSyncError(error: unknown) {
  if (error instanceof TypeError) return 'offline';
  const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;
  if (status === 401) return 'authentication';
  if (status === 400 || status === 403 || status === 404 || status === 409 || status === 422) return 'needs_attention';
  return 'retryable';
}

export function filterAgentCases<T extends { status: string }>(cases: T[], filter: 'active' | 'submitted') {
  return cases.filter((item) => filter === 'active' ? activeStatuses.has(item.status) : !activeStatuses.has(item.status));
}

export function filterCaseEvidence<T extends { caseId: string }>(evidence: T[], caseId: string | null) {
  return evidence.filter((item) => item.caseId === caseId);
}
