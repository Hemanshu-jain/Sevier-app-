import { shouldCacheRequest } from './sw-policy.mjs';

const CACHE_NAME = 'handoff-field-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys()
    .then((names) => Promise.all(names.filter((name) => name.startsWith('handoff-field-') && name !== CACHE_NAME).map((name) => caches.delete(name))))
    .then(() => self.clients.claim()),
));
self.addEventListener('fetch', (event) => {
  if (!shouldCacheRequest({ method: event.request.method, url: event.request.url, origin: self.location.origin })) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))));
});
