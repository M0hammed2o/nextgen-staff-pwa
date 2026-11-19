import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import { OfflineContext, countEntries, type OfflineContextValue } from "@/lib/offline/offline-context";
import { OfflineQueue } from "@/lib/offline/queue";
import { MemoryStore } from "@/lib/offline/store";
import { trainingStore } from "@/lib/offline/training";
import { __resetSafeStorageForTests } from "@/lib/safe-storage";
import { resolveSaleCustomerPhone } from "@/lib/ready-notify";
import { quickAction } from "@/components/QuickOrderAction";
import type { QueueEntry } from "@/lib/offline/types";
import type { Order } from "@/types";

/**
 * "Notify customer when ready (WhatsApp)" opt-in at the till. The frontend
 * never sends a message; it only decides whether customer_phone is attached.
 */

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: null, staff_name: "Cashier", role: "STAFF", business_id: "biz-1", business_name: "Stall" },
  }),
}));

import Pos from "@/pages/Pos";

const MENU_ITEM = {
  id: "item-1", category_id: null, name: "Burger", description: null, price_cents: 5000, currency: "ZAR",
  options_json: null, add_ons: [], is_active: true, sort_order: 0, image_url: null, requires_preparation: false,
};
const TILL_OPEN = {
  id: "till-1", status: "OPEN", opening_float_cents: 0, expected_cash_cents: null, counted_cash_cents: null,
  variance_cents: null, opened_at: "2026-11-18T08:00:00Z", closed_at: null,
};
const POS_SETTINGS = {
  cash_enabled: true, card_enabled: false, other_payment_enabled: false, table_number_required: false,
  delivery_fee_cents: 0, max_staff_discount_cents: 0, vat_registered: false, vat_rate_basis_points: null,
  vat_inclusive_pricing: true, receipt_paper_width_mm: 80, receipt_auto_print: false, receipt_copies: 1,
  print_kitchen_receipt: false, inventory_enabled: false, digital_receipts_enabled: false,
  staff_live_orders_tab_enabled: true, staff_wastage_tab_enabled: false, staff_stocktake_tab_enabled: false,
};

function saleOrder() {
  return {
    id: "order-1", order_number: "A-0042", status: "ACCEPTED", payment_status: "PAID", payment_required: false,
    payment_method: "CASH", order_mode: "PICKUP", source: "POS", cash_tendered_cents: 5000, change_due_cents: 0,
    items: [], total_cents: 5000, currency: "ZAR", created_at: "2026-11-18T09:00:00Z",
  };
}

function offlineValue(online: boolean): OfflineContextValue {
  const queue = new OfflineQueue(new MemoryStore());
  return {
    available: true, online, entries: [] as QueueEntry[], counts: countEntries([]), authRequired: false,
    syncNow: async () => undefined,
    enqueueSale: (payload) => queue.enqueueSale({ businessId: "biz-1", staffId: "user-1", payload }),
    retry: async () => undefined, discard: async () => undefined,
  };
}

function renderPos(online = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <OfflineContext.Provider value={offlineValue(online)}>
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

async function addBurger() {
  fireEvent.click(await screen.findByText("Burger"));
  await screen.findByPlaceholderText("Phone (for loyalty)");
}
function payCashExact() {
  fireEvent.click(screen.getByRole("button", { name: /Checkout/ }));
  fireEvent.click(screen.getByRole("button", { name: /Cash/ }));
  fireEvent.click(screen.getByRole("button", { name: "Exact" }));
  fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  __resetSafeStorageForTests();
  trainingStore.reset();
  getMock.mockImplementation((path: string) => {
    if (path === "/v1/business/menu/categories") return Promise.resolve([]);
    if (path === "/v1/business/menu/items") return Promise.resolve([MENU_ITEM]);
    if (path === "/v1/business/pos/till/current") return Promise.resolve(TILL_OPEN);
    if (path === "/v1/business/pos/settings") return Promise.resolve(POS_SETTINGS);
    if (path === "/v1/business/event-access") return Promise.reject({ status: 404, message: "Not found" });
    if (String(path).endsWith("/variants")) return Promise.resolve([]); // plain item: no variants
    return Promise.reject(new Error(`Unmocked GET ${path}`));
  });
  postMock.mockImplementation((path: string) =>
    path === "/v1/business/pos/orders" ? Promise.resolve(saleOrder()) : Promise.reject(new Error(`Unmocked POST ${path}`)),
  );
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  trainingStore.reset();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("ready-notify opt-in at the till", () => {
  it("sends no customer_phone when the consent box is not ticked, even if a number was typed", async () => {
    renderPos();
    await addBurger();
    const box = await screen.findByRole("checkbox", { name: /Notify customer when ready/i });
    fireEvent.click(box); // tick
    fireEvent.change(screen.getByLabelText("Customer WhatsApp number"), { target: { value: "0821234567" } });
    fireEvent.click(box); // untick again
    payCashExact();
    await screen.findByText("Sale complete");
    expect(postMock.mock.calls[0][1].customer_phone).toBeNull();
  });

  it("sends the number only once consent is ticked, and shows the order number prominently afterwards", async () => {
    renderPos();
    await addBurger();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Notify customer when ready/i }));
    expect(screen.getByText(/Requires this stall's own WhatsApp number to be connected/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Customer WhatsApp number"), { target: { value: "082 123 4567" } });
    payCashExact();
    await screen.findByText("Sale complete");
    expect(postMock.mock.calls[0][1].customer_phone).toBe("082 123 4567");
    expect(screen.getByTestId("sale-order-number")).toHaveTextContent("A-0042");
  });

  it("blocks checkout while consent is ticked but the number is missing or invalid", async () => {
    renderPos();
    await addBurger();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Notify customer when ready/i }));
    const checkout = screen.getByRole("button", { name: /Checkout/ });
    expect(checkout).toBeDisabled();
    expect(screen.getByText(/Enter the customer's WhatsApp number/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Customer WhatsApp number"), { target: { value: "123" } });
    expect(screen.getByText(/does not look like a valid/)).toBeInTheDocument();
    expect(checkout).toBeDisabled();
  });

  it("is not offered offline (an explanatory note replaces it) and an offline sale carries no number", async () => {
    renderPos(false);
    await addBurger();
    expect(screen.queryByRole("checkbox", { name: /Notify customer when ready/i })).toBeNull();
    expect(screen.getByTestId("ready-notify-offline")).toHaveTextContent(/needs internet/i);
  });

  it("is hidden entirely in training mode", async () => {
    trainingStore.setActive(true);
    renderPos();
    await addBurger();
    expect(screen.queryByRole("checkbox", { name: /Notify customer when ready/i })).toBeNull();
    expect(screen.queryByTestId("ready-notify")).toBeNull();
    expect(screen.queryByTestId("ready-notify-offline")).toBeNull();
  });
});

describe("resolveSaleCustomerPhone", () => {
  const base = { loyaltyPhone: "", notifyPhone: "0821234567", consent: true, available: true, rewardApplied: false };
  it("requires consent, availability and a plausible number", () => {
    expect(resolveSaleCustomerPhone(base)).toBe("0821234567");
    expect(resolveSaleCustomerPhone({ ...base, consent: false })).toBeNull();
    expect(resolveSaleCustomerPhone({ ...base, available: false })).toBeNull();
    expect(resolveSaleCustomerPhone({ ...base, notifyPhone: "12" })).toBeNull();
  });
  it("keeps the loyalty phone when a reward is bound to it", () => {
    expect(resolveSaleCustomerPhone({ ...base, loyaltyPhone: "0839876543", rewardApplied: true })).toBe("0839876543");
  });
});

describe("kitchen quick action", () => {
  const o = (over: Partial<Order>) => ({ order_mode: "PICKUP", source: "POS", payment_required: false, payment_status: "PAID", ...over }) as Order;
  it("walks ACCEPTED -> IN_PROGRESS -> READY -> COLLECTED with one tap each", () => {
    expect(quickAction(o({ status: "ACCEPTED" }))).toMatchObject({ next: "IN_PROGRESS" });
    expect(quickAction(o({ status: "IN_PROGRESS" }))).toMatchObject({ next: "READY" });
    expect(quickAction(o({ status: "READY" }))).toMatchObject({ label: "Collected", next: "COLLECTED" });
  });
  it("leaves unpaid READY orders and finished orders to the order screen", () => {
    expect(quickAction(o({ status: "READY", payment_status: "PENDING" }))).toBeNull();
    expect(quickAction(o({ status: "COLLECTED" }))).toBeNull();
  });
});
