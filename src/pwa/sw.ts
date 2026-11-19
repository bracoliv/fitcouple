const cacheName = "fit-shell-v1";
const shell = [
  "./",
  "index.html",
  "play.html",
  "solo.html",
  "dashboard.html",
  "family.html",
  "admin.html",
  "fit.css",
  "play.css",
  "fit.js",
  "play.js",
  "config.js",
  "manifest.json",
  "manifest-solo.json",
  "manifest-couple.json",
  "manifest-family.json",
];

self.addEventListener("install", (event: any) => {
  event.waitUntil(caches.open(cacheName).then((cache: any) => cache.addAll(shell)).then(() => (self as any).skipWaiting()));
});

self.addEventListener("activate", (event: any) => {
  event.waitUntil((self as any).clients.claim());
});

self.addEventListener("fetch", (event: any) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== (self as any).location.origin) return;
  event.respondWith(
    fetch(event.request).then((response: any) => {
      const copy = response.clone();
      caches.open(cacheName).then((cache: any) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request)),
  );
});
