import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/lib/api";
import type { Order } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { useTouchField } from "@/hooks/useTouchField";
import {
  buildReturnRefundBody, canStartExchange, checkRefundAmount, clampReturnQty, estimateRefundCents, exchangePath,
  isVariantLine, returnableQty, validateReturn, type ReturnQuantities,
} from "@/lib/returns";
import { friendlyPosError } from "@/lib/pos-errors";

interface ReversalPanelProps {
  order: Order;
  /** OWNER / MANAGER / STAFF — reversal is manager-gated on the backend too. */
  role: string;
  inventoryEnabled: boolean;
  onDone: () => void;
}

/**
 * Void and refund actions for a paid POS sale.
 *
 * These endpoints existed on the backend, fully tested, with no button
 * anywhere in the product — so a cashier who rang up the wrong pizza had no
 * way to reverse it. This is that button.
 *
 * VOID vs REFUND is a real distinction, not two words for one thing:
 *
 *   Void   — the sale should never have happened. Nothing was made, so the
 *            ingredients go back automatically.
 *   Refund — money goes back to the customer. The food usually does NOT come
 *            back: it was made and handed over. Restoring its ingredients
 *            would invent stock that does not physically exist, so that is
 *            an explicit, deliberate choice the manager makes here.
 */
export default function ReversalPanel({
  order,
  role,
  inventoryEnabled,
  onDone,
}: ReversalPanelProps) {
  const [mode, setMode] = useState<"none" | "void" | "refund">("none");
  const [reason, setReason] = useState("");
  // Retail (variant) sales default to a line-by-line return with restock ON;
  // a restaurant sale keeps the original whole-sale refund with restock OFF.
  const hasVariantLines = order.items.some(isVariantLine);
  const [restoreStock, setRestoreStock] = useState(hasVariantLines);
  const [returnMode, setReturnMode] = useState(hasVariantLines);
  const [qty, setQty] = useState<ReturnQuantities>({});
  const [amountInput, setAmountInput] = useState("");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Called unconditionally, above every early return below, per the Rules
  // of Hooks — even on the branches that never render the reason field at
  // all (already-reversed / not-a-manager), this still registers/unregisters
  // cleanly since useTouchField() no-ops outside touch mode and this field
  // is simply never focused on those branches.
  const reasonTouch = useTouchField({ value: reason, onChange: setReason, layout: "QWERTY", maxLength: 255 });

  const isManager = role === "OWNER" || role === "MANAGER";
  const alreadyReversed =
    order.payment_status === "VOIDED" ||
    order.payment_status === "REFUNDED" ||
    order.payment_status === "PARTIALLY_REFUNDED";

  // Only a paid till sale can be reversed here; other sources use the
  // provider-dependent refund flow.
  if (order.source !== "POS" || order.payment_status !== "PAID") {
    if (!alreadyReversed) return null;
  }

  if (alreadyReversed) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">
          {order.payment_status === "VOIDED" ? "Sale voided" : "Refunded"}
        </p>
        {order.refund_amount_cents ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {formatCurrency(order.refund_amount_cents)}
            {order.refund_reference ? ` · ${order.refund_reference}` : ""}
          </p>
        ) : null}
        {canStartExchange(order) && (
          <button
            type="button"
            onClick={() => navigate(exchangePath(order))}
            className="mt-3 h-12 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground active:opacity-90"
          >
            Exchange: ring up the replacement
          </button>
        )}
      </div>
    );
  }

  if (!isManager) {
    // The staff PWA's PIN login is deliberately STAFF-only (a 4-digit PIN
    // must never carry manager-level API power — see auth_service.py) and
    // get_staff_directory() excludes OWNER/MANAGER accounts from the PIN
    // picker entirely, so no manager can ever sign into THIS app to clear
    // this gate from here. Voiding/refunding is done from the Manager
    // Dashboard instead (password login) — this used to be a dead end with
    // no way forward at all; now it points at the actual place to go.
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Ask a manager or the owner to void or refund this order from the Manager
          Dashboard → Orders → {order.order_number}.
        </p>
      </div>
    );
  }

  const lineReturn = mode === "refund" && returnMode;
  const returnCheck = validateReturn(order, qty);
  const estimateCents = lineReturn && returnCheck.ok ? estimateRefundCents(order, qty) : 0;
  const amountCheck = checkRefundAmount(estimateCents, amountInput);
  const anyReturnable = order.items.some((i) => returnableQty(i) > 0);

  async function submit() {
    if (!reason.trim()) {
      setError("Give a reason — it appears on the audit trail.");
      return;
    }
    if (lineReturn) {
      if (!returnCheck.ok) {
        setError(returnCheck.error);
        return;
      }
      if (!amountCheck.ok) {
        setError(amountCheck.error);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "void") {
        await apiClient.post(`/v1/business/pos/orders/${order.id}/void`, {
          reason: reason.trim(),
        });
      } else if (lineReturn) {
        // ONE call: an order can only be refunded once, so every returned
        // line goes in this single request.
        await apiClient.post(
          `/v1/business/pos/orders/${order.id}/refund`,
          buildReturnRefundBody({
            reason,
            restoreStock,
            lines: returnCheck.lines,
            amountCents: amountCheck.amountCents,
          }),
        );
      } else {
        await apiClient.post(`/v1/business/pos/orders/${order.id}/refund`, {
          reason: reason.trim(),
          restore_stock: restoreStock,
        });
      }
      setMode("none");
      setReason("");
      setRestoreStock(hasVariantLines);
      setQty({});
      setAmountInput("");
      onDone();
    } catch (err) {
      setError(friendlyPosError(err, "Could not complete that — try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-semibold text-foreground">Reverse this sale</p>

      {mode === "none" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode("void")}
            className="h-12 rounded-lg border border-border text-sm font-medium text-foreground active:bg-muted"
          >
            Void
          </button>
          <button
            onClick={() => setMode("refund")}
            className="h-12 rounded-lg border border-border text-sm font-medium text-foreground active:bg-muted"
          >
            Refund
          </button>
        </div>
      )}

      {mode !== "none" && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            {mode === "void"
              ? "Rung up by mistake. The full amount is reversed" +
                (inventoryEnabled ? " and the ingredients go back to stock." : ".")
              : lineReturn
                ? "Choose what came back. The refund is the value of those items."
                : `Refunding ${formatCurrency(order.total_cents)} to the customer.`}
          </p>

          {mode === "refund" && anyReturnable && (
            <button
              type="button"
              onClick={() => setReturnMode((v) => !v)}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {returnMode ? "Refund the whole sale instead" : "Choose items to return instead"}
            </button>
          )}

          {lineReturn && (
            <ul className="space-y-2" data-testid="return-lines">
              {order.items.map((item) => {
                const max = returnableQty(item);
                const q = qty[item.id] ?? 0;
                return (
                  <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{item.name_snapshot}</p>
                      {item.variant_label_snapshot && (
                        <p className="text-xs text-muted-foreground">{item.variant_label_snapshot}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Sold {item.quantity}
                        {(item.returned_quantity ?? 0) > 0 ? `, already returned ${item.returned_quantity}` : ""}
                      </p>
                    </div>
                    {max === 0 ? (
                      <span className="text-xs text-muted-foreground">All returned</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Return fewer ${item.name_snapshot}`}
                          onClick={() => setQty((p) => ({ ...p, [item.id]: clampReturnQty(item, q - 1) }))}
                          className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-lg"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums" data-testid={`return-qty-${item.id}`}>
                          {q}
                        </span>
                        <button
                          type="button"
                          aria-label={`Return more ${item.name_snapshot}`}
                          onClick={() => setQty((p) => ({ ...p, [item.id]: clampReturnQty(item, q + 1) }))}
                          disabled={q >= max}
                          className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-lg disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {lineReturn && returnCheck.ok && (
            <div className="space-y-1">
              <p className="text-sm text-foreground" data-testid="refund-estimate">
                Refund: <span className="font-semibold">{formatCurrency(estimateCents)}</span>
              </p>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  Lower the amount (optional, for example a restocking fee). It cannot be more than{" "}
                  {formatCurrency(estimateCents)}.
                </span>
                <input
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  inputMode="decimal"
                  placeholder={(estimateCents / 100).toFixed(2)}
                  aria-label="Refund amount in rand"
                  className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                />
              </label>
              {!amountCheck.ok && <p className="text-xs font-medium text-destructive">{amountCheck.error}</p>}
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={255}
              autoFocus
              placeholder={mode === "void" ? "e.g. Wrong item rung up" : "e.g. Customer unhappy"}
              className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              {...reasonTouch.fieldProps}
            />
          </label>

          {mode === "refund" && (inventoryEnabled || hasVariantLines) && (
            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                checked={restoreStock}
                onChange={(e) => setRestoreStock(e.target.checked)}
                className="mt-0.5 h-5 w-5 flex-none"
              />
              <span className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  The food came back and is still usable
                </span>
                <br />
                Only tick this if the items were returned unopened. Otherwise the
                stock stays consumed, because it physically was.
              </span>
            </label>
          )}

          {error && <p className="text-xs font-medium text-destructive">{error}</p>}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setMode("none");
                setError(null);
              }}
              disabled={busy}
              className="h-12 rounded-lg border border-border text-sm font-medium text-foreground active:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="h-12 rounded-lg bg-destructive text-sm font-semibold text-destructive-foreground active:bg-destructive/90 disabled:opacity-50"
            >
              {busy ? "Working…" : mode === "void" ? "Void sale" : "Refund"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
