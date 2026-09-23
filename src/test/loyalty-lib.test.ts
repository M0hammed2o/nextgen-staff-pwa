import { describe, it, expect, vi, beforeEach } from "vitest";

const getMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

import { lookupLoyaltyCustomer, listLoyaltyRewards, isLoyaltyNotEnabledError } from "@/lib/loyalty";

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

  it("resolves to null (a clean absence) when the backend 409s with LOYALTY_NOT_ENABLED — BUG-0108, the platform entitlement gate", async () => {
    getMock.mockRejectedValue({
      message: "The loyalty module is not enabled for this business",
      status: 409,
      code: "LOYALTY_NOT_ENABLED",
    });
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

  it("re-throws an UNRELATED 409 (no LOYALTY_NOT_ENABLED code/text) rather than guessing it means 'not entitled' — a 409 is used for other conflicts in this app too", async () => {
    const failure = { message: "Till is closed", status: 409, code: "TILL_CLOSED" };
    getMock.mockRejectedValue(failure);
    await expect(lookupLoyaltyCustomer("0821234567")).rejects.toEqual(failure);
  });

  it("re-throws a genuine 500 rather than masking it as absence", async () => {
    const failure = { message: "An unexpected error occurred. Please try again or contact support.", status: 500, code: "INTERNAL_SERVER_ERROR" };
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

describe("isLoyaltyNotEnabledError", () => {
  it("matches on the ApiFetchError.code field", () => {
    expect(isLoyaltyNotEnabledError({ message: "irrelevant", status: 409, code: "LOYALTY_NOT_ENABLED" })).toBe(true);
  });

  it("falls back to matching the message text when code is absent", () => {
    expect(isLoyaltyNotEnabledError({ message: "LOYALTY_NOT_ENABLED: nope", status: 409 })).toBe(true);
  });

  it("does not match an unrelated 409 or a null/undefined error", () => {
    expect(isLoyaltyNotEnabledError({ message: "Till is closed", status: 409, code: "TILL_CLOSED" })).toBe(false);
    expect(isLoyaltyNotEnabledError(null)).toBe(false);
    expect(isLoyaltyNotEnabledError(undefined)).toBe(false);
  });
});

describe("listLoyaltyRewards", () => {
  it("resolves to the reward catalogue on success", async () => {
    const rewards = [{ id: "r1", name: "R30 off", description: null, points_cost: 100, is_active: true, value_cents: 3000 }];
    getMock.mockResolvedValue(rewards);
    await expect(listLoyaltyRewards()).resolves.toEqual(rewards);
    expect(getMock).toHaveBeenCalledWith("/v1/business/loyalty/rewards");
  });

  it("re-throws a 409 LOYALTY_NOT_ENABLED so the caller (LoyaltyRewardPicker) can render a clean absence rather than the catalogue silently claiming success", async () => {
    const failure = { message: "The loyalty module is not enabled for this business", status: 409, code: "LOYALTY_NOT_ENABLED" };
    getMock.mockRejectedValue(failure);
    await expect(listLoyaltyRewards()).rejects.toEqual(failure);
  });

  it("re-throws a genuine 500 unchanged", async () => {
    const failure = { message: "An unexpected error occurred. Please try again or contact support.", status: 500, code: "INTERNAL_SERVER_ERROR" };
    getMock.mockRejectedValue(failure);
    await expect(listLoyaltyRewards()).rejects.toEqual(failure);
  });
});
