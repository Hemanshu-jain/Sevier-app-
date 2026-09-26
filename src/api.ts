import type { Agent, AgentGroup, AgentRates, AgentRating, OpenOffer, VerificationRequest, AppNotification, AuditEvent, CustodyRecord, EvidenceRecord, FinanceMember, RecoveryCase, ReleasePass } from './types';
import { apiUrl } from './api-origin.ts';

export type UserRole = 'super_admin' | 'finance_manager' | 'finance_staff' | 'agent' | 'platform_admin';

export interface SessionUser {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  role: UserRole;
  permissions: string[];
  name: string;
  email: string;
  mobile: string | null;
  city: string | null;
  onboardingComplete?: boolean;
  rates?: AgentRates;
  profile?: AgentProfile;
}

export interface AgentProfile {
  addressLine1: string;
  addressLine2: string;
  pincode: string;
  idProofType: 'aadhaar' | 'pan' | null;
  idProofLast4: string | null;
  avatar: string | null;
}

export interface ProfileInput {
  name: string;
  city: string;
  idProof?: string;
  idProofType?: 'aadhaar' | 'pan';
  addressLine1?: string;
  addressLine2?: string;
  pincode?: string;
  rateVehicle?: string;
  rateVerification?: string;
}

export interface CaseMessage {
  id: string;
  body: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  fromAgent: boolean;
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
  groups: AgentGroup[];
  notifications: AppNotification[];
  releasePasses: ReleasePass[];
  verifications?: VerificationRequest[];
  openOffers?: OpenOffer[];
}

export interface VerificationInput {
  reference: string;
  customerName: string;
  customerMobile: string;
  address: string;
  landmark: string;
  city: string;
  pincode: string;
  instructions: string;
}

export interface ImportResult {
  batchId: string;
  accepted: number;
  rejected: number;
  created: number;
  updated: number;
  duplicate: boolean;
  billing?: ChargeSummary;
}

export interface ChargeSummary {
  paid: number;
  pending: number;
  amountPaidPaise: number;
  amountDuePaise: number;
}

export interface Topup {
  id: string;
  tenantId: string;
  tenantName?: string;
  amountPaise: number;
  reference: string;
  status: 'pending' | 'confirmed' | 'rejected';
  requestedBy?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface BillingSummary {
  balancePaise: number;
  duePaise: number;
  lockedCount: number;
  month: { count: number; amountPaise: number };
  allTime: { count: number; amountPaise: number };
  prices: { vehicleRowPaise: number; verificationFeePaise: number };
  paymentInstructions: string;
  topupAmountsPaise: number[];
  imports: Array<{ id: string; fileName: string; snapshotMonth: string; createdAt: string; rowsCharged: number; amountPaise: number; pendingRows: number }>;
  charges: Array<{ id: number; itemType: string; itemId: string; amountPaise: number; status: 'paid' | 'pending'; createdAt: string; paidAt?: string }>;
  topups: Topup[];
}

export interface PlatformSettings {
  vehicleRowPaise: number;
  verificationFeePaise: number;
  apiKeyFeePaise: number;
  paymentInstructions: string;
}

export interface PlatformOverview {
  keyRequests: KeyRequest[];
  topups: Topup[];
  tenants: Array<{ id: string; name: string; balancePaise: number; duePaise: number; lockedCount: number; chargedCount: number }>;
  settings: PlatformSettings;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdBy?: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface KeyRequest {
  id: string;
  tenantId: string;
  tenantName?: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  feePaise?: number;
  requestedBy?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface ApiKeyAllowance {
  limit: number;
  active: number;
  extraKeyFeePaise: number;
  latestRequest: KeyRequest | null;
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

export interface DirectoryAgent {
  id: string;
  name: string;
  mobile: string;
  city: string | null;
  createdVia: string;
  linked: boolean;
  rating?: AgentRating | null;
  rates?: AgentRates;
}

const sessionKey = 'handoff-session';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

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
  const response = await fetch(apiUrl(path, import.meta.env.VITE_API_ORIGIN), {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(error.error || 'The request could not be completed.', response.status);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const api = {
  requestOtp: (mobile: string) => request<OtpChallenge>('/api/auth/request-otp', { method: 'POST', body: JSON.stringify({ mobile }) }),
  verifyOtp: (mobile: string, code: string, challengeId: string) => request<Session>('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ mobile, code, challengeId }) }),
  financeSignupVerify: (mobile: string, code: string, challengeId: string, company: { companyName: string; name: string; city: string }) => request<Session>('/api/finance/signup/verify', { method: 'POST', body: JSON.stringify({ mobile, code, challengeId, ...company }) }),
  signupRequestOtp: (mobile: string) => request<OtpChallenge>('/api/agent/signup/request-otp', { method: 'POST', body: JSON.stringify({ mobile }) }),
  signupVerify: (mobile: string, code: string, challengeId: string) => request<Session>('/api/agent/signup/verify', { method: 'POST', body: JSON.stringify({ mobile, code, challengeId }) }),
  updateProfile: (token: string, values: ProfileInput) => request<{ user: SessionUser }>('/api/profile', { method: 'PUT', body: JSON.stringify(values) }, token),
  updateProfilePhoto: (token: string, photo: string) => request<{ user: SessionUser }>('/api/profile/photo', { method: 'PUT', body: JSON.stringify({ photo }) }, token),
  caseMessages: (token: string, caseId: string) => request<{ messages: CaseMessage[] }>(`/api/cases/${caseId}/messages`, {}, token),
  sendCaseMessage: (token: string, caseId: string, body: string) => request<{ message: CaseMessage }>(`/api/cases/${caseId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }, token),
  logout: (token: string) => request<void>('/api/auth/logout', { method: 'POST' }, token),
  me: (token: string) => request<{ user: SessionUser }>('/api/me', {}, token),
  workspace: (token: string) => request<Workspace>('/api/workspace', {}, token),
  createAgent: (token: string, values: { name: string; mobile: string; city: string }) => request<{ agent: Agent }>('/api/agents', { method: 'POST', body: JSON.stringify(values) }, token),
  setAgentActive: (token: string, agentId: string, active: boolean) => request<{ agent: Agent }>(`/api/agents/${agentId}/status`, { method: 'PUT', body: JSON.stringify({ active }) }, token),
  agentDirectory: (token: string, q: string) => request<{ agents: DirectoryAgent[] }>(`/api/agents/directory?q=${encodeURIComponent(q)}`, {}, token),
  linkAgent: (token: string, agentId: string) => request<{ agent: Agent }>(`/api/agents/${agentId}/link`, { method: 'POST' }, token),
  createGroup: (token: string, values: { name: string; agentIds: string[] }) => request<{ group: AgentGroup }>('/api/agent-groups', { method: 'POST', body: JSON.stringify(values) }, token),
  updateGroup: (token: string, groupId: string, values: { name?: string; agentIds?: string[] }) => request<{ groups: AgentGroup[] }>(`/api/agent-groups/${groupId}`, { method: 'PUT', body: JSON.stringify(values) }, token),
  deleteGroup: (token: string, groupId: string) => request<void>(`/api/agent-groups/${groupId}`, { method: 'DELETE' }, token),
  broadcastGroup: (token: string, groupId: string, values: { title: string; detail: string }) => request<{ delivered: number }>(`/api/agent-groups/${groupId}/broadcast`, { method: 'POST', body: JSON.stringify(values) }, token),
  createAccount: (token: string, values: AccountInput) => request<{ case: RecoveryCase }>('/api/accounts', { method: 'POST', body: JSON.stringify(values) }, token),
  updateAccount: (token: string, caseId: string, values: AccountInput) => request<{ case: RecoveryCase }>(`/api/accounts/${caseId}`, { method: 'PUT', body: JSON.stringify(values) }, token),
  auditEvents: (token: string) => request<{ events: AuditEvent[] }>('/api/audit-events', {}, token),
  members: (token: string) => request<{ members: FinanceMember[] }>('/api/members', {}, token),
  createMember: (token: string, values: { name: string; mobile: string; city: string; role: string }) => request<{ member: FinanceMember }>('/api/members', { method: 'POST', body: JSON.stringify(values) }, token),
  setMemberActive: (token: string, memberId: string, active: boolean) => request<{ member: FinanceMember }>(`/api/members/${memberId}/status`, { method: 'PUT', body: JSON.stringify({ active }) }, token),
  caseReport: async (token: string) => {
    const response = await fetch(apiUrl('/api/reports/cases.csv', import.meta.env.VITE_API_ORIGIN), { headers: { Authorization: `Bearer ${token}` } });
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
  assignCase: (token: string, caseId: string, agentIds: string[], assignmentNote: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/assignment`, { method: 'PUT', body: JSON.stringify({ agentIds, assignmentNote }) }, token),
  recordAttempt: (token: string, caseId: string, reason: string, note: string, mutationId: string, location?: { latitude: number; longitude: number }) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/attempt`, { method: 'POST', headers: { 'Idempotency-Key': mutationId }, body: JSON.stringify({ reason, note, ...location }) }, token),
  recordCustody: (token: string, caseId: string, values: { yardName: string; arrivalTime: string; parkingRate: number; checklist: number; inspection: Record<string, string>; customNote?: string; latitude?: number; longitude?: number }, mutationId: string) => request<{ case: RecoveryCase; custody: CustodyRecord }>(`/api/cases/${caseId}/custody`, { method: 'POST', headers: { 'Idempotency-Key': mutationId }, body: JSON.stringify(values) }, token),
  approveCustody: (token: string, caseId: string, note: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/custody-review`, { method: 'POST', body: JSON.stringify({ note }) }, token),
  requestCustodyChanges: (token: string, caseId: string, note: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/custody-changes`, { method: 'POST', body: JSON.stringify({ note }) }, token),
  revokeAuthority: (token: string, caseId: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/authority-revocation`, { method: 'POST' }, token),
  confirmPayment: (token: string, caseId: string, reference: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/payment-confirmation`, { method: 'POST', body: JSON.stringify({ reference }) }, token),
  releasePass: (token: string, caseId: string) => request<{ case: RecoveryCase; releasePass: ReleasePass }>(`/api/cases/${caseId}/release-pass`, { method: 'POST' }, token),
  closeCase: (token: string, caseId: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/close`, { method: 'POST' }, token),
  revokeReleasePass: (token: string, caseId: string, reason: string) => request<{ ok: boolean }>(`/api/cases/${caseId}/release-revocation`, { method: 'POST', body: JSON.stringify({ reason }) }, token),
  readNotifications: (token: string) => request<void>('/api/notifications/read-all', { method: 'POST' }, token),
  billing: (token: string) => request<BillingSummary>('/api/billing', {}, token),
  createVerification: (token: string, values: VerificationInput) => request<{ verification: VerificationRequest; billing: ChargeSummary }>('/api/verifications', { method: 'POST', body: JSON.stringify(values) }, token),
  assignVerification: (token: string, requestId: string, agentId: string) => request<{ verification: VerificationRequest }>(`/api/verifications/${requestId}/assignment`, { method: 'PUT', body: JSON.stringify({ agentId }) }, token),
  cancelVerification: (token: string, requestId: string) => request<{ verification: VerificationRequest }>(`/api/verifications/${requestId}/cancel`, { method: 'POST' }, token),
  verificationEvidence: (token: string, requestId: string) => request<{ evidence: EvidenceRecord[] }>(`/api/verifications/${requestId}/evidence`, {}, token),
  verificationPhoto: async (token: string, evidenceId: string) => {
    const response = await fetch(apiUrl(`/api/verification-evidence/${evidenceId}/file`, import.meta.env.VITE_API_ORIGIN), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new ApiError('The photo could not be loaded.', response.status);
    return response.blob();
  },
  submitVerification: (token: string, requestId: string, files: File[], mutationId: string, values: { capturedAt: string; location: { latitude: number; longitude: number }; result: 'verified' | 'not_verified'; note: string }) => {
    const body = new FormData();
    for (const file of files) body.append('files', file);
    body.append('capturedAt', values.capturedAt);
    body.append('latitude', String(values.location.latitude));
    body.append('longitude', String(values.location.longitude));
    body.append('result', values.result);
    body.append('note', values.note);
    return request<{ verification: VerificationRequest }>(`/api/verifications/${requestId}/submit`, { method: 'POST', headers: { 'Idempotency-Key': mutationId }, body }, token);
  },
  setAgentVisibility: (token: string, caseId: string, visibility: { customer: boolean; vehicle: boolean }) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/agent-visibility`, { method: 'PUT', body: JSON.stringify(visibility) }, token),
  rateAgent: (token: string, values: { jobType?: 'case' | 'verification'; caseId?: string; jobId?: string; agentId: string; stars: number; comment?: string }) => request<{ rating: { stars: number } }>('/api/ratings', { method: 'POST', body: JSON.stringify(values) }, token),
  apiKeys: (token: string) => request<{ keys: ApiKey[]; allowance: ApiKeyAllowance }>('/api/api-keys', {}, token),
  requestApiKey: (token: string, reason: string) => request<{ request: KeyRequest }>('/api/api-keys/requests', { method: 'POST', body: JSON.stringify({ reason }) }, token),
  decideApiKeyRequest: (token: string, requestId: string, decision: 'approve' | 'reject') => request<{ status: string }>(`/api/platform/api-key-requests/${requestId}/decision`, { method: 'POST', body: JSON.stringify({ decision }) }, token),
  offerCase: (token: string, caseId: string) => request<{ case: RecoveryCase; notified: number }>(`/api/cases/${caseId}/offer`, { method: 'POST' }, token),
  withdrawOffer: (token: string, caseId: string) => request<{ case: RecoveryCase }>(`/api/cases/${caseId}/offer`, { method: 'DELETE' }, token),
  acceptOffer: (token: string, caseId: string) => request<{ caseId: string }>(`/api/cases/${caseId}/accept-offer`, { method: 'POST' }, token),
  createApiKey: (token: string, name: string) => request<{ key: ApiKey & { key: string } }>('/api/api-keys', { method: 'POST', body: JSON.stringify({ name }) }, token),
  revokeApiKey: (token: string, keyId: string) => request<void>(`/api/api-keys/${keyId}`, { method: 'DELETE' }, token),
  requestTopup: (token: string, amountPaise: number, reference: string) => request<{ topup: Topup }>('/api/billing/topups', { method: 'POST', body: JSON.stringify({ amountPaise, reference }) }, token),
  platformOverview: (token: string) => request<PlatformOverview>('/api/platform/overview', {}, token),
  decideTopup: (token: string, topupId: string, decision: 'confirm' | 'reject') => request<{ settled: number }>(`/api/platform/topups/${topupId}/decision`, { method: 'POST', body: JSON.stringify({ decision }) }, token),
  updatePlatformSettings: (token: string, values: { vehicleRowRupees: number; verificationFeeRupees: number; apiKeyFeeRupees: number; paymentInstructions: string }) => request<{ settings: PlatformSettings }>('/api/platform/settings', { method: 'PUT', body: JSON.stringify(values) }, token),
  evidence: (token: string, caseId: string) => request<{ evidence: EvidenceRecord[] }>(`/api/cases/${caseId}/evidence`, {}, token),
  evidenceFile: async (token: string, evidenceId: string) => {
    const response = await fetch(apiUrl(`/api/evidence/${evidenceId}/file`, import.meta.env.VITE_API_ORIGIN), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('The secured evidence file could not be loaded.');
    return response.blob();
  },
  uploadEvidence: (token: string, caseId: string, files: File[], mutationId: string, capturedAt: string, location?: { latitude: number; longitude: number }) => {
    const body = new FormData();
    files.forEach((file) => body.append('files', file));
    body.append('capturedAt', capturedAt);
    if (location) { body.append('latitude', String(location.latitude)); body.append('longitude', String(location.longitude)); }
    return request<{ evidence: EvidenceRecord[] }>(`/api/cases/${caseId}/evidence`, { method: 'POST', headers: { 'Idempotency-Key': mutationId }, body }, token);
  },
};
