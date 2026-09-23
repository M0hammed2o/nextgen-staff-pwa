import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * LoyaltyBalance.tsx — the till's loyalty-points display, wired to
 * CartPanel's existing "Phone (for loyalty)" field. Reward SELECTION now
 * lives in the sibling LoyaltyRewardPicker.tsx (see
 * loyalty-reward-picker.test.tsx and pos-loyalty-checkout.test.tsx for its
 * coverage; KNOWN_BUGS.md BUG-0104 for the backend value_cents-exposure fix
 * that unblocked it — corrected 2026-09-23; this docstring previously
 * cited the wrong bug number, BUG-0102, which documents an unrelated
 * order-number-sequence defect). This file's own tests stay scoped to the
 * two real hazards LoyaltyBalance.tsx itself owns:
 *   1. The lookup CREATES a customer as a side effect — it must never fire
 *      for a phone number the cashier hasn't finished typing.
 *   2. A 404 (loyalty not enabled for this business) must be a silent,
 *      clean absence, distinct from a genuine failure (network/5xx), which
 *      must still be visibly reported rather than swallowed.
 */

const getMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

import LoyaltyBalance from "@/components/pos/LoyaltyBalance";

const BALANCE_RESPONSE = {
  customer_id: "cust-1",
  display_name: "Thabo",
  phone_number: "+27821234567",
  loyalty_points_balance: 120,
  loyalty_tier: "SILVER",
};

function renderBalance(phone: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <LoyaltyBalance phone={phone} />
      </QueryClientProvider>
    ),
  };
}

function rerenderBalance(
  rerender: (ui: ReactElement) => void,
  queryClient: QueryClient,
  phone: string
) {
  rerender(
    <QueryClientProvider client={queryClient}>
      <LoyaltyBalance phone={phone} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  getMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoyaltyBalance — never looks up an unfinished number", () => {
  it("does not call the lookup endpoint for an obviously incomplete phone number", async () => {
    renderBalance("082");
    // Wait comfortably past the component's own debounce window (500ms).
    await new Promise((r) => setTimeout(r, 700));
    expect(getMock).not.toHaveBeenCalled();
  });

  it("renders nothing for an incomplete number rather than an empty loading/error state", async () => {
    const { container } = renderBalance("08212");
    await new Promise((r) => setTimeout(r, 700));
    expect(container.textContent).toBe("");
  });

  it("only calls the lookup once after rapid typing settles, using the final value — never per keystroke", async () => {
    getMock.mockResolvedValue(BALANCE_RESPONSE);
    const { rerender, queryClient } = renderBalance("0");
    const partials = ["08", "082", "0821", "08212", "082123", "0821234", "08212345", "082123456", "0821234567"];
    for (const partial of partials) {
      rerenderBalance(rerender, queryClient, partial);
      // Faster than the 500ms debounce — simulates a cashier still typing.
      await new Promise((r) => setTimeout(r, 20));
    }
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining("0821234567"));
  });
});

describe("LoyaltyBalance — 404 (loyalty not enabled) is a clean absence, not an error", () => {
  it("shows nothing, and no error text, when the lookup 404s", async () => {
    getMock.mockRejectedValue({ message: "LoyaltyProgram not found", status: 404 });
    const { container } = renderBalance("0821234567");
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByText(/Couldn't check/)).not.toBeInTheDocument();
  });
});

describe("LoyaltyBalance — a genuine failure is reported, not silently swallowed", () => {
  it("shows an error message for a non-404 failure (network/5xx)", async () => {
    getMock.mockRejectedValue({ message: "Could not reach the server", status: 0, noResponse: true });
    renderBalance("0821234567");
    await screen.findByText("Couldn't check loyalty balance.");
  });
});

describe("LoyaltyBalance — happy path", () => {
  it("shows points balance, tier and the customer's name once resolved", async () => {
    getMock.mockResolvedValue(BALANCE_RESPONSE);
    renderBalance("0821234567");
    await screen.findByText("120 pts · SILVER · Thabo");
  });

  it("calls the lookup endpoint with the phone number in the query string", async () => {
    getMock.mockResolvedValue(BALANCE_RESPONSE);
    renderBalance("0821234567");
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    expect(getMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/v1\/business\/loyalty\/customers\/lookup\?phone=/)
    );
  });
});
