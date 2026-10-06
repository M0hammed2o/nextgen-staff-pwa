import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";

/**
 * Pos.tsx's checkout → auto-print flow, focused on the P0 requirement: a
 * receipt document fetch failure after a successful sale must NEVER cause a
 * second POST to /pos/orders (see KNOWN_BUGS BUG-0045's checkout-flow
 * fix). The sale stays completed; only a retry-print action is offered.
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
  id: "item-1",
  category_id: null,
  name: "Burger",
  description: null,
  price_cents: 5000,
  currency: "ZAR",
  options_json: null,
  add_ons: [],
  is_active: true,
  sort_order: 0,
  image_url: null,
  requires_preparation: false,
};

const TILL_OPEN = {
  id: "till-1",
  status: "OPEN",
  opening_float_cents: 0,
  expected_cash_cents: null,
  counted_cash_cents: null,
  variance_cents: null,
  opened_at: "2026-09-21T08:00:00Z",
  closed_at: null,
};

const POS_SETTINGS: Record<string, unknown> = {
  cash_enabled: true,
  card_enabled: false,
  other_payment_enabled: false,
  table_number_required: false,
  delivery_fee_cents: 0,
  max_staff_discount_cents: 0,
  vat_registered: true,
  vat_rate_basis_points: 1500,
  vat_inclusive_pricing: true,
  receipt_paper_width_mm: 80,
  receipt_auto_print: true,
  receipt_copies: 1,
  print_kitchen_receipt: true,
  inventory_enabled: false,
  // This tenant IS entitled to digital receipts -- the till only offers the
  // WhatsApp/Both receipt options when it is.
  digital_receipts_enabled: true,
  staff_live_orders_tab_enabled: true,
  staff_wastage_tab_enabled: false,
  staff_stocktake_tab_enabled: false,
};

const CREATED_ORDER = {
  id: "order-1",
  order_number: "A-0001",
  status: "NEW",
  payment_status: "PAID",
  payment_required: false,
  payment_method: "CASH",
  payment_reference: null,
  payment_link_url: null,
  paid_at: "2026-09-21T09:00:00Z",
  order_mode: "PICKUP",
  table_number: null,
  source: "POS",
  cash_tendered_cents: 5000,
  change_due_cents: 0,
  till_session_id: "till-1",
  created_by_user_id: "user-1",
  refund_reference: null,
  refund_amount_cents: null,
  refunded_at: null,
  customer_name: null,
  phone_number: null,
  delivery_address: null,
  items: [],
  subtotal_cents: 5000,
  delivery_fee_cents: 0,
  discount_cents: 0,
  tax_cents: 0,
  discount_reason: null,
  total_cents: 5000,
  currency: "ZAR",
  estimated_ready_at: null,
  confirmed_at: null,
  accepted_at: null,
  ready_at: null,
  completed_at: null,
  special_instructions: null,
  cancelled_reason: null,
  created_at: "2026-09-21T09:00:00Z",
  updated_at: "2026-09-21T09:00:00Z",
};

function installApiMock() {
  getMock.mockImplementation((path: string) => {
    if (path === "/v1/business/menu/categories") return Promise.resolve([]);
    if (path === "/v1/business/menu/items") return Promise.resolve([MENU_ITEM]);
    if (path === "/v1/business/pos/till/current") return Promise.resolve(TILL_OPEN);
    if (path === "/v1/business/pos/settings") return Promise.resolve(POS_SETTINGS);
    if (path.startsWith("/v1/business/receipts/orders/")) {
      // The receipt fetch always fails in this test — that's the scenario
      // under test.
      return Promise.reject({ message: "Could not reach the server", status: 0, noResponse: true });
    }
    return Promise.reject(new Error(`Unmocked GET ${path}`));
  });
  postMock.mockImplementation((path: string) => {
    if (path === "/v1/business/pos/orders") return Promise.resolve(CREATED_ORDER);
    return Promise.reject(new Error(`Unmocked POST ${path}`));
  });
}

function renderPos() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/pos"]}>
      <QueryClientProvider client={queryClient}>
        <TouchKeyboardProvider>
          <Pos />
        </TouchKeyboardProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  installApiMock();
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

async function ringUpAndPay() {
  renderPos();
  const tile = await screen.findByText("Burger");
  fireEvent.click(tile);

  // The desktop cart panel is always mounted (hidden via CSS only, which
  // jsdom doesn't apply) so its Checkout button is reachable directly.
  const checkoutButton = await screen.findByRole("button", { name: /Checkout/ });
  fireEvent.click(checkoutButton);

  fireEvent.click(await screen.findByRole("button", { name: /Cash/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Exact" }));
  fireEvent.click(await screen.findByRole("button", { name: "Complete sale" }));

  await screen.findByText("Sale complete");
}

describe("Pos receipt choice — truthful WhatsApp availability", () => {
  it("offers WhatsApp and Both when the business IS entitled to digital receipts", async () => {
    POS_SETTINGS.digital_receipts_enabled = true;
    await ringUpAndPay();

    expect((await screen.findByRole("button", { name: /WhatsApp/ })) as HTMLButtonElement).not.toBeDisabled();
    expect((await screen.findByRole("button", { name: /^Both$/ })) as HTMLButtonElement).not.toBeDisabled();
    expect(screen.queryByText(/aren.t enabled for this restaurant/i)).toBeNull();
  });

  it("does NOT offer WhatsApp when the business is not entitled, and says so plainly", async () => {
    // The cashier must learn this BEFORE tapping. Previously the only way to
    // find out was to send and watch it come back NOT_REQUESTED, which reads
    // as a failure to a customer standing at the counter.
    POS_SETTINGS.digital_receipts_enabled = false;
    await ringUpAndPay();

    expect((await screen.findByRole("button", { name: /WhatsApp/ })) as HTMLButtonElement).toBeDisabled();
    expect((await screen.findByRole("button", { name: /^Both$/ })) as HTMLButtonElement).toBeDisabled();
    expect(screen.getByText(/aren.t enabled for this restaurant/i)).toBeInTheDocument();

    // Printing is unaffected -- the sale is still fully serviceable.
    expect((await screen.findByRole("button", { name: /Print/ })) as HTMLButtonElement).not.toBeDisabled();
    expect((await screen.findByRole("button", { name: /No receipt/ })) as HTMLButtonElement).not.toBeDisabled();
  });
});

describe("Pos checkout → receipt print", () => {
  it("a receipt fetch failure after a successful sale never causes a second POST to /pos/orders", async () => {
    await ringUpAndPay();

    // Auto-print kicked in and failed (GET always rejects in this test).
    await screen.findByText("Receipt did not print");

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith("/v1/business/pos/orders", expect.objectContaining({ idempotency_key: expect.any(String) }));

    // Manual retry re-fetches the receipt, never re-submits the sale. The
    // post-sale receipt step now offers Print/WhatsApp/Both/No receipt —
    // "Print" reuses the exact same handlePrintReceipt retry as before.
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    await waitFor(() => {
      const receiptCalls = getMock.mock.calls.filter(([path]) => String(path).startsWith("/v1/business/receipts/orders/"));
      expect(receiptCalls.length).toBeGreaterThanOrEqual(2);
    });

    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("the sale stays marked complete (order number + total shown) even though the receipt never printed", async () => {
    await ringUpAndPay();
    await screen.findByText("Receipt did not print");
    expect(screen.getByText(/Order A-0001/)).toBeInTheDocument();
  });
});
