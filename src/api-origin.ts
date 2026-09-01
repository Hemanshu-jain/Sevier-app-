export function apiUrl(path: string, configuredOrigin: string | undefined) {
  const origin = String(configuredOrigin || '').trim();
  if (!origin) return path;
  const parsed = new URL(origin);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('The API origin must use HTTP or HTTPS.');
  return new URL(path, parsed.origin).toString();
}
