export function shouldCacheRequest({ method, url, origin }) {
  if (method !== 'GET') return false;
  const requestUrl = new URL(url);
  // Downloads (the agent APK) must reach the browser straight from the network: a service-worker-supplied
  // binary may not be saved as a download on Android, and the offline fallback would return the app page instead.
  if (requestUrl.pathname.startsWith('/download/')) return false;
  return requestUrl.origin === origin && requestUrl.pathname !== '/api' && !requestUrl.pathname.startsWith('/api/');
}
