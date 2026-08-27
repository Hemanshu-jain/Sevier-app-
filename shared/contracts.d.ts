export type CaseStatus =
  | 'draft'
  | 'awaiting_authority'
  | 'ready_to_assign'
  | 'awaiting_agent'
  | 'in_field'
  | 'attempt_review'
  | 'custody_review'
  | 'payment_pending'
  | 'payment_confirmed'
  | 'release_issued'
  | 'closed'
  | 'cancelled';

export const CASE_STATUS: Readonly<Record<string, CaseStatus>>;
export const PERMISSIONS: Readonly<Record<string, string>>;
export const ROLE_TEMPLATES: Readonly<Record<'owner' | 'manager' | 'staff' | 'agent', readonly string[]>>;
export function canTransition(from: CaseStatus, to: CaseStatus): boolean;
export function hasPermission(permissions: readonly string[] | null | undefined, permission: string): boolean;
export function permissionsForRole(role: string): readonly string[];
