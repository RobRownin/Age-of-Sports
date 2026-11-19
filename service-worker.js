// Production (/) and staging (/staging/) share one origin and therefore one Cache Storage.
// Each environment only manages caches with its own prefix.
const ENV_PREFIX = self.registration.scope.includes("/staging/") ? "age-of-sports-staging-" : "age-of-sports-";
const CACHE_NAME = ENV_PREFIX + "v4";

function isOwnCache(key) {
  const isStagingKey = key.startsWith("age-of-sports-staging-");
  return ENV_PREFIX === "age-of-sports-staging-" ? isStagingKey : !isStagingKey;
}
const ASSETS = ["./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && isOwnCache(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for navigation/HTML: you always see the latest version when online.
// Only falls back to the cache when offline (e.g. icons/manifest).
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./index.html"))
    );
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

