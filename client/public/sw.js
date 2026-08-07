/**
 * sw.js — Sevai Scout Service Worker
 * Caches scheme data + static assets. Handles push notifications.
 */

const CACHE_NAME = 'sevai-v3';
const PRECACHE = ['/', '/index.html', '/favicon.svg', '/manifest.json'];

// Cache-first is correct in production — the offline story depends on it — but
// on a dev host it serves yesterday's CSS and JS forever, with no error and no
// obvious cause. Every fetch handler below no-ops on localhost.
const DEV_HOST = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

// ── Install: precache static shell ──────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

// ── Activate: delete old caches ──────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ── Fetch: cache-first for GET requests ─────────────────────────────────────
self.addEventListener('fetch', (e) => {
  if (DEV_HOST) return;                    // never cache during development
  if (e.request.method !== 'GET') return;
  // Don't cache API calls — always network for /api/*
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('/index.html')); // SPA fallback offline
    }),
  );
});

// ── Push: show notification ──────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data?.json() || {}; } catch (_) {}

  const title = data.title || 'Sevai Scout';
  const options = {
    body: data.body || 'A scheme matches your profile',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.tag || 'sevai-alert',
    data: data,
    actions: [
      { action: 'view', title: 'View scheme' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open feed ────────────────────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  const schemeId = e.notification.data?.schemeId;
  const url = schemeId ? `/scheme/${schemeId}` : '/feed';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else clients.openWindow(url);
    }),
  );
});
