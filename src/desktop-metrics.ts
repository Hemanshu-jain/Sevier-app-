const financeReviewStatuses = new Set(['Imported', 'Unable to recover', 'Custody review', 'Payment pending']);

export function financeReviewCases<T extends { status: string }>(cases: readonly T[]) {
  return cases.filter((item) => financeReviewStatuses.has(item.status));
}

export function recoveryPipeline(cases: readonly { status: string }[]) {
  const count = (...statuses: string[]) => cases.filter((item) => statuses.includes(item.status)).length;
  return [
    { label: 'Import', count: count('Imported') },
    { label: 'Field work', count: count('Assigned', 'Accepted', 'Attempt in progress', 'Unable to recover') },
    { label: 'Custody', count: count('Recovered', 'Custody certificate issued', 'Custody review') },
    { label: 'Payment', count: count('Payment pending', 'Payment confirmed') },
    { label: 'Release', count: count('Release pass printed', 'Closed') },
  ];
}
