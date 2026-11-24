// Service worker: makes Sense of Scale installable and quick to open on phones.
// App files: cache first, refreshed in the background. Puzzles: network first, cached copy if offline.
// Results and stats always go to the network.
const VERSION = "sos-v1";
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
  if (url.pathname === "/api/puzzle") {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || Response.error())));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
  // Stale-while-revalidate for the app shell and static files.
  e.respondWith(caches.open(VERSION).then(async c => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => cached);
    return cached || fresh;
  }));
});
