/* ═══════════════════════════════════════════
   SAI DENTAL CLINIC — SERVICE WORKER
   sw.js  (PWA offline support)
═══════════════════════════════════════════ */

const CACHE_NAME = 'sai-dental-v4';

/* Files to cache for offline use */
const PRECACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/firebase-init.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-144.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=DM+Sans:wght@300;400;500&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

/* Install: cache all precache files */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

/* Activate: clear old caches */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Fetch: network-first for Firebase/API, cache-first for assets */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Always go network-first for Firebase requests */
  if (url.hostname.includes('firebase') || url.hostname.includes('firestore') || url.hostname.includes('googleapis')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  /* Cache-first for everything else (assets, fonts, HTML, CSS, JS) */
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        /* Cache valid GET responses */
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        /* Fallback to index.html for navigation requests */
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});