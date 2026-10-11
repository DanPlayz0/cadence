// SPDX-License-Identifier: GPL-2.0-or-later
const CACHE = __CACHE_NAME__;
const FILES = __PRECACHE__;
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  // Wait for existing tabs to close so updates never interrupt playback.
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("cadence-static-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/healthz"
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.open(CACHE).then((cache) => cache.match("/offline.html")),
      ),
    );
  } else if (
    !url.search &&
    (FILES.includes(url.pathname) ||
      /^\/assets\/playlist-icon-[^/]+\.js$/.test(url.pathname))
  ) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          // Storage limits must not prevent a successfully fetched icon from rendering.
          try {
            await cache.put(url.pathname, response.clone());
          } catch {}
        }
        return response;
      }),
    );
  }
});
