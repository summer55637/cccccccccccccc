const CACHE_NAME = "offline-adventure-shell-v3";
const PRECACHE_ASSETS = [
  "./character/ui/index.html",
  "./character/ui/styles.css",
  "./character/ui/backup.css",
  "./character/ui/app.js",
  "./game/index.html",
  "./game/screen.css",
  "./game/main.js",
  "./game/progression/rules.js",
  "./game/progression/service.js",
  "./game/world/map.js",
  "./game/world/movement.js",
  "./game/combat/monsters.js",
  "./game/combat/rules.js",
  "./game/combat/service.js",
  "./game/inventory/items.js",
  "./game/inventory/service.js",
  "./game/skills/definitions.js",
  "./game/skills/rules.js",
  "./game/skills/service.js",
  "./storage/indexeddb.js",
  "./storage/backup.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

function assetUrl(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_ASSETS.map(assetUrl));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith("offline-adventure-shell-") && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (requestUrl.origin !== scopeUrl.origin || !requestUrl.pathname.startsWith(scopeUrl.pathname)) {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    if (request.mode === "navigate") {
      const fallback = await cache.match(assetUrl("./character/ui/index.html"));
      if (fallback) return fallback;
    }

    return new Response("這個頁面或資源尚未加入離線快取，請先連線開啟單機版一次。", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  })());
});
