// Replaced with the exact static build manifest by import-legacy-wallet.mjs.
const manifest = __LEGACY_WALLET_MANIFEST__
const prefix = `legacy-cashu-static:${self.registration.scope}:`
const cacheName = prefix + manifest.version
const index = new URL("index.html", self.registration.scope).href
// The history router's document routes can share the cached entry page. Keep
// this explicit so API requests and unknown paths never receive cached HTML.
const routes = new Set(
  ["", "settings", "restore", "already-running", "welcome", "terms"].map(
    (route) => new URL(route, self.registration.scope).href
  )
)
const files = new Map(
  Object.entries(manifest.files).map(([file, hash]) => [
    new URL(file, self.registration.scope).href,
    `sha256-${btoa(String.fromCharCode(...hash.match(/../g).map((byte) => parseInt(byte, 16))))}`,
  ])
)

async function retireUnusedCaches() {
  // An update may wait behind an open wallet. Keep every live worker's version;
  // discard only abandoned installations or versions the browser has retired.
  const keep = new Set([cacheName])
  for (const worker of [
    self.registration.active,
    self.registration.waiting,
    self.registration.installing,
  ]) {
    const version =
      worker && new URL(worker.scriptURL).pathname.match(/\.([0-9a-f]{64})\.js$/)?.[1]
    if (version) keep.add(prefix + version)
  }
  await Promise.all(
    (await caches.keys())
      .filter((name) => name.startsWith(prefix) && !keep.has(name))
      .map((name) => caches.delete(name))
  )
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName)
      // Atomic static response batch: no API URLs or wallet data are included.
      try {
        await cache.addAll(
          [...files].map(
            ([url, integrity]) => new Request(url, {cache: "no-cache", integrity})
          )
        )
      } catch (error) {
        const inUse = [self.registration.active, self.registration.waiting].some(
          (worker) => worker?.scriptURL === self.location.href
        )
        if (!inUse) await caches.delete(cacheName)
        throw error
      }
      await retireUnusedCaches()
    })()
  )
  // No skipWaiting: open wallets keep their matching HTML, scripts and styles.
})
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await retireUnusedCaches()
      await self.clients.claim()
    })()
  )
})
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return
  const url = new URL(event.request.url)
  url.search = ""
  const key = event.request.mode === "navigate" && routes.has(url.href) ? index : url.href
  if (!files.has(key)) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName)
      const saved = await cache.match(key)
      if (saved) return saved
      const response = await fetch(new Request(key, {integrity: files.get(key)}))
      if (response.ok) await cache.put(key, response.clone())
      return response
    })()
  )
})
