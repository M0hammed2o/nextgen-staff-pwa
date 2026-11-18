import { describe, it, expect, vi, beforeEach } from "vitest";

const getMock = vi.fn();
vi.mock("@/lib/api", () => ({ apiClient: { get: (...a: unknown[]) => getMock(...a) } }));

import { cachedGet, clearSnapshots } from "@/lib/offline/snapshot-cache";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";

beforeEach(() => {
  localStorage.clear();
  __resetSafeStorageForTests();
  getMock.mockReset();
});

describe("cachedGet (menu/till/settings offline fallback)", () => {
  it("remembers a good answer and serves it when the request gets no response", async () => {
    getMock.mockResolvedValueOnce([{ id: "i1" }]);
    expect(await cachedGet("biz-1", "items", "/v1/business/menu/items")).toEqual([{ id: "i1" }]);
    getMock.mockRejectedValueOnce({ noResponse: true, status: 0, message: "down" });
    expect(await cachedGet("biz-1", "items", "/v1/business/menu/items")).toEqual([{ id: "i1" }]);
  });

  it("caches a legitimate null (no open till) too", async () => {
    getMock.mockResolvedValueOnce(null);
    await cachedGet("biz-1", "till", "/t");
    getMock.mockRejectedValueOnce({ noResponse: true, status: 0 });
    expect(await cachedGet("biz-1", "till", "/t")).toBeNull();
  });

  it("never masks a real HTTP error with stale data", async () => {
    getMock.mockResolvedValueOnce([{ id: "i1" }]);
    await cachedGet("biz-1", "items", "/p");
    getMock.mockRejectedValueOnce({ status: 500, message: "boom" });
    await expect(cachedGet("biz-1", "items", "/p")).rejects.toMatchObject({ status: 500 });
  });

  it("throws when offline with nothing cached, and is scoped per business", async () => {
    getMock.mockResolvedValueOnce([{ id: "i1" }]);
    await cachedGet("biz-1", "items", "/p");
    getMock.mockRejectedValueOnce({ noResponse: true, status: 0 });
    await expect(cachedGet("biz-2", "items", "/p")).rejects.toMatchObject({ noResponse: true });
  });

  it("is cleared on logout", async () => {
    getMock.mockResolvedValueOnce([{ id: "i1" }]);
    await cachedGet("biz-1", "items", "/p");
    clearSnapshots("biz-1");
    getMock.mockRejectedValueOnce({ noResponse: true, status: 0 });
    await expect(cachedGet("biz-1", "items", "/p")).rejects.toBeTruthy();
  });
});
