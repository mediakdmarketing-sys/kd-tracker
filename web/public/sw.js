// KD Tracker service worker.
//
// Strategy: network-first for all API/BFF calls (fresh data always matters for an attendance
// portal), cache-first for static assets (_next/static). Offline: show a simple offline page
// rather than a broken skeleton.
//
// Deliberately minimal — no Workbox dependency. The portal is not an offline-first app;
// the SW's job is (1) enable the "Add to Home Screen" install prompt, and (2) provide a
// friendly offline page instead of the browser's default error screen.

const CACHE = 'kd-tracker-v1';
const OFFLINE_URL = '/offline.html';

// Assets to pre-cache on install so the offline page is always available.
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Remove old caches from previous SW versions.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  // Static Next.js chunks: cache-first (they are content-hashed).
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
          return res;
        });
      })
    );
    return;
  }

  // Navigation requests (HTML pages): network-first, fall back to offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Everything else (API/BFF, images): network-only. Attendance data must be live.
});
