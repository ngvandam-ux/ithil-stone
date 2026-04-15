const CACHE_NAME = 'ithilstone-v1';
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/favicon.png',
];

// Cache art images
const ART_URLS = [
  '/art/tolkien-fingolfin-morgoth.jpg',
  '/art/tolkien-rohirrim-charge.jpg',
  '/art/tolkien-gandalf-counsel.jpg',
  '/art/tolkien-palantir.jpg',
  '/art/tolkien-mordor-fortress.jpg',
  '/art/tolkien-fellowship-road.jpg',
  '/art/tolkien-duel-of-songs.jpg',
  '/art/tolkien-star-hope.jpg',
  '/art/tolkien-feanor-oath.jpg',
  '/art/tolkien-sword-reforged.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...PRECACHE_URLS, ...ART_URLS]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Cache-first for static assets and art
  if (url.pathname.startsWith('/art/') || url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg' || url.pathname === '/favicon.png') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      }))
    );
    return;
  }
  // Network-first for everything else
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
