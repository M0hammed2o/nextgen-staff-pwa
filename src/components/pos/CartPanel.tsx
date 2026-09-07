import { Minus, Plus, Trash2 } from "lucide-react";
import type { CartLine, POSSettings } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

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
  tillOpen, errorMessage, onCheckout,
}: Props) {
  const subtotalCents = lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const discountCents = Math.round((parseFloat(discountRand || "0") || 0) * 100);
  const deliveryFeeCents = orderMode === "DELIVERY" ? (posSettings?.delivery_fee_cents ?? 0) : 0;
  const estimatedTotalCents = Math.max(0, subtotalCents - discountCents) + deliveryFeeCents;

  const tableNumberRequired = orderMode === "DINE_IN" && !!posSettings?.table_number_required;
  const canCheckout = lines.length > 0 && tillOpen && (!tableNumberRequired || tableNumber.trim().length > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <h2 className="text-base font-bold text-foreground">Current order</h2>

        {lines.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No items yet — tap a menu item to add it.</p>
        ) : (
          <div className="space-y-3">
            {lines.map((line) => (
              <div key={line.key} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{line.name}</p>
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
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {formatCurrency(lineTotalCents(line))}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (line.quantity <= 1 ? onRemove(line.key) : onUpdateQty(line.key, line.quantity - 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-foreground active:bg-muted"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-5 text-center text-sm font-medium">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => onUpdateQty(line.key, line.quantity + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-foreground active:bg-muted"
                    aria-label="Increase quantity"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(line.key)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-destructive active:bg-destructive/10"
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
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
                  className="flex h-10 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
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
                  className="flex h-10 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <input
                  value={customerPhone}
                  onChange={(e) => onCustomerPhoneChange(e.target.value)}
                  placeholder="Phone (for loyalty)"
                  inputMode="tel"
                  className="flex h-10 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            {/* Discount (optional) */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">Discount (optional)</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={discountRand}
                  onChange={(e) => onDiscountRandChange(e.target.value)}
                  placeholder="R0.00"
                  className="flex h-10 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <input
                  value={discountReason}
                  onChange={(e) => onDiscountReasonChange(e.target.value)}
                  placeholder="Reason"
                  className="flex h-10 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {discountCents > 0 && posSettings && discountCents > posSettings.max_staff_discount_cents && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
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
              <span>{formatCurrency(subtotalCents)}</span>
            </div>
            {discountCents > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Discount</span>
                <span>-{formatCurrency(discountCents)}</span>
              </div>
            )}
            {deliveryFeeCents > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Delivery</span>
                <span>{formatCurrency(deliveryFeeCents)}</span>
              </div>
            )}
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
            className="flex h-14 w-full items-center justify-between rounded-xl bg-primary px-5 text-primary-foreground shadow-lg disabled:opacity-50"
          >
            <span className="text-sm font-semibold">Checkout</span>
            <span className="text-lg font-bold">{formatCurrency(estimatedTotalCents)}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export { lineTotalCents };
