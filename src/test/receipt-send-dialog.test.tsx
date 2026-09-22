import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import { setStoredInputMode } from "@/lib/touch-input";
import type { POSReceiptResponse } from "@/types";

const postMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

import ReceiptSendDialog from "@/components/pos/ReceiptSendDialog";
import TouchKeyboard from "@/components/TouchKeyboard";

function renderDialog(props: Partial<React.ComponentProps<typeof ReceiptSendDialog>> = {}) {
  return render(
    <MemoryRouter initialEntries={["/pos"]}>
      <TouchKeyboardProvider>
        <ReceiptSendDialog
          open
          onClose={vi.fn()}
          orderId="order-1"
          prefillPhone={null}
          {...props}
        />
      </TouchKeyboardProvider>
    </MemoryRouter>
  );
}

/**
 * Stateful wrapper so `onClose` actually flips the dialog's own `open` prop
 * to false (a bare `vi.fn()` onClose, as used by every other test in this
 * file, never exercises the real close path a cashier's tap goes through) —
 * needed to reproduce BUG-0080, where the bug is specifically about what
 * happens to app state (the shared on-screen keyboard) once the dialog is
 * told to close.
 */
function StatefulHarness(props: Partial<React.ComponentProps<typeof ReceiptSendDialog>> = {}) {
  const [open, setOpen] = useState(true);
  return (
    <MemoryRouter initialEntries={["/pos"]}>
      <TouchKeyboardProvider>
        <ReceiptSendDialog
          open={open}
          onClose={() => setOpen(false)}
          orderId="order-1"
          prefillPhone={null}
          {...props}
        />
        <TouchKeyboard />
        <div>
          <button type="button">New sale</button>
          <button type="button">Both</button>
          <button type="button">No receipt</button>
        </div>
      </TouchKeyboardProvider>
    </MemoryRouter>
  );
}

function baseResponse(overrides: Partial<POSReceiptResponse> = {}): POSReceiptResponse {
  return {
    id: "receipt-1",
    order_id: "order-1",
    receipt_url: "https://api.example/v1/r/abc",
    print_requested: false,
    whatsapp_requested: true,
    whatsapp_status: "SENT",
    whatsapp_failure_reason: null,
    ...overrides,
  };
}

beforeEach(() => {
  postMock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ReceiptSendDialog", () => {
  it("prefills the phone field from the order's captured number", () => {
    renderDialog({ prefillPhone: "0821234567" });
    expect(screen.getByDisplayValue("0821234567")).toBeInTheDocument();
  });

  it("disables Send for an obviously invalid number and enables it for a valid one", () => {
    renderDialog({ prefillPhone: null });
    const sendButton = screen.getByRole("button", { name: /Send/ });
    expect(sendButton).toBeDisabled();

    const input = screen.getByPlaceholderText("082 123 4567");
    fireEvent.change(input, { target: { value: "0821234567" } });
    expect(sendButton).not.toBeDisabled();
  });

  it("sends channels=[WHATSAPP] with the typed number and shows a success state on SENT", async () => {
    postMock.mockResolvedValue(baseResponse({ whatsapp_status: "SENT" }));
    renderDialog({ prefillPhone: "0821234567" });

    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await screen.findByText("Receipt sent");
    expect(postMock).toHaveBeenCalledWith(
      "/v1/business/pos/orders/order-1/receipt",
      { channels: ["WHATSAPP"], phone_number: "0821234567", force_resend: false }
    );
  });

  it("passes force_resend: true when the caller (Order Detail resend) requests it", async () => {
    postMock.mockResolvedValue(baseResponse({ whatsapp_status: "SENT" }));
    renderDialog({ prefillPhone: "0821234567", forceResend: true });

    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await screen.findByText("Receipt sent");
    expect(postMock).toHaveBeenCalledWith(
      "/v1/business/pos/orders/order-1/receipt",
      { channels: ["WHATSAPP"], phone_number: "0821234567", force_resend: true }
    );
  });

  it("shows the plain-language failure reason and lets the cashier retry without force_resend", async () => {
    postMock.mockResolvedValueOnce(
      baseResponse({ whatsapp_status: "FAILED", whatsapp_failure_reason: "Meta rejected the template" })
    );
    renderDialog({ prefillPhone: "0821234567" });

    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    await screen.findByText("Meta rejected the template");

    postMock.mockResolvedValueOnce(baseResponse({ whatsapp_status: "SENT" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByText("Receipt sent");
    expect(postMock).toHaveBeenCalledTimes(2);
    // A retry of a FAILED status never needs force_resend, even when this
    // dialog's own forceResend prop is false — both calls used the same body.
    expect(postMock.mock.calls[1][1]).toEqual(postMock.mock.calls[0][1]);
  });

  it("treats whatsapp_requested=true + whatsapp_status=NOT_REQUESTED as the feature being off, never as a fabricated success", async () => {
    postMock.mockResolvedValue(baseResponse({ whatsapp_status: "NOT_REQUESTED" }));
    renderDialog({ prefillPhone: "0821234567" });

    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await screen.findByText("WhatsApp receipts aren't enabled");
    expect(screen.queryByText("Receipt sent")).not.toBeInTheDocument();
  });

  it("shows a transport-error retry path when the request itself fails (no HTTP response)", async () => {
    postMock.mockRejectedValueOnce({ message: "Could not reach the server", status: 0, noResponse: true });
    renderDialog({ prefillPhone: "0821234567" });

    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    await screen.findByText("Could not reach the server");

    postMock.mockResolvedValueOnce(baseResponse({ whatsapp_status: "SENT" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
  });

  describe("BUG-0080: on-screen keyboard must close with the dialog, not just the phone field", () => {
    beforeEach(() => {
      setStoredInputMode("touch");
    });

    it("closes the on-screen keyboard (and un-covers the receipt-choice buttons) when a WhatsApp send failure is dismissed via the dialog's own Close button", async () => {
      postMock.mockResolvedValueOnce(
        // Real shape of the documented failure: whatsapp_status FAILED with
        // a plain-language reason (e.g. no whatsapp_phone_number_id
        // configured).
        baseResponse({
          whatsapp_status: "FAILED",
          whatsapp_failure_reason: "Could not send the receipt — business has no whatsapp_phone_number_id configured",
        })
      );

      render(<StatefulHarness />);

      const phoneInput = screen.getByPlaceholderText("082 123 4567");
      fireEvent.change(phoneInput, { target: { value: "0821234567" } });
      fireEvent.focus(phoneInput);

      // The on-screen keyboard is open, driven by the phone field. Queried
      // by its DOM marker (not role/name) because Radix aria-hides
      // everything outside the open modal's own subtree while it's open —
      // a real, accepted, screen-reader-only gap (see TouchKeyboard.tsx's
      // own comment on this) that would otherwise make this presence check
      // brittle even though the keyboard is genuinely on screen and
      // pointer-interactive.
      expect(document.querySelector("[data-touch-keyboard-root]")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Send/ }));
      await screen.findByText("Could not send the receipt — business has no whatsapp_phone_number_id configured");

      // Dismiss the error via the dialog's own top-right Close ("X") button
      // — the exact BUG-0080 repro step, not Cancel/Retry/Edit number.
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      // The dialog is gone...
      await waitFor(() => expect(screen.queryByText("Send receipt via WhatsApp")).not.toBeInTheDocument());
      // ...and, critically, so is the on-screen keyboard: it must not be left
      // pinned to the bottom of the viewport covering the Receipt-choice
      // buttons underneath.
      expect(document.querySelector("[data-touch-keyboard-root]")).not.toBeInTheDocument();

      // The Receipt-choice buttons underneath are reachable again.
      expect(screen.getByRole("button", { name: "New sale" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Both" })).toBeVisible();
      expect(screen.getByRole("button", { name: "No receipt" })).toBeVisible();
    });
  });
});
