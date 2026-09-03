export type CaseStatus =
  | 'imported'
  | 'assigned'
  | 'unable_to_recover'
  | 'custody_review'
  | 'payment_pending'
  | 'payment_confirmed'
  | 'release_pass_printed'
  | 'closed'
  | 'cancelled';

// Sentence-case a snake_case status for display (mirrors shared/contracts.mjs caseStatusLabel).
export function caseStatusLabel(status: string) {
  return status.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

export type AttemptReason =
  | 'Vehicle not found'
  | 'Vehicle details mismatch'
  | 'Unsafe situation'
  | 'Customer dispute'
  | 'Authority issue'
  | 'Other';

export interface Agent {
  id: string;
  name: string;
  mobile: string;
  city: string;
  activeCases: number;
  completedThisMonth: number;
  status: 'Active' | 'Suspended';
}

export interface RecoveryCase {
  id: string;
  accountNumber: string;
  borrower: { name: string; mobile: string; address: string };
  vehicle: { registration: string; makeModel: string; chassis: string; type: '2-wheeler' | '4-wheeler' };
  branch: string;
  pendingAmount: number;
  overdueDays: number;
  status: CaseStatus;
  assignedAgentId?: string;
  assignedAgents?: { id: string; name: string }[];
  assignedAt?: string;
  assignmentNote?: string;
  updatedAt: string;
  custodyId?: string;
  failure?: { reason: AttemptReason; note: string; recordedAt: string };
  paymentCleared?: boolean;
  paymentReference?: string;
  paymentConfirmedAt?: string;
  releasePassId?: string;
  authority?: { documentName: string; approvedAt: string };
}

export interface CustodyRecord {
  id: string;
  caseId: string;
  vehicleCondition: 'Verified';
  yardName: string;
  arrivalTime: string;
  parkingRate: number;
  createdAt: string;
  agentName: string;
  checklist: number;
  inspection?: Record<string, string>;
  customNote?: string;
  financeReviewedAt?: string;
  financeReviewNote?: string;
}

export interface AgentGroup {
  id: string;
  name: string;
  createdAt: string;
  members: { id: string; name: string }[];
}

export interface AppNotification {
  id: string;
  caseId?: string;
  title: string;
  detail: string;
  createdAt: string;
  read: boolean;
  tone: 'blue' | 'amber' | 'green' | 'red';
}

export interface EvidenceRecord {
  id: string;
  caseId: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  latitude: number | null;
  longitude: number | null;
  capturedAt: string;
  agentName?: string;
}

export interface ReleasePass {
  id: string;
  caseId: string;
  verificationCode: string;
  issuedAt: string;
  borrowerName: string;
  borrowerMobile: string;
  vehicleRegistration: string;
  vehicleModel: string;
  custodyId?: string;
  paymentReference?: string;
  issuedByName?: string;
  signedToken?: string;
  lifecycle?: 'valid' | 'revoked' | 'redeemed' | 'expired';
}

export interface AuditEvent {
  id: number;
  caseId: string | null;
  actorName: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface FinanceMember {
  id: string;
  name: string;
  mobile: string;
  city: string;
  role: 'super_admin' | 'finance_manager' | 'finance_staff';
  active: boolean;
}
