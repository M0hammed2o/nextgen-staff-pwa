import { useState } from "react";
import { apiClient } from "@/lib/api";
import type { Order } from "@/types";
import { formatCurrency } from "@/lib/utils";

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
  const [restoreStock, setRestoreStock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      </div>
    );
  }

  if (!isManager) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          A manager or owner is needed to void or refund this sale.
        </p>
      </div>
    );
  }

  async function submit() {
    if (!reason.trim()) {
      setError("Give a reason — it appears on the audit trail.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "void") {
        await apiClient.post(`/v1/business/pos/orders/${order.id}/void`, {
          reason: reason.trim(),
        });
      } else {
        await apiClient.post(`/v1/business/pos/orders/${order.id}/refund`, {
          reason: reason.trim(),
          restore_stock: restoreStock,
        });
      }
      setMode("none");
      setReason("");
      setRestoreStock(false);
      onDone();
    } catch (err) {
      setError(
        (err as { message?: string })?.message ??
          "Could not complete that — try again."
      );
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
              : `Refunding ${formatCurrency(order.total_cents)} to the customer.`}
          </p>

          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={255}
              autoFocus
              placeholder={mode === "void" ? "e.g. Wrong item rung up" : "e.g. Customer unhappy"}
              className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            />
          </label>

          {mode === "refund" && inventoryEnabled && (
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
