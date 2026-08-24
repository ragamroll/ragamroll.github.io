const CACHE = 'ragamroll-e818112';

// SERVED FROM A LOCAL SERVER: stand down entirely.
//
// Everything but a page is cache-first, and the cache NAME is what retires a stale copy —
// rewritten to the commit hash at build time, so each published version gets its own. A
// local server never goes through that build, so the name above is the name forever: a
// module cached on the first visit is served on every visit after it, and an edit to it is
// invisible until the cache is cleared by hand. That is not a hypothetical — it cost an
// afternoon of a fixed file looking unfixed, twice.
//
// Offline is what the worker is FOR, and localhost is never offline. So on a local host it
// installs nothing, caches nothing, and answers no request; the published site is
// untouched, which is the only place the behaviour matters.
const DEV = ['localhost', '127.0.0.1', '[::1]', ''].includes(self.location.hostname);
const ASSETS = [
  './', './index.html', './help.html', './pitchy.html', './app.js', './worker.js', './version.js', './manifest.webmanifest',
  './vendor/preact.module.js', './vendor/hooks.module.js', './vendor/htm.module.js', './vendor/htm-preact.js',
  './vendor/tone.js',
  './vendor/pitchy.mjs', './vendor/fft.mjs',
  './components/Editor.js', './components/RollPane.js', './components/RollTools.js', './components/EditTools.js', './components/EditorDrawer.js', './components/Toolbar.js',
  './components/Diagnostics.js', './components/Controls.js', './components/ChromeBar.js', './core/chrome-layout.js', './components/ReferenceDialog.js', './components/Splitter.js',
  './components/Footer.js', './components/PerfDialog.js', './components/OpenMenu.js', './components/ScaleDialog.js', './components/TalaDialog.js',
  './components/RagaDialog.js',
  './audio/schedule.js', './audio/drone.js', './audio/backend.js', './audio/backends/tone.js', './audio/backends/webaudio.js', './audio/player.js',
  './core/app-update.js', './core/perf.js', './core/parser.js', './core/gamaka-inline.js', './core/gamaka-curve.js', './core/tuning.js', './core/raga-base.js', './core/raga-db.json', './core/reference.js',
  './core/shruti.js', './core/melakarta.js', './core/tala-preview.js', './core/raga-shruti.js', './core/share.js', './core/share-legacy.js',
  './core/raga-ext.js', './core/raga-preview.js', './core/retune.js',
  './core/detect.js', './core/detect-raga-helper.js', './core/note-edit.js', './core/raga-seed.js', './core/raga-switchboard.js',
  './core/roll-geometry.js', './core/roll-render.js', './core/roll-model.js', './core/ragamroll.js', './core/roll-audio.js', './core/marks.js', './core/roll-edit.js', './core/curve-edit.js', './core/gamaka-edit.js', './core/grid-stretch.js', './core/roll-pan.js', './core/note-split.js', './core/roll-seam.js',
  './core/renderers/notation.js', './core/renderers/roll.js',
  './core/midi/gm.js', './core/midi/smf.js', './core/midi/sequence.js', './core/midi/tala.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

// Examples are NOT hardcoded here — precache whatever examples/index.json lists,
// so adding a piece (drop the .srgm + regenerate the manifest) needs no sw edit.
async function precacheExamples(cache) {
  try {
    const list = await fetch('./examples/index.json').then((r) => r.json());
    await cache.put('./examples/index.json', await fetch('./examples/index.json'));
    await cache.addAll(list.map((n) => `./examples/${n}.srgm`));
  } catch { /* offline / no manifest: examples still runtime-cache on first open */ }
}

self.addEventListener('install', (e) => {
  if (DEV) { self.skipWaiting(); return; }          // nothing to precache off a dev server
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    await precacheExamples(c);
    await self.skipWaiting();
  })());
});
// A page asking to be moved along. This worker already calls skipWaiting() on install, so
// nothing normally waits — but a future one that drops that would sit in 'waiting' until
// every tab closed, and the footer's Update button is the thing that would move it.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  // On a dev host this also CLEARS whatever an earlier visit left behind, so the fix
  // arrives by loading the page rather than by knowing to empty the cache by hand.
  if (DEV) { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
    .then(() => self.clients.claim())); return; }
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Cache-first, then network — and cache any successful same-origin GET so pieces
// (or assets) not in the precache still work offline after their first fetch.
self.addEventListener('fetch', (e) => {
  if (DEV) return;                                   // the network is the answer here
  if (e.request.method !== 'GET') return;
  // A PAGE ASKING FOR THE TRUTH. `?fresh=` is never served from the cache and never added to
  // it: the update check reads version.js this way to find out what the server actually has,
  // past both this worker and the HTTP cache. Without the second half it would also put a
  // uniquely-named copy in the cache on every check, for ever.
  if (new URL(e.request.url).searchParams.has('fresh')) {
    e.respondWith(fetch(e.request).catch(() => Response.error()));
    return;
  }
  e.respondWith((async () => {
    // PAGES are network-first, everything else cache-first. Cache-first on
    // navigations meant a published change was invisible until the worker
    // happened to update and the user loaded the page a SECOND time — the html
    // came from cache, so the new html that names the new assets never ran.
    // Falls back to the cache the moment the network fails, so offline is
    // unchanged.
    if (e.request.mode === 'navigate') {
      try {
        const fresh = await fetch(e.request);
        if (fresh && fresh.ok) {
          const clone = fresh.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return fresh;
        }
      } catch { /* offline — fall through to the cache */ }
      return (await caches.match(e.request)) || (await caches.match('./index.html')) || Response.error();
    }
    const hit = await caches.match(e.request);
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok && new URL(e.request.url).origin === self.location.origin) {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
      }
      return res;
    } catch {
      return hit || Response.error();
    }
  })());
});
