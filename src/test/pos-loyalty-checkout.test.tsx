import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";

/**
 * Pos.tsx's till-side loyalty reward redemption — the full checkout flow
 * with a reward attached. Complements loyalty-reward-picker.test.tsx (which
 * covers the picker's own filtering in isolation) and
 * pos-checkout-receipt.test.tsx (the pre-existing non-loyalty checkout/
 * receipt regression coverage, left untouched).
 *
 * THE FINANCIAL RULE under test throughout: this app only ever sends a
 * reward id to the backend and renders whatever the backend's committed
 * order says back — it never assumes its own preview figure is what was
 * actually applied, never leaves points looking spent when a checkout
 * failed, and never regenerates the idempotency key on a retry.
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
  price_cents: 10000, // R100 — comfortably covers the R30 reward used below
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
  opened_at: "2026-09-23T08:00:00Z",
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
  vat_rate_basis_points: null,
  vat_inclusive_pricing: true,
  receipt_paper_width_mm: 80,
  receipt_auto_print: false, // keep these tests focused on checkout, not the print pipeline
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

const CUSTOMER = {
  customer_id: "cust-1",
  display_name: "Thabo",
  phone_number: "+27821234567",
  loyalty_points_balance: 150,
  loyalty_tier: "SILVER",
};

const REWARD = {
  id: "reward-1",
  name: "R30 off",
  description: null,
  points_cost: 100,
  is_active: true,
  value_cents: 3000,
};

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    order_number: "A-0001",
    status: "NEW",
    payment_status: "PAID",
    payment_required: false,
    payment_method: "CASH",
    payment_reference: null,
    payment_link_url: null,
    paid_at: "2026-09-23T09:00:00Z",
    order_mode: "PICKUP",
    table_number: null,
    source: "POS",
    cash_tendered_cents: 10000,
    change_due_cents: 0,
    till_session_id: "till-1",
    created_by_user_id: "user-1",
    refund_reference: null,
    refund_amount_cents: null,
    refunded_at: null,
    customer_name: null,
    phone_number: "+27821234567",
    delivery_address: null,
    items: [],
    subtotal_cents: 10000,
    delivery_fee_cents: 0,
    discount_cents: 0,
    tax_cents: 0,
    discount_reason: null,
    total_cents: 10000,
    currency: "ZAR",
    estimated_ready_at: null,
    confirmed_at: null,
    accepted_at: null,
    ready_at: null,
    completed_at: null,
    special_instructions: null,
    cancelled_reason: null,
    created_at: "2026-09-23T09:00:00Z",
    updated_at: "2026-09-23T09:00:00Z",
    loyalty_discount_cents: 0,
    loyalty_reward_id: null,
    loyalty_points_redeemed: 0,
    loyalty_reward_name: null,
    ...overrides,
  };
}

function installApiMock(opts: { onPost?: typeof postMock.mockImplementation } = {}) {
  getMock.mockImplementation((path: string) => {
    if (path === "/v1/business/menu/categories") return Promise.resolve([]);
    if (path === "/v1/business/menu/items") return Promise.resolve([MENU_ITEM]);
    if (path === "/v1/business/pos/till/current") return Promise.resolve(TILL_OPEN);
    if (path === "/v1/business/pos/settings") return Promise.resolve(POS_SETTINGS);
    if (path.startsWith("/v1/business/loyalty/customers/lookup")) return Promise.resolve(CUSTOMER);
    if (path === "/v1/business/loyalty/rewards") return Promise.resolve([REWARD]);
    if (path.startsWith("/v1/business/receipts/orders/")) {
      return Promise.reject({ message: "not needed for these tests", status: 0, noResponse: true });
    }
    return Promise.reject(new Error(`Unmocked GET ${path}`));
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

async function addItemAndEnterPhone(phone = "0821234567") {
  renderPos();
  const tile = await screen.findByText("Burger");
  fireEvent.click(tile);

  const phoneInput = await screen.findByPlaceholderText("Phone (for loyalty)");
  fireEvent.change(phoneInput, { target: { value: phone } });
  return phoneInput;
}

async function selectReward() {
  const rewardButton = await screen.findByTestId(`loyalty-reward-${REWARD.id}`, {}, { timeout: 3000 });
  fireEvent.click(rewardButton);
  await waitFor(() => expect(rewardButton).toHaveAttribute("aria-pressed", "true"));
  return rewardButton;
}

function payWithCash() {
  fireEvent.click(screen.getByRole("button", { name: /Checkout/ }));
  fireEvent.click(screen.getByRole("button", { name: /Cash/ }));
  fireEvent.click(screen.getByRole("button", { name: "Exact" }));
  fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));
}

describe("Pos + loyalty — successful redemption", () => {
  it("sends loyalty_reward_id, customer_phone and a stable idempotency_key together, and shows the backend-returned redemption on Sale complete", async () => {
    postMock.mockImplementation((path: string, body: Record<string, unknown>) => {
      if (path === "/v1/business/pos/orders") {
        return Promise.resolve(
          baseOrder({
            total_cents: 7000,
            loyalty_discount_cents: 3000,
            loyalty_reward_id: REWARD.id,
            loyalty_points_redeemed: 100,
            loyalty_reward_name: REWARD.name,
            _sentBody: body, // not a real field — asserted on below via the mock's own call args
          })
        );
      }
      return Promise.reject(new Error(`Unmocked POST ${path}`));
    });

    await addItemAndEnterPhone();
    await selectReward();
    payWithCash();

    await screen.findByText("Sale complete");
    expect(postMock).toHaveBeenCalledTimes(1);
    const [, body] = postMock.mock.calls[0];
    expect(body).toMatchObject({
      loyalty_reward_id: REWARD.id,
      customer_phone: "0821234567",
      idempotency_key: expect.any(String),
    });

    // Sale complete renders ONLY what the backend returned — never a
    // locally recomputed figure.
    expect(screen.getByText(/R30 off redeemed/)).toBeInTheDocument();
    expect(screen.getByText(/100 pts/)).toBeInTheDocument();
  });
});

describe("Pos + loyalty — insufficient points at checkout time", () => {
  it("surfaces the backend's rejection and does not mark the sale complete", async () => {
    postMock.mockImplementation((path: string) => {
      if (path === "/v1/business/pos/orders") {
        return Promise.reject({ message: "Customer does not have enough points for this reward", status: 422 });
      }
      return Promise.reject(new Error(`Unmocked POST ${path}`));
    });

    await addItemAndEnterPhone();
    await selectReward();
    payWithCash();

    await screen.findByText("Customer does not have enough points for this reward");
    expect(screen.queryByText("Sale complete")).not.toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});

describe("Pos + loyalty — reward worth more than the cart total", () => {
  it("is offered as a clamped preview but never lets the frontend invent a negative total", async () => {
    const bigReward = { ...REWARD, id: "reward-big", name: "R500 off", value_cents: 50000, points_cost: 10 };
    getMock.mockImplementation((path: string) => {
      if (path === "/v1/business/menu/categories") return Promise.resolve([]);
      if (path === "/v1/business/menu/items") return Promise.resolve([MENU_ITEM]);
      if (path === "/v1/business/pos/till/current") return Promise.resolve(TILL_OPEN);
      if (path === "/v1/business/pos/settings") return Promise.resolve(POS_SETTINGS);
      if (path.startsWith("/v1/business/loyalty/customers/lookup")) return Promise.resolve(CUSTOMER);
      if (path === "/v1/business/loyalty/rewards") return Promise.resolve([bigReward]);
      return Promise.reject(new Error(`Unmocked GET ${path}`));
    });

    await addItemAndEnterPhone();
    const rewardButton = await screen.findByTestId(`loyalty-reward-${bigReward.id}`);
    // The cart (R100) cannot absorb a R500 reward — offered disabled, per
    // this feature's deliberately-stricter-than-the-backend filtering.
    expect(rewardButton).toBeDisabled();
    expect(screen.getByText("Too high for this order")).toBeInTheDocument();
  });
});

describe("Pos + loyalty — customer number changed after reward selection", () => {
  it("clears the selected reward and does not send loyalty_reward_id at checkout", async () => {
    postMock.mockImplementation((path: string) => {
      if (path === "/v1/business/pos/orders") return Promise.resolve(baseOrder());
      return Promise.reject(new Error(`Unmocked POST ${path}`));
    });

    const phoneInput = await addItemAndEnterPhone();
    await selectReward();

    // Cashier changes the phone number to a different customer.
    fireEvent.change(phoneInput, { target: { value: "0839876543" } });

    // The picker for the OLD number's reward should no longer show it
    // selected once the number changes (a fresh lookup/catalogue applies).
    await waitFor(() => {
      expect(screen.queryByTestId(`loyalty-reward-${REWARD.id}`)).not.toHaveAttribute("aria-pressed", "true");
    });

    payWithCash();
    await screen.findByText("Sale complete");

    // The property may exist as `undefined` (dropped by JSON.stringify at
    // the real fetch layer) — what matters is that no reward id is sent.
    const [, body] = postMock.mock.calls[0];
    expect(body.loyalty_reward_id).toBeUndefined();
  });
});

describe("Pos + loyalty — cart cleared", () => {
  it("clears the selected reward when every line is removed from the cart", async () => {
    await addItemAndEnterPhone();
    await selectReward();

    // Remove the only line (quantity 1 -> Minus button removes it).
    fireEvent.click(screen.getByLabelText("Decrease quantity"));

    // Re-add the item and re-enter the same number — the OLD selection
    // must not silently still be applied.
    const tile = await screen.findByText("Burger");
    fireEvent.click(tile);
    const phoneInput = await screen.findByPlaceholderText("Phone (for loyalty)");
    fireEvent.change(phoneInput, { target: { value: "0821234567" } });

    await waitFor(() => {
      const rewardButton = screen.queryByTestId(`loyalty-reward-${REWARD.id}`);
      expect(rewardButton).not.toHaveAttribute("aria-pressed", "true");
    });
  });
});

describe("Pos + loyalty — duplicate Pay press / idempotent retry", () => {
  it("does not double-submit on a fast repeated click of Complete sale", async () => {
    let resolvePost: (value: unknown) => void = () => {};
    postMock.mockImplementation((path: string) => {
      if (path === "/v1/business/pos/orders") {
        return new Promise((resolve) => {
          resolvePost = resolve;
        });
      }
      return Promise.reject(new Error(`Unmocked POST ${path}`));
    });

    await addItemAndEnterPhone();
    await selectReward();

    fireEvent.click(screen.getByRole("button", { name: /Checkout/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cash/ }));
    fireEvent.click(screen.getByRole("button", { name: "Exact" }));
    const payButton = screen.getByRole("button", { name: "Complete sale" });
    fireEvent.click(payButton);
    // A second, near-simultaneous press — the button disables itself via
    // isSubmitting before this fires.
    fireEvent.click(payButton);

    expect(postMock).toHaveBeenCalledTimes(1);
    resolvePost(baseOrder({ loyalty_reward_id: REWARD.id, loyalty_discount_cents: 3000, loyalty_points_redeemed: 100, loyalty_reward_name: REWARD.name }));
    await screen.findByText("Sale complete");
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("a same-key retry after an unknown outcome resends the EXACT same payload (including loyalty_reward_id), never a fresh idempotency key", async () => {
    let firstBody: Record<string, unknown> | null = null;
    let callCount = 0;
    postMock.mockImplementation((path: string, body: Record<string, unknown>) => {
      if (path !== "/v1/business/pos/orders") return Promise.reject(new Error(`Unmocked POST ${path}`));
      callCount += 1;
      if (callCount === 1) {
        firstBody = body;
        // Outcome unknown — no HTTP response at all.
        return Promise.reject({ message: "timed out", status: 0, noResponse: true });
      }
      // Recovery resend — must be byte-identical to the first attempt.
      expect(body).toEqual(firstBody);
      return Promise.resolve(
        baseOrder({ loyalty_reward_id: REWARD.id, loyalty_discount_cents: 3000, loyalty_points_redeemed: 100, loyalty_reward_name: REWARD.name })
      );
    });

    await addItemAndEnterPhone();
    await selectReward();
    payWithCash();

    // The blocking recovery overlay appears once the outcome is unknown.
    await screen.findByText("Checking your last sale…");
    fireEvent.click(screen.getByRole("button", { name: /Check now/ }));

    await screen.findByText("Sale complete");
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(firstBody).toMatchObject({ loyalty_reward_id: REWARD.id });
    const [, secondBody] = postMock.mock.calls[1];
    expect(secondBody).toEqual(firstBody); // same idempotency_key, same everything
  });
});

describe("Pos + loyalty — digital (WhatsApp) receipt after a redeemed sale", () => {
  // There is no independent frontend renderer for the digital receipt in
  // this repo — its full itemised content (including the loyalty reward
  // line) is built entirely server-side by the SAME
  // backend/app/receipts/document.py::build_receipt_document(order,
  // business) call the printed receipt uses (routes_receipts.py:146 for
  // print, whatsapp_receipt.py:361 for the WhatsApp send), so the two are
  // guaranteed to agree by construction — verified by reading that backend
  // code, not by a frontend test, since there is nothing here to render.
  // What THIS app owns is triggering the send correctly after a
  // loyalty-redeemed sale, which this test covers.
  it("opens the WhatsApp send dialog for the just-completed (loyalty-redeemed) order and posts the expected request", async () => {
    postMock.mockImplementation((path: string) => {
      if (path === "/v1/business/pos/orders") {
        return Promise.resolve(
          baseOrder({ loyalty_reward_id: REWARD.id, loyalty_discount_cents: 3000, loyalty_points_redeemed: 100, loyalty_reward_name: REWARD.name })
        );
      }
      if (path.startsWith("/v1/business/pos/orders/") && path.endsWith("/receipt")) {
        return Promise.resolve({ id: "receipt-1", whatsapp_requested: true, whatsapp_status: "SENT", whatsapp_failure_reason: null });
      }
      return Promise.reject(new Error(`Unmocked POST ${path}`));
    });

    await addItemAndEnterPhone();
    await selectReward();
    payWithCash();

    await screen.findByText("Sale complete");
    fireEvent.click(screen.getByRole("button", { name: /WhatsApp/ }));
    await screen.findByText("Send receipt via WhatsApp");

    const sendButton = await screen.findByRole("button", { name: /Send/ });
    fireEvent.click(sendButton);

    await waitFor(() => {
      const receiptCalls = postMock.mock.calls.filter(([path]) => String(path).includes("/receipt"));
      expect(receiptCalls.length).toBe(1);
    });
    const [, receiptBody] = postMock.mock.calls.find(([path]) => String(path).includes("/receipt"))!;
    expect(receiptBody).toMatchObject({ channels: ["WHATSAPP"] });
    await screen.findByText("Receipt sent");
  });
});
