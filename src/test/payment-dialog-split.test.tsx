import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import type { POSSettings, POSCheckoutPaymentPayload, PaymentIntent } from "@/types";

/**
 * PaymentDialog.tsx's split-payment / Pay-by-Link UI, built against the
 * locked backend contract in the task brief: either the legacy top-level
 * payment_method/cash_tendered_cents/payment_reference fields, OR a
 * payments[] array (mutually exclusive). This file is the dedicated
 * split-payment/Pay-by-Link coverage; pos-checkout-receipt.test.tsx and
 * pos-loyalty-checkout.test.tsx already cover the pre-existing single-method
 * flow end-to-end through Pos.tsx and are left untouched.
 */

const createPaymentIntentMock = vi.fn();
const getPaymentIntentMock = vi.fn();
const resendPaymentIntentMock = vi.fn();
const cancelPaymentIntentMock = vi.fn();

vi.mock("@/lib/payment-intents", () => ({
  createPaymentIntent: (...args: unknown[]) => createPaymentIntentMock(...args),
  getPaymentIntent: (...args: unknown[]) => getPaymentIntentMock(...args),
  resendPaymentIntent: (...args: unknown[]) => resendPaymentIntentMock(...args),
  cancelPaymentIntent: (...args: unknown[]) => cancelPaymentIntentMock(...args),
  maskPhoneForStatus: (raw: string) => `+27 •• ••• ${raw.replace(/\D/g, "").slice(-4)}`,
}));

import PaymentDialog from "@/components/pos/PaymentDialog";

const BASE_SETTINGS: POSSettings = {
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
  receipt_auto_print: true,
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

function renderDialog(opts: {
  totalCents: number;
  posSettings: POSSettings | null;
  onConfirm?: (payload: POSCheckoutPaymentPayload) => void;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  customerPhone?: string | null;
}) {
  const onConfirm = opts.onConfirm ?? vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={["/pos"]}>
      <TouchKeyboardProvider>
        <PaymentDialog
          open
          onClose={onClose}
          totalCents={opts.totalCents}
          posSettings={opts.posSettings}
          onConfirm={onConfirm}
          isSubmitting={opts.isSubmitting ?? false}
          errorMessage={opts.errorMessage ?? null}
          customerPhone={opts.customerPhone ?? null}
        />
      </TouchKeyboardProvider>
    </MemoryRouter>
  );
  return { ...utils, onConfirm, onClose };
}

function pendingIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: "intent-1",
    status: "PENDING",
    whatsapp_status: "SENT",
    amount_cents: 15000,
    expires_at: "2026-10-10T12:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PaymentDialog — single-method flow is unchanged", () => {
  it("Cash/Card/Other buttons work exactly as before when Split isn't used", () => {
    const { onConfirm } = renderDialog({ totalCents: 5000, posSettings: { ...BASE_SETTINGS, card_enabled: false, pay_by_link_enabled: false } });

    // Only one method enabled (cash) -- Split must not appear at all.
    expect(screen.queryByText("Split payment")).toBeNull();

    fireEvent.click(screen.getByText("💵 Cash"));
    fireEvent.click(screen.getByRole("button", { name: "Exact" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(onConfirm).toHaveBeenCalledWith({ payment_method: "CASH", cash_tendered_cents: 5000 });
  });

  it("does not offer Split payment when fewer than 2 methods are enabled", () => {
    renderDialog({ totalCents: 5000, posSettings: { ...BASE_SETTINGS, card_enabled: false, pay_by_link_enabled: false } });
    expect(screen.queryByText("Split payment")).toBeNull();
  });

  it("offers Split payment once >= 2 methods are enabled", () => {
    renderDialog({ totalCents: 5000, posSettings: BASE_SETTINGS });
    expect(screen.getByText("Split payment")).toBeInTheDocument();
  });

  it("hides Pay by Link from the split method list when the settings flag is absent (graceful degrade, no crash)", () => {
    const settingsWithoutFlag: POSSettings = { ...BASE_SETTINGS };
    delete (settingsWithoutFlag as Partial<POSSettings>).pay_by_link_enabled;
    renderDialog({ totalCents: 5000, posSettings: settingsWithoutFlag });

    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));

    expect(screen.queryByText(/Pay by Link/)).toBeNull();
    expect(screen.getByText("💵 Cash")).toBeInTheDocument();
    expect(screen.getByText("💳 Card")).toBeInTheDocument();
  });
});

describe("PaymentDialog — split cash + card remaining-balance and change-due math", () => {
  it("R300 total: R100 cash (R200 tendered, R100 change) leaves R200 remaining, which the next Card allocation defaults to and fully settles", () => {
    const { onConfirm } = renderDialog({ totalCents: 30000, posSettings: BASE_SETTINGS });

    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText("💵 Cash"));

    // Phase 1: amount to apply -- default is the full remaining (R300).
    const amountInput = screen.getByDisplayValue("300.00");
    fireEvent.change(amountInput, { target: { value: "100.00" } });
    fireEvent.click(screen.getByText("Next"));

    // Phase 2: cash received -- R200 handed over against a R100 allocation.
    const receivedInput = screen.getByPlaceholderText("0.00");
    fireEvent.change(receivedInput, { target: { value: "200.00" } });
    expect(screen.getByText("Change due")).toBeInTheDocument();
    expect(screen.getByText("R 100.00")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add payment"));

    // Back on the split list: remaining is the TRUE remaining (R200), not
    // R300 minus nothing -- the change never gets double-counted.
    expect(screen.getByText("R 200.00")).toBeInTheDocument(); // Remaining card

    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText("💳 Card"));
    const cardAmountInput = screen.getByDisplayValue("200.00");
    expect(cardAmountInput).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add payment"));

    // Fully settled -- Complete Sale is enabled.
    const completeButton = screen.getByRole("button", { name: "Complete sale" });
    expect(completeButton).not.toBeDisabled();
    fireEvent.click(completeButton);

    expect(onConfirm).toHaveBeenCalledWith({
      payments: [
        { payment_method: "CASH", amount_cents: 10000, cash_tendered_cents: 20000 },
        { payment_method: "CARD", amount_cents: 20000 },
      ],
    });
  });

  it("Complete Sale stays disabled while anything remains unallocated", () => {
    renderDialog({ totalCents: 30000, posSettings: BASE_SETTINGS });
    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText("💳 Card"));
    fireEvent.change(screen.getByDisplayValue("300.00"), { target: { value: "100.00" } });
    fireEvent.click(screen.getByText("Add payment"));

    // Split list is implicit here (no explicit nav needed -- adding returns to it)
    expect(screen.getByRole("button", { name: "Complete sale" })).toBeDisabled();
  });
});

describe("PaymentDialog — Pay by Link allocation and polling", () => {
  it("creates an intent, shows masked phone + waiting state, and blocks Complete Sale until the poll reports PAID", async () => {
    vi.useFakeTimers();
    createPaymentIntentMock.mockResolvedValue(pendingIntent());
    getPaymentIntentMock.mockResolvedValue(pendingIntent({ status: "PAID" }));

    const { onConfirm } = renderDialog({ totalCents: 15000, posSettings: BASE_SETTINGS, customerPhone: "0821234567" });

    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText(/Pay by Link/));

    // Phone prefilled from the order's existing customer phone.
    expect(screen.getByDisplayValue("0821234567")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Send link"));
      await Promise.resolve();
    });

    expect(createPaymentIntentMock).toHaveBeenCalledWith({ amount_cents: 15000, customer_phone: "0821234567" });
    // The raw number must never be rendered -- only the masked form.
    expect(screen.queryByText("0821234567")).toBeNull();
    expect(screen.getByText("+27 •• ••• 4567")).toBeInTheDocument();
    expect(screen.getByText("Sent — waiting for payment")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Back to split payment"));

    // Still pending -- Complete Sale is blocked even though the full total
    // is "allocated".
    expect(screen.getByRole("button", { name: "Complete sale" })).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(2600);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getPaymentIntentMock).toHaveBeenCalledWith("intent-1");
    // "Paid" appears twice here: the PAID/REMAINING summary label, and the
    // allocation row's own status text -- both are expected.
    expect(screen.getAllByText("Paid").length).toBeGreaterThanOrEqual(2);

    const completeButton = screen.getByRole("button", { name: "Complete sale" });
    expect(completeButton).not.toBeDisabled();
    fireEvent.click(completeButton);

    expect(onConfirm).toHaveBeenCalledWith({
      payments: [{ payment_method: "PAY_BY_LINK", amount_cents: 15000, payment_intent_id: "intent-1" }],
    });
  });

  it("never shows a 'Sent' label when whatsapp_status is TEMPLATE_REQUIRED, even though the intent is PENDING", async () => {
    createPaymentIntentMock.mockResolvedValue(
      pendingIntent({ whatsapp_status: "TEMPLATE_REQUIRED" })
    );

    renderDialog({ totalCents: 15000, posSettings: BASE_SETTINGS, customerPhone: "0821234567" });
    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText(/Pay by Link/));

    await act(async () => {
      fireEvent.click(screen.getByText("Send link"));
      await Promise.resolve();
    });

    expect(screen.getByText(/needs an approved WhatsApp payment template/)).toBeInTheDocument();
    expect(screen.queryByText(/^Sent/)).toBeNull();
  });

  it("resend is disabled while in flight, protecting against a double-tap creating a second request", async () => {
    createPaymentIntentMock.mockResolvedValue(pendingIntent());
    let resolveResend: (v: PaymentIntent) => void = () => {};
    resendPaymentIntentMock.mockImplementation(
      () => new Promise<PaymentIntent>((resolve) => { resolveResend = resolve; })
    );

    renderDialog({ totalCents: 15000, posSettings: BASE_SETTINGS, customerPhone: "0821234567" });
    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText(/Pay by Link/));
    await act(async () => {
      fireEvent.click(screen.getByText("Send link"));
      await Promise.resolve();
    });

    const resendButton = screen.getByRole("button", { name: /Resend/ });
    fireEvent.click(resendButton);
    expect(resendButton).toBeDisabled();
    fireEvent.click(resendButton); // double-tap while in flight -- must be a no-op
    expect(resendPaymentIntentMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveResend(pendingIntent());
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /Resend/ })).not.toBeDisabled();
  });

  it("cancelling a PENDING intent removes it from the allocation list cleanly", async () => {
    createPaymentIntentMock.mockResolvedValue(pendingIntent());
    cancelPaymentIntentMock.mockResolvedValue(pendingIntent({ status: "CANCELLED" }));

    renderDialog({ totalCents: 15000, posSettings: BASE_SETTINGS, customerPhone: "0821234567" });
    fireEvent.click(screen.getByText("Split payment"));
    fireEvent.click(screen.getByText(/\+ Add payment/));
    fireEvent.click(screen.getByText(/Pay by Link/));
    await act(async () => {
      fireEvent.click(screen.getByText("Send link"));
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await Promise.resolve();
    });

    expect(cancelPaymentIntentMock).toHaveBeenCalledWith("intent-1");
    // Back on the split list, with no allocations left -- remaining is the
    // full total again, and the dangling intent is not silently counted.
    expect(screen.getByText("No payments added yet.")).toBeInTheDocument();
  });
});
