import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
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
