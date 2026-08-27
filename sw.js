// sw.js — offline app-shell cache for the installed (home-screen) app.
// Cache-first for the static assets so the app opens instantly and works
// without a connection. Audio is processed live on-device; nothing here
// caches or transmits recordings.

const CACHE = 'bark-translator-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/classifier.js',
  './js/audio-engine.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).catch(() => caches.match('./index.html'))
    )
  );
});
