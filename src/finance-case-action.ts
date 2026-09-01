export type FinanceCaseAction =
  | 'authority'
  | 'assign'
  | 'waiting-field'
  | 'waiting-custody'
  | 'custody-review'
  | 'payment'
  | 'release'
  | 'print-close'
  | 'closed'
  | 'restricted';

export function financeCaseAction(
  recoveryCase: { status: string; hasAuthority?: boolean; hasCustody?: boolean; hasReleasePass?: boolean },
  permissions: readonly string[] | null | undefined,
): FinanceCaseAction {
  const allowed = (permission: string) => permissions?.includes(permission) ?? false;
  switch (recoveryCase.status) {
    case 'Imported':
      if (!recoveryCase.hasAuthority) return allowed('authority.approve') ? 'authority' : 'restricted';
      return allowed('case.assign') ? 'assign' : 'restricted';
    case 'Unable to recover':
      return allowed('case.assign') ? 'assign' : 'restricted';
    case 'Assigned':
    case 'Accepted':
    case 'Attempt in progress':
      return 'waiting-field';
    case 'Recovered':
    case 'Custody certificate issued':
      if (!recoveryCase.hasCustody) return 'waiting-custody';
      return allowed('custody.review') ? 'custody-review' : 'restricted';
    case 'Custody review':
      return allowed('custody.review') ? 'custody-review' : 'restricted';
    case 'Payment pending':
      return allowed('payment.confirm') ? 'payment' : 'restricted';
    case 'Payment confirmed':
      return allowed('release.issue') ? 'release' : 'restricted';
    case 'Release pass printed':
      return recoveryCase.hasReleasePass && allowed('release.close') ? 'print-close' : 'restricted';
    case 'Closed':
      return 'closed';
    default:
      return 'restricted';
  }
}
