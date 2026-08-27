import type { Agent, AppNotification, CustodyRecord, EvidenceRecord, RecoveryCase, ReleasePass } from './types';

export type UserRole = 'super_admin' | 'finance_manager' | 'finance_staff' | 'agent';

export interface SessionUser {
  id: string;
  tenantId: string;
  tenantName: string;
  role: UserRole;
  name: string;
  email: string;
  mobile: string | null;
  city: string | null;
}

export interface Session {
  token: string;
  user: SessionUser;
}

export interface Workspace {
  cases: RecoveryCase[];
  custody: CustodyRecord[];
  agents: Agent[];
  notifications: AppNotification[];
  releasePasses: ReleasePass[];
}

const sessionKey = 'handoff-session';

export function storedSession(): Session | null {
  try {
    const value = localStorage.getItem(sessionKey);
    return value ? JSON.parse(value) as Session : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  localStorage.setItem(sessionKey, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(sessionKey);
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'The request could not be completed.');
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) => request<Session>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: (token: string) => request<{ user: SessionUser }>('/api/me', {}, token),
  workspace: (token: string) => request<Workspace>('/api/workspace', {}, token),
  importDemoCase: (token: string) => request<{ case: RecoveryCase }>('/api/cases/import-demo', { method: 'POST' }, token),
  approveAuthority: (token: string, caseId: string, document: File) => {
    const body = new FormData();
    body.append('document', document);
    return request<{ case: RecoveryCase }>(`/api/cases/${caseId}/authority-approval`, { method: 'POST', body }, token);
  },
  assignCase: (token: string, caseId: string, agentId: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/assignment`, { method: 'PUT', body: JSON.stringify({ agentId }) }, token),
  recordAttempt: (token: string, caseId: string, reason: string, note: string, location?: { latitude: number; longitude: number }) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/attempt`, { method: 'POST', body: JSON.stringify({ reason, note, ...location }) }, token),
  recordCustody: (token: string, caseId: string, values: { yardName: string; arrivalTime: string; parkingRate: number; checklist: number; inspection: Record<string, string>; latitude?: number; longitude?: number }) => request<{ case: RecoveryCase; custody: CustodyRecord }>(`/api/cases/${caseId}/custody`, { method: 'POST', body: JSON.stringify(values) }, token),
  approveCustody: (token: string, caseId: string, note: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/custody-review`, { method: 'POST', body: JSON.stringify({ note }) }, token),
  confirmPayment: (token: string, caseId: string, reference: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/payment-confirmation`, { method: 'POST', body: JSON.stringify({ reference }) }, token),
  releasePass: (token: string, caseId: string) => request<{ case: RecoveryCase; releasePass: ReleasePass }>(`/api/cases/${caseId}/release-pass`, { method: 'POST' }, token),
  closeCase: (token: string, caseId: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/close`, { method: 'POST' }, token),
  readNotifications: (token: string) => request<void>('/api/notifications/read-all', { method: 'POST' }, token),
  evidence: (token: string, caseId: string) => request<{ evidence: EvidenceRecord[] }>(`/api/cases/${caseId}/evidence`, {}, token),
  evidenceFile: async (token: string, evidenceId: string) => {
    const response = await fetch(`/api/evidence/${evidenceId}/file`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('The secured evidence file could not be loaded.');
    return response.blob();
  },
  uploadEvidence: (token: string, caseId: string, files: File[], location?: { latitude: number; longitude: number }) => {
    const body = new FormData();
    files.forEach((file) => body.append('files', file));
    body.append('capturedAt', new Date().toISOString());
    if (location) { body.append('latitude', String(location.latitude)); body.append('longitude', String(location.longitude)); }
    return request<{ evidence: EvidenceRecord[] }>(`/api/cases/${caseId}/evidence`, { method: 'POST', body }, token);
  },
};
