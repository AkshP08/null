// ── Null service worker: offline shell + real-data caching ──────────────────
// Strategy:
//   • Navigations (the HTML document) → NETWORK-FIRST, falling back to the
//     cached shell offline. This guarantees a fresh deploy is picked up
//     immediately and users never get stranded on a stale index.html that
//     points at deleted hashed assets.
//   • Same-origin static assets + bundled REAL price data → CACHE-FIRST, then
//     network (and cache the result) so the tool works fully offline.
//   • Cross-origin requests (e.g. the Anthropic API, analytics) → never touched;
//     they always hit the network and are never cached.
// Bumping CACHE invalidates every old asset on activate.
const CACHE = "null-v2";
const SHELL = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never cache the API / analytics / any other origin

  // Navigations: network-first so redeploys are picked up; cached shell offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html"))),
    );
    return;
  }

  // Static assets + bundled data: cache-first, then network (and cache it).
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html")); // SPA fallback when offline
    }),
  );
});
