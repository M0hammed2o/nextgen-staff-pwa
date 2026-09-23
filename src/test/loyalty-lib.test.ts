import { describe, it, expect, vi, beforeEach } from "vitest";

const getMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

import { lookupLoyaltyCustomer } from "@/lib/loyalty";

beforeEach(() => {
  getMock.mockReset();
});

describe("lookupLoyaltyCustomer", () => {
  it("resolves to the customer's balance on success", async () => {
    const response = {
      customer_id: "cust-1",
      display_name: null,
      phone_number: "+27821234567",
      loyalty_points_balance: 50,
      loyalty_tier: "BRONZE",
    };
    getMock.mockResolvedValue(response);
    await expect(lookupLoyaltyCustomer("0821234567")).resolves.toEqual(response);
  });

  it("resolves to null (a clean absence) when the backend 404s — loyalty not enabled", async () => {
    getMock.mockRejectedValue({ message: "LoyaltyProgram not found", status: 404 });
    await expect(lookupLoyaltyCustomer("0821234567")).resolves.toBeNull();
  });

  it("re-throws a non-404 failure rather than silently treating it as 'no loyalty' — a real outage must never look like an absent feature", async () => {
    const failure = { message: "Could not reach the server", status: 0, noResponse: true };
    getMock.mockRejectedValue(failure);
    await expect(lookupLoyaltyCustomer("0821234567")).rejects.toEqual(failure);
  });

  it("re-throws a 422 (e.g. an unparseable number) rather than masking it as absence", async () => {
    const failure = { message: "Enter a valid South African mobile number", status: 422 };
    getMock.mockRejectedValue(failure);
    await expect(lookupLoyaltyCustomer("0821234567")).rejects.toEqual(failure);
  });

  it("URL-encodes the phone number in the query string", async () => {
    getMock.mockResolvedValue({
      customer_id: "cust-1",
      display_name: null,
      phone_number: null,
      loyalty_points_balance: 0,
      loyalty_tier: "BRONZE",
    });
    await lookupLoyaltyCustomer("+27 82 123 4567");
    expect(getMock).toHaveBeenCalledWith(
      `/v1/business/loyalty/customers/lookup?phone=${encodeURIComponent("+27 82 123 4567")}`
    );
  });
});
