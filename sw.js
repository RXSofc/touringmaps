/* TouringTogether service worker.
 *
 * Purpose: fast start and a usable app shell when the connection drops.
 * It does NOT make live features work offline: GPS sharing, rooms, routing
 * and geocoding always need the network.
 *
 * Strategy
 *  - Same-origin GET:  network-first, cache only as an offline fallback (new deploys show up on the next load)
 *  - Firebase SDK files from gstatic: cache-first (they are versioned by URL)
 *  - Everything else (Firebase RTDB/Auth, OSRM, Nominatim, map tiles): untouched
 *
 * Bump VERSION when you want to drop old caches.
 */
const VERSION = 'tt-v14';
const SHELL_CACHE = `${VERSION}-shell`;
const SDK_CACHE = `${VERSION}-sdk`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/icons/icon.svg',
  'css/splash.css',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'css/layout.css',
  'css/responsive.css',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/leaflet.js',
  'js/app.js',
  'js/main.js',
  'js/config.js',
  'js/firebase.js',
  'js/router.js',
  'js/ui.js',
  'js/geo.js',
  'js/net.js',
  'js/auth.js',
  'js/profile.js',
  'js/rooms.js',
  'js/presence.js',
  'js/location.js',
  'js/permissions.js',
  'js/map.js',
  'js/destinations.js',
  'js/routing.js',
  'js/discord.js',
  'js/map-config.js',
  'js/gps-filter.js',
  'js/guidance.js',
  'js/splash.js',
  'js/motion.js',
  'js/views/gpsSheet.js',
  'js/views/voiceSheet.js',
  'js/voice.js',
  'js/signaling.js',
  'js/views/setup.js',
  'js/views/auth.js',
  'js/views/dashboard.js',
  'js/views/profile.js',
  'js/views/touring.js',
  'js/views/destinationPanel.js',
  'js/views/roomSheet.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // allSettled: one missing optional file must not block installation
      Promise.allSettled(SHELL.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(cacheFirst(req, SDK_CACHE));
  }
  // anything else: let the browser handle it
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const fallback = await cache.match('index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}
