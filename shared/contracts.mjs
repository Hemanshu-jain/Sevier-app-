// Canonical case statuses: the real runtime lifecycle in lowercase snake_case.
// Single source of truth for the PostgreSQL schema, API, and React display.
// ponytail: the PG CHECK constraint lists these literally — keep the two in sync.
export const CASE_STATUS = Object.freeze({
  IMPORTED: 'imported',
  ASSIGNED: 'assigned',
  UNABLE_TO_RECOVER: 'unable_to_recover',
  CUSTODY_REVIEW: 'custody_review',
  PAYMENT_PENDING: 'payment_pending',
  PAYMENT_CONFIRMED: 'payment_confirmed',
  RELEASE_PASS_PRINTED: 'release_pass_printed',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
});

// Sentence-case the snake_case status for display. Reproduces every legacy label exactly.
export function caseStatusLabel(status) {
  return String(status).replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

export const PERMISSIONS = Object.freeze({
  ORGANIZATION_MANAGE: 'organization.manage',
  MEMBER_MANAGE: 'member.manage',
  ROLE_MANAGE: 'role.manage',
  AGENT_MANAGE: 'agent.manage',
  IMPORT_MANAGE: 'import.manage',
  ACCOUNT_MANAGE: 'account.manage',
  CASE_CREATE: 'case.create',
  AUTHORITY_APPROVE: 'authority.approve',
  CASE_ASSIGN: 'case.assign',
  ASSIGNMENT_RESPOND: 'assignment.respond',
  ATTEMPT_SUBMIT: 'attempt.submit',
  ATTEMPT_REVIEW: 'attempt.review',
  CUSTODY_SUBMIT: 'custody.submit',
  CUSTODY_REVIEW: 'custody.review',
  PAYMENT_CONFIRM: 'payment.confirm',
  RELEASE_ISSUE: 'release.issue',
  RELEASE_REVOKE: 'release.revoke',
  RELEASE_CLOSE: 'release.close',
  REPORT_EXPORT: 'report.export',
  AUDIT_VIEW: 'audit.view',
  RETENTION_MANAGE: 'retention.manage',
});

export const ROLE_TEMPLATES = Object.freeze({
  owner: Object.freeze(Object.values(PERMISSIONS)),
  manager: Object.freeze([
    PERMISSIONS.MEMBER_MANAGE,
    PERMISSIONS.AGENT_MANAGE,
    PERMISSIONS.IMPORT_MANAGE,
    PERMISSIONS.ACCOUNT_MANAGE,
    PERMISSIONS.CASE_CREATE,
    PERMISSIONS.AUTHORITY_APPROVE,
    PERMISSIONS.CASE_ASSIGN,
    PERMISSIONS.ATTEMPT_REVIEW,
    PERMISSIONS.CUSTODY_REVIEW,
    PERMISSIONS.PAYMENT_CONFIRM,
    PERMISSIONS.RELEASE_ISSUE,
    PERMISSIONS.RELEASE_REVOKE,
    PERMISSIONS.RELEASE_CLOSE,
    PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.AUDIT_VIEW,
  ]),
  staff: Object.freeze([
    PERMISSIONS.IMPORT_MANAGE,
    PERMISSIONS.ACCOUNT_MANAGE,
    PERMISSIONS.CASE_CREATE,
  ]),
  agent: Object.freeze([
    PERMISSIONS.ASSIGNMENT_RESPOND,
    PERMISSIONS.ATTEMPT_SUBMIT,
    PERMISSIONS.CUSTODY_SUBMIT,
  ]),
});

export function hasPermission(permissions, permission) {
  return Array.isArray(permissions) && permissions.includes(permission);
}

const legacyRoles = Object.freeze({
  super_admin: 'owner',
  finance_manager: 'manager',
  finance_staff: 'staff',
  agent: 'agent',
});

export function permissionsForRole(role) {
  return ROLE_TEMPLATES[legacyRoles[role] || role] || [];
}
