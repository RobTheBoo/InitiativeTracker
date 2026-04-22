// Service Worker per RPG Initiative Tracker - Vista Giocatore (PWA)

const CACHE_NAME = 'rpg-tracker-pwa-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/ui-enhancements.css',
  '/app.js',
  '/ui-enhancements.js',
  '/socket.io.min.js',
  '/manifest.webmanifest',
  '/icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Lascia stare le richieste Socket.io e non-GET
  if (request.method !== 'GET' || request.url.includes('/socket.io/')) {
    return;
  }

  // Per le navigazioni (HTML), usa network-first con fallback alla cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  // Per gli asset statici, cache-first con fallback alla rete
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);
    })
  );
});

