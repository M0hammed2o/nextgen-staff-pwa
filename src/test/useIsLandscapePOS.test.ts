import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useIsLandscapePOS } from "@/hooks/useIsLandscapePOS";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: height });
}

afterEach(() => {
  cleanup();
  setViewport(1024, 768);
});

describe("useIsLandscapePOS", () => {
  it("reflects the current landscape POS terminal size (1024x768) on mount", () => {
    setViewport(1024, 768);
    const { result } = renderHook(() => useIsLandscapePOS());
    expect(result.current).toBe(true);
  });

  it("reflects a portrait tablet (768x1024) on mount", () => {
    setViewport(768, 1024);
    const { result } = renderHook(() => useIsLandscapePOS());
    expect(result.current).toBe(false);
  });

  it("updates when the viewport resizes from landscape to portrait (device rotated)", () => {
    setViewport(1024, 768);
    const { result } = renderHook(() => useIsLandscapePOS());
    expect(result.current).toBe(true);

    act(() => {
      setViewport(768, 1024);
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(false);
  });

  it("updates on orientationchange too, not only resize", () => {
    setViewport(768, 1024);
    const { result } = renderHook(() => useIsLandscapePOS());
    expect(result.current).toBe(false);

    act(() => {
      setViewport(1024, 768);
      window.dispatchEvent(new Event("orientationchange"));
    });
    expect(result.current).toBe(true);
  });
});
