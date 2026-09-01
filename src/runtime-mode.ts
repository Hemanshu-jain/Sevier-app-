export function loginDefaults(development: boolean) {
  return development
    ? { mobile: '+91 98450 11111', showDemoAccounts: true }
    : { mobile: '', showDemoAccounts: false };
}
