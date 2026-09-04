const CACHE_NAME = "age-of-sports-v2";
const ASSETS = ["./manifest.json", "./icon-192.png", "./icon-512.png", "./avatar-pixel.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first für Navigation/HTML: Du siehst immer die neueste Version, wenn online.
// Fällt nur auf den Cache zurück, wenn offline (z. B. Icons/Manifest).
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

