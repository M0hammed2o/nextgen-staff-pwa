import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStoredInputMode,
  setStoredInputMode,
  detectTouchCapable,
  detectIsIOS,
  detectIsAndroid,
  resolveTouchActive,
  resolveCustomKeyboardActive,
  INPUT_MODE_CHANGE_EVENT,
} from "@/lib/touch-input";

beforeEach(() => {
  localStorage.clear();
});

describe("input mode storage", () => {
  it("defaults to auto when nothing is stored", () => {
    expect(getStoredInputMode()).toBe("auto");
  });

  it("round-trips a stored mode", () => {
    setStoredInputMode("touch");
    expect(getStoredInputMode()).toBe("touch");
    setStoredInputMode("keyboard");
    expect(getStoredInputMode()).toBe("keyboard");
  });

  it("falls back to auto for a corrupted/unknown stored value", () => {
    localStorage.setItem("nextgen_staff_input_mode", "not-a-real-mode");
    expect(getStoredInputMode()).toBe("auto");
  });

  it("broadcasts a window event when the mode changes, so other components can react without a shared React tree", () => {
    const handler = vi.fn();
    window.addEventListener(INPUT_MODE_CHANGE_EVENT, handler);
    setStoredInputMode("touch");
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent<string>;
    expect(event.detail).toBe("touch");
    window.removeEventListener(INPUT_MODE_CHANGE_EVENT, handler);
  });
});

describe("resolveTouchActive", () => {
  it("an explicit touch override always wins, regardless of detection", () => {
    expect(resolveTouchActive("touch")).toBe(true);
  });

  it("an explicit keyboard override always wins, regardless of detection", () => {
    expect(resolveTouchActive("keyboard")).toBe(false);
  });

  it("auto falls back to detectTouchCapable()", () => {
    // jsdom's default (see src/test/setup.ts's matchMedia stub) reports no
    // touch capability, so auto should resolve to false in this environment.
    expect(resolveTouchActive("auto")).toBe(detectTouchCapable());
  });
});

// Real user-agent strings for each device class this app runs on.
const UA = {
  iPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  iPadLegacy: "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ "desktop-class" Safari: indistinguishable from a Mac by UA alone.
  macDesktopUA: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  androidWebView: "Mozilla/5.0 (Linux; Android 13; SM-T220 Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Safari/537.36",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

function mockDevice({ userAgent, platform = "", maxTouchPoints = 0 }: { userAgent: string; platform?: string; maxTouchPoints?: number }) {
  Object.defineProperty(window.navigator, "userAgent", { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: maxTouchPoints, configurable: true });
}

function restoreDevice() {
  // The overrides above are own properties shadowing the Navigator.prototype getters.
  for (const key of ["userAgent", "platform", "maxTouchPoints"]) {
    delete (window.navigator as unknown as Record<string, unknown>)[key];
  }
}

describe("detectIsIOS / detectIsAndroid", () => {
  afterEach(restoreDevice);

  it("detects an iPhone", () => {
    mockDevice({ userAgent: UA.iPhone, platform: "iPhone", maxTouchPoints: 5 });
    expect(detectIsIOS()).toBe(true);
    expect(detectIsAndroid()).toBe(false);
  });

  it("detects a legacy iPad UA", () => {
    mockDevice({ userAgent: UA.iPadLegacy, platform: "iPad", maxTouchPoints: 5 });
    expect(detectIsIOS()).toBe(true);
  });

  it("detects iPadOS 13+ reporting as a Mac, via MacIntel + multi-touch", () => {
    mockDevice({ userAgent: UA.macDesktopUA, platform: "MacIntel", maxTouchPoints: 5 });
    expect(detectIsIOS()).toBe(true);
  });

  it("does not treat a real Mac (no touch points) as iOS", () => {
    mockDevice({ userAgent: UA.macDesktopUA, platform: "MacIntel", maxTouchPoints: 0 });
    expect(detectIsIOS()).toBe(false);
  });

  it("detects Android Chrome and the Capacitor Android WebView", () => {
    mockDevice({ userAgent: UA.androidChrome, platform: "Linux armv8l", maxTouchPoints: 5 });
    expect(detectIsAndroid()).toBe(true);
    expect(detectIsIOS()).toBe(false);
    mockDevice({ userAgent: UA.androidWebView, platform: "Linux armv8l", maxTouchPoints: 5 });
    expect(detectIsAndroid()).toBe(true);
  });

  it("a Windows touchscreen is neither", () => {
    mockDevice({ userAgent: UA.windowsChrome, platform: "Win32", maxTouchPoints: 10 });
    expect(detectIsIOS()).toBe(false);
    expect(detectIsAndroid()).toBe(false);
  });
});

describe("resolveCustomKeyboardActive", () => {
  afterEach(restoreDevice);

  const modes = ["auto", "touch", "keyboard"] as const;

  it.each([
    ["iPhone", { userAgent: UA.iPhone, platform: "iPhone", maxTouchPoints: 5 }],
    ["iPadOS 13+", { userAgent: UA.macDesktopUA, platform: "MacIntel", maxTouchPoints: 5 }],
    ["Android", { userAgent: UA.androidChrome, platform: "Linux armv8l", maxTouchPoints: 5 }],
  ])("is never active on %s, in every mode (even an explicit Touchscreen override)", (_name, device) => {
    mockDevice(device);
    for (const mode of modes) {
      expect(resolveCustomKeyboardActive(mode)).toBe(false);
    }
  });

  it("on iOS/Android, resolveTouchActive keeps its existing meaning (unchanged for other consumers)", () => {
    mockDevice({ userAgent: UA.iPhone, platform: "iPhone", maxTouchPoints: 5 });
    expect(resolveTouchActive("auto")).toBe(true);
    expect(resolveTouchActive("touch")).toBe(true);
    expect(resolveCustomKeyboardActive("auto")).toBe(false);
  });

  it("Windows touchscreen: auto and touch open the custom keyboard, keyboard override does not", () => {
    mockDevice({ userAgent: UA.windowsChrome, platform: "Win32", maxTouchPoints: 10 });
    expect(resolveCustomKeyboardActive("auto")).toBe(true);
    expect(resolveCustomKeyboardActive("touch")).toBe(true);
    expect(resolveCustomKeyboardActive("keyboard")).toBe(false);
  });

  it("Windows desktop without touch: only an explicit Touchscreen override opens it", () => {
    mockDevice({ userAgent: UA.windowsChrome, platform: "Win32", maxTouchPoints: 0 });
    expect(resolveCustomKeyboardActive("auto")).toBe(false);
    expect(resolveCustomKeyboardActive("touch")).toBe(true);
    expect(resolveCustomKeyboardActive("keyboard")).toBe(false);
  });
});

describe("detectTouchCapable", () => {
  it("returns true when navigator.maxTouchPoints indicates a touchscreen", () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, "maxTouchPoints");
    Object.defineProperty(window.navigator, "maxTouchPoints", { value: 5, configurable: true });
    expect(detectTouchCapable()).toBe(true);
    if (original) Object.defineProperty(window.navigator, "maxTouchPoints", original);
  });

  it("returns false when there is no touch signal at all", () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, "maxTouchPoints");
    Object.defineProperty(window.navigator, "maxTouchPoints", { value: 0, configurable: true });
    expect(detectTouchCapable()).toBe(false);
    if (original) Object.defineProperty(window.navigator, "maxTouchPoints", original);
  });
});
