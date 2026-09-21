import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom has no ResizeObserver — TouchKeyboard.tsx and BottomNav.tsx use one
// to measure their real rendered height (see the wave0a layout fixes). A
// no-op stub is enough here: components fall back to their pre-measurement
// default height, which every existing/added test that doesn't specifically
// assert on measured geometry is unaffected by.
if (typeof window.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverStub;
}
