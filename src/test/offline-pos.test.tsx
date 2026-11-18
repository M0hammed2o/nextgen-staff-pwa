import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import { OfflineContext, countEntries, type OfflineContextValue } from "@/lib/offline/offline-context";
import { OfflineQueue } from "@/lib/offline/queue";
import { MemoryStore } from "@/lib/offline/store";
import { trainingStore } from "@/lib/offline/training";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";
import type { QueueEntry } from "@/lib/offline/types";

/**
 * Till behaviour for offline capture, training mode and the event-access gate.
 * The network is fully mocked: `apiClient` is the only door out of Pos.tsx, so
 * `postMock` call counts are the "was anything sent" signal (plus a global
 * fetch spy for the training test).
 */

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: null, staff_name: "Cashier", role: "STAFF", business_id: "biz-1", business_name: "Ciao Pizza" },
  }),
}));

import Pos from "@/pages/Pos";

const MENU_ITEM = {
  id: "item-1", category_id: null, name: "Burger", description: null, price_cents: 5000, currency: "ZAR",
  options_json: null, add_ons: [], is_active: true, sort_order: 0, image_url: null, requires_preparation: false,
};
const TILL_OPEN = {
  id: "till-1", status: "OPEN", opening_float_cents: 0, expected_cash_cents: null, counted_cash_cents: null,
  variance_cents: null, opened_at: "2026-09-21T08:00:00Z", closed_at: null,
};
const POS_SETTINGS = {
  cash_enabled: true, card_enabled: true, other_payment_enabled: false, table_number_required: false,
  delivery_fee_cents: 0, max_staff_discount_cents: 0, vat_registered: false, vat_rate_basis_points: 1500,
  vat_inclusive_pricing: true, receipt_paper_width_mm: 80, receipt_auto_print: false, receipt_copies: 1,
  print_kitchen_receipt: false, inventory_enabled: false, digital_receipts_enabled: false,
  staff_live_orders_tab_enabled: true, staff_wastage_tab_enabled: false, staff_stocktake_tab_enabled: false,
};

let eventAccessResponse: () => Promise<unknown>;

function installApi() {
  eventAccessResponse = () => Promise.reject({ status: 404, message: "Not found" });
  getMock.mockImplementation((path: string) => {
    if (path === "/v1/business/menu/categories") return Promise.resolve([]);
    if (path === "/v1/business/menu/items") return Promise.resolve([MENU_ITEM]);
    if (path === "/v1/business/pos/till/current") return Promise.resolve(TILL_OPEN);
    if (path === "/v1/business/pos/settings") return Promise.resolve(POS_SETTINGS);
    if (path === "/v1/business/event-access") return eventAccessResponse();
    return Promise.reject(new Error(`Unmocked GET ${path}`));
  });
  postMock.mockRejectedValue(new Error("unexpected POST"));
}

function offlineValue(online: boolean, queue: OfflineQueue, extra: Partial<OfflineContextValue> = {}): OfflineContextValue {
  return {
    available: true,
    online,
    entries: [] as QueueEntry[],
    counts: countEntries([]),
    authRequired: false,
    syncNow: async () => undefined,
    enqueueSale: (payload) => queue.enqueueSale({ businessId: "biz-1", staffId: "user-1", payload }),
    retry: async () => undefined,
    discard: async () => undefined,
    ...extra,
  };
}

function renderPos(value?: OfflineContextValue) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <MemoryRouter initialEntries={["/pos"]}>
      <QueryClientProvider client={client}>
        <TouchKeyboardProvider>
          <Pos />
        </TouchKeyboardProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  return render(value ? <OfflineContext.Provider value={value}>{tree}</OfflineContext.Provider> : tree);
}

async function addBurger() {
  fireEvent.click(await screen.findByText("Burger"));
}
async function checkout() {
  fireEvent.click(await screen.findByRole("button", { name: /Checkout/ }));
}
async function payCashExact() {
  fireEvent.click(await screen.findByRole("button", { name: /Cash/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Exact" }));
  fireEvent.click(await screen.findByRole("button", { name: "Complete sale" }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  __resetSafeStorageForTests();
  trainingStore.reset();
  installApi();
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  trainingStore.reset();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("offline cash sale", () => {
  it("completes a cash sale with a local reference, enqueues it, and sends nothing", async () => {
    const store = new MemoryStore();
    const queue = new OfflineQueue(store);
    renderPos(offlineValue(false, queue));

    await addBurger();
    await checkout();
    await payCashExact();

    const ref = await screen.findByTestId("local-sale-ref");
    expect(ref.textContent).toMatch(/^T[0-9A-F]{4}-0001$/);
    expect(screen.getByText("Sale saved on this device")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /WhatsApp receipt/ })).toBeDisabled();

    expect(postMock).not.toHaveBeenCalled();
    const entries = await queue.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "pending", local_ref: ref.textContent, total_cents: 5000, business_id: "biz-1", staff_id: "user-1" });
    const stored = await queue.decryptPayload(entries[0]);
    // The idempotency key sent on every server call IS the entry id.
    expect(stored.request.idempotency_key).toBe(entries[0].id);
    expect(stored.request.payment_method).toBe("CASH");
    expect(stored.request.items[0].menu_item_id).toBe("item-1");
  });

  it("shows the offline banner and disables card (labelled needs internet) while offline", async () => {
    renderPos(offlineValue(false, new OfflineQueue(new MemoryStore())));
    expect(await screen.findByTestId("offline-banner")).toBeInTheDocument();
    await addBurger();
    await checkout();
    const card = await screen.findByRole("button", { name: /Card/ });
    expect(card).toBeDisabled();
    expect(card.textContent).toMatch(/needs internet/i);
    expect(screen.queryByRole("button", { name: /Split payment/ })).toBeNull();
    // Cash is still available.
    expect(screen.getByRole("button", { name: /Cash/ })).not.toBeDisabled();
  });

  it("a cash sale whose request gets NO response is captured under the same key it was sent with", async () => {
    const queue = new OfflineQueue(new MemoryStore());
    postMock.mockRejectedValue({ message: "Could not reach the server", status: 0, noResponse: true });
    renderPos(offlineValue(true, queue));

    await addBurger();
    await checkout();
    await payCashExact();

    await screen.findByTestId("local-sale-ref");
    expect(postMock).toHaveBeenCalledTimes(1);
    const sentBody = postMock.mock.calls[0][1] as { idempotency_key: string };
    const [entry] = await queue.list();
    expect(entry.id).toBe(sentBody.idempotency_key); // server dedupes on replay
    // And no "outcome unknown" blocking card.
    expect(screen.queryByText(/Checking your last sale/)).toBeNull();
  });

  it("a definite server rejection (HTTP 4xx) is NOT queued", async () => {
    const queue = new OfflineQueue(new MemoryStore());
    postMock.mockRejectedValue({ message: "Till is closed", status: 409, code: "TILL_NOT_OPEN" });
    renderPos(offlineValue(true, queue));
    await addBurger();
    await checkout();
    await payCashExact();
    await screen.findByText(/Till is closed/);
    expect(await queue.list()).toHaveLength(0);
  });
});

describe("training mode", () => {
  it("makes zero network calls for a training sale, shows the banner, and exit clears the practice sales", async () => {
    trainingStore.setActive(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const queue = new OfflineQueue(new MemoryStore());
    const enqueue = vi.spyOn(queue, "enqueueSale");
    renderPos(offlineValue(true, queue));

    expect(await screen.findByTestId("training-banner")).toHaveTextContent("Training — not real sales");
    await addBurger();
    await checkout();
    await payCashExact();

    const ref = await screen.findByTestId("local-sale-ref");
    expect(ref.textContent).toBe("TRAIN-001");
    expect(screen.getByText("Practice sale — not real")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await queue.list()).toHaveLength(0);
    expect(trainingStore.get().sales).toHaveLength(1);

    // Card etc. are not available in training.
    fireEvent.click(screen.getByRole("button", { name: "New sale" }));
    await addBurger();
    await checkout();
    const card = await screen.findByRole("button", { name: /Card/ });
    expect(card).toBeDisabled();
    expect(card.textContent).toMatch(/not available in training/i);
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Exit training" }));
    expect(trainingStore.get()).toMatchObject({ active: false, sales: [] });
    await waitFor(() => expect(screen.queryByTestId("training-banner")).toBeNull());
  });

  it("training works even when the till is closed and the event gate is closed", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/v1/business/menu/categories") return Promise.resolve([]);
      if (path === "/v1/business/menu/items") return Promise.resolve([MENU_ITEM]);
      if (path === "/v1/business/pos/till/current") return Promise.resolve(null);
      if (path === "/v1/business/pos/settings") return Promise.resolve(POS_SETTINGS);
      if (path === "/v1/business/event-access")
        return Promise.resolve({ is_event_vendor: true, access_level: "CONFIGURE", reason: "PREP_WINDOW", events: [] });
      return Promise.reject(new Error(`Unmocked GET ${path}`));
    });
    trainingStore.setActive(true);
    renderPos(offlineValue(true, new OfflineQueue(new MemoryStore())));
    await addBurger();
    const btn = await screen.findByRole("button", { name: /Checkout/ });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});

describe("event access banner", () => {
  function mockEvent(res: unknown) {
    eventAccessResponse = () => ("is_event_vendor" in (res as object) ? Promise.resolve(res) : Promise.reject(res));
  }

  it("CONFIGURE: set-up banner with the reason, and the real Checkout is disabled", async () => {
    mockEvent({ is_event_vendor: true, access_level: "CONFIGURE", reason: "PREP_WINDOW", events: [] });
    renderPos(offlineValue(true, new OfflineQueue(new MemoryStore())));
    const banner = await screen.findByTestId("event-access-banner");
    expect(banner).toHaveTextContent("Set-up mode — trading opens when your paid event day starts");
    expect(banner).toHaveTextContent("PREP_WINDOW");
    await addBurger();
    expect(await screen.findByRole("button", { name: /Checkout/ })).toBeDisabled();
    expect(screen.getByTestId("checkout-blocked-reason")).toBeInTheDocument();
  });

  it("NONE: explains that access has ended and blocks Checkout", async () => {
    mockEvent({ is_event_vendor: true, access_level: "NONE", reason: "NO_PAID_COVER_TODAY", events: [] });
    renderPos(offlineValue(true, new OfflineQueue(new MemoryStore())));
    expect(await screen.findByTestId("event-access-banner")).toHaveTextContent(/event access has ended/i);
    await addBurger();
    expect(await screen.findByRole("button", { name: /Checkout/ })).toBeDisabled();
  });

  it("TRADE: no banner, Checkout enabled", async () => {
    mockEvent({ is_event_vendor: true, access_level: "TRADE", reason: null, events: [] });
    renderPos(offlineValue(true, new OfflineQueue(new MemoryStore())));
    await addBurger();
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/v1/business/event-access", expect.anything()));
    expect(screen.queryByTestId("event-access-banner")).toBeNull();
    expect(await screen.findByRole("button", { name: /Checkout/ })).not.toBeDisabled();
  });

  it("404 (endpoint absent) behaves as today: a normal non-event business", async () => {
    mockEvent({ status: 404, message: "Not found" });
    renderPos(offlineValue(true, new OfflineQueue(new MemoryStore())));
    await addBurger();
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/v1/business/event-access", expect.anything()));
    expect(screen.queryByTestId("event-access-banner")).toBeNull();
    expect(await screen.findByRole("button", { name: /Checkout/ })).not.toBeDisabled();
  });

  it("offline uses the last known level: a cached CONFIGURE never lets a sale be queued as real", async () => {
    localStorage.setItem(
      "nextgen_staff_event_access_v1_biz-1",
      JSON.stringify({ is_event_vendor: true, access_level: "CONFIGURE", reason: "PREP_WINDOW" }),
    );
    mockEvent({ message: "Could not reach the server", status: 0, noResponse: true });
    const queue = new OfflineQueue(new MemoryStore());
    renderPos(offlineValue(false, queue));
    await addBurger();
    const btn = await screen.findByRole("button", { name: /Checkout/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(screen.queryByText("Cash received")).toBeNull();
    expect(screen.queryByRole("button", { name: /Complete sale/ })).toBeNull();
    expect(await queue.list()).toHaveLength(0);
    expect(screen.getByTestId("event-access-banner")).toHaveTextContent(/last known/i);
  });

  it("server 403 EVENT_TRADING_NOT_ALLOWED on a live sale shows the server reason and re-checks access", async () => {
    postMock.mockRejectedValue({ message: "Trading is not allowed: there is no paid event subscription covering today.", status: 403, code: "EVENT_TRADING_NOT_ALLOWED" });
    renderPos(offlineValue(true, new OfflineQueue(new MemoryStore())));
    await addBurger();
    await checkout();
    await payCashExact();
    await screen.findByText(/no paid event subscription/);
    await act(async () => undefined);
    await waitFor(() => {
      const calls = getMock.mock.calls.filter(([p]) => p === "/v1/business/event-access");
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
