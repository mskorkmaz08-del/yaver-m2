// CaliCoach service worker: makes the app installable and keeps the app shell
// available offline. MediaPipe's files come from their CDNs and are cached by
// the browser; network first, so updates show up straight away.
const CACHE = "calicoach-v3";
const SHELL = ["./", "index.html", "style.css", "app.js", "engine.js", "pose.js", "pose-worker.js", "store.js", "guide.js", "insights.js", "replay.js", "capture.js", "viewer3d.js", "refs.js", "sync.js", "model.json", "manifest.webmanifest", "icons/icon.svg"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok && !url.pathname.endsWith("demo.json")) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
