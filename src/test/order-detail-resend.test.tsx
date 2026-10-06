import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";

/**
 * The "Resend Receipt via WhatsApp" action on Order Detail must match the
 * backend's force_resend role rule (OWNER/MANAGER only — see
 * backend/app/api/v1/routes_pos.py::request_pos_receipt, which 403s a
 * STAFF caller that sets force_resend=true). This only checks the UI-level
 * gate; the real security boundary is server-side regardless.
 */

const getMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: vi.fn(),
  },
}));

let mockRole = "STAFF";
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: null, staff_name: "Test", role: mockRole, business_id: "biz-1", business_name: "Ciao Pizza" },
  }),
}));

import OrderDetail from "@/pages/OrderDetail";

const ORDER = {
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
  customer_name: "Jane",
  phone_number: "0821234567",
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

const POS_SETTINGS = {
  cash_enabled: true,
  card_enabled: false,
  other_payment_enabled: false,
  table_number_required: false,
  delivery_fee_cents: 0,
  max_staff_discount_cents: 0,
  vat_registered: false,
  vat_rate_basis_points: 0,
  vat_inclusive_pricing: true,
  receipt_paper_width_mm: 80,
  receipt_auto_print: true,
  receipt_copies: 1,
  print_kitchen_receipt: true,
  inventory_enabled: false,
  // Not entitled to digital receipts: the till must not offer WhatsApp.
  digital_receipts_enabled: false,
  staff_live_orders_tab_enabled: true,
  staff_wastage_tab_enabled: false,
  staff_stocktake_tab_enabled: false,
};

function installApiMock() {
  getMock.mockImplementation((path: string) => {
    if (path === "/v1/business/orders/order-1") return Promise.resolve(ORDER);
    if (path === "/v1/business/pos/settings") return Promise.resolve(POS_SETTINGS);
    return Promise.reject(new Error(`Unmocked GET ${path}`));
  });
}

function renderOrderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/orders/order-1"]}>
      <QueryClientProvider client={queryClient}>
        <TouchKeyboardProvider>
          <Routes>
            <Route path="/orders/:orderId" element={<OrderDetail />} />
          </Routes>
        </TouchKeyboardProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderDetail — Resend Receipt gating", () => {
  it("shows the resend action to an OWNER", async () => {
    mockRole = "OWNER";
    installApiMock();
    renderOrderDetail();
    expect(await screen.findByText("Resend Receipt via WhatsApp")).toBeInTheDocument();
  });

  it("shows the resend action to a MANAGER", async () => {
    mockRole = "MANAGER";
    installApiMock();
    renderOrderDetail();
    expect(await screen.findByText("Resend Receipt via WhatsApp")).toBeInTheDocument();
  });

  it("hides the resend action from a plain STAFF cashier (matches the backend's force_resend role rule)", async () => {
    mockRole = "STAFF";
    installApiMock();
    renderOrderDetail();
    await screen.findByText("Order #A-0001");
    expect(screen.queryByText("Resend Receipt via WhatsApp")).not.toBeInTheDocument();
  });
});
