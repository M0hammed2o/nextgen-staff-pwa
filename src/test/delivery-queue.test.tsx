import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Delivery orders waiting on staff (Uber Eats) — the "one kitchen queue"
 * gap: pending delivery orders used to be visible only to owners/managers.
 * Staff may accept a ready order, decline, or retry an unconfirmed accept;
 * an order with unmatched items can never be accepted here (a manager maps
 * it first), and nothing is shown or fetched for a tenant without the
 * delivery module.
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
  useAuth: () => ({ isAuthenticated: true }),
}));

import DeliveryQueue from "@/components/DeliveryQueue";
import { deadlineInfo, marketplaceLabel } from "@/lib/delivery";

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

function queueItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "dq-1",
    provider: "UBER_EATS",
    provider_label: "Uber Eats",
    display_id: "BC953",
    status: "READY_TO_ACCEPT",
    placed_at: new Date().toISOString(),
    accept_deadline_at: inMinutes(8),
    customer_first_name: "Larry",
    special_instructions: null,
    lines: [
      { title: "Fresh-baked muffin", quantity: 2, special_instructions: null,
        modifiers: [{ title: "Sugar", quantity: null, removed: true }] },
    ],
    unresolved: [],
    can_accept: true,
    can_deny: true,
    can_retry_accept: false,
    waiting_for_manager: false,
    message: null,
    ...overrides,
  };
}

function setup({ deliveryEnabled = true, queue = [queueItem()] } = {}) {
  getMock.mockImplementation((path: string) => {
    if (path === "/v1/business/pos/settings") {
      return Promise.resolve({ delivery_platforms_enabled: deliveryEnabled });
    }
    if (path === "/v1/business/delivery/queue") return Promise.resolve(queue);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DeliveryQueue />
    </QueryClientProvider>,
  );
}

describe("DeliveryQueue", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    postMock.mockResolvedValue({});
  });
  afterEach(cleanup);

  it("shows what was ordered, including removed ingredients, and lets staff accept a ready order", async () => {
    setup();
    expect(await screen.findByText("Uber Eats #BC953")).toBeInTheDocument();
    expect(screen.getByText(/2x Fresh-baked muffin/)).toBeInTheDocument();
    expect(screen.getByText(/no Sugar/)).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent(/left to accept/);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/v1/business/delivery/orders/dq-1/accept"),
    );
  });

  it("never offers Accept for an order with items a manager has not mapped", async () => {
    setup({
      queue: [queueItem({
        status: "NEEDS_MAPPING", can_accept: false, waiting_for_manager: true,
        unresolved: ["Secret Burger"],
        message: "A manager must match these items to your menu before this order can be accepted.",
      })],
    });
    expect(await screen.findByText(/A manager must match these items/)).toBeInTheDocument();
    expect(screen.getByText("Not yet on your menu: Secret Burger")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("declines with a plain-language reason mapped to the platform's code", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    fireEvent.click(screen.getByRole("button", { name: "Too busy right now" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/v1/business/delivery/orders/dq-1/deny", { reason_code: "CAPACITY" },
      ),
    );
  });

  it("offers a retry, not an accept, when the platform never confirmed the accept", async () => {
    setup({
      queue: [queueItem({
        status: "ACCEPT_UNCONFIRMED", can_accept: false, can_deny: false, can_retry_accept: true,
        message: "In the kitchen, but the delivery platform has not confirmed it.",
      })],
    });
    fireEvent.click(await screen.findByRole("button", { name: "Retry with Uber Eats" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/v1/business/delivery/orders/dq-1/retry-accept"),
    );
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("shows the server's reason when an action fails", async () => {
    postMock.mockRejectedValueOnce({ message: "This order is DENIED — nothing to manually accept.", status: 409 });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nothing to manually accept");
  });

  it("renders nothing and never calls the queue endpoint without the delivery module", async () => {
    setup({ deliveryEnabled: false });
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/v1/business/pos/settings"));
    expect(getMock).not.toHaveBeenCalledWith("/v1/business/delivery/queue");
    expect(screen.queryByText(/Delivery orders waiting/)).not.toBeInTheDocument();
  });
});

describe("delivery helpers", () => {
  it("counts down and turns urgent inside the last two minutes", () => {
    const now = Date.parse("2026-10-26T18:00:00Z");
    expect(deadlineInfo("2026-10-26T18:05:07Z", now)).toEqual({ label: "5:07 left to accept", urgent: false, passed: false });
    expect(deadlineInfo("2026-10-26T18:01:30Z", now)?.urgent).toBe(true);
    expect(deadlineInfo("2026-10-26T17:59:00Z", now)?.passed).toBe(true);
    expect(deadlineInfo(null, now)).toBeNull();
  });

  it("labels marketplace orders for the kitchen and leaves in-store orders alone", () => {
    expect(marketplaceLabel("UBER_EATS")).toBe("Uber Eats");
    expect(marketplaceLabel("MR_D")).toBe("Mr D");
    expect(marketplaceLabel("POS")).toBeNull();
  });
});
