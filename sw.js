// Offline support: app shell cached on install; map tiles cached as you view them.
const VERSION = 'cropscout-v4';
const TILE_CACHE = 'cropscout-tiles';
const SHELL = [
  './', './index.html', './css/styles.css', './manifest.webmanifest',
  './js/app.js', './js/store.js', './js/geo.js', './js/voice.js', './js/report.js', './js/defaults.js', './js/importer.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/apple-touch-icon.png',
  './vendor/leaflet/leaflet.css', './vendor/leaflet/leaflet.js', './vendor/shpjs/shp.min.js',
];
const MAX_TILES = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILE_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: cache-first so paddocks you've viewed work without signal.
  if (url.hostname.includes('arcgisonline.com')) {
    e.respondWith(caches.open(TILE_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); }
        return res;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // App shell: network-first for same-origin (so updates arrive), fall back to cache offline.
  // Ignore query string so Siri links (?say=...) work offline.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req);
      if (res.ok && url.origin === location.origin) {
        if (!url.search) cache.put(req, res.clone());
      }
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? cache.match('./') : Response.error());
    }
  })());
});
