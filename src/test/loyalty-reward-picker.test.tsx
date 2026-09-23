import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * LoyaltyRewardPicker.tsx — the till's reward SELECTION UI (companion to
 * LoyaltyBalance.tsx, which owns the plain balance/tier text). These tests
 * cover the filtering rules from the component's own docstring: exactly
 * which rewards a cashier may pick, and why a disabled one is disabled —
 * never letting a cashier select a reward the backend would refuse.
 */

const getMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

import LoyaltyRewardPicker from "@/components/pos/LoyaltyRewardPicker";
import type { LoyaltyRewardResponse } from "@/types";

const CUSTOMER = {
  customer_id: "cust-1",
  display_name: "Thabo",
  phone_number: "+27821234567",
  loyalty_points_balance: 150,
  loyalty_tier: "SILVER",
};

const REWARD_AFFORDABLE: LoyaltyRewardResponse = {
  id: "reward-affordable",
  name: "R30 off",
  description: null,
  points_cost: 100,
  is_active: true,
  value_cents: 3000,
};

const REWARD_INSUFFICIENT_POINTS: LoyaltyRewardResponse = {
  id: "reward-expensive",
  name: "Free feast",
  description: null,
  points_cost: 10000,
  is_active: true,
  value_cents: 5000,
};

const REWARD_NULL_VALUE: LoyaltyRewardResponse = {
  id: "reward-manual-only",
  name: "Birthday voucher",
  description: null,
  points_cost: 50,
  is_active: true,
  value_cents: null,
};

const REWARD_ZERO_VALUE: LoyaltyRewardResponse = {
  id: "reward-zero",
  name: "Zero value",
  description: null,
  points_cost: 10,
  is_active: true,
  value_cents: 0,
};

const REWARD_INACTIVE: LoyaltyRewardResponse = {
  id: "reward-inactive",
  name: "Retired reward",
  description: null,
  points_cost: 10,
  is_active: false,
  value_cents: 1000,
};

const REWARD_TOO_HIGH: LoyaltyRewardResponse = {
  id: "reward-too-high",
  name: "R500 off",
  description: null,
  points_cost: 20,
  is_active: true,
  value_cents: 50000,
};

function installApiMock(rewards: LoyaltyRewardResponse[]) {
  getMock.mockImplementation((path: string) => {
    if (path.startsWith("/v1/business/loyalty/customers/lookup")) return Promise.resolve(CUSTOMER);
    if (path === "/v1/business/loyalty/rewards") return Promise.resolve(rewards);
    return Promise.reject(new Error(`Unmocked GET ${path}`));
  });
}

function renderPicker(
  rewards: LoyaltyRewardResponse[],
  overrides: { subtotalCents?: number; discountCents?: number; selectedReward?: LoyaltyRewardResponse | null } = {}
) {
  installApiMock(rewards);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSelect = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <LoyaltyRewardPicker
        phone="0821234567"
        subtotalCents={overrides.subtotalCents ?? 10000}
        discountCents={overrides.discountCents ?? 0}
        selectedReward={overrides.selectedReward ?? null}
        onSelect={onSelect}
      />
    </QueryClientProvider>
  );
  return { ...utils, onSelect };
}

beforeEach(() => {
  getMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoyaltyRewardPicker — sufficient points, affordable value", () => {
  it("offers a reward the customer can afford and this cart can absorb, as selectable", async () => {
    renderPicker([REWARD_AFFORDABLE]);
    const button = await screen.findByTestId(`loyalty-reward-${REWARD_AFFORDABLE.id}`);
    expect(button).not.toBeDisabled();
    expect(screen.getByText(/worth R ?30\.00/)).toBeInTheDocument();
  });

  it("calls onSelect with the reward when tapped, and with null when tapped again (deselect)", async () => {
    const { onSelect, rerender } = renderPicker([REWARD_AFFORDABLE]);
    const button = await screen.findByTestId(`loyalty-reward-${REWARD_AFFORDABLE.id}`);
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(REWARD_AFFORDABLE);

    // Re-render as if the parent had applied the selection, then tap again.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <LoyaltyRewardPicker
          phone="0821234567"
          subtotalCents={10000}
          discountCents={0}
          selectedReward={REWARD_AFFORDABLE}
          onSelect={onSelect}
        />
      </QueryClientProvider>
    );
    const selectedButton = await screen.findByTestId(`loyalty-reward-${REWARD_AFFORDABLE.id}`);
    fireEvent.click(selectedButton);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe("LoyaltyRewardPicker — insufficient points", () => {
  it("disables a reward the customer cannot afford in points, with a reason", async () => {
    renderPicker([REWARD_INSUFFICIENT_POINTS]);
    const button = await screen.findByTestId(`loyalty-reward-${REWARD_INSUFFICIENT_POINTS.id}`);
    expect(button).toBeDisabled();
    expect(screen.getByText("Not enough points")).toBeInTheDocument();
  });
});

describe("LoyaltyRewardPicker — inactive reward", () => {
  it("disables a reward flagged is_active=false, with a reason (defensive — the backend already excludes these)", async () => {
    renderPicker([REWARD_INACTIVE]);
    const button = await screen.findByTestId(`loyalty-reward-${REWARD_INACTIVE.id}`);
    expect(button).toBeDisabled();
    expect(screen.getByText("No longer available")).toBeInTheDocument();
  });
});

describe("LoyaltyRewardPicker — zero/null-value reward", () => {
  it("disables a reward with value_cents null (manual-handover-only)", async () => {
    renderPicker([REWARD_NULL_VALUE]);
    const button = await screen.findByTestId(`loyalty-reward-${REWARD_NULL_VALUE.id}`);
    expect(button).toBeDisabled();
    expect(screen.getByText("Not redeemable at the till")).toBeInTheDocument();
  });

  it("disables a reward with value_cents 0", async () => {
    renderPicker([REWARD_ZERO_VALUE]);
    const button = await screen.findByTestId(`loyalty-reward-${REWARD_ZERO_VALUE.id}`);
    expect(button).toBeDisabled();
    expect(screen.getByText("Not redeemable at the till")).toBeInTheDocument();
  });
});

describe("LoyaltyRewardPicker — reward worth more than the cart total", () => {
  it("disables a reward whose value_cents exceeds what this cart can absorb, with a reason", async () => {
    renderPicker([REWARD_TOO_HIGH], { subtotalCents: 10000, discountCents: 0 });
    const button = await screen.findByTestId(`loyalty-reward-${REWARD_TOO_HIGH.id}`);
    expect(button).toBeDisabled();
    expect(screen.getByText("Too high for this order")).toBeInTheDocument();
  });

  it("accounts for an already-entered staff discount when computing what the cart can absorb", async () => {
    // subtotal 10000, staff discount 9600 -> only 400 cents left to absorb;
    // REWARD_AFFORDABLE's value_cents (3000) no longer fits.
    renderPicker([REWARD_AFFORDABLE], { subtotalCents: 10000, discountCents: 9600 });
    const button = await screen.findByTestId(`loyalty-reward-${REWARD_AFFORDABLE.id}`);
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByText("Too high for this order")).toBeInTheDocument();
  });
});

describe("LoyaltyRewardPicker — no rewards / loading / error states", () => {
  it("shows an empty-state message when the business has no rewards configured", async () => {
    renderPicker([]);
    await screen.findByText("No rewards set up for this business yet.");
  });

  it("renders nothing for an incomplete phone number (same gate as LoyaltyBalance)", async () => {
    installApiMock([REWARD_AFFORDABLE]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <LoyaltyRewardPicker phone="082" subtotalCents={10000} discountCents={0} selectedReward={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    );
    await new Promise((r) => setTimeout(r, 700));
    expect(container.textContent).toBe("");
    expect(getMock).not.toHaveBeenCalled();
  });

  it("shows nothing when the customer lookup 404s (loyalty not enabled for this business)", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/v1/business/loyalty/customers/lookup")) {
        return Promise.reject({ message: "LoyaltyProgram not found", status: 404 });
      }
      return Promise.reject(new Error(`Unmocked GET ${path}`));
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <LoyaltyRewardPicker phone="0821234567" subtotalCents={10000} discountCents={0} selectedReward={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("shows nothing when the customer lookup 409s with LOYALTY_NOT_ENABLED (the platform entitlement gate, BUG-0108) — no error text, and the rewards endpoint is never called", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/v1/business/loyalty/customers/lookup")) {
        return Promise.reject({
          message: "The loyalty module is not enabled for this business",
          status: 409,
          code: "LOYALTY_NOT_ENABLED",
        });
      }
      return Promise.reject(new Error(`Unmocked GET ${path}`));
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <LoyaltyRewardPicker phone="0821234567" subtotalCents={10000} discountCents={0} selectedReward={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(""));
    expect(getMock).toHaveBeenCalledTimes(1); // only the customer lookup — /rewards never fires
  });

  it("shows nothing (not 'Couldn't load rewards.') when the customer lookup succeeds but the rewards fetch itself 409s with LOYALTY_NOT_ENABLED — a rare mid-session entitlement-revocation race, still a clean absence not an error", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/v1/business/loyalty/customers/lookup")) return Promise.resolve(CUSTOMER);
      if (path === "/v1/business/loyalty/rewards") {
        return Promise.reject({
          message: "The loyalty module is not enabled for this business",
          status: 409,
          code: "LOYALTY_NOT_ENABLED",
        });
      }
      return Promise.reject(new Error(`Unmocked GET ${path}`));
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <LoyaltyRewardPicker phone="0821234567" subtotalCents={10000} discountCents={0} selectedReward={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByText("Couldn't load rewards.")).not.toBeInTheDocument();
  });

  it("shows 'Couldn't load rewards.' when the rewards fetch fails with an unrelated error (genuine failure, not entitlement)", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/v1/business/loyalty/customers/lookup")) return Promise.resolve(CUSTOMER);
      if (path === "/v1/business/loyalty/rewards") {
        return Promise.reject({ message: "An unexpected error occurred. Please try again or contact support.", status: 500, code: "INTERNAL_SERVER_ERROR" });
      }
      return Promise.reject(new Error(`Unmocked GET ${path}`));
    });
    renderPickerRaw();
    await screen.findByText("Couldn't load rewards.");
  });
});

function renderPickerRaw() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LoyaltyRewardPicker phone="0821234567" subtotalCents={10000} discountCents={0} selectedReward={null} onSelect={vi.fn()} />
    </QueryClientProvider>
  );
}
