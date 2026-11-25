const V = "cine-idf-v36", DATA = "cine-idf-data", FRESH = 8 * 60 * 1000,
  STATIC = ["/", "/index.html", "/style.css", "/app.js", "/itineraire.js", "/data/cinemas.js", "/slot.js", "/manifest.webmanifest", "/icon.svg", "/apple-touch-icon.png", "/icon-192.png", "/plus.js", "/pathe.js", "/v11.js", "/v12.js", "/v13.js", "/v15.js", "/v18.js", "/v26.js", "/reset.js", "/durable.js", "/logo-96.png"];
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys(), old = keys.find(k => k.startsWith("cine-idf-v") && k !== V);
    // Mise à jour : on précharge la nouvelle version. 1re installation : pas de 2e téléchargement, le fetch runtime remplira le cache.
    if (old) await caches.open(V).then(c => c.addAll(STATIC)).catch(() => {});
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V && x !== DATA).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
const ageMs = r => { const d = r && r.headers.get("date"); return d ? Date.now() - new Date(d).getTime() : Infinity; };
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname === "/sw.js") return; // pas de cache pour /api/transit, OSRM, Nominatim
  if (u.pathname.startsWith("/allocine-all/")) {
    e.respondWith((async () => {
      const cache = await caches.open(DATA);
      const cached = await cache.match(e.request);
      const revalidate = async () => {
        const h = new Headers(e.request.headers);
        const tag = cached && cached.headers.get("etag");
        if (tag) h.set("If-None-Match", tag);
        const r = await fetch(new Request(e.request, {headers: h, cache: "no-store"}));
        if (r.status === 304) return cached;
        const cp = r.clone(); let ok = false;
        try { const x = await cp.clone().json(); ok = Object.values(x.cinemas || {}).some(v => v && v.length); } catch (_) {}
        if (ok) cache.put(e.request, cp);
        return r;
      };
      if (cached && ageMs(cached) < FRESH) return cached;
      if (cached) { e.waitUntil(revalidate().catch(() => {})); return cached; }
      try { return await revalidate(); } catch (_) { return cached || Response.json({cinemas: {}}); }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(V);
    const cached = await cache.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; });
    if (cached) { e.waitUntil(net.catch(() => {})); return cached; }
    try { return await net; } catch (_) { return (await caches.match(e.request)) || caches.match("/index.html"); }
  })());
});
