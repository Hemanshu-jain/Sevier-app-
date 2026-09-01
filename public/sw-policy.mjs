export function shouldCacheRequest({ method, url, origin }) {
  if (method !== 'GET') return false;
  const requestUrl = new URL(url);
  return requestUrl.origin === origin && requestUrl.pathname !== '/api' && !requestUrl.pathname.startsWith('/api/');
}
