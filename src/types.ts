export type CaseStatus =
  | 'Imported'
  | 'Assigned'
  | 'Accepted'
  | 'Attempt in progress'
  | 'Unable to recover'
  | 'Recovered'
  | 'Custody certificate issued'
  | 'Custody review'
  | 'Payment pending'
  | 'Payment confirmed'
  | 'Release pass printed'
  | 'Closed';

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
  financeReviewedAt?: string;
  financeReviewNote?: string;
}

export interface AppNotification {
  id: string;
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
