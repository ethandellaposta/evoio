// Service Worker for evoio — caches WASM binary and static assets
const CACHE_NAME = 'evoio-v1'
const PRECACHE = [
  '/pkg/evoio_wasm_bg.wasm'
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)

  // Cache-first for WASM binary and hashed assets
  if (url.pathname.endsWith('.wasm') || url.pathname.match(/\.[a-f0-9]{8}\./)) {
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

  // Network-first for everything else
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  )
})
