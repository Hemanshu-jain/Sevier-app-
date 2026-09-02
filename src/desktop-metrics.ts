const financeReviewStatuses = new Set(['imported', 'unable_to_recover', 'custody_review', 'payment_pending']);

export function financeReviewCases<T extends { status: string }>(cases: readonly T[]) {
  return cases.filter((item) => financeReviewStatuses.has(item.status));
}

export function recoveryPipeline(cases: readonly { status: string }[]) {
  const count = (...statuses: string[]) => cases.filter((item) => statuses.includes(item.status)).length;
  return [
    { label: 'Import', count: count('imported') },
    { label: 'Field work', count: count('assigned', 'unable_to_recover') },
    { label: 'Custody', count: count('custody_review') },
    { label: 'Payment', count: count('payment_pending', 'payment_confirmed') },
    { label: 'Release', count: count('release_pass_printed', 'closed') },
  ];
}
