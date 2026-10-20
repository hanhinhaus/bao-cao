/* Service worker: chạy offline phần khung app + nhận thông báo đẩy */
const CACHE = 'inhaus-bc-v8';
const SHELL = ['./', './index.html', './app.js', './features.js', './v2.css', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Mạng trước, lỗi mạng thì dùng bản đã lưu (chỉ cho file của app, không đụng tới dữ liệu)
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const own = u.origin === location.origin;
  const lib = u.href.startsWith('https://cdn.jsdelivr.net/npm/@supabase/');
  const font = u.host === 'fonts.googleapis.com' || u.host === 'fonts.gstatic.com';
  if (!own && !lib && !font) return;
  // File của app luôn hỏi lại máy chủ (no-cache) để bản sửa mới hiện ngay
  e.respondWith(
    fetch(e.request, own ? { cache: 'no-cache' } : undefined).then(r => {
      if (r.ok && (own || lib || font)) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'INHAUS Báo cáo ngày';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', icon: 'icon-192.png', badge: 'badge-96.png',
    tag: d.tag || 'inhaus-remind', renotify: true, data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
