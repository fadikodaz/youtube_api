// Service worker: makes YTPocket installable and keeps the app shell
// available when the network drops. API calls and downloads are never cached.
const CACHE = 'ytpocket-shell-v3';
const SHELL = [
  '/',
  '/app.css',
  '/app.js',
  '/nav.js',
  '/theme.js',
  '/icons.svg',
  '/icon.svg',
  '/fonts/bricolage-latin.woff2',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Network first (so updates show up immediately), cached copy when offline.
  // The app page is matched without its query string (share-target launches).
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && SHELL.includes(url.pathname) && !url.search) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req.mode === 'navigate' ? '/' : req, { ignoreSearch: req.mode === 'navigate' })
          .then((hit) => hit || Response.error())
      )
  );
});
