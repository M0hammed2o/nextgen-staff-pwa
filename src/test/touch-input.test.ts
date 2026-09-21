import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getStoredInputMode,
  setStoredInputMode,
  detectTouchCapable,
  resolveTouchActive,
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
