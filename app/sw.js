// Offline cache for the app shell. Bump VERSION whenever app files change.
const VERSION = "penote-v16";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "js/app.js",
  "js/audio.js",
  "js/db.js",
  "js/editor.js",
  "js/icons.js",
  "js/import.js",
  "js/ink.js",
  "js/items.js",
  "js/model.js",
  "js/pdf.js",
  "js/plist.js",
  "js/render.js",
  "js/theme.js",
  "vendor/pdf.min.mjs",
  "vendor/pdf.worker.min.mjs",
  "vendor/fflate.mjs",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates arrive when online), falling back to the cache offline.
// "no-cache" revalidates with the server instead of trusting the HTTP cache (GitHub Pages sends
// max-age=600), so a fresh deploy never mixes new and old modules.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  const req =
    e.request.mode === "navigate"
      ? new Request(e.request.url, { cache: "no-cache", credentials: "same-origin" })
      : new Request(e.request, { cache: "no-cache" });
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
