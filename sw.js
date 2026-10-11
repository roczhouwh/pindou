// ============================================================
// 拼豆图纸生成器 — Service Worker
// ============================================================
// 设计原则：
// 1. 只缓存 / 回复「拼豆自己」的有限资源，绝不无差别拦截同源所有请求，
//    以免把 SW 留在某个公端口（如 localhost:3000）时劫持其它项目的页面。
// 2. 非导航请求：仅已知资源走 cache-first，其余一律放行给网络（真实服务器）。
// 3. 导航请求：先走网络（让任何项目都能加载自己的首页）；离线时退回缓存的
//    拼豆应用壳，且只有内容确实是拼豆页面才进缓存，防止存进别的项目首页。

// ⚠️ 任何对 index.html / app.js / color-palette.js / style.css 的改动都必须递增此版本号，
// 否则 cache-first 会让老用户一直拿到旧文件、看不到更新（见 REVIEW.md 相关说明）
const CACHE_NAME = 'pindou-v4';

// 拼豆自己的资源列表（相对 SW 脚本作用域解析）
const ASSET_PATHS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './color-palette.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
];

// 标识「这就是拼豆页面」的稳定字符串，用于导航缓存做校验
const APP_SIGNATURE = '拼豆图纸';

// 解析成完整 URL 集合，供 fetch 精确匹配
const scopeURL = new URL('./', self.location.href);
const ASSETS = new Set(
  ASSET_PATHS.map((p) => new URL(p, scopeURL.href).href)
);

// 拼豆应用壳缓存键（用于离线导航兜底）
const APP_SHELL_URL = new URL('./index.html', scopeURL.href).href;
// 作用域根 URL。ASSET_PATHS 里的 './' 也指向同一页面，
// 导航缓存必须同时更新这两个键，否则离线时其中一个会返回旧壳（见 REVIEW.md M6）
const SCOPE_URL = scopeURL.href;

// install: 预缓存拼豆核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 逐个 add + allSettled，而不是 cache.addAll：
      // addAll 是**原子操作**，8 个资源中任一失败（网络抖动、图标 404、
      // '/' 返回重定向导致 response.ok 为 false）就会整体 reject →
      // install 失败 → SW 永不激活 → **离线能力完全不可用**（见 REVIEW.md M7）。
      // 逐项缓存后，失败项只是缺一个离线副本，不影响其余资源与 SW 激活。
      const results = await Promise.allSettled(
        [...ASSETS].map((url) => cache.add(url))
      );

      const failed = results
        .map((r, i) => (r.status === 'rejected' ? [...ASSETS][i] : null))
        .filter(Boolean);

      if (failed.length) {
        // 如实播报，避免"离线时某个资源神秘 404"无从排查（见 n4 的同类问题）
        console.warn(
          `[拼豆 SW] ${failed.length}/${ASSETS.size} 个资源预缓存失败，离线时这些资源不可用：`,
          failed
        );
      }
    })
  );
  // 跳过等待，立即激活
  self.skipWaiting();
});

// activate: 清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
  );
  // 控制所有已打开页面
  self.clients.claim();
});

// 校验给定响应是否是「拼豆页面」，是才作为应用壳缓存
async function isPindouShell(response) {
  try {
    const text = await response.clone().text();
    return text.includes(APP_SIGNATURE);
  } catch (err) {
    return false;
  }
}

// fetch: 精确、克制的缓存策略
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 仅同源请求
  if (url.origin !== self.location.origin) return;
  // 非 GET 不处理
  if (event.request.method !== 'GET') return;

  // ---- 导航请求：网络优先，避免劫持其它项目首页 ----
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(async (resp) => {
          // 只有响应确实是拼豆页面才更新应用壳缓存。
          // 同时写 './' 与 './index.html' 两个键：ASSET_PATHS 里两者都在，
          // 只更新其中一个会让另一个在离线时返回旧壳（见 REVIEW.md M6）
          if (resp && resp.ok && (await isPindouShell(resp))) {
            const clones = [resp.clone(), resp.clone()];
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(APP_SHELL_URL, clones[0]);
              cache.put(SCOPE_URL, clones[1]);
            });
          }
          return resp;
        })
        .catch(async () => {
          // 离线兜底：两个壳键都试一遍，任一存在即可返回
          const hit = await caches.match(APP_SHELL_URL);
          return hit || caches.match(SCOPE_URL);
        })
    );
    return;
  }

  // ---- 非导航请求：只有拼豆自己的资源才拦截，其余放行 ----
  if (!ASSETS.has(url.href)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (
          !response ||
          response.status !== 200 ||
          response.type !== 'basic'
        ) {
          return response;
        }
        const clone = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});