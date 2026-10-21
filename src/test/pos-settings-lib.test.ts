import { describe, it, expect } from "vitest";
import { landingPath, isPosNotEnabledError } from "@/lib/pos-settings";
import type { POSSettings } from "@/types";

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
  receipt_paper_width_mm: 58,
  receipt_auto_print: false,
  receipt_copies: 1,
  print_kitchen_receipt: false,
  inventory_enabled: false,
  digital_receipts_enabled: false,
  loyalty_enabled: false,
  staff_live_orders_tab_enabled: true,
  staff_wastage_tab_enabled: false,
  staff_stocktake_tab_enabled: false,
};

describe("landingPath", () => {
  it("returns null while settings have not arrived yet (caller waits, never guesses)", () => {
    expect(landingPath(null)).toBeNull();
    expect(landingPath(undefined)).toBeNull();
  });

  it("lands on Live Orders when the tab is enabled — existing, unchanged behaviour", () => {
    expect(landingPath({ ...BASE_SETTINGS, staff_live_orders_tab_enabled: true })).toBe("/");
  });

  it("falls back to /pos when Live Orders is off and pos_enabled is absent (older/cached response) — unchanged default", () => {
    expect(landingPath({ ...BASE_SETTINGS, staff_live_orders_tab_enabled: false })).toBe("/pos");
  });

  it("falls back to /pos when Live Orders is off and pos_enabled is explicitly true — unchanged for a normal POS tenant", () => {
    expect(landingPath({ ...BASE_SETTINGS, staff_live_orders_tab_enabled: false, pos_enabled: true })).toBe("/pos");
  });

  it("falls back to Live Orders instead of /pos when pos_enabled is false (WhatsApp-only subscription), even if the live-orders tab flag is also off", () => {
    expect(landingPath({ ...BASE_SETTINGS, staff_live_orders_tab_enabled: false, pos_enabled: false })).toBe("/");
  });
});

describe("isPosNotEnabledError", () => {
  it("matches on the ApiFetchError.code field", () => {
    expect(isPosNotEnabledError({ message: "irrelevant", status: 409, code: "POS_NOT_ENABLED" })).toBe(true);
  });

  it("falls back to matching the message text when code is absent", () => {
    expect(isPosNotEnabledError({ message: "POS_NOT_ENABLED: nope", status: 409 })).toBe(true);
  });

  it("does not match an unrelated 409 or a null/undefined error", () => {
    expect(isPosNotEnabledError({ message: "Till is closed", status: 409, code: "TILL_CLOSED" })).toBe(false);
    expect(isPosNotEnabledError(null)).toBe(false);
    expect(isPosNotEnabledError(undefined)).toBe(false);
  });
});
