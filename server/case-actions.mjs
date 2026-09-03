export function validateCaseAction(action, recoveryCase, context = {}) {
  switch (action) {
    case 'approve_authority':
      if (recoveryCase.status !== 'imported') return 'Only an imported case can receive authority approval.';
      return context.hasDocument ? null : 'An authority document is required.';
    case 'assign':
      if (!recoveryCase.authority_approved_at) return 'Approve and attach the authority document before assignment.';
      if (String(context.assignmentNote || '').length > 2000) return 'The assignment note must be 2,000 characters or fewer.';
      return ['imported', 'unable_to_recover', 'assigned'].includes(recoveryCase.status) ? null : 'This case is not ready for assignment.';
    case 'approve_custody':
      return recoveryCase.status === 'custody_review' ? null : 'A submitted custody report is required.';
    case 'confirm_payment':
      return recoveryCase.status === 'payment_pending' ? null : 'Finance must approve custody before confirming payment.';
    case 'issue_release':
      return recoveryCase.status === 'payment_confirmed' && recoveryCase.payment_cleared ? null : 'Payment must be confirmed before issuing a release pass.';
    case 'close':
      return recoveryCase.status === 'release_pass_printed' && recoveryCase.release_pass_id ? null : 'Issue a release pass before closing the case.';
    default:
      return 'Unknown case action.';
  }
}
