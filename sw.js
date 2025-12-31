const CACHE_NAME = 'pixelforge-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/PixelEditor.js',
  './js/GIFEncoder.js',
  './js/SolanaManager.js',
  './js/irys.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://unpkg.com/@solana/web3.js@latest/lib/index.iife.min.js'
];

// Install Event
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force update
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching Assets');
      return cache.addAll(ASSETS);
    })
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
      })
    ])
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
