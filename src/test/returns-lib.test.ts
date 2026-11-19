import { describe, it, expect } from "vitest";
import {
  buildReturnRefundBody, canStartExchange, checkRefundAmount, clampReturnQty, estimateRefundCents, exchangePath,
  parseExchangeParams, returnableQty, validateReturn,
} from "@/lib/returns";
import { friendlyPosError } from "@/lib/pos-errors";
import type { Order, OrderItem } from "@/types";

const item = (over: Partial<OrderItem>): OrderItem => ({
  id: "oi-1", name_snapshot: "Tee", unit_price_cents: 20000, quantity: 3, line_total_cents: 60000,
  options_snapshot: null, add_ons_snapshot: null, selected_options_snapshot: null, removed_ingredients_snapshot: null,
  special_instructions: null, variant_id: "var-m", variant_label_snapshot: "M / Black", returned_quantity: 0, ...over,
});
const order = (items: OrderItem[], over: Partial<Order> = {}): Order =>
  ({
    id: "11111111-1111-4111-8111-111111111111", order_number: "A-0042", source: "POS", payment_status: "PAID",
    items, total_cents: items.reduce((s, i) => s + i.line_total_cents, 0), ...over,
  }) as Order;

describe("return quantity validation", () => {
  it("returnable = sold minus already returned", () => {
    expect(returnableQty(item({ quantity: 3, returned_quantity: 1 }))).toBe(2);
    expect(returnableQty(item({ quantity: 3, returned_quantity: null }))).toBe(3);
    expect(returnableQty(item({ quantity: 3, returned_quantity: 5 }))).toBe(0);
  });

  it("cannot exceed sold minus returned_quantity", () => {
    const o = order([item({ quantity: 3, returned_quantity: 1 })]);
    expect(validateReturn(o, { "oi-1": 2 })).toMatchObject({ ok: true, lines: [{ order_item_id: "oi-1", quantity: 2 }] });
    const bad = validateReturn(o, { "oi-1": 3 });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/only 2 can still be returned/);
  });

  it("requires at least one line, ignores zero lines, rejects fractions", () => {
    const o = order([item({}), item({ id: "oi-2", name_snapshot: "Cap" })]);
    expect(validateReturn(o, {}).ok).toBe(false);
    expect(validateReturn(o, { "oi-1": 0 }).ok).toBe(false);
    expect(validateReturn(o, { "oi-2": 1 }).lines).toEqual([{ order_item_id: "oi-2", quantity: 1 }]);
    expect(validateReturn(o, { "oi-1": 1.5 }).ok).toBe(false);
  });

  it("clamps stepper input into range", () => {
    const i = item({ quantity: 3, returned_quantity: 1 });
    expect(clampReturnQty(i, 9)).toBe(2);
    expect(clampReturnQty(i, -4)).toBe(0);
    expect(clampReturnQty(i, Number.NaN)).toBe(0);
  });
});

describe("refund amount cap", () => {
  it("previews the returned value pro-rated for discount/VAT (total / sum of lines)", () => {
    // 1 of 3 units at R200, order discounted 10%: total 54000 on 60000 of lines
    const o = order([item({})], { total_cents: 54000 });
    expect(estimateRefundCents(o, { "oi-1": 1 })).toBe(18000);
    // returning everything is exactly the order total
    expect(estimateRefundCents(o, { "oi-1": 3 })).toBe(54000);
  });

  it("blank keeps the server default (no amount sent); equal to the estimate also sends none", () => {
    expect(checkRefundAmount(18000, "")).toEqual({ ok: true, error: null });
    expect(checkRefundAmount(18000, "180.00")).toEqual({ ok: true, error: null });
  });

  it("allows lowering, sending the lowered amount in cents", () => {
    expect(checkRefundAmount(18000, "150")).toEqual({ ok: true, amountCents: 15000, error: null });
    expect(checkRefundAmount(18000, "150,50")).toMatchObject({ ok: true, amountCents: 15050 });
  });

  it("refuses raising above the returned value, zero, negative, or junk", () => {
    expect(checkRefundAmount(18000, "180.01").ok).toBe(false);
    expect(checkRefundAmount(18000, "180.01").error).toMatch(/lowered but not raised/);
    expect(checkRefundAmount(18000, "0").ok).toBe(false);
    expect(checkRefundAmount(18000, "-5").ok).toBe(false);
    expect(checkRefundAmount(18000, "abc").ok).toBe(false);
  });

  it("the one-call refund body lists every returned line, the restock flag, and amount only when lowered", () => {
    const lines = [{ order_item_id: "oi-1", quantity: 1 }, { order_item_id: "oi-2", quantity: 2 }];
    expect(buildReturnRefundBody({ reason: " Wrong size ", restoreStock: true, lines })).toEqual({
      reason: "Wrong size", restore_stock: true, return_items: lines,
    });
    expect(buildReturnRefundBody({ reason: "x", restoreStock: false, lines, amountCents: 5000 }).amount_cents).toBe(5000);
  });
});

describe("exchange", () => {
  const refunded = order([item({ returned_quantity: 1 })], { payment_status: "PARTIALLY_REFUNDED" });

  it("is offered only on a refunded POS order that has returned lines", () => {
    expect(canStartExchange(refunded)).toBe(true);
    expect(canStartExchange(order([item({})]))).toBe(false); // still PAID
    expect(canStartExchange({ ...refunded, source: "WHATSAPP" } as Order)).toBe(false);
    expect(canStartExchange({ ...refunded, payment_status: "REFUNDED", items: [item({ returned_quantity: 0 })] } as Order)).toBe(false);
  });

  it("the link carries the original order id and number, and parses back to the exchange_of_order_id payload", () => {
    const path = exchangePath(refunded);
    expect(path.startsWith("/pos?")).toBe(true);
    const parsed = parseExchangeParams(new URLSearchParams(path.split("?")[1]));
    expect(parsed).toEqual({ id: refunded.id, number: "A-0042" });
  });

  it("a malformed exchange id is ignored", () => {
    expect(parseExchangeParams(new URLSearchParams("exchange_of=not-a-uuid"))).toBeNull();
    expect(parseExchangeParams(new URLSearchParams(""))).toBeNull();
  });
});

describe("error code messages", () => {
  it("maps every variant / return / exchange code to a clear message, else falls back", () => {
    for (const code of [
      "VARIANT_REQUIRED", "VARIANT_INACTIVE", "EXCHANGE_ORIGINAL_NOT_REFUNDED",
      "REFUND_EXCEEDS_RETURNED_VALUE", "RETURN_EXCEEDS_SOLD", "RETURN_ITEMS_REQUIRED",
    ]) {
      const msg = friendlyPosError({ code, message: "raw server text" }, "fallback");
      expect(msg).not.toBe("raw server text");
      expect(msg.length).toBeGreaterThan(20);
    }
    expect(friendlyPosError({ code: "OTHER", message: "raw" }, "fb")).toBe("raw");
    expect(friendlyPosError({}, "fb")).toBe("fb");
  });
});
