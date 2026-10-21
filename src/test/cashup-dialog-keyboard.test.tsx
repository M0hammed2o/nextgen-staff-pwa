import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import { setStoredInputMode } from "@/lib/touch-input";
import TouchKeyboard from "@/components/TouchKeyboard";

/**
 * Regression guard (BUG-0080 fix): CashupDialog's till-float-entry field is
 * the ALREADY-WORKING reference pattern ReceiptSendDialog.tsx now matches
 * (handleDialogClose() explicitly calling the shared touch keyboard's
 * close() before onClose(), so every exit path — Done button, the dialog's
 * own X/Escape/outside-click via onOpenChange, and a successful
 * open/close-till submission — closes the keyboard together with the
 * dialog, not just whichever field happens to unmount). This test proves
 * that pattern still holds after the ReceiptSendDialog fix, so the shared
 * touch-keyboard system is not regressed for any other dialog.
 */

const getMock = vi.fn();
const postMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: null, staff_name: "Owner", role: "OWNER", business_id: "biz-1", business_name: "Ciao Pizza" },
  }),
}));

// The real <Toaster/> is mounted once at the app root (src/App.tsx) — its
// Radix portal/animation lifecycle isn't what these tests are about, and
// asserting through it would make them a test of Radix's jsdom animation
// timing rather than of CashupDialog. Mocking useToast lets the tests assert
// CashupDialog actually asked for a success toast without depending on it.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import CashupDialog from "@/components/pos/CashupDialog";

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/pos"]}>
        <TouchKeyboardProvider>
          <CashupDialog open onClose={vi.fn()} />
          <TouchKeyboard />
        </TouchKeyboardProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Stateful wrapper so `onClose` actually flips the dialog's own `open` prop
 * to false (a bare `vi.fn()` onClose never exercises the real close path a
 * cashier's tap goes through) — needed to prove the till-open success path
 * genuinely dismisses the dialog, not just that `onClose` was called, the
 * same pattern already used in receipt-send-dialog.test.tsx for BUG-0080.
 */
function renderStatefulDialog(onCloseSpy: () => void = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <CashupDialog
        open={open}
        onClose={() => {
          onCloseSpy();
          setOpen(false);
        }}
      />
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/pos"]}>
        <TouchKeyboardProvider>
          <Harness />
          <TouchKeyboard />
        </TouchKeyboardProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  toastMock.mockReset();
  localStorage.clear();
  setStoredInputMode("touch");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CashupDialog on-screen keyboard lifecycle (regression guard)", () => {
  it("closes the on-screen keyboard when its own Done button dismisses the dialog", async () => {
    getMock.mockResolvedValue(null); // no till open yet -> "Open the till" form
    renderDialog();

    const floatInput = await screen.findByLabelText("Opening float (R)");
    fireEvent.focus(floatInput);
    expect(document.querySelector("[data-touch-keyboard-root]")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(document.querySelector("[data-touch-keyboard-root]")).not.toBeInTheDocument();
  });
});

/**
 * Regression guard for the reported defect: a successful till-open must
 * dismiss CashupDialog itself rather than leaving it sitting on top of the
 * menu grid re-rendered as "Close the till — ask a manager or owner to
 * close it". A failed open must do the opposite — stay open, keep the
 * typed float, and show the error — and a fast double-click/tap must only
 * ever fire one POST /till/open.
 */
describe("CashupDialog till-open success/failure/double-click", () => {
  it("touch mode: dismisses the dialog, invalidates till state, shows a success toast, and closes the on-screen keyboard on a successful open", async () => {
    getMock.mockResolvedValue(null); // "Open the till" form
    postMock.mockResolvedValue({
      id: "till-1",
      opening_float_cents: 50000,
      opened_at: new Date().toISOString(),
    });
    const onClose = vi.fn();
    renderStatefulDialog(onClose);

    const floatInput = await screen.findByLabelText("Opening float (R)");
    fireEvent.focus(floatInput);
    expect(document.querySelector("[data-touch-keyboard-root]")).toBeInTheDocument();

    fireEvent.change(floatInput, { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Open till" }));

    // The dialog dismisses itself — the cashier does not have to close it by
    // hand — leaving the POS underneath immediately usable.
    await waitFor(() => expect(screen.queryByText("Open the till")).not.toBeInTheDocument());
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith("/v1/business/pos/till/open", { opening_float_cents: 50000 });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Till opened" }));
    // Every exit path (including a successful-open dismissal) must close the
    // on-screen keyboard — see BUG-0080.
    expect(document.querySelector("[data-touch-keyboard-root]")).not.toBeInTheDocument();
  });

  it("keyboard/mouse mode: dismisses the dialog and shows success feedback on a successful open", async () => {
    setStoredInputMode("keyboard");
    getMock.mockResolvedValue(null);
    postMock.mockResolvedValue({
      id: "till-1",
      opening_float_cents: 20000,
      opened_at: new Date().toISOString(),
    });
    const onClose = vi.fn();
    renderStatefulDialog(onClose);

    const floatInput = await screen.findByLabelText("Opening float (R)");
    fireEvent.change(floatInput, { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Open till" }));

    await waitFor(() => expect(screen.queryByText("Open the till")).not.toBeInTheDocument());
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Till opened" }));
  });

  it("keeps the dialog open, keeps the typed float, and shows the error when the open request fails", async () => {
    getMock.mockResolvedValue(null);
    postMock.mockRejectedValue({ message: "Till already open", status: 409, code: "TILL_ALREADY_OPEN" });
    const onClose = vi.fn();
    renderStatefulDialog(onClose);

    const floatInput = await screen.findByLabelText("Opening float (R)");
    fireEvent.focus(floatInput); // opens the on-screen keyboard, touch mode from beforeEach
    fireEvent.change(floatInput, { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Open till" }));

    await screen.findByText("Till already open");
    // The dialog is still showing the open form, not dismissed.
    expect(onClose).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
    // The typed float was not silently lost.
    expect((screen.getByLabelText("Opening float (R)") as HTMLInputElement).value).toBe("500");
    // The form is still in use, so the on-screen keyboard must stay open —
    // only a real exit path (Done, or a successful open) closes it.
    expect(document.querySelector("[data-touch-keyboard-root]")).toBeInTheDocument();
  });

  it("shows the honest 'POS is not available' message, not the backend's raw 409 text, when a WhatsApp-only tenant's staff opens this dialog by URL", async () => {
    getMock.mockResolvedValue(null);
    postMock.mockRejectedValue({ message: "POS is not enabled for this business.", status: 409, code: "POS_NOT_ENABLED" });
    const onClose = vi.fn();
    renderStatefulDialog(onClose);

    const floatInput = await screen.findByLabelText("Opening float (R)");
    fireEvent.change(floatInput, { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Open till" }));

    await screen.findByText("POS is not available for this restaurant");
    expect(screen.queryByText("POS is not enabled for this business.")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a fast double-click on Open till only fires one POST request", async () => {
    getMock.mockResolvedValue(null);
    let resolvePost: (v: unknown) => void = () => {};
    postMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      })
    );
    renderDialog();

    const floatInput = await screen.findByLabelText("Opening float (R)");
    fireEvent.change(floatInput, { target: { value: "500" } });
    const openButton = screen.getByRole("button", { name: "Open till" });
    fireEvent.click(openButton);
    fireEvent.click(openButton); // fast second click before the first request settles

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));

    resolvePost({ id: "till-1", opening_float_cents: 50000, opened_at: new Date().toISOString() });
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    // Still exactly one request after the mutation fully settles — the
    // second click never queued a second request behind the first.
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
