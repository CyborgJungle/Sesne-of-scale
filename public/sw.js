// Service worker: makes Sense of Scale installable and usable on a bad connection.
// Network first for everything, so a new deploy reaches players immediately;
// the cached copy is only used when the network fails. Results and stats are never cached.
const VERSION = "sos-v2";
const SHELL = ["/", "/style.css", "/js/app.js", "/js/core.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") && url.pathname !== "/api/puzzle") return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: url.pathname !== "/api/puzzle" }).then(r => r || caches.match("/")))
  );
});
