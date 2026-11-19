import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import { OfflineContext, countEntries, type OfflineContextValue } from "@/lib/offline/offline-context";
import { OfflineQueue } from "@/lib/offline/queue";
import { MemoryStore } from "@/lib/offline/store";
import { SyncEngine, classifyError, isPendingReview, PERMANENT_SALE_CODES } from "@/lib/offline/sync-engine";
import { toState } from "@/lib/offline/event-access";
import { trainingStore } from "@/lib/offline/training";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";
import type { QueueEntry, SalePayload } from "@/lib/offline/types";
import type { POSOrderCreateRequest } from "@/types";

/**
 * BUG-0208 post-event sync grace on the till: the sync-only state, the
 * "sent to manager for review" outcome of a late upload (202), and the error
 * classification of the new server codes.
 */

const getMock = vi.fn();
const postMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: null, staff_name: "Cashier", role: "STAFF", business_id: "biz-1", business_name: "Souk Stall" },
  }),
}));

import Pos from "@/pages/Pos";

function payload(key: string, extra: Partial<POSOrderCreateRequest> = {}): SalePayload {
  const request = {
    order_mode: "PICKUP",
    items: [{ menu_item_id: "item-1", quantity: 1, selected_option_ids: {}, add_on_selections: [], removed_ingredient_ids: [], special_instructions: null }],
    payment_method: "CASH",
    cash_tendered_cents: 5000,
    idempotency_key: key,
    ...extra,
  } as unknown as POSOrderCreateRequest;
  return {
    request,
    snapshot: { lines: [{ name: "Wrap", quantity: 1, detail: null, line_total_cents: 5000 }], total_cents: 5000, cash_tendered_cents: 5000, change_due_cents: 0 },
  };
}

let clock = 5_000_000;
const now = () => clock;

function setup() {
  const queue = new OfflineQueue(new MemoryStore(), now);
  const send = vi.fn();
  const engine = new SyncEngine({ queue, send, getIdentity: () => ({ businessId: "biz-1" }), isOnline: () => true, now });
  const enqueue = (key: string) => queue.enqueueSale({ businessId: "biz-1", staffId: "staff-1", payload: payload(key) });
  return { queue, send, engine, enqueue };
}

beforeEach(() => {
  clock = 5_000_000;
  localStorage.clear();
  __resetSafeStorageForTests();
  trainingStore.reset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("late upload sent to manager review (202 OFFLINE_CAPTURE_PENDING_REVIEW)", () => {
  it("moves the entry to a final review state: not an error, not retried, not double-counted", async () => {
    const { queue, send, engine, enqueue } = setup();
    await enqueue("late-1");
    await enqueue("ok-2");
    send.mockImplementation(async (entry: QueueEntry) =>
      entry.id === "late-1"
        ? { code: "OFFLINE_CAPTURE_PENDING_REVIEW", review_id: "rev-9", review_status: "PENDING" }
        : { id: "order-2", order_number: "#0002" },
    );
    await engine.syncNow();
    const [late, ok] = await queue.list();
    expect(late.status).toBe("review");
    expect(late.review_id).toBe("rev-9");
    expect(late.payload).toBeNull(); // the server holds it; no cart data kept here
    expect(late.last_error).toBeNull();
    expect(ok.status).toBe("synced");
    // the head is final, so the FIFO carried on to the next sale
    expect(send).toHaveBeenCalledTimes(2);
    // not unsynced, not pending, not attention: counted once, as review
    expect(await queue.unsyncedCount()).toBe(0);
    expect(countEntries(await queue.list())).toMatchObject({ pending: 0, attention: 0, synced: 1, review: 1 });
    // a further pass never re-sends it
    await engine.syncNow({ manual: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("is purged after the retention window like a synced sale, and wiped on logout", async () => {
    const { queue, send, engine, enqueue } = setup();
    await enqueue("late-1");
    send.mockResolvedValue({ code: "OFFLINE_CAPTURE_PENDING_REVIEW", review_id: "rev-1" });
    await engine.syncNow();
    clock += 25 * 60 * 60 * 1000;
    expect(await queue.purgeSynced()).toBe(1);
    await enqueue("late-2");
    await engine.syncNow();
    await queue.wipe({ discardUnsynced: false });
    expect(await queue.list()).toEqual([]);
  });

  it("only a 202 body with a review id counts as review", () => {
    expect(isPendingReview({ code: "OFFLINE_CAPTURE_PENDING_REVIEW", review_id: "r" })).toBe(true);
    expect(isPendingReview({ code: "OFFLINE_CAPTURE_PENDING_REVIEW" })).toBe(false);
    expect(isPendingReview({ id: "o", order_number: "#1" })).toBe(false);
    expect(isPendingReview(null)).toBe(false);
  });
});

describe("classification of the new server codes", () => {
  it("EVENT_SYNC_ONLY and a rejected/decided review are parked for a human, never retried", () => {
    for (const [status, code] of [
      [403, "EVENT_SYNC_ONLY"],
      [409, "OFFLINE_CAPTURE_REVIEW_REJECTED"],
      [409, "OFFLINE_CAPTURE_REVIEW_DECIDED"],
    ] as const) {
      const o = classifyError({ status, code, message: "raw" });
      expect(o.kind).toBe("conflict");
      if (o.kind === "conflict") {
        expect(o.code).toBe(code);
        expect(o.message).toBe(PERMANENT_SALE_CODES[code]);
      }
    }
  });

  it("the suspension wait and the network retry are unchanged", () => {
    expect(classifyError({ status: 403, code: "BUSINESS_SUSPENDED", message: "x" }).kind).toBe("auth");
    expect(classifyError({ noResponse: true, status: 0, message: "x" }).kind).toBe("retry");
  });
});

describe("the upload opts in to the review queue only for offline captures", () => {
  it("adds offline_review_if_too_old to a queued sale with a capture time, never to one without", async () => {
    const runtime = await import("@/lib/offline/runtime");
    apiFetchMock.mockResolvedValue({ id: "o1", order_number: "#1" });
    const engine = runtime.getEngine() as unknown as { opts: { send: (e: QueueEntry, p: SalePayload) => Promise<unknown> } };
    const entry = { id: "key-1" } as QueueEntry;
    await engine.opts.send(entry, payload("key-1", { offline_captured_at: "2026-11-20T10:00:00+02:00" }));
    await engine.opts.send({ id: "key-2" } as QueueEntry, payload("key-2"));
    const bodies = apiFetchMock.mock.calls.map(([, init]) => JSON.parse((init as { body: string }).body));
    expect(bodies[0]).toMatchObject({ idempotency_key: "key-1", offline_review_if_too_old: true });
    expect(bodies[1].idempotency_key).toBe("key-2");
    expect("offline_review_if_too_old" in bodies[1]).toBe(false);
  });
});

describe("event access: sync-only grace", () => {
  it("maps sync_only/sync_only_until and never allows trading", () => {
    const s = toState(
      { is_event_vendor: true, access_level: "NONE", reason: "EVENT_ENDED", sync_only: true, sync_only_until: "2026-11-22T22:00:00Z" },
      false,
    );
    expect(s).toMatchObject({ syncOnly: true, syncOnlyUntil: "2026-11-22T22:00:00Z", canTrade: false, level: "NONE" });
    // older backend (no field) and non-event businesses are unchanged
    expect(toState({ is_event_vendor: true, access_level: "NONE", reason: "EVENT_ENDED" }, false).syncOnly).toBe(false);
    const plain = toState({ is_event_vendor: false, access_level: null, reason: null, sync_only: true }, false);
    expect(plain).toMatchObject({ syncOnly: false, canTrade: true });
  });

  const MENU_ITEM = {
    id: "item-1", category_id: null, name: "Wrap", description: null, price_cents: 5000, currency: "ZAR",
    options_json: null, add_ons: [], is_active: true, sort_order: 0, image_url: null, requires_preparation: false,
  };

  function renderPos(value: OfflineContextValue) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <OfflineContext.Provider value={value}>
        <MemoryRouter initialEntries={["/pos"]}>
          <QueryClientProvider client={client}>
            <TouchKeyboardProvider>
              <Pos />
            </TouchKeyboardProvider>
          </QueryClientProvider>
        </MemoryRouter>
      </OfflineContext.Provider>,
    );
  }

  it("shows the upload-only state with the deadline, no menu, and Sync now drives the queue", async () => {
    const syncOnlyErr = { status: 403, code: "EVENT_SYNC_ONLY", message: "This event has ended." };
    getMock.mockImplementation((path: string) => {
      if (path === "/v1/business/event-access")
        return Promise.resolve({
          is_event_vendor: true, access_level: "NONE", reason: "EVENT_ENDED", events: [],
          sync_only: true, sync_only_until: "2026-11-22T22:00:00Z",
        });
      if (path === "/v1/business/pos/till/current") return Promise.resolve(null);
      if (path === "/v1/business/menu/items") return Promise.resolve([MENU_ITEM]);
      return Promise.reject(syncOnlyErr); // menu/settings are no longer served
    });
    postMock.mockRejectedValue(new Error("unexpected POST"));
    const syncNow = vi.fn(async () => undefined);
    const entries = [
      { id: "a", status: "pending" }, { id: "b", status: "review" }, { id: "c", status: "conflict" },
    ] as QueueEntry[];
    renderPos({
      available: true, online: true, entries, counts: countEntries(entries), authRequired: false,
      syncNow, enqueueSale: vi.fn(), retry: vi.fn(), discard: vi.fn(),
    });
    const banner = await screen.findByTestId("event-sync-only-banner");
    expect(banner).toHaveTextContent("Event ended — upload your offline sales only");
    expect(banner).toHaveTextContent(/until/);
    const panel = await screen.findByTestId("sync-only-panel");
    expect(panel).toHaveTextContent("1 offline sale is waiting to upload.");
    expect(panel).toHaveTextContent("1 needs a manager.");
    expect(panel).toHaveTextContent("1 sent to a manager for review.");
    expect(screen.queryByText("Wrap")).toBeNull(); // no product tiles: no new sales
    expect(screen.queryByText("Failed to load the menu")).toBeNull();
    // opening a till is refused after the event, so it is not offered
    expect(screen.queryByText("The till is closed")).toBeNull();
    expect(screen.getByRole("button", { name: "Open the till" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(syncNow).toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });
});
