const CACHE = 'pass-archive-v0.4.5';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const page of ['/', '/terminal.html', '/credits.html', '/login.html']) {
      const response = await fetch(page);
      if (!response.ok) throw new Error('Unable to precache shell');
      await cache.put(page, response.clone());
    }
    const response = await fetch('/app-cache.json');
    if (!response.ok) throw new Error('Unable to precache terminal manifest');
    const manifest = await response.json();
    await cache.addAll(manifest.resources);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(k => k.startsWith('pass-archive-') && k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/v1/catalog/') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(request);
    const asset = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/rhine/');
    if (saved && asset) return saved;
    try {
      const response = await fetch(request);
      if (response.ok && (request.mode === 'navigate' || url.pathname === '/catalog.json' || url.pathname === '/api/v1/catalog/' || asset)) {
        try { await cache.put(request, response.clone()); } catch (_) { /* storage quota: keep the existing shell */ }
      }
      return response;
    } catch (error) {
      if (saved) return saved;
      if (request.mode === 'navigate') return (await cache.match(['/terminal.html','/credits.html','/login.html'].includes(url.pathname) ? url.pathname : '/')) || Response.error();
      return Response.error();
    }
  })());
});
