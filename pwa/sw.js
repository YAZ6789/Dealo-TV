/* Dealo TV service worker — generated into dist/sw.js by the `dealo-sw` plugin in vite.config.ts.
 * App shell: precached, so the app opens offline (your library lives in the browser anyway).
 * Fonts and other same-origin files: cache-first, per version.
 * Posters and show-data APIs (TMDB, TVmaze, Google Sheets, Anthropic) pass straight through — posters are
 * cross-origin <img> loads (opaque responses, which can't be reused for CORS reads and bloat quota), and the
 * app keeps its own data cache in IndexedDB. */
const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const SHELL = `dealo-shell-${VERSION}`;
const RUNTIME = `dealo-runtime-${VERSION}`;

self.addEventListener('install', (event) => {
  // `cache: 'reload'` skips the HTTP cache: GitHub Pages serves HTML with max-age=600, and precaching a stale
  // index.html would point at chunks this version doesn't have.
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', ...ASSETS].map((u) => new Request(u, { cache: 'reload' })))));
});

// A new version waits until the page says "reload now" (see src/pwa.ts), so it never swaps code under you.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Keep the previous version's files for one more deploy: a tab or installed app that is still
// running the old code (e.g. resumed from the background) can then finish loading its pages
// instead of asking the server for files a new deploy has already removed.
const KEEP_VERSIONS = 2;
const META = 'dealo-meta';

async function pruneOldVersions() {
  const meta = await caches.open(META);
  const prev = await meta.match('versions').then((r) => (r ? r.json() : [])).catch(() => []);
  const versions = [VERSION, ...prev.filter((v) => v !== VERSION)].slice(0, KEEP_VERSIONS);
  await meta.put('versions', new Response(JSON.stringify(versions)));
  const keep = new Set([META, ...versions.flatMap((v) => [`dealo-shell-${v}`, `dealo-runtime-${v}`])]);
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith('dealo-') && !keep.has(k)).map((k) => caches.delete(k)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(pruneOldVersions().then(() => self.clients.claim()));
});

async function networkFirst(request) {
  try {
    const res = await Promise.race([fetch(request, { cache: 'no-cache' }), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))]);
    if (res.ok) await (await caches.open(SHELL)).put('./', res.clone()).catch(() => undefined);
    return res;
  } catch {
    return (await caches.match('./')) || (await caches.match('index.html')) || Response.error();
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone(); // clone before the page starts reading the body
    caches.open(RUNTIME).then((c) => c.put(request, copy)).catch(() => undefined);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && url.origin === self.location.origin) return event.respondWith(networkFirst(request));
  if (url.origin === self.location.origin && url.pathname.startsWith(new URL('./', self.location).pathname)) return event.respondWith(cacheFirst(request));
});

// Airing alerts (src/components/NewEpisodesBanner.tsx): focus Dealo and jump to the page the alert is about.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = (event.notification.data && event.notification.data.hash) || '#/upcoming';
  const target = new URL(`./${hash}`, self.location).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => w.url.startsWith(new URL('./', self.location).href));
      if (!win) return self.clients.openWindow(target);
      // navigate() rejects for windows this worker doesn't control yet (first install) — then ask the page.
      return win
        .focus()
        .then((w) => w.navigate(target))
        .catch(() => win.postMessage({ type: 'dealo:navigate', hash }));
    }),
  );
});
