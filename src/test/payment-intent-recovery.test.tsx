import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import type { POSSettings, POSCheckoutPaymentPayload, PaymentIntent } from "@/types";

/**
 * Financial-safety closeout for Pay by Link: a PAID-but-unconsumed intent
 * must never silently disappear from the till.
 *
 *  - PaymentDialog blocks leaving the payment screen (Back out of split, or
 *    closing the dialog) while a Pay-by-Link allocation is PAID but the
 *    sale hasn't been completed.
 *  - Pos.tsx shows a persistent "Payment received but sale not completed"
 *    banner from GET /payment-intents/unconsumed-paid, with "Resume Sale",
 *    which lets the cashier attach that EXACT existing intent to a new
 *    checkout ("Use existing payment") without creating a new one.
 *
 * Only the HTTP boundary (apiClient) is mocked — lib/payment-intents.ts is
 * the real module, so the endpoint paths asserted here are the real ones.
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

import PaymentDialog, { LEAVE_WITH_PAID_LINK_MESSAGE } from "@/components/pos/PaymentDialog";
import Pos from "@/pages/Pos";

const INTENTS_PATH = "/v1/business/pos/payment-intents";
const UNCONSUMED_PATH = "/v1/business/pos/payment-intents/unconsumed-paid";
const ORDERS_PATH = "/v1/business/pos/orders";

const SETTINGS: POSSettings = {
  cash_enabled: true,
  card_enabled: true,
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
  print_kitchen_receipt: true,
  inventory_enabled: false,
  digital_receipts_enabled: false,
  loyalty_enabled: false,
  staff_live_orders_tab_enabled: true,
  staff_wastage_tab_enabled: false,
  staff_stocktake_tab_enabled: false,
  pay_by_link_enabled: true,
};

function intent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: "intent-1",
    status: "PENDING",
    whatsapp_status: "SENT",
    amount_cents: 15000,
    expires_at: "2026-10-11T12:00:00Z",
    ...overrides,
  };
}

function paidUnconsumed(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return intent({
    id: "paid-1",
    status: "PAID",
    amount_cents: 12000,
    customer_phone_masked: "+27 •• ••• 4567",
    paid_at: "2026-10-11T09:15:00Z",
    order_id: null,
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────
// PaymentDialog
// ─────────────────────────────────────────────────────────────────────────

function renderDialog(opts: {
  totalCents: number;
  resumePaymentIntent?: PaymentIntent | null;
  customerPhone?: string | null;
}) {
  const onConfirm = vi.fn<(p: POSCheckoutPaymentPayload) => void>();
  const onClose = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={["/pos"]}>
      <TouchKeyboardProvider>
        <PaymentDialog
          open
          onClose={onClose}
          totalCents={opts.totalCents}
          posSettings={SETTINGS}
          onConfirm={onConfirm}
          isSubmitting={false}
          errorMessage={null}
          customerPhone={opts.customerPhone ?? "0821234567"}
          resumePaymentIntent={opts.resumePaymentIntent ?? null}
        />
      </TouchKeyboardProvider>
    </MemoryRouter>
  );
  return { ...utils, onConfirm, onClose };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Split → Add payment → Pay by Link → Send link; returns on the link status screen. */
async function sendLink() {
  fireEvent.click(screen.getByText("Split payment"));
  fireEvent.click(screen.getByText(/\+ Add payment/));
  fireEvent.click(screen.getByText(/Pay by Link/));
  await act(async () => {
    fireEvent.click(screen.getByText("Send link"));
    await Promise.resolve();
  });
}

describe("PaymentDialog — leaving the payment screen with a PAID Pay-by-Link allocation", () => {
  it("blocks Back (and closing the dialog) with the exact message once the link is PAID, and never tries to cancel it", async () => {
    vi.useFakeTimers();
    postMock.mockImplementation((path: string) =>
      path === INTENTS_PATH ? Promise.resolve(intent()) : Promise.reject(new Error(`Unmocked POST ${path}`))
    );
    getMock.mockResolvedValue(intent({ status: "PAID" }));

    const { onClose } = renderDialog({ totalCents: 30000 });
    await sendLink();
    fireEvent.click(screen.getByText("Back to split payment"));

    // Poll tick: the intent reaches PAID.
    await act(async () => {
      vi.advanceTimersByTime(2600);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getMock).toHaveBeenCalledWith(`${INTENTS_PATH}/intent-1`);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Payment has already been received. Complete this sale before leaving the payment screen."
    );
    expect(LEAVE_WITH_PAID_LINK_MESSAGE).toBe(
      "Payment has already been received. Complete this sale before leaving the payment screen."
    );
    // Still on the split screen, allocation intact.
    expect(screen.getByText("Split payment")).toBeInTheDocument(); // dialog title
    expect(screen.getByText("Payment 1 · Pay by Link")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalledWith(`${INTENTS_PATH}/intent-1/cancel`);

    // Closing the dialog (Escape → onOpenChange(false)) is blocked too.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(LEAVE_WITH_PAID_LINK_MESSAGE);
  });

  it("Back still works normally (and cancels the link) while the Pay-by-Link allocation is only PENDING", async () => {
    postMock.mockImplementation((path: string) => {
      if (path === INTENTS_PATH) return Promise.resolve(intent());
      if (path === `${INTENTS_PATH}/intent-1/cancel`) return Promise.resolve(intent({ status: "CANCELLED" }));
      return Promise.reject(new Error(`Unmocked POST ${path}`));
    });

    renderDialog({ totalCents: 30000 });
    await sendLink();
    fireEvent.click(screen.getByText("Back to split payment"));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await flush();

    expect(postMock).toHaveBeenCalledWith(`${INTENTS_PATH}/intent-1/cancel`);
    expect(screen.getByText("Select payment method")).toBeInTheDocument();
    expect(screen.queryByText(LEAVE_WITH_PAID_LINK_MESSAGE)).toBeNull();
  });

  it("Back still works normally when there is no Pay-by-Link allocation at all", async () => {
    renderDialog({ totalCents: 30000 });
    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText("💳 Card"));
    fireEvent.change(screen.getByDisplayValue("300.00"), { target: { value: "100.00" } });
    fireEvent.click(screen.getByText("Add payment"));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await flush();

    expect(screen.getByText("Select payment method")).toBeInTheDocument();
    expect(screen.queryByText(LEAVE_WITH_PAID_LINK_MESSAGE)).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("closing the dialog still works normally while a link is only PENDING", async () => {
    postMock.mockImplementation((path: string) =>
      path === INTENTS_PATH ? Promise.resolve(intent()) : Promise.reject(new Error(`Unmocked POST ${path}`))
    );
    const { onClose } = renderDialog({ totalCents: 30000 });
    await sendLink();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("if the customer pays between the last poll and Back, the refused cancel is re-checked and the PAID allocation is kept", async () => {
    postMock.mockImplementation((path: string) => {
      if (path === INTENTS_PATH) return Promise.resolve(intent());
      if (path === `${INTENTS_PATH}/intent-1/cancel`) {
        return Promise.reject({ status: 422, message: "Cannot cancel — this payment link is PAID" });
      }
      return Promise.reject(new Error(`Unmocked POST ${path}`));
    });
    getMock.mockResolvedValue(intent({ status: "PAID" }));

    renderDialog({ totalCents: 30000 });
    await sendLink();
    fireEvent.click(screen.getByText("Back to split payment"));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await flush();

    expect(getMock).toHaveBeenCalledWith(`${INTENTS_PATH}/intent-1`);
    expect(screen.getByRole("alert")).toHaveTextContent(LEAVE_WITH_PAID_LINK_MESSAGE);
    expect(screen.getByText("Payment 1 · Pay by Link")).toBeInTheDocument();
    expect(screen.queryByText("Select payment method")).toBeNull();
  });
});

describe("PaymentDialog — Use existing payment (resume a paid, unconsumed intent)", () => {
  it("attaches the existing intent by id as the Pay-by-Link allocation without creating or sending a new link", async () => {
    getMock.mockImplementation((path: string) =>
      path === `${INTENTS_PATH}/paid-1`
        ? Promise.resolve(paidUnconsumed({ amount_cents: 15000 }))
        : Promise.reject(new Error(`Unmocked GET ${path}`))
    );

    const { onConfirm } = renderDialog({ totalCents: 15000, resumePaymentIntent: paidUnconsumed({ amount_cents: 15000 }) });
    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText(/Pay by Link/));

    const useExisting = screen.getByRole("button", { name: /^Use existing payment \(R 150\.00, received .+\)$/ });
    // The normal send-a-new-link path is still offered alongside.
    expect(screen.getByText("Send link")).toBeInTheDocument();

    fireEvent.click(useExisting);
    await flush();

    expect(getMock).toHaveBeenCalledWith(`${INTENTS_PATH}/paid-1`);
    expect(postMock).not.toHaveBeenCalled(); // no createPaymentIntent, nothing sent
    expect(screen.getByText(/existing payment/)).toBeInTheDocument();

    const complete = screen.getByRole("button", { name: "Complete sale" });
    expect(complete).not.toBeDisabled();
    fireEvent.click(complete);

    expect(onConfirm).toHaveBeenCalledWith({
      payments: [{ payment_method: "PAY_BY_LINK", amount_cents: 15000, payment_intent_id: "paid-1" }],
    });
  });

  it("a resumed intent smaller than the bill is just ONE allocation in a larger split (R120 link + R80 cash on a R200 sale)", async () => {
    getMock.mockResolvedValue(paidUnconsumed());

    const { onConfirm } = renderDialog({ totalCents: 20000, resumePaymentIntent: paidUnconsumed() });
    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText(/Pay by Link/));
    fireEvent.click(screen.getByRole("button", { name: /^Use existing payment \(R 120\.00/ }));
    await flush();

    // R80 still owing — Complete Sale blocked until it's covered.
    expect(screen.getByText("R 80.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete sale" })).toBeDisabled();

    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText("💵 Cash"));
    expect(screen.getByDisplayValue("80.00")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "80.00" } });
    fireEvent.click(screen.getByText("Add payment"));

    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));
    expect(onConfirm).toHaveBeenCalledWith({
      payments: [
        { payment_method: "PAY_BY_LINK", amount_cents: 12000, payment_intent_id: "paid-1" },
        { payment_method: "CASH", amount_cents: 8000, cash_tendered_cents: 8000 },
      ],
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("can't attach a resumed payment larger than what's still owing — says why instead", () => {
    renderDialog({ totalCents: 5000, resumePaymentIntent: paidUnconsumed() });
    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText(/Pay by Link/));

    expect(screen.getByRole("button", { name: /^Use existing payment/ })).toBeDisabled();
    expect(screen.getByText(/more than the R 50\.00 still\s+owing/)).toBeInTheDocument();
  });

  it("refuses to attach a resumed payment the server now says is already used", async () => {
    getMock.mockResolvedValue(paidUnconsumed({ status: "CONSUMED", order_id: "order-9" }));

    renderDialog({ totalCents: 12000, resumePaymentIntent: paidUnconsumed() });
    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText(/Pay by Link/));
    fireEvent.click(screen.getByRole("button", { name: /^Use existing payment/ }));
    await flush();

    expect(screen.getByText("This payment has already been used for a sale or is no longer available.")).toBeInTheDocument();
    expect(screen.queryByText("Payment 1 · Pay by Link")).toBeNull();
  });

  it("a resumed allocation can be removed again (it is only detached locally, never cancelled), after which Back works", async () => {
    getMock.mockResolvedValue(paidUnconsumed());

    renderDialog({ totalCents: 20000, resumePaymentIntent: paidUnconsumed() });
    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText(/Pay by Link/));
    fireEvent.click(screen.getByRole("button", { name: /^Use existing payment/ }));
    await flush();

    // While attached it is PAID, so Back is blocked like any other paid link.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(LEAVE_WITH_PAID_LINK_MESSAGE);

    fireEvent.click(screen.getByRole("button", { name: "Remove payment 1" }));
    await flush();
    expect(postMock).not.toHaveBeenCalled();
    expect(screen.getByText("No payments added yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await flush();
    expect(screen.getByText("Select payment method")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Pos.tsx recovery banner
// ─────────────────────────────────────────────────────────────────────────

const MENU_ITEM = {
  id: "item-1",
  category_id: null,
  name: "Burger",
  description: null,
  price_cents: 12000,
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
  opened_at: "2026-10-11T08:00:00Z",
  closed_at: null,
};

const CREATED_ORDER = {
  id: "order-1",
  order_number: "A-0001",
  status: "NEW",
  payment_status: "PAID",
  payment_required: false,
  payment_method: "PAY_BY_LINK",
  payment_reference: null,
  payment_link_url: null,
  paid_at: "2026-10-11T09:30:00Z",
  order_mode: "PICKUP",
  table_number: null,
  source: "POS",
  cash_tendered_cents: null,
  change_due_cents: null,
  till_session_id: "till-1",
  created_by_user_id: "user-1",
  refund_reference: null,
  refund_amount_cents: null,
  refunded_at: null,
  customer_name: null,
  phone_number: null,
  delivery_address: null,
  items: [],
  subtotal_cents: 12000,
  delivery_fee_cents: 0,
  discount_cents: 0,
  tax_cents: 0,
  discount_reason: null,
  total_cents: 12000,
  currency: "ZAR",
  estimated_ready_at: null,
  confirmed_at: null,
  accepted_at: null,
  ready_at: null,
  completed_at: null,
  special_instructions: null,
  cancelled_reason: null,
  created_at: "2026-10-11T09:30:00Z",
  updated_at: "2026-10-11T09:30:00Z",
};

function installPosApi(opts: {
  unconsumed: () => Promise<PaymentIntent[]>;
  till?: () => Promise<unknown>;
}) {
  getMock.mockImplementation((path: string) => {
    if (path === "/v1/business/menu/categories") return Promise.resolve([]);
    if (path === "/v1/business/menu/items") return Promise.resolve([MENU_ITEM]);
    if (path === "/v1/business/pos/till/current") return opts.till ? opts.till() : Promise.resolve(TILL_OPEN);
    if (path === "/v1/business/pos/settings") return Promise.resolve(SETTINGS);
    if (path === UNCONSUMED_PATH) return opts.unconsumed();
    if (path === `${INTENTS_PATH}/paid-1`) return Promise.resolve(paidUnconsumed());
    return Promise.reject(new Error(`Unmocked GET ${path}`));
  });
  postMock.mockImplementation((path: string) => {
    if (path === ORDERS_PATH) return Promise.resolve(CREATED_ORDER);
    return Promise.reject(new Error(`Unmocked POST ${path}`));
  });
}

function renderPos() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <MemoryRouter initialEntries={["/pos"]}>
      <QueryClientProvider client={queryClient}>
        <TouchKeyboardProvider>
          <Pos />
        </TouchKeyboardProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  return { ...utils, queryClient };
}

function unconsumedCalls() {
  return getMock.mock.calls.filter(([p]) => p === UNCONSUMED_PATH).length;
}

describe("Pos — 'Payment received but sale not completed' recovery banner", () => {
  it("is hidden when the backend reports no unconsumed paid intents (checked on mount)", async () => {
    installPosApi({ unconsumed: () => Promise.resolve([]) });
    renderPos();
    await screen.findByText("Burger");
    await waitFor(() => expect(unconsumedCalls()).toBe(1));
    expect(screen.queryByText("Payment received but sale not completed")).toBeNull();
  });

  it("is shown on mount (so it survives a refresh) with amount, masked phone and a Resume Sale button — never a link", async () => {
    installPosApi({ unconsumed: () => Promise.resolve([paidUnconsumed()]) });
    const { container } = renderPos();

    const heading = await screen.findByText("Payment received but sale not completed");
    const banner = heading.closest('[role="alert"]') as HTMLElement;
    expect(within(banner).getByText("R 120.00")).toBeInTheDocument();
    expect(within(banner).getByText(/\+27 •• ••• 4567 · received /)).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Resume Sale for R 120.00" })).toHaveTextContent("Resume Sale");
    // No payment link anywhere: no URL in visible text, no anchor at all.
    expect(container.textContent ?? "").not.toMatch(/https?:\/\//);
    expect(container.querySelector("a[href]")).toBeNull();
  });

  it("re-checks when a till is opened", async () => {
    let tillOpen = false;
    installPosApi({
      unconsumed: () => Promise.resolve([]),
      till: () => Promise.resolve(tillOpen ? TILL_OPEN : null),
    });
    const { queryClient } = renderPos();
    await screen.findByText("Burger");
    await waitFor(() => expect(unconsumedCalls()).toBe(1));

    tillOpen = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["till-current"] });
    });
    await waitFor(() => expect(unconsumedCalls()).toBe(2));
  });

  it("says so (with a retry) when the check itself fails, instead of looking like nothing is outstanding", async () => {
    let fail = true;
    installPosApi({
      unconsumed: () => (fail ? Promise.reject({ status: 0, message: "offline", noResponse: true }) : Promise.resolve([paidUnconsumed()])),
    });
    renderPos();
    expect(await screen.findByText("Couldn't check for payments received without a completed sale.")).toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Payment received but sale not completed")).toBeInTheDocument();
  });

  it("Resume Sale → ring up → Use existing payment checks out through the normal orders endpoint with that intent id, never creating a new one; the banner clears afterwards", async () => {
    let unconsumed: PaymentIntent[] = [paidUnconsumed()];
    installPosApi({ unconsumed: () => Promise.resolve(unconsumed) });
    renderPos();

    fireEvent.click(await screen.findByRole("button", { name: "Resume Sale for R 120.00" }));
    expect(
      screen.getByText(/Ring up items totalling R 120\.00, then choose Split payment, then Pay by\s+Link/)
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByText("Burger"));
    fireEvent.click(await screen.findByRole("button", { name: /Checkout/ }));
    fireEvent.click(await screen.findByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByRole("button", { name: /Pay by Link \(WhatsApp\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Use existing payment \(R 120\.00/ }));

    const complete = await screen.findByRole("button", { name: "Complete sale" });
    await waitFor(() => expect(complete).not.toBeDisabled());

    unconsumed = []; // consumed by this checkout server-side
    fireEvent.click(complete);
    await screen.findByText("Sale complete");

    const orderCalls = postMock.mock.calls.filter(([p]) => p === ORDERS_PATH);
    expect(orderCalls).toHaveLength(1);
    expect(orderCalls[0][1]).toMatchObject({
      payments: [{ payment_method: "PAY_BY_LINK", amount_cents: 12000, payment_intent_id: "paid-1" }],
    });
    expect(postMock.mock.calls.some(([p]) => p === INTENTS_PATH)).toBe(false);

    await waitFor(() => expect(screen.queryByText("Payment received but sale not completed")).toBeNull());
  });
});
