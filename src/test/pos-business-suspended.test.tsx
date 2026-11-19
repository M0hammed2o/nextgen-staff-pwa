import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineContext, countEntries, type OfflineContextValue } from "@/lib/offline/offline-context";
import { trainingStore } from "@/lib/offline/training";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";
import type { QueueEntry } from "@/lib/offline/types";

/**
 * Souk e2e 8d: a paid vendor is trading, the organiser cancels the event, the
 * reconcile job suspends the business, and the next sale attempt crashed the
 * whole app to "Something went wrong / Reload App".
 *
 * Root cause: the backend's rbac check raises an HTTPException whose body is
 * FastAPI's `{ detail: { code: "BUSINESS_SUSPENDED", message } }` (not the
 * app's `{ error: {...} }`). apiFetch took `body.detail` (an object) as the
 * error message, Pos put it in state, and React threw rendering an object as
 * a child. This file covers the till side; api-timeout.test.ts covers the
 * parsing.
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
    user: { id: "user-1", email: null, staff_name: "Cashier", role: "STAFF", business_id: "biz-1", business_name: "Souk Stall" },
  }),
}));

import Pos from "@/pages/Pos";

const MENU_ITEM = {
  id: "item-1", category_id: null, name: "Ginger Beer", description: null, price_cents: 2500, currency: "ZAR",
  options_json: null, add_ons: [], is_active: true, sort_order: 0, image_url: null, requires_preparation: false,
  has_variants: false,
};
const TILL_OPEN = {
  id: "till-1", status: "OPEN", opening_float_cents: 0, expected_cash_cents: null, counted_cash_cents: null,
  variance_cents: null, opened_at: "2026-11-19T08:00:00Z", closed_at: null,
};

const SUSPENDED = { status: 403, code: "BUSINESS_SUSPENDED", message: "This business account has been suspended." };

let suspended = false;

function installApi() {
  suspended = false;
  getMock.mockImplementation((path: string) => {
    if (path === "/v1/business/event-access") {
      return suspended
        ? Promise.reject(SUSPENDED)
        : Promise.resolve({ is_event_vendor: true, access_level: "TRADE", reason: "PAID_DAY", events: [] });
    }
    if (suspended) return Promise.reject(SUSPENDED);
    if (path === "/v1/business/menu/categories") return Promise.resolve([]);
    if (path === "/v1/business/menu/items") return Promise.resolve([MENU_ITEM]);
    if (path === "/v1/business/pos/till/current") return Promise.resolve(TILL_OPEN);
    if (path === "/v1/business/pos/settings") return Promise.resolve({ cash_enabled: true, receipt_auto_print: false });
    if (path === "/v1/business/pos/payment-intents/unconsumed-paid") return Promise.resolve([]);
    return Promise.reject(new Error(`Unmocked GET ${path}`));
  });
}

function offlineValue(entries: QueueEntry[] = []): OfflineContextValue {
  return {
    available: true, online: true, entries, counts: countEntries(entries), authRequired: false,
    syncNow: async () => undefined, enqueueSale: vi.fn(), retry: vi.fn(), discard: vi.fn(),
  };
}

function renderPos(value: OfflineContextValue) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ErrorBoundary>
      <OfflineContext.Provider value={value}>
        <MemoryRouter initialEntries={["/pos"]}>
          <QueryClientProvider client={client}>
            <TouchKeyboardProvider>
              <Pos />
            </TouchKeyboardProvider>
          </QueryClientProvider>
        </MemoryRouter>
      </OfflineContext.Provider>
    </ErrorBoundary>,
  );
}

async function ringCashSale() {
  fireEvent.click(await screen.findByText("Ginger Beer"));
  fireEvent.click(await screen.findByRole("button", { name: /Checkout/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Cash/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Exact" }));
  fireEvent.click(await screen.findByRole("button", { name: "Complete sale" }));
}

beforeEach(() => {
  localStorage.clear();
  __resetSafeStorageForTests();
  trainingStore.reset();
  installApi();
  window.print = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("sale refused because the business was suspended (event cancelled)", () => {
  it("does not crash; says the stall is no longer trading and switches the till to not-trading", async () => {
    postMock.mockImplementation(async () => {
      suspended = true; // reconcile ran between the last sale and this one
      throw SUSPENDED;
    });
    renderPos(offlineValue());
    await ringCashSale();

    expect(await screen.findByText(/This stall is no longer trading: the account has been suspended/)).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    // access is re-checked; the server's 403 BUSINESS_SUSPENDED becomes the banner
    const banner = await screen.findByTestId("event-access-banner");
    expect(banner).toHaveTextContent("This stall is no longer trading");
    expect(banner).toHaveTextContent(/saved on this device stay here/);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("a rejection whose message is not a string (the old crash shape) still renders a readable error", async () => {
    postMock.mockRejectedValue({ status: 403, message: { code: "SOMETHING_NEW", message: "nested" } });
    renderPos(offlineValue());
    await ringCashSale();
    expect(await screen.findByText("Could not complete the sale — try again")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("after a reload a 403 BUSINESS_SUSPENDED replaces a stale last-known TRADE (no crash, nothing sent)", async () => {
    suspended = true;
    // a last-known TRADE from before the cancellation must not be trusted
    localStorage.setItem(
      "nextgen_staff_event_access_v1_biz-1",
      JSON.stringify({ is_event_vendor: true, access_level: "TRADE", reason: "PAID_DAY" }),
    );
    const entries = [{ id: "q-1", status: "pending" }] as QueueEntry[];
    renderPos(offlineValue(entries));
    expect(await screen.findByTestId("event-access-banner")).toHaveTextContent("This stall is no longer trading");
    const cached = JSON.parse(localStorage.getItem("nextgen_staff_event_access_v1_biz-1") ?? "{}");
    expect(cached).toMatchObject({ business_suspended: true, access_level: "NONE" });
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("event access: suspended mapping", () => {
  it("suspended never trades, never offers WhatsApp, and is not the sync-only state", async () => {
    const { toState } = await import("@/lib/offline/event-access");
    const s = toState(
      { is_event_vendor: true, access_level: "TRADE", reason: "BUSINESS_SUSPENDED", sync_only: true, business_suspended: true },
      false,
    );
    expect(s).toMatchObject({ suspended: true, canTrade: false, readyNotifyAvailable: false, syncOnly: false, level: "NONE" });
    const plain = toState({ is_event_vendor: false, access_level: null, reason: "BUSINESS_SUSPENDED", business_suspended: true }, false);
    expect(plain).toMatchObject({ suspended: true, canTrade: false });
  });
});
