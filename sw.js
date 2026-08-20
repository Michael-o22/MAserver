/**
 * MAserver - Service Worker
 * Offline Caching & Progressive Web App Support
 */

const CACHE_NAME = 'maserver-audit-v4';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './data.js',
  './firebase-config.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// Install Event: Pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[Service Worker] Some assets failed to pre-cache', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Network-First with Stale-While-Revalidate / Cache Fallback
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Skip non-GET requests and Firebase Firestore/Storage WebSocket or API requests
  if (request.method !== 'GET' || request.url.includes('firestore.googleapis.com') || request.url.includes('firebasestorage.googleapis.com') || request.url.includes('/api/upload')) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // Return cached response immediately if found, while fetching fresh in background
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // Network failed (offline)
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
