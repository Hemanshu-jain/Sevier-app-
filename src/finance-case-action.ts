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
    case 'imported':
      if (!recoveryCase.hasAuthority) return allowed('authority.approve') ? 'authority' : 'restricted';
      return allowed('case.assign') ? 'assign' : 'restricted';
    case 'unable_to_recover':
      return allowed('case.assign') ? 'assign' : 'restricted';
    case 'assigned':
      return 'waiting-field';
    case 'custody_review':
      return allowed('custody.review') ? 'custody-review' : 'restricted';
    case 'payment_pending':
      return allowed('payment.confirm') ? 'payment' : 'restricted';
    case 'payment_confirmed':
      return allowed('release.issue') ? 'release' : 'restricted';
    case 'release_pass_printed':
      return recoveryCase.hasReleasePass && allowed('release.close') ? 'print-close' : 'restricted';
    case 'closed':
      return 'closed';
    default:
      return 'restricted';
  }
}
