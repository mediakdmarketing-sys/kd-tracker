// KD Tracker service worker.
//
// Strategy: network-first for all API/BFF calls (fresh data always matters for an attendance
// portal) and for static assets (_next/static, cached only as an offline fallback — see the
// fetch handler for why not cache-first). Offline: show a simple offline page
// rather than a broken skeleton.
//
// Deliberately minimal — no Workbox dependency. The portal is not an offline-first app;
// the SW's job is (1) enable the "Add to Home Screen" install prompt, and (2) provide a
// friendly offline page instead of the browser's default error screen.

// Bumped to v2 so the activate step below drops chunks the old cache-first rule left behind.
const CACHE = 'kd-tracker-v2';
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

  // Static Next.js chunks: network-first, cache only as an offline fallback.
  //
  // This used to be cache-first on the assumption that chunk names are content-hashed. They
  // are in a production build, but `next dev` (Turbopack) reuses the same file names while the
  // contents change, so cache-first kept serving old JS against new server HTML and every edit
  // showed up as a hydration mismatch until the site's data was cleared by hand. Network-first
  // is correct in both modes; the browser's own HTTP cache still gives hashed files their
  // long-lived caching.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
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
