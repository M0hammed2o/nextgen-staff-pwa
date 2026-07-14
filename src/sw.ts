/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// Without these, registerType: "autoUpdate" doesn't actually auto-update —
// a newly deployed service worker installs but sits "waiting" until every
// open tab of the OLD worker is closed, which never happens for a
// bookmarked/pinned till that's rarely fully closed. skipWaiting() +
// clients.claim() make every new deploy take over immediately for tabs
// already open, instead of silently getting stuck behind a stale worker.
self.skipWaiting();
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

cleanupOutdatedCaches();
// self.__WB_MANIFEST is replaced by the actual precache list at build time
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  let payload: { title?: string; body?: string; url?: string };
  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  const title = payload.title ?? 'New Order!';
  const options: NotificationOptions = {
    body: payload.body ?? 'You have a new order.',
    icon: '/logo.jpeg',
    badge: '/logo.jpeg',
    vibrate: [400, 100, 400, 100, 400],
    tag: 'new-order',
    renotify: true,
    requireInteraction: true,
    data: { url: payload.url ?? '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl: string = (event.notification.data as { url?: string })?.url ?? '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const existing = clientList.find((c) => 'focus' in c);
        if (existing) return (existing as WindowClient).focus();
        return self.clients.openWindow(targetUrl);
      })
  );
});
