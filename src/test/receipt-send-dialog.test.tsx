import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import type { POSReceiptResponse } from "@/types";

const postMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

import ReceiptSendDialog from "@/components/pos/ReceiptSendDialog";

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
});

afterEach(() => {
  cleanup();
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
});
