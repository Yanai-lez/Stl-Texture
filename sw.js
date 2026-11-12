// Service worker: makes the app installable and usable offline after the first visit.
// Same-origin files are fetched network-first and with cache:'no-cache', so the browser's own
// HTTP cache (GitHub Pages allows 10 minutes) can never hand out an old script next to a new
// page. Mixed versions of index.html and main.js would break every button. The service worker
// cache is only an offline fallback.
const VERSION = 'stlt-v3';
const CACHE = VERSION + '-cache';

const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'responsive.css',
  'manifest.webmanifest',
  'icons/logo-96.png',
  'icons/favicon-32.png',
  'icons/favicon-48.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/customTextures.js',
  'js/decimation.js',
  'js/displacement.js',
  'js/exclusion.js',
  'js/exportPipeline.js',
  'js/exportWorker.js',
  'js/exporter.js',
  'js/i18n.js',
  'js/main.js',
  'js/mapping.js',
  'js/meshIndex.js',
  'js/meshRepair.js',
  'js/meshValidation.js',
  'js/outlineWrap.js',
  'js/outlineWrapWorker.js',
  'js/paintTree.js',
  'js/presetTextures.js',
  'js/previewMaterial.js',
  'js/previewPipeline.js',
  'js/previewWorker.js',
  'js/regularize.js',
  'js/section.js',
  'js/sidebarToggle.js',
  'js/smartResolution.js',
  'js/softMask.js',
  'js/spaceMousePanel.js',
  'js/stepConvert.js',
  'js/stepLoader.js',
  'js/stepWorker.js',
  'js/stlLoader.js',
  'js/subdivision.js',
  'js/subdivisionEstimate.js',
  'js/textureAnalysis.js',
  'js/textureGallery.js',
  'js/threeCompat.js',
  'js/version.js',
  'js/viewer.js',
  'js/zipStream.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file must not block installing the whole app.
    await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    // A navigation Request cannot be re-used with extra options (Chrome throws), so build a
    // fresh same-origin request that always revalidates with the server.
    const fresh = new Request(request.url, {
      cache: 'no-cache',
      credentials: 'same-origin',
      mode: request.mode === 'navigate' ? 'same-origin' : request.mode,
    });
    const res = await fetch(fresh);
    if (res.ok && res.status === 200) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

// Versioned CDN files (three.js, fflate, meshstep) never change, so cache-first is safe.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request));
  }
});
