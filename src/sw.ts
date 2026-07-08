/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;
declare const __WB_MANIFEST: Array<{ url: string; revision: string | null }>;

cleanupOutdatedCaches();
precacheAndRoute(__WB_MANIFEST);

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
