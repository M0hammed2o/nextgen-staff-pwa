import type { CapacitorConfig } from '@capacitor/cli';

/**
 * NextGen POS — thin native shell around the existing PWA.
 *
 * ARCHITECTURE: the React/Vite app in `src/` is the single source of truth for
 * all business logic, and it is the SAME build that serves the browser. The
 * native project exists only to package it, so there is no second POS codebase
 * to keep in step. See docs/MOBILE_APP_ARCHITECTURE.md for the full decision
 * and the alternatives considered.
 *
 * `webDir: "dist"` means `npm run build` then `npx cap sync` is the whole
 * pipeline — the shell always ships exactly what the web app ships.
 *
 * NOTE ON IDENTITY: appId/appName are NextGen's, not any restaurant's. One
 * store binary serves every tenant and personalises ITSELF after the business
 * is resolved at login. Per-restaurant store binaries are deliberately not
 * attempted — see the architecture doc.
 */
const config: CapacitorConfig = {
  appId: 'za.co.nextgenintelligence.pos',
  appName: 'NextGen POS',
  webDir: 'dist',
  android: {
    // The till is a fixed-purpose device; allowing mixed content or cleartext
    // would only widen the attack surface for no benefit.
    allowMixedContent: false,
  },
};

export default config;
