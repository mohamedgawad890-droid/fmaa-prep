// FMAA Prep — Service Worker
// Caches the app shell for offline use and handles auto-updates.

const CACHE_NAME = 'fmaa-prep-v5';

// Files to cache on install (app shell)
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './dictionary.json',
  './icon-192.png',
  './icon-512.png',
  './gawad-avatar.webp',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js'
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('[SW] Pre-cache partial failure (non-fatal):', err);
      });
    })
  );
  // Don't self.skipWaiting() here — let the main thread trigger it
  // via postMessage({type:'SKIP_WAITING'}) so updates are controlled.
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
// Strategy:
//   • Firebase / Cloudinary / Google / gstatic → always network (no intercept)
//   • HTML document (navigation) → NETWORK-FIRST, bypassing the HTTP cache,
//     so your edits to index.html appear on the next online open with no
//     Ctrl+Shift+R. Falls back to the cached copy only when offline.
//   • lesson/quiz JSON → network-first, fall back to cache
//   • everything else (icons, avatar, manifest, Firebase SDK) → cache-first
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Never intercept Firebase, Cloudinary, or Google APIs — always go to network
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('cloudinary.com') ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    return; // fall through to browser default (network)
  }

  // ── HTML document / navigation → NETWORK-FIRST (always pull the latest) ──────
  const isDocument =
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html');

  if (isDocument) {
    event.respondWith(
      // { cache: 'reload' } bypasses the browser's own HTTP cache so GitHub
      // Pages' cache headers can't hand back a stale page.
      fetch(req, { cache: 'reload' })
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', clone));
          return response;
        })
        .catch(() =>
          caches.match(req).then(cached => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // ── Lesson and quiz JSON → network-first, fall back to cache ─────────────────
  if (url.pathname.includes('/lessons/') || url.pathname.includes('/questions/') || url.pathname.endsWith('/dictionary.json')) {
    event.respondWith(
      fetch(req)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          return response;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // ── Everything else (app shell assets) → cache-first, fall back to network ──
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(response => {
        // Only cache successful same-origin responses
        if (
          response &&
          response.status === 200 &&
          response.type === 'basic'
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return response;
      });
    })
  );
});

// ── Message: handle SKIP_WAITING from the main thread ────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
