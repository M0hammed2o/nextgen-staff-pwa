import { describe, it, expect } from "vitest";
import { isAppShellNavigation, NAVIGATION_DENYLIST } from "@/sw-navigation";

/**
 * Souk e2e 6a: reloading /pos offline showed the browser's offline page
 * because the service worker had no navigation fallback. These cover which
 * navigations get the precached app shell. (The NavigationRoute itself only
 * ever sees request.mode === "navigate", so API fetches never reach it.)
 */
describe("service worker navigation fallback", () => {
  it("serves the app shell for the app's own routes", () => {
    for (const p of ["/", "/pos", "/login", "/orders/8f0c1d2e", "/stocktake", "/pos/"]) {
      expect(isAppShellNavigation(p), p).toBe(true);
    }
  });

  it("never serves HTML for API paths", () => {
    for (const p of ["/v1", "/v1/business/pos/till/current", "/api/x", "/admin_api/v1/events", "/health"]) {
      expect(isAppShellNavigation(p), p).toBe(false);
    }
  });

  it("leaves files (anything with an extension) to the network", () => {
    for (const p of ["/logo.jpeg", "/sw.js", "/manifest.webmanifest", "/assets/index-abc123.js", "/favicon.ico"]) {
      expect(isAppShellNavigation(p), p).toBe(false);
    }
  });

  it("does not over-match routes that merely start like an API prefix", () => {
    expect(isAppShellNavigation("/v1x")).toBe(true);
    expect(NAVIGATION_DENYLIST.length).toBeGreaterThan(0);
  });
});
