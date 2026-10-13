/**
 * Safe, three-tier key/value storage.
 *
 * Why this exists: Safari (notably on iPad, and worse under certain privacy /
 * storage-partitioning settings, or when the app is installed to the home
 * screen) can throw on `localStorage.setItem`/`getItem`/`removeItem`, or
 * silently restrict it. `token-storage.ts` used to guard every READ with
 * try/catch but call `localStorage` directly, unguarded, on every WRITE and
 * REMOVE (`storeTokens`, `storeUser`, `saveBusiness`, `clearTokens`,
 * `clearAll`). A throw there propagated straight out of `auth.tsx`'s
 * `login()` into `Login.tsx`'s catch block, which showed "Incorrect PIN.
 * Please try again." for ANY error — so a Safari storage throw on iPad looked
 * exactly like a wrong PIN. This module fixes that bug class at the root: the
 * same class of bug KNOWN_BUGS.md documents for the sibling Manager Dashboard
 * app's `auth-storage.ts`.
 *
 * Also see KNOWN_BUGS.md BUG-0002 (SSE relative-URL pattern) and BUG-0010
 * (key/id-regeneration pattern) — unrelated bug classes, but ones this module
 * must not reintroduce elsewhere: every access here is wrapped so it can
 * never throw up into caller code, and nothing here derives a key from a
 * field that changes live.
 *
 * Fallback chain, per key, tried in this order:
 *   1. localStorage  (preferred — persists across tabs/restarts)
 *   2. sessionStorage (persists for the tab's lifetime)
 *   3. in-memory Map (always available, cleared on full reload)
 *
 * The tier that actually succeeds for a write is remembered per key so a
 * later READ of that key goes back to the same tier first, rather than
 * mixing results from different tiers for what should be one logical value.
 * If the remembered tier itself throws on a later read (e.g. it stopped
 * working mid-session), the read falls through the same probe chain and
 * re-remembers whichever tier actually answered.
 *
 * `safeRemoveItem` clears a key from ALL THREE tiers unconditionally,
 * regardless of which tier is currently remembered — this matters for
 * logout, which must not leave a stale value behind in a tier that was in
 * use earlier in the session (e.g. localStorage worked at login time, then a
 * later write only landed in sessionStorage).
 */

type Tier = "local" | "session" | "memory";

const memoryStore = new Map<string, string>();
const tierForKey = new Map<string, Tier>();

/** Thrown only when every tier — including the in-memory fallback — fails. */
export class SafeStorageError extends Error {
  constructor(message = "Couldn't save data on this device. Please try again.") {
    super(message);
    this.name = "SafeStorageError";
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    tierForKey.set(key, "local");
    return;
  } catch {
    /* localStorage unavailable/throwing — fall through to sessionStorage */
  }
  try {
    sessionStorage.setItem(key, value);
    tierForKey.set(key, "session");
    return;
  } catch {
    /* sessionStorage unavailable/throwing — fall through to memory */
  }
  try {
    memoryStore.set(key, value);
    tierForKey.set(key, "memory");
  } catch {
    // Should be essentially unreachable (a plain in-memory Map.set failing
    // implies something catastrophic, e.g. out of memory) — but handle it
    // defensively rather than letting an exception escape into the login
    // flow, where it could be mistaken for bad credentials.
    throw new SafeStorageError();
  }
}

export function safeGetItem(key: string): string | null {
  const remembered = tierForKey.get(key);

  if (remembered === "local") {
    try {
      return localStorage.getItem(key);
    } catch {
      /* fall through to the full probe below */
    }
  } else if (remembered === "session") {
    try {
      return sessionStorage.getItem(key);
    } catch {
      /* fall through to the full probe below */
    }
  } else if (remembered === "memory") {
    return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
  }

  // No remembered tier, or the remembered tier just failed — probe in
  // priority order and remember whichever tier actually answers.
  try {
    const value = localStorage.getItem(key);
    tierForKey.set(key, "local");
    return value;
  } catch {
    /* fall through */
  }
  try {
    const value = sessionStorage.getItem(key);
    tierForKey.set(key, "session");
    return value;
  } catch {
    /* fall through */
  }
  tierForKey.set(key, "memory");
  return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore — nothing to clear there */
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore — nothing to clear there */
  }
  memoryStore.delete(key);
  tierForKey.delete(key);
}

/**
 * Test-only reset of the module-level in-memory tier and tier bookkeeping.
 * `localStorage.clear()`/`sessionStorage.clear()` in a test's `beforeEach`
 * do not touch these module-level Maps, so without this, a key that fell
 * back to 'memory' or 'session' in one test would stay remembered as such in
 * the next. Not used outside tests.
 */
export function __resetSafeStorageForTests(): void {
  memoryStore.clear();
  tierForKey.clear();
}
