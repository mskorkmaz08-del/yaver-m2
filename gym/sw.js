// CaliCoach service worker: makes the app installable and keeps the app shell
// available offline. MediaPipe's files come from their CDNs and are cached by
// the browser; network first, so updates show up straight away.
const CACHE = "calicoach-v7";
const SHELL = ["./", "index.html", "style.css", "app.js", "engine.js", "pose.js", "pose-worker.js", "store.js", "guide.js", "insights.js", "analytics.js", "replay.js", "capture.js", "viewer3d.js", "refs.js", "sync.js", "model.json", "manifest.webmanifest"];
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
    // cache: "no-cache" asks GitHub for the newest file every time (Pages sets a
    // 10-minute browser cache), so an update shows up on the next open.
    fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" }).then((r) => {
      if (r.ok && !url.pathname.endsWith("demo.json")) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
