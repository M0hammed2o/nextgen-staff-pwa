import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OfflineQueue } from "@/lib/offline/queue";
import { MemoryStore } from "@/lib/offline/store";
import { SyncEngine, classifyError, PERMANENT_SALE_CODES } from "@/lib/offline/sync-engine";
import { friendlyPosError } from "@/lib/pos-errors";
import { EVENT_THRESHOLDS, STANDARD_THRESHOLDS, EVENT_STALE_WARN_MS, EVENT_CAPTURE_MAX_AGE_MS, thresholdsFor, isoWithOffset, staleQueueState, clockSkewMs, isClockSkewed, HOUR_MS, STALE_WARN_MS, CAPTURE_MAX_AGE_MS } from "@/lib/offline/capture";
import { encryptJson, getOrCreateDeviceKey } from "@/lib/offline/crypto";
import { trainingStore } from "@/lib/offline/training";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";
import type { SalePayload } from "@/lib/offline/types";
import type { POSOrderCreateRequest } from "@/types";

function payload(key: string, total = 5000): SalePayload {
  const request = {
    order_mode: "PICKUP",
    items: [{ menu_item_id: "item-1", quantity: 1 }],
    payment_method: "CASH",
    cash_tendered_cents: total,
    idempotency_key: key,
  } as unknown as POSOrderCreateRequest;
  return {
    request,
    snapshot: { lines: [{ name: "Burger", quantity: 1, detail: null, line_total_cents: total }], total_cents: total, cash_tendered_cents: total, change_due_cents: 0 },
  };
}

describe("fields captured at sale time", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stamps capture time, cashier and till total at enqueue and replays them unchanged 30h later", async () => {
    vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
    const queue = new OfflineQueue(new MemoryStore());
    await queue.enqueueSale({ businessId: "biz-1", staffId: "cashier-7", payload: payload("k1", 4321) });
    const stampedMs = Date.now();

    vi.setSystemTime(new Date(stampedMs + 30 * HOUR_MS));
    const sent: Record<string, unknown>[] = [];
    const engine = new SyncEngine({
      queue,
      getIdentity: () => ({ businessId: "biz-1" }),
      isOnline: () => true,
      send: async (entry, p) => {
        sent.push({ ...p.request, idempotency_key: entry.id });
        return { id: "o1", order_number: "1" };
      },
    });
    await engine.syncNow();

    expect(sent).toHaveLength(1);
    const body = sent[0];
    expect(body.idempotency_key).toBe("k1");
    expect(body.captured_by_user_id).toBe("cashier-7");
    expect(body.offline_client_total_cents).toBe(4321);
    const captured = body.offline_captured_at as string;
    expect(captured).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(Date.parse(captured)).toBe(stampedMs); // sale time, not the sync time 30h later
  });

  it("isoWithOffset round-trips the instant and always carries an offset", () => {
    const ms = Date.parse("2026-03-01T23:59:59.123Z");
    const s = isoWithOffset(ms);
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(Date.parse(s)).toBe(ms);
  });

  it("replays an entry queued by an older build (no offline fields) without adding any", async () => {
    const store = new MemoryStore();
    const queue = new OfflineQueue(store);
    const e = await queue.enqueueSale({ businessId: "biz-1", staffId: "c", payload: payload("old") });
    // Re-write the stored blob the way an older build stored it: no offline fields.
    const blob = await encryptJson(await getOrCreateDeviceKey(store), payload("old"));
    await store.putEntry({ ...e, payload: blob });

    let body: Record<string, unknown> | null = null;
    const engine = new SyncEngine({
      queue,
      getIdentity: () => ({ businessId: "biz-1" }),
      isOnline: () => true,
      send: async (entry, p) => {
        body = { ...p.request, idempotency_key: entry.id };
        return { id: "o" };
      },
    });
    await engine.syncNow();
    expect(body).not.toBeNull();
    const sentBody = body as unknown as Record<string, unknown>;
    expect(sentBody.idempotency_key).toBe("old");
    expect("offline_captured_at" in sentBody).toBe(false);
    expect("captured_by_user_id" in sentBody).toBe(false);
    expect("offline_client_total_cents" in sentBody).toBe(false);
    expect((await queue.get("old"))!.status).toBe("synced");
  });
});

describe("error classification (contract section 6)", () => {
  const permanent: Array<[number, string]> = [
    [422, "OFFLINE_CAPTURE_TOO_OLD"],
    [422, "OFFLINE_CAPTURE_IN_FUTURE"],
    [422, "OFFLINE_CAPTURE_NO_TIMEZONE"],
    [404, "USER_NOT_FOUND"],
    [422, "INSUFFICIENT_CASH_TENDERED"],
    [422, "PAYMENT_TOTAL_MISMATCH"],
  ];
  it.each(permanent)("%s %s is permanent with a plain message", (status, code) => {
    const o = classifyError({ status, code, message: "raw" });
    expect(o.kind).toBe("conflict");
    expect((o as { message: string }).message).toBe(PERMANENT_SALE_CODES[code]);
    expect((o as { code: string }).code).toBe(code);
  });

  it("EVENT_TRADING_NOT_ALLOWED is permanent and keeps the server's reason text", () => {
    const o = classifyError({ status: 403, code: "EVENT_TRADING_NOT_ALLOWED", message: "No paid day" });
    expect(o).toEqual({ kind: "conflict", message: "No paid day", code: "EVENT_TRADING_NOT_ALLOWED" });
  });

  it("keeps the sale (auth wait, never parked) on BUSINESS_SUSPENDED and 401", () => {
    expect(classifyError({ status: 403, code: "BUSINESS_SUSPENDED", message: "x" }).kind).toBe("auth");
    expect(classifyError({ status: 401, message: "x" }).kind).toBe("auth");
  });

  it("retries network errors and 5xx, and parks an unknown 404 for a human", () => {
    expect(classifyError({ noResponse: true, status: 0, message: "x" }).kind).toBe("retry");
    expect(classifyError({ status: 503, message: "x" }).kind).toBe("retry");
    expect(classifyError({ status: 404, code: "MENU_ITEM_NOT_FOUND", message: "x" }).kind).toBe("failed");
  });

  it("engine parks a permanent failure and never retries it; a suspended sale stays pending with its payload", async () => {
    const queue = new OfflineQueue(new MemoryStore());
    await queue.enqueueSale({ businessId: "biz-1", staffId: "c", payload: payload("a") });
    await queue.enqueueSale({ businessId: "biz-1", staffId: "c", payload: payload("b") });
    const send = vi.fn(async (entry: { id: string }) => {
      if (entry.id === "a") throw { status: 422, code: "OFFLINE_CAPTURE_TOO_OLD", message: "raw" };
      throw { status: 403, code: "BUSINESS_SUSPENDED", message: "raw" };
    });
    const engine = new SyncEngine({ queue, send: send as never, getIdentity: () => ({ businessId: "biz-1" }), isOnline: () => true });
    await engine.syncNow();
    await engine.syncNow({ manual: true });
    const a = (await queue.get("a"))!;
    const b = (await queue.get("b"))!;
    expect(a.status).toBe("conflict");
    expect(a.last_error).toBe(PERMANENT_SALE_CODES.OFFLINE_CAPTURE_TOO_OLD);
    expect(send.mock.calls.filter((c) => c[0].id === "a")).toHaveLength(1);
    expect(b.status).toBe("pending");
    expect(b.payload).not.toBeNull();
    expect(b.last_error_code).toBe("BUSINESS_SUSPENDED");
  });
});

describe("training isolation", () => {
  beforeEach(() => {
    __resetSafeStorageForTests();
    trainingStore.reset();
  });
  afterEach(() => {
    trainingStore.reset();
    vi.unstubAllGlobals();
  });

  it("training sales stay in memory: no fetch, nothing in the real queue store", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const queue = new OfflineQueue(new MemoryStore());
    trainingStore.setActive(true);
    trainingStore.addSale({ total_cents: 1000, cash_tendered_cents: 1000, change_due_cents: 0, lines: [] });
    expect(trainingStore.get().sales).toHaveLength(1);
    expect(await queue.list()).toHaveLength(0);
    expect(await queue.unsyncedCount()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("stale queue warning", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const e = (status: "pending" | "syncing" | "synced" | "conflict", ageMs: number) => ({ status, created_at: new Date(now - ageMs).toISOString() });

  it("is silent at or below 48h, warns just over 48h, expired at 72h", () => {
    expect(staleQueueState([], now).level).toBe("none");
    expect(staleQueueState([e("pending", STALE_WARN_MS)], now).level).toBe("none");
    const warn = staleQueueState([e("pending", STALE_WARN_MS + 1)], now);
    expect(warn.level).toBe("warn");
    expect(warn.hoursLeft).toBe(23);
    expect(staleQueueState([e("pending", CAPTURE_MAX_AGE_MS)], now).level).toBe("expired");
  });

  it("uses the oldest waiting sale and ignores synced and parked ones", () => {
    const s = staleQueueState([e("synced", 100 * HOUR_MS), e("conflict", 100 * HOUR_MS), e("pending", 1 * HOUR_MS), e("syncing", 50 * HOUR_MS)], now);
    expect(s.level).toBe("warn");
    expect(staleQueueState([e("synced", 100 * HOUR_MS), e("conflict", 100 * HOUR_MS)], now).level).toBe("none");
  });
});

describe("clock skew (warn only)", () => {
  it("parses the Date header and flags more than 5 minutes either way", () => {
    const dev = Date.parse("2026-11-19T12:00:00Z");
    expect(clockSkewMs(null, dev)).toBeNull();
    expect(clockSkewMs("garbage", dev)).toBeNull();
    expect(isClockSkewed(clockSkewMs("Thu, 19 Nov 2026 11:56:00 GMT", dev))).toBe(false);
    expect(isClockSkewed(clockSkewMs("Thu, 19 Nov 2026 11:54:00 GMT", dev))).toBe(true);
    expect(isClockSkewed(clockSkewMs("Thu, 19 Nov 2026 12:06:00 GMT", dev))).toBe(true);
    expect(isClockSkewed(null)).toBe(false);
  });
});

describe("threshold-aware stale warning", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const pending = (ageMs: number) => [{ status: "pending" as const, created_at: new Date(now - ageMs).toISOString() }];

  it("constants: standard 48h/72h, event 24h/36h", () => {
    expect(STANDARD_THRESHOLDS).toEqual({ warnMs: 48 * HOUR_MS, maxAgeMs: 72 * HOUR_MS });
    expect(EVENT_THRESHOLDS).toEqual({ warnMs: 24 * HOUR_MS, maxAgeMs: 36 * HOUR_MS });
    expect(thresholdsFor(true)).toBe(EVENT_THRESHOLDS);
    expect(thresholdsFor(false)).toBe(STANDARD_THRESHOLDS);
  });

  it("an event vendor is warned after 24h and told 36h; a standard business is not warned at 30h", () => {
    const ev = thresholdsFor(true);
    expect(staleQueueState(pending(EVENT_STALE_WARN_MS), now, ev).level).toBe("none");
    const warn = staleQueueState(pending(EVENT_STALE_WARN_MS + 1), now, ev);
    expect(warn.level).toBe("warn");
    expect(warn.maxAgeHours).toBe(36);
    expect(warn.hoursLeft).toBe(11);
    expect(staleQueueState(pending(EVENT_CAPTURE_MAX_AGE_MS), now, ev).level).toBe("expired");
    expect(staleQueueState(pending(30 * HOUR_MS), now, thresholdsFor(false)).level).toBe("none");
    expect(staleQueueState(pending(30 * HOUR_MS), now).maxAgeHours).toBe(72);
  });
});

describe("refund error mapping", () => {
  it("maps OFFLINE_REFUND_REQUIRES_OWNER to a plain message", () => {
    const m = friendlyPosError({ code: "OFFLINE_REFUND_REQUIRES_OWNER", message: "raw" }, "fallback");
    expect(m).toMatch(/owner/i);
    expect(m).not.toBe("raw");
  });
});
