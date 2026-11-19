/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
// workbox-routing is the same 7.4.0 package workbox-precaching already depends
// on (and uses for precacheAndRoute's own route), like workbox-precaching itself
// it arrives via vite-plugin-pwa rather than a direct package.json entry.
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NAVIGATION_DENYLIST } from './sw-navigation';

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

// Offline deep links: answer same-origin page navigations (/pos, /orders/123,
// a reload anywhere) with the precached index.html, the same "navigateFallback"
// approach Workbox's generateSW uses. index.html is precached with a content
// revision and every asset it references is hashed, so a deploy replaces it
// when the new worker installs (skipWaiting + clientsClaim above); it cannot
// keep serving an old shell once a new worker is active. registerRoute runs
// after precacheAndRoute, so exact precache hits ("/", "/index.html") are still
// answered by the precache route first. Registered only when index.html is in
// the precache (it is in every production build; `vite dev` has no worker).
try {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: NAVIGATION_DENYLIST }));
} catch {
  // index.html not precached (unexpected build): leave navigations to the network.
}

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  let payload: { title?: string; body?: string; url?: string };
  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  const title = payload.title ?? 'New Order!';
  // `vibrate`/`renotify` are real, supported NotificationOptions fields on
  // the browsers this PWA targets, but are missing from the installed
  // lib.dom types (pre-existing gap, unrelated to this task, tracked in
  // TODO.md) — the extra type below is type-only, same object at runtime.
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
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
