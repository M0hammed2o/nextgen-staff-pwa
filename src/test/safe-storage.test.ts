import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  safeGetItem,
  safeSetItem,
  safeRemoveItem,
  __resetSafeStorageForTests,
} from "@/lib/safe-storage";

describe("safe-storage — three-tier fallback", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    __resetSafeStorageForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses localStorage normally when it works (baseline, unchanged behavior)", () => {
    safeSetItem("k1", "v1");
    expect(localStorage.getItem("k1")).toBe("v1");
    expect(sessionStorage.getItem("k1")).toBeNull();
    expect(safeGetItem("k1")).toBe("v1");
  });

  it("falls back to sessionStorage when localStorage.setItem throws", () => {
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value
    ) {
      if (this === localStorage) throw new DOMException("QuotaExceededError");
      realSetItem.call(this, key, value);
    });

    safeSetItem("k2", "v2");

    expect(sessionStorage.getItem("k2")).toBe("v2");
    expect(safeGetItem("k2")).toBe("v2");
  });

  it("falls back to in-memory storage when both localStorage and sessionStorage throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    safeSetItem("k3", "v3");

    expect(safeGetItem("k3")).toBe("v3");
  });

  it("reads consistently reuse whichever tier actually answered, never a mix", () => {
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value
    ) {
      if (this === localStorage) throw new DOMException("QuotaExceededError");
      realSetItem.call(this, key, value);
    });
    safeSetItem("k4", "session-value");

    // Directly poke a decoy value into localStorage, bypassing the helper,
    // to prove a read doesn't just prefer localStorage because it now has
    // something in it, once the mock is removed.
    vi.restoreAllMocks();
    localStorage.setItem("k4", "local-decoy");

    expect(safeGetItem("k4")).toBe("session-value");
    expect(sessionStorage.getItem("k4")).toBe("session-value");
  });

  it("safeRemoveItem clears the value from all three tiers", () => {
    localStorage.setItem("k5", "a");
    sessionStorage.setItem("k5", "b");
    safeSetItem("k5", "c"); // lands in localStorage, tier = local

    safeRemoveItem("k5");

    expect(localStorage.getItem("k5")).toBeNull();
    expect(sessionStorage.getItem("k5")).toBeNull();
    expect(safeGetItem("k5")).toBeNull();
  });

  it("safeRemoveItem clears the in-memory tier even if both real storages are unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    safeSetItem("k6", "mem-value");
    expect(safeGetItem("k6")).toBe("mem-value");

    safeRemoveItem("k6");

    expect(safeGetItem("k6")).toBeNull();
  });
});
