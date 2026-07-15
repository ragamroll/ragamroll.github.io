const CACHE = 'ragamroll-v2';
const ASSETS = [
  './', './index.html', './app.js', './manifest.webmanifest',
  './vendor/preact.module.js', './vendor/hooks.module.js', './vendor/htm.module.js', './vendor/htm-preact.js',
  './components/Editor.js', './components/NotationPane.js', './components/RollPane.js', './components/Toolbar.js',
  './components/Diagnostics.js',
  './core/parser.js', './core/tuning.js', './core/raga-base.js', './core/raga-base.json',
  './core/renderers/notation.js', './core/renderers/roll.js',
  './core/midi/gm.js', './core/midi/smf.js', './core/midi/sequence.js', './core/midi/tala.js',
  './examples/swaravali.srgm', './examples/hamsa.srgm', './examples/vathapi.srgm',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
