// sw.js — forket UENDRET (mønster) fra Bondøya, se
// mittbondøya-workspace/bondoya/sw.js. Minimal service worker, kun for
// PWA-installerbarhet + at app-skallet laster selv uten nett. All ekte data
// (Worker-API, KI-proxy) går alltid rett til nettverket, uberørt.
//
// Network-first med cache kun som offline-fallback — IKKE cache-først. Se
// Bondøyas sw.js-kommentar for hele historikken (v0.9.23-buggen der en
// cache-først-strategi lot en admin gå glipp av en funksjon ni deploys
// etter at den ble skrudd på). Ramme arver denne allerede rettede
// versjonen fra forgreningstidspunktet — verifisert direkte her, ikke bare
// antatt.

const CACHE_NAME = 'ramme-shell-v0.1.2';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css?v=0.1.2',
  './js/app.js?v=0.1.2',
  './js/api-client.js?v=0.1.2',
  './js/offline-queue.js?v=0.1.2',
  './js/ki-client.js?v=0.1.2',
  './js/map.js?v=0.1.2',
  './data/species.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isShellRequest = isSameOrigin && event.request.method === 'GET';
  if (!isShellRequest) return; // la alt annet (API-kall) gå rett til nett

  event.respondWith(
    fetch(event.request).then(res => {
      if (res.ok) {
        const cacheCopy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, cacheCopy));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});
