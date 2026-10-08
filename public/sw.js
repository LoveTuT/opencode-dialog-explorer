/* Service worker for the "opencode Dialog Explorer" PWA.
 *
 * Strategy:
 *  - Precache a minimal app shell on install.
 *  - Network-first for navigations and same-origin GET requests so fresh
 *    content always wins (important: keeps Vite HMR / new builds working).
 *    Falls back to the cache only when the network is unavailable (offline).
 *  - /api/* is never cached as the primary source of truth (data is dynamic
 *    and served locally). We still keep a best-effort cached copy so an
 *    offline reload can show stale data instead of a hard failure.
 *
 * To disable during development: unregister via DevTools > Application >
 * Service Workers, or call navigator.serviceWorker.getRegistrations().
 */

const VERSION = 'v3';
const CACHE_NAME = `opencode-dialog-explorer-${VERSION}`;
const API_CACHE_NAME = `opencode-dialog-explorer-api-${VERSION}`;

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
      const keep = new Set([CACHE_NAME, API_CACHE_NAME]);
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

  // API: always go to the network; never treat cache as primary. Keep a
  // best-effort cached copy purely as an offline fallback.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE_NAME));
    return;
  }

  // Navigations: network-first, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
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

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put('/', response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached =
      (await cache.match(request)) || (await cache.match('/'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
        '<body style="font-family:system-ui;background:#0d1117;color:#e6edf3;' +
        'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
        '<p>Offline and no cached copy available.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
    );
  }
}
