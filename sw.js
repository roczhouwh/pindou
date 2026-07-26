// ============================================================
// 拼豆图纸生成器 — Service Worker
// ============================================================

const CACHE_NAME = 'pindou-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './color-palette.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// install: 预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  // 跳过等待，立即激活
  self.skipWaiting();
});

// activate: 清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  // 控制所有已打开的页面
  self.clients.claim();
});

// fetch: cache-first 策略
self.addEventListener('fetch', (event) => {
  // 仅缓存同源请求
  if (!event.request.url.startsWith(self.location.origin)) return;

  // 非 GET 请求不缓存
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        // 只缓存有效响应
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });

        return response;
      });
    })
  );
});