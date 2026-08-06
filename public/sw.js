// sw.js — cache the app shell so StudyHub opens fast and works offline for browsing UI.
// API responses and files are NEVER cached (auth + freshness); only static shell assets.
const CACHE = 'studyhub-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/api.js',
  '/app.js',
  '/viewer.js',
  '/chat.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never intercept API, socket, or file streams — always go to network.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    e.request.method !== 'GET'
  ) {
    return; // default browser behavior
  }

  // Shell assets: cache-first with background refresh.
  if (url.origin === self.location.origin && SHELL.includes(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const network = fetch(e.request).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Everything else (CDN scripts, etc.): network-first, fall back to cache if present.
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
