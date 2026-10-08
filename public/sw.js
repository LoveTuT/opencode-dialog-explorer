/* Service worker for the "opencode Dialog Explorer" PWA.
 *
 * Strategy:
 *  - Precache a minimal app shell on install.
 *  - Navigations and API requests require the local server: a stopped service
 *    must not appear to be running by serving cached conversations.
 *  - Static assets use network-first with a cache fallback.
 *
 * To disable during development: unregister via DevTools > Application >
 * Service Workers, or call navigator.serviceWorker.getRegistrations().
 */

const VERSION = 'v4';
const CACHE_NAME = `opencode-dialog-explorer-${VERSION}`;

// App shell. Vite serves index.html at '/', so caching '/' covers the shell.
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icon-32.png',
  '/icon-64.png',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll is atomic; use individual best-effort puts so one missing
      // asset (e.g. during dev) doesn't abort the whole install.
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res && res.ok) await cache.put(url, res.clone());
          } catch (_) {
            /* ignore individual failures */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([CACHE_NAME]);
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => (keep.has(name) ? null : caches.delete(name)))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET; let the browser deal with POST/PUT/etc.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle same-origin requests; pass through cross-origin untouched.
  if (url.origin !== self.location.origin) return;

  // Conversation data must never be served from a cache after the server stops.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // A stopped service should make new navigations fail, not show a stale shell.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request));
    return;
  }

  // Other same-origin GETs (assets): network-first so new builds win,
  // cache fallback when offline.
  event.respondWith(networkFirst(request, CACHE_NAME));
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
