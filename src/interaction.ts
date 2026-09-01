export function isActivationKey(key: string) {
  return key === 'Enter' || key === ' ';
}

export function isSearchShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }) {
  return event.key.toLowerCase() === 'k' && !event.altKey && (event.ctrlKey || event.metaKey);
}
