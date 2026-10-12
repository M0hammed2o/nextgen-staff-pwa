// ── POS Input Mode ───────────────────────────────────────────────────────
//
// A per-DEVICE (browser/terminal) preference, deliberately NOT a business
// setting — the same restaurant might run one touchscreen till and one
// till with a physical keyboard+mouse side by side, so this lives in
// localStorage on the device itself, exactly like token-storage.ts's
// pattern (try/catch on every access; a missing/corrupt value just falls
// back to "auto" rather than throwing).

export type InputModeSetting = "auto" | "touch" | "keyboard";

const STORAGE_KEY = "nextgen_staff_input_mode";

// Dispatched on `window` whenever the stored mode changes, so every
// component holding its own useInputMode() hook instance (Profile page,
// Login page, the app-root TouchKeyboard host) stays in sync without a full
// reload or a shared React context tree — the mode can be changed from a
// completely different part of the component tree (Profile) than the one
// consuming it (a field on the Pos page, mounted at the app root).
export const INPUT_MODE_CHANGE_EVENT = "nextgen:input-mode-change";

export function getStoredInputMode(): InputModeSetting {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "auto" || raw === "touch" || raw === "keyboard") return raw;
    return "auto";
  } catch {
    return "auto";
  }
}

export function setStoredInputMode(mode: InputModeSetting): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage unavailable — the choice just won't survive a reload this session.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<InputModeSetting>(INPUT_MODE_CHANGE_EVENT, { detail: mode }));
  }
}

/**
 * Best-effort touch-capability detection for "Auto" mode.
 *
 * IMPORTANT: this can never prove whether a physical keyboard is attached —
 * a touchscreen laptop or a Surface-style device with a keyboard plugged in
 * still reports `pointer: coarse`/touch points. It only answers "does this
 * device have a touchscreen", which is what "Auto" needs; the explicit
 * Touchscreen/Keyboard+Mouse override exists precisely because this
 * heuristic cannot be perfect, and Auto is a starting guess, not a promise.
 */
export function detectTouchCapable(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const touchPoints = (navigator.maxTouchPoints ?? 0) > 0;
  const coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const noHover = typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;
  return touchPoints || coarsePointer || noHover;
}

/** Resolves a stored setting (which may be "auto") down to a concrete on/off touch-active boolean. An explicit override always wins over detection. */
export function resolveTouchActive(mode: InputModeSetting): boolean {
  if (mode === "touch") return true;
  if (mode === "keyboard") return false;
  return detectTouchCapable();
}

/**
 * iPhone/iPad/iPod, including iPadOS 13+ — which reports itself as
 * "Macintosh" in its user-agent, so it is told apart from a real Mac by
 * MacIntel + more than one touch point (no Mac has a touchscreen).
 */
export function detectIsIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1);
}

/** Any Android browser, and the Capacitor Android WebView this app also ships in (its UA contains "Android"). */
export function detectIsAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/.test(navigator.userAgent);
}

/**
 * True only for a device that should get the CUSTOM on-screen keyboard —
 * the Windows+Chrome touchscreen workaround this system exists for.
 * Never true on iOS/Android: they always have a real native keyboard,
 * and no explicit override should force the workaround onto them.
 *
 * Deliberately separate from resolveTouchActive(), which keeps its existing
 * meaning ("is this a touch device / did the user choose Touchscreen").
 */
export function resolveCustomKeyboardActive(mode: InputModeSetting): boolean {
  if (detectIsIOS() || detectIsAndroid()) return false;
  if (mode === "touch") return true;
  if (mode === "keyboard") return false;
  return detectTouchCapable();
}
