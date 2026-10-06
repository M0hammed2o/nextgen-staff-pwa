import { Minus, Plus, Trash2 } from "lucide-react";
import type { CartLine, LoyaltyRewardResponse, POSSettings } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useTouchField } from "@/hooks/useTouchField";
import LoyaltyBalance from "./LoyaltyBalance";
import LoyaltyRewardPicker, { previewLoyaltyDiscountCents } from "./LoyaltyRewardPicker";

export type OrderMode = "PICKUP" | "DELIVERY" | "DINE_IN";

function lineTotalCents(line: CartLine): number {
  const optionAdjustment = line.selectedOptionsDisplay.reduce((sum, o) => sum + o.priceDeltaCents, 0);
  const addOnTotal = line.addOnSelections.reduce((sum, a) => sum + a.priceCents * a.quantity, 0);
  const unitPrice = Math.max(0, line.basePriceCents + optionAdjustment + addOnTotal);
  return unitPrice * line.quantity;
}

const ORDER_MODES: { value: OrderMode; label: string }[] = [
  { value: "PICKUP", label: "Takeaway" },
  { value: "DINE_IN", label: "Dine-in" },
  { value: "DELIVERY", label: "Delivery" },
];

interface Props {
  lines: CartLine[];
  onUpdateQty: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  orderMode: OrderMode;
  onOrderModeChange: (mode: OrderMode) => void;
  tableNumber: string;
  onTableNumberChange: (v: string) => void;
  posSettings: POSSettings | null;
  customerName: string;
  onCustomerNameChange: (v: string) => void;
  customerPhone: string;
  onCustomerPhoneChange: (v: string) => void;
  discountRand: string;
  onDiscountRandChange: (v: string) => void;
  discountReason: string;
  onDiscountReasonChange: (v: string) => void;
  loyaltyReward: LoyaltyRewardResponse | null;
  onLoyaltyRewardChange: (reward: LoyaltyRewardResponse | null) => void;
  tillOpen: boolean;
  errorMessage: string | null;
  onCheckout: () => void;
}

export default function CartPanel({
  lines, onUpdateQty, onRemove,
  orderMode, onOrderModeChange,
  tableNumber, onTableNumberChange,
  posSettings,
  customerName, onCustomerNameChange,
  customerPhone, onCustomerPhoneChange,
  discountRand, onDiscountRandChange,
  discountReason, onDiscountReasonChange,
  loyaltyReward, onLoyaltyRewardChange,
  tillOpen, errorMessage, onCheckout,
}: Props) {
  const subtotalCents = lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const discountCents = Math.round((parseFloat(discountRand || "0") || 0) * 100);
  // PREVIEW ONLY — see LoyaltyRewardPicker.tsx's docstring. The committed
  // order's own loyalty_discount_cents (from the backend response) is the
  // only real figure; this is purely so the cashier isn't flying blind.
  const loyaltyDiscountCents = previewLoyaltyDiscountCents(loyaltyReward, subtotalCents, discountCents);
  const deliveryFeeCents = orderMode === "DELIVERY" ? (posSettings?.delivery_fee_cents ?? 0) : 0;
  const estimatedTotalCents = Math.max(0, subtotalCents - discountCents - loyaltyDiscountCents) + deliveryFeeCents;

  // VAT shown as a BREAKDOWN of the total, never as an addition to it.
  //
  // Only the inclusive case is rendered. With inclusive pricing the tax is
  // already contained in the prices, so showing it changes no arithmetic --
  // it is pure information, which is what POSSettings' own "the till shows a
  // tax line before checkout" comment anticipates.
  //
  // The EXCLUSIVE case is deliberately NOT rendered: this cart's total does
  // not add VAT today, so displaying an exclusive VAT line would either
  // contradict the Checkout figure or require changing it -- and changing a
  // total is a pricing change, which this programme is explicitly not allowed
  // to make. If exclusive pricing needs a till-side total, that is a costed
  // backend/pricing decision, not a visual one.
  const vatRateBps = posSettings?.vat_rate_basis_points ?? 0;
  const showsInclusiveVat = Boolean(posSettings?.vat_registered) && posSettings?.vat_inclusive_pricing === true && vatRateBps > 0;
  const inclusiveVatCents = showsInclusiveVat
    ? Math.round((estimatedTotalCents * vatRateBps) / (10000 + vatRateBps))
    : 0;

  const tableNumberRequired = orderMode === "DINE_IN" && !!posSettings?.table_number_required;
  const canCheckout = lines.length > 0 && tillOpen && (!tableNumberRequired || tableNumber.trim().length > 0);

  const tableNumberTouch = useTouchField({ value: tableNumber, onChange: onTableNumberChange, layout: "QWERTY", maxLength: 20 });
  const customerNameTouch = useTouchField({ value: customerName, onChange: onCustomerNameChange, layout: "QWERTY", maxLength: 100 });
  const customerPhoneTouch = useTouchField({ value: customerPhone, onChange: onCustomerPhoneChange, layout: "PHONE", maxLength: 20 });
  const discountRandTouch = useTouchField({ value: discountRand, onChange: onDiscountRandChange, layout: "CURRENCY" });
  const discountReasonTouch = useTouchField({ value: discountReason, onChange: onDiscountReasonChange, layout: "QWERTY", maxLength: 100 });

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <h2 className="text-base font-bold text-foreground">Current order</h2>

        {lines.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No items yet — tap a menu item to add it.</p>
        ) : (
          <div className="space-y-3">
            {lines.map((line) => (
              <div key={line.key} className="rounded-xl border border-border bg-card p-3 transition-colors duration-fast">
                <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{line.name}</p>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrency(lineTotalCents(line))}
                    </p>
                  </div>
                  {line.selectedOptionsDisplay.map((o) => (
                    <p key={o.groupName} className="text-xs text-muted-foreground">{o.optionName}</p>
                  ))}
                  {line.addOnSelections.map((a) => (
                    <p key={a.addOnId} className="text-xs text-muted-foreground">
                      {a.quantity}x {a.name}
                    </p>
                  ))}
                  {line.removedIngredientsDisplay.map((ing) => (
                    <p key={ing.id} className="text-xs font-medium text-destructive">No {ing.name}</p>
                  ))}
                  {line.specialInstructions && (
                    <p className="text-xs italic text-muted-foreground">{line.specialInstructions}</p>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (line.quantity <= 1 ? onRemove(line.key) : onUpdateQty(line.key, line.quantity - 1))}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-foreground active:bg-muted"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-5 text-center text-sm font-medium">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => onUpdateQty(line.key, line.quantity + 1)}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-foreground active:bg-muted"
                    aria-label="Increase quantity"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(line.key)}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-destructive active:bg-destructive/10"
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {lines.length > 0 && (
          <>
            {/* Order type */}
            <div className="space-y-2 border-t border-border pt-3">
              <span className="text-xs font-medium text-muted-foreground">Order type</span>
              <div className="grid grid-cols-3 gap-2">
                {ORDER_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => onOrderModeChange(m.value)}
                    className={cn(
                      "rounded-lg px-2 py-2 text-xs font-medium transition-colors",
                      orderMode === m.value ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {orderMode === "DINE_IN" && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Table number {tableNumberRequired && <span className="text-destructive">*</span>}
                </label>
                <input
                  value={tableNumber}
                  onChange={(e) => onTableNumberChange(e.target.value)}
                  placeholder="e.g. 12"
                  className="flex h-11 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  {...tableNumberTouch.fieldProps}
                />
              </div>
            )}

            {/* Customer (optional — never required for a guest sale) */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">Customer (optional)</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={customerName}
                  onChange={(e) => onCustomerNameChange(e.target.value)}
                  placeholder="Name"
                  className="flex h-11 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  {...customerNameTouch.fieldProps}
                />
                <input
                  value={customerPhone}
                  onChange={(e) => onCustomerPhoneChange(e.target.value)}
                  placeholder="Phone (for loyalty)"
                  inputMode={customerPhoneTouch.touchActive ? undefined : "tel"}
                  className="flex h-11 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  {...customerPhoneTouch.fieldProps}
                />
              </div>
              <LoyaltyBalance phone={customerPhone} />
              <LoyaltyRewardPicker
                phone={customerPhone}
                subtotalCents={subtotalCents}
                discountCents={discountCents}
                selectedReward={loyaltyReward}
                onSelect={onLoyaltyRewardChange}
              />
            </div>

            {/* Discount (optional) */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">Discount (optional)</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  inputMode={discountRandTouch.touchActive ? undefined : "decimal"}
                  min="0"
                  step="0.01"
                  value={discountRand}
                  onChange={(e) => onDiscountRandChange(e.target.value)}
                  placeholder="R0.00"
                  className="flex h-11 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  {...discountRandTouch.fieldProps}
                />
                <input
                  value={discountReason}
                  onChange={(e) => onDiscountReasonChange(e.target.value)}
                  placeholder="Reason"
                  className="flex h-11 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  {...discountReasonTouch.fieldProps}
                />
              </div>
              {discountCents > 0 && posSettings && discountCents > posSettings.max_staff_discount_cents && (
                <p className="text-xs text-warning">
                  Above your discount limit — this sale will need manager approval.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {lines.length > 0 && (
        <div className="border-t border-border p-4 space-y-3">
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatCurrency(subtotalCents)}</span>
            </div>
            {discountCents > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Discount</span>
                <span className="tabular-nums">-{formatCurrency(discountCents)}</span>
              </div>
            )}
            {loyaltyReward && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="truncate pr-2">{loyaltyReward.name} (preview)</span>
                <span className="shrink-0 tabular-nums">-{formatCurrency(loyaltyDiscountCents)}</span>
              </div>
            )}
            {deliveryFeeCents > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Delivery</span>
                <span className="tabular-nums">{formatCurrency(deliveryFeeCents)}</span>
              </div>
            )}
            {showsInclusiveVat && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Includes VAT ({(vatRateBps / 100).toFixed(2)}%)</span>
                <span className="tabular-nums">{formatCurrency(inclusiveVatCents)}</span>
              </div>
            )}
          </div>

          {/* The total is stated in its own right, not only inside the
              Checkout button. A cashier reading an amount back to a customer
              should not have to read it off a button. */}
          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm font-medium text-muted-foreground">Total</span>
            <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {formatCurrency(estimatedTotalCents)}
            </span>
          </div>

          {!tillOpen && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Open the till (top-right) before taking payment.
            </p>
          )}
          {errorMessage && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</p>
          )}

          <button
            type="button"
            onClick={onCheckout}
            disabled={!canCheckout}
            className="flex h-16 w-full items-center justify-between rounded-xl bg-brand px-5 text-brand-foreground shadow-md transition-colors duration-fast hover:bg-brand-hover active:bg-brand-active disabled:opacity-50"
          >
            <span className="text-base font-semibold">Checkout</span>
            <span className="text-xl font-bold tabular-nums">{formatCurrency(estimatedTotalCents)}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export { lineTotalCents };
