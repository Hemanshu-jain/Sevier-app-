import type { Agent, AppNotification, AuditEvent, CustodyRecord, EvidenceRecord, FinanceMember, RecoveryCase, ReleasePass } from './types';

export type UserRole = 'super_admin' | 'finance_manager' | 'finance_staff' | 'agent';

export interface SessionUser {
  id: string;
  tenantId: string;
  tenantName: string;
  role: UserRole;
  permissions: string[];
  name: string;
  email: string;
  mobile: string | null;
  city: string | null;
}

export interface Session {
  token: string;
  user: SessionUser;
}

export interface OtpChallenge {
  challengeId: string;
  expiresAt: string;
  developmentCode?: string;
}

export interface Workspace {
  cases: RecoveryCase[];
  custody: CustodyRecord[];
  agents: Agent[];
  notifications: AppNotification[];
  releasePasses: ReleasePass[];
}

export interface ImportResult {
  batchId: string;
  accepted: number;
  rejected: number;
  created: number;
  updated: number;
  duplicate: boolean;
}

export interface ImportError {
  row: number;
  message: string;
}

export interface AccountInput {
  accountNumber: string;
  borrowerName: string;
  borrowerMobile: string;
  borrowerAddress: string;
  registration: string;
  makeModel: string;
  vehicleType: string;
  chassis: string;
  branch: string;
  pendingAmount: string;
  overdueDays: string;
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
  requestOtp: (mobile: string) => request<OtpChallenge>('/api/auth/request-otp', { method: 'POST', body: JSON.stringify({ mobile }) }),
  verifyOtp: (mobile: string, code: string, challengeId: string) => request<Session>('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ mobile, code, challengeId }) }),
  logout: (token: string) => request<void>('/api/auth/logout', { method: 'POST' }, token),
  me: (token: string) => request<{ user: SessionUser }>('/api/me', {}, token),
  workspace: (token: string) => request<Workspace>('/api/workspace', {}, token),
  createAgent: (token: string, values: { name: string; mobile: string; city: string }) => request<{ agent: Agent }>('/api/agents', { method: 'POST', body: JSON.stringify(values) }, token),
  setAgentActive: (token: string, agentId: string, active: boolean) => request<{ agent: Agent }>(`/api/agents/${agentId}/status`, { method: 'PUT', body: JSON.stringify({ active }) }, token),
  createAccount: (token: string, values: AccountInput) => request<{ case: RecoveryCase }>('/api/accounts', { method: 'POST', body: JSON.stringify(values) }, token),
  updateAccount: (token: string, caseId: string, values: AccountInput) => request<{ case: RecoveryCase }>(`/api/accounts/${caseId}`, { method: 'PUT', body: JSON.stringify(values) }, token),
  auditEvents: (token: string) => request<{ events: AuditEvent[] }>('/api/audit-events', {}, token),
  members: (token: string) => request<{ members: FinanceMember[] }>('/api/members', {}, token),
  createMember: (token: string, values: { name: string; mobile: string; city: string; role: string }) => request<{ member: FinanceMember }>('/api/members', { method: 'POST', body: JSON.stringify(values) }, token),
  setMemberActive: (token: string, memberId: string, active: boolean) => request<{ member: FinanceMember }>(`/api/members/${memberId}/status`, { method: 'PUT', body: JSON.stringify({ active }) }, token),
  caseReport: async (token: string) => {
    const response = await fetch('/api/reports/cases.csv', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('The case report could not be exported.');
    return response.blob();
  },
  importMonthly: (token: string, file: File, snapshotMonth: string) => {
    const body = new FormData();
    body.append('file', file);
    body.append('snapshotMonth', snapshotMonth);
    return request<{ result: ImportResult; errors: ImportError[] }>('/api/imports/monthly', { method: 'POST', body }, token);
  },
  approveAuthority: (token: string, caseId: string, document: File) => {
    const body = new FormData();
    body.append('document', document);
    return request<{ case: RecoveryCase }>(`/api/cases/${caseId}/authority-approval`, { method: 'POST', body }, token);
  },
  assignCase: (token: string, caseId: string, agentId: string, assignmentNote: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/assignment`, { method: 'PUT', body: JSON.stringify({ agentId, assignmentNote }) }, token),
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
