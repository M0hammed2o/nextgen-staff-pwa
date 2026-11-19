/**
 * Which navigations the service worker answers with the precached app shell
 * (index.html). Kept free of service-worker globals so it can be unit tested
 * (src/test/sw-navigation.test.ts); src/sw.ts wires it into a Workbox
 * NavigationRoute.
 *
 * Why: the worker precached index.html but registered no navigation route,
 * so reloading a deep link such as /pos while offline showed the browser's
 * own offline error page in Chromium and WebKit (Souk e2e 6a) even though
 * the whole app was in the precache.
 *
 * Only top-level page navigations (request.mode === "navigate") ever reach a
 * NavigationRoute, so fetch()/XHR API calls are never answered with HTML.
 * The denylist additionally keeps API-looking paths and anything that looks
 * like a file (has an extension) going to the network.
 */
export const NAVIGATION_DENYLIST: RegExp[] = [
  /^\/v1(\/|$)/, // backend API (normally on its own origin, but never HTML here)
  /^\/api(\/|$)/,
  /^\/admin_api(\/|$)/,
  /^\/health(\/|$)/,
  /\/[^/?]+\.[^/]+$/, // a path ending in a file name: /logo.jpeg, /sw.js, /manifest.webmanifest
];

export function isAppShellNavigation(pathname: string): boolean {
  return !NAVIGATION_DENYLIST.some((re) => re.test(pathname));
}
