import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";

/**
 * WhatsApp-only subscription (pos_enabled: false): every POS-write route
 * 409s POS_NOT_ENABLED server-side. Till is hidden from the nav
 * (BottomNav.test.tsx) and the landing redirect never sends such a tenant to
 * /pos (pos-settings.test.ts), but a staff member can still reach /pos by
 * typing the URL directly — this covers that this app shows a clear,
 * specific message rather than a generic/broken error state when it does.
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

const POS_SETTINGS = {
  cash_enabled: true,
  card_enabled: false,
  other_payment_enabled: false,
  table_number_required: false,
  delivery_fee_cents: 0,
  max_staff_discount_cents: 0,
  vat_registered: false,
  vat_rate_basis_points: 0,
  vat_inclusive_pricing: false,
  receipt_paper_width_mm: 80,
  receipt_auto_print: false,
  receipt_copies: 1,
  print_kitchen_receipt: false,
  inventory_enabled: false,
  digital_receipts_enabled: false,
  loyalty_enabled: false,
  staff_live_orders_tab_enabled: true,
  staff_wastage_tab_enabled: false,
  staff_stocktake_tab_enabled: false,
  // This tenant is on a WhatsApp-only subscription -- no POS entitlement.
  pos_enabled: false,
};

function installApiMock() {
  getMock.mockImplementation((path: string) => {
    if (path === "/v1/business/menu/categories") return Promise.resolve([]);
    if (path === "/v1/business/menu/items") return Promise.resolve([MENU_ITEM]);
    if (path === "/v1/business/pos/till/current") return Promise.resolve(TILL_OPEN);
    if (path === "/v1/business/pos/settings") return Promise.resolve(POS_SETTINGS);
    if (path === "/v1/business/pos/payment-intents/unconsumed-paid") return Promise.resolve([]);
    return Promise.reject(new Error(`Unmocked GET ${path}`));
  });
  postMock.mockImplementation((path: string) => {
    if (path === "/v1/business/pos/orders") {
      return Promise.reject({
        message: "POS is not enabled for this business",
        status: 409,
        code: "POS_NOT_ENABLED",
      });
    }
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
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("Pos — 409 POS_NOT_ENABLED", () => {
  it("shows a specific, honest message instead of the backend's raw 409 text", async () => {
    renderPos();
    const tile = await screen.findByText("Burger");
    fireEvent.click(tile);

    const checkoutButton = await screen.findByRole("button", { name: /Checkout/ });
    fireEvent.click(checkoutButton);

    fireEvent.click(await screen.findByRole("button", { name: /Cash/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Exact" }));
    fireEvent.click(await screen.findByRole("button", { name: "Complete sale" }));

    expect(await screen.findByText("POS is not available for this restaurant")).toBeInTheDocument();
    // The backend's raw entitlement-gate text must never leak to the cashier.
    expect(screen.queryByText("POS is not enabled for this business")).not.toBeInTheDocument();
  });
});
