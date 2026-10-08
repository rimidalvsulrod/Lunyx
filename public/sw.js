// Lunyx offline worker. Keeps the app, effects engine, fonts and AI libraries
// on the device so the editor opens and works with no connection.
const CACHE = "lunyx-v2";
const SHELL = ["/", "/cut/fx.wasm", "/cut/manifest.webmanifest", "/cut/icon-192.png", "/cut/icon-180.png", "/cut/logo.svg", "/asr-worker.js"];
const CDN = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com", "storage.googleapis.com"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("lunyx-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const ok = (res) => res && (res.ok || res.type === "opaque");

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (ok(res)) cache.put(request, res.clone());
  return res;
}

// Fresh when online (gives up after 4s on a bad connection), cached otherwise.
async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(request), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 4000))]);
    if (res.ok) cache.put(key || request, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(key || request, { ignoreSearch: true })) || (await cache.match("/"));
    if (hit) return hit;
    return fetch(request);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/_next/static/")) event.respondWith(cacheFirst(req));
    else if (req.mode === "navigate") event.respondWith(networkFirst(req, "/"));
    else if (url.pathname.startsWith("/cut/") || url.pathname === "/asr-worker.js") event.respondWith(networkFirst(req));
    return;
  }
  if (CDN.includes(url.hostname)) event.respondWith(cacheFirst(req));
});

// The page asks us to keep a list of URLs (app chunks, fonts) for offline use.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "precache") return;
  const port = event.ports[0];
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      let done = 0;
      for (const u of event.data.urls) {
        try {
          if (!(await cache.match(u, { ignoreVary: true }))) {
            const res = await fetch(u, { mode: new URL(u, self.location.href).origin === self.location.origin ? "same-origin" : "cors" });
            if (ok(res)) await cache.put(u, res);
          }
        } catch {}
        port?.postMessage({ progress: ++done / event.data.urls.length });
      }
      port?.postMessage({ done: true });
    }),
  );
});
