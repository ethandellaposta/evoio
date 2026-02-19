// Service Worker for EvoIO static hosting.
// Keep this conservative: avoid brittle hardcoded precache paths.
const CACHE_NAME = 'evoio-static-v2'

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)
  if (url.origin !== self.location.origin) return

  // Cache-first for immutable assets and wasm
  if (url.pathname.endsWith('.wasm') || url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached
        return fetch(e.request).then((resp) => {
          if (resp.ok) {
            const clone = resp.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone))
          }
          return resp
        })
      })
    )
    return
  }

  // Network-first for navigations, fallback to cache when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
  }
})
