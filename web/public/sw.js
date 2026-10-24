/* 站点离线缓存：预存页面和静态资源；账号与个人存档接口始终走网络。 */
const CACHE = 'pass-archive-v0.4.5';
// 安装新版本时先缓存页面外壳，再根据构建清单缓存脚本、样式、模型与字体。
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
// 激活后删除本应用旧版本缓存并接管页面，避免继续使用过期外壳。
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(k => k.startsWith('pass-archive-') && k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));
// 仅接管同源 GET；公开目录允许缓存，其他 API 尤其账号数据不进入缓存。
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // 管理页面永远联网验证，不缓存 HTML，也不回退到任何离线外壳。
  if (url.pathname === '/admin.html') return;
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/v1/catalog/') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(request);
    const asset = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/rhine/');
    // 带构建版本的静态资源优先复用缓存，页面与目录则优先请求网络。
    if (saved && asset) return saved;
    try {
      const response = await fetch(request);
      if (response.ok && (request.mode === 'navigate' || url.pathname === '/catalog.json' || url.pathname === '/api/v1/catalog/' || asset)) {
        try { await cache.put(request, response.clone()); } catch (_) { /* storage quota: keep the existing shell */ }
      }
      return response;
    // 网络失败时使用已有缓存；导航请求按页面类型回退到对应外壳。
    } catch (error) {
      if (saved) return saved;
      if (request.mode === 'navigate') return (await cache.match(['/terminal.html','/credits.html','/login.html'].includes(url.pathname) ? url.pathname : '/')) || Response.error();
      return Response.error();
    }
  })());
});
