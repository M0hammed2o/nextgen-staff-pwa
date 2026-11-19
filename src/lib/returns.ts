/**
 * Returns / exchange helpers for a paid POS order.
 *
 * The server is the authority (it pro-rates for order discount, loyalty and
 * exclusive VAT, and enforces both caps). This module only previews and
 * pre-validates so staff get an instant, clear answer; it never sends an
 * amount higher than the server's default and omits `amount_cents` entirely
 * unless staff deliberately lowered it.
 */
import type { Order, OrderItem } from "@/types";

export type ReturnQuantities = Record<string, number>;

/** Units of a line that can still come back: sold minus already returned. */
export function returnableQty(item: Pick<OrderItem, "quantity" | "returned_quantity">): number {
  return Math.max(0, item.quantity - (item.returned_quantity ?? 0));
}

export function isVariantLine(item: Pick<OrderItem, "variant_id" | "variant_label_snapshot" | "sku_snapshot">): boolean {
  return !!(item.variant_id || item.variant_label_snapshot || item.sku_snapshot);
}

/** Clamp a requested quantity into [0, returnable]. */
export function clampReturnQty(item: OrderItem, wanted: number): number {
  if (!Number.isFinite(wanted)) return 0;
  return Math.min(returnableQty(item), Math.max(0, Math.floor(wanted)));
}

export interface ReturnValidation {
  ok: boolean;
  error: string | null;
  lines: { order_item_id: string; quantity: number }[];
}

/** Every selected quantity must be 1..returnable; at least one line must be selected. */
export function validateReturn(order: Pick<Order, "items">, qty: ReturnQuantities): ReturnValidation {
  const lines: { order_item_id: string; quantity: number }[] = [];
  for (const item of order.items) {
    const q = qty[item.id] ?? 0;
    if (!q) continue;
    if (!Number.isInteger(q) || q < 0) {
      return { ok: false, error: `Quantity for ${item.name_snapshot} is not valid.`, lines: [] };
    }
    if (q > returnableQty(item)) {
      return {
        ok: false,
        error: `${item.name_snapshot}: only ${returnableQty(item)} can still be returned (sold ${item.quantity}, already returned ${item.returned_quantity ?? 0}).`,
        lines: [],
      };
    }
    lines.push({ order_item_id: item.id, quantity: q });
  }
  if (lines.length === 0) return { ok: false, error: "Choose at least one item to return.", lines: [] };
  return { ok: true, error: null, lines };
}

/**
 * Preview of the refund the server will default to: returned units' value,
 * scaled by total/sum(lines) so order discount, loyalty and exclusive VAT are
 * carried the same way the server pro-rates them. Preview only.
 */
export function estimateRefundCents(order: Pick<Order, "items" | "total_cents">, qty: ReturnQuantities): number {
  const gross = order.items.reduce((s, i) => s + i.line_total_cents, 0);
  if (gross <= 0) return 0;
  let returned = 0;
  for (const i of order.items) {
    const q = qty[i.id] ?? 0;
    if (q > 0 && i.quantity > 0) returned += (i.line_total_cents / i.quantity) * q;
  }
  const full = order.items.every((i) => (qty[i.id] ?? 0) >= returnableQty(i) && returnableQty(i) === i.quantity);
  if (full) return order.total_cents;
  return Math.min(order.total_cents, Math.round((returned * order.total_cents) / gross));
}

export interface RefundAmountCheck {
  ok: boolean;
  /** amount to send, or undefined to let the server use its default */
  amountCents?: number;
  error: string | null;
}

/**
 * `input` is the rand string staff typed ("" = keep the default). A refund may
 * only be LOWER than the computed value, never higher.
 */
export function checkRefundAmount(estimateCents: number, input: string): RefundAmountCheck {
  const raw = input.trim().replace(",", ".");
  if (raw === "") return { ok: true, error: null };
  const rand = Number(raw);
  if (!Number.isFinite(rand) || rand <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  const cents = Math.round(rand * 100);
  if (cents > estimateCents) {
    return { ok: false, error: "The refund can be lowered but not raised above the value of the returned items." };
  }
  if (cents === estimateCents) return { ok: true, error: null };
  return { ok: true, amountCents: cents, error: null };
}

export interface RefundBody {
  reason: string;
  restore_stock: boolean;
  return_items: { order_item_id: string; quantity: number }[];
  amount_cents?: number;
}

export function buildReturnRefundBody(args: {
  reason: string;
  restoreStock: boolean;
  lines: { order_item_id: string; quantity: number }[];
  amountCents?: number;
}): RefundBody {
  const body: RefundBody = {
    reason: args.reason.trim(),
    restore_stock: args.restoreStock,
    return_items: args.lines,
  };
  if (args.amountCents !== undefined) body.amount_cents = args.amountCents;
  return body;
}

/** An order can be exchanged against once it has been refunded with returned lines. */
export function canStartExchange(order: Pick<Order, "source" | "payment_status" | "items">): boolean {
  return (
    order.source === "POS" &&
    (order.payment_status === "REFUNDED" || order.payment_status === "PARTIALLY_REFUNDED") &&
    order.items.some((i) => (i.returned_quantity ?? 0) > 0)
  );
}

export function exchangePath(order: Pick<Order, "id" | "order_number">): string {
  const p = new URLSearchParams({ exchange_of: order.id, exchange_no: order.order_number });
  return `/pos?${p.toString()}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseExchangeParams(params: URLSearchParams): { id: string; number: string } | null {
  const id = params.get("exchange_of");
  if (!id || !UUID_RE.test(id)) return null;
  const number = (params.get("exchange_no") ?? "").slice(0, 40);
  return { id, number };
}
