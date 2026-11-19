import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import { OfflineContext, countEntries, type OfflineContextValue } from "@/lib/offline/offline-context";
import { trainingStore } from "@/lib/offline/training";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";
import { clearSnapshots } from "@/lib/offline/snapshot-cache";
import { savePosDraft } from "@/lib/pos-draft";
import PaymentDialog from "@/components/pos/PaymentDialog";
import type { CartLine, POSSettings } from "@/types";

/**
 * Souk e2e dev iteration 8a: "Exact" tendered R25,00 on a R50.00 total after
 * a restored cart draft. The Playwright trace shows the order of events:
 * the draft restored 1 x Ginger Beer (R25); the cashier tapped Ginger Beer
 * again, and that tap's variants lookup answered only AFTER Checkout > Cash >
 * Exact had run. Exact filled R25.00 for the then-total, then the late tap
 * raised the total to R50.00 under the open payment dialog. The draft was
 * incidental; the cause was a tap still in flight when Checkout opened.
 */

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: { get: (...a: unknown[]) => getMock(...a), post: (...a: unknown[]) => postMock(...a) },
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: null, staff_name: "Cashier", role: "STAFF", business_id: "biz-1", business_name: "Stall" },
  }),
}));

import Pos from "@/pages/Pos";

const GINGER = {
  id: "item-gb", category_id: null, name: "Ginger Beer", description: null, price_cents: 2500, currency: "ZAR",
  options_json: null, add_ons: [], is_active: true, sort_order: 0, image_url: null, requires_preparation: false,
};
const TILL = { id: "till-1", status: "OPEN", opening_float_cents: 0, expected_cash_cents: null, counted_cash_cents: null, variance_cents: null, opened_at: "2026-11-19T08:00:00Z", closed_at: null };
const SETTINGS = { cash_enabled: true, card_enabled: false, other_payment_enabled: false, receipt_auto_print: false } as unknown as POSSettings;

function restoredLine(): CartLine {
  return {
    key: GINGER.id, menuItemId: GINGER.id, name: GINGER.name, basePriceCents: 2500, quantity: 1, requiresPreparation: false,
    selectedOptionIds: {}, selectedOptionsDisplay: [], addOnSelections: [], removedIngredientIds: [], removedIngredientsDisplay: [],
    specialInstructions: null,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function offlineValue(): OfflineContextValue {
  return {
    available: true, online: true, entries: [], counts: countEntries([]), authRequired: false,
    syncNow: async () => undefined, enqueueSale: vi.fn(), retry: vi.fn(), discard: vi.fn(),
  };
}

beforeEach(() => {
  localStorage.clear();
  __resetSafeStorageForTests();
  clearSnapshots("biz-1");
  trainingStore.reset();
  window.print = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Exact after a restored draft and a tap still in flight", () => {
  it("Checkout waits for the pending tap, so Exact tenders the full new total", async () => {
    savePosDraft("biz-1", "user-1", {
      cart: [restoredLine()], orderMode: "PICKUP", tableNumber: "", customerName: "", customerPhone: "",
      discountRand: "", discountReason: "", idempotencyKey: "key-1", submission: { status: "idle" },
    });
    const lookup = deferred<unknown[]>();
    let lookupsHeld = 0;
    getMock.mockImplementation((path: string) => {
      if (path === "/v1/business/menu/categories") return Promise.resolve([]);
      if (path === "/v1/business/menu/items") return Promise.resolve([GINGER]);
      if (path === "/v1/business/pos/till/current") return Promise.resolve(TILL);
      if (path === "/v1/business/pos/settings") return Promise.resolve(SETTINGS);
      if (path === "/v1/business/event-access") return Promise.reject({ status: 404, message: "Not found" });
      if (path === "/v1/business/pos/payment-intents/unconsumed-paid") return Promise.resolve([]);
      if (path.endsWith("/variants")) {
        lookupsHeld++;
        return lookup.promise;
      }
      return Promise.reject(new Error(`Unmocked GET ${path}`));
    });
    postMock.mockResolvedValue({ id: "o1", order_number: "A-1", items: [], total_cents: 5000, payment_status: "PAID", status: "COMPLETED" });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <OfflineContext.Provider value={offlineValue()}>
        <MemoryRouter initialEntries={["/pos"]}>
          <QueryClientProvider client={client}>
            <TouchKeyboardProvider>
              <Pos />
            </TouchKeyboardProvider>
          </QueryClientProvider>
        </MemoryRouter>
      </OfflineContext.Provider>,
    );
    await screen.findByText("Your unfinished order was restored.");
    const tile = (await screen.findAllByText("Ginger Beer"))[0];
    fireEvent.click(tile);
    await waitFor(() => expect(lookupsHeld).toBeGreaterThan(0));

    // the lookup for the second Ginger Beer has not answered: Checkout waits
    const checkout = await screen.findByRole("button", { name: /Checkout/ });
    expect(checkout).toBeDisabled();
    fireEvent.click(checkout);
    expect(screen.queryByRole("button", { name: "Exact" })).toBeNull();

    lookup.resolve([]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Checkout/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Checkout/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Cash/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Exact" }));
    fireEvent.click(await screen.findByRole("button", { name: "Complete sale" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const body = postMock.mock.calls[0][1] as { cash_tendered_cents: number; items: Array<{ quantity: number }> };
    expect(body.items[0].quantity).toBe(2);
    expect(body.cash_tendered_cents).toBe(5000);
  });
});

describe("PaymentDialog when the total changes while open", () => {
  function dialog(totalCents: number) {
    return (
      <MemoryRouter>
        <TouchKeyboardProvider>
          <PaymentDialog open onClose={vi.fn()} totalCents={totalCents} posSettings={SETTINGS} onConfirm={vi.fn()} isSubmitting={false} errorMessage={null} />
        </TouchKeyboardProvider>
      </MemoryRouter>
    );
  }

  it("clears a cash amount entered for the old total instead of leaving it stale", async () => {
    const { rerender } = render(dialog(2500));
    fireEvent.click(await screen.findByRole("button", { name: /Cash/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Exact" }));
    expect(screen.getByPlaceholderText("0.00")).toHaveValue(25);
    rerender(dialog(5000));
    await waitFor(() => expect(screen.getByPlaceholderText("0.00")).toHaveValue(null));
    expect(screen.getByRole("button", { name: "Complete sale" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Exact" }));
    expect(screen.getByPlaceholderText("0.00")).toHaveValue(50);
  });
});
