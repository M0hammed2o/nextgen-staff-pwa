import { useState } from "react";
import type { Order } from "@/types";
import { apiClient } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

interface DeliveryFeePanelProps {
  order: Order;
  onUpdated: () => void;
}

/**
 * Shown on delivery orders in PENDING_DELIVERY_FEE or FEE_SENT status.
 *
 * PENDING_DELIVERY_FEE → staff enters fee → POST /delivery-fee → status becomes FEE_SENT
 *   (system sends WhatsApp to customer automatically)
 * FEE_SENT → waiting for customer to reply yes/no on WhatsApp.
 */
export default function DeliveryFeePanel({ order, onUpdated }: DeliveryFeePanelProps) {
  const [feeCents, setFeeCents] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  if (order.order_mode !== "DELIVERY") return null;
  if (order.status !== "PENDING_DELIVERY_FEE" && order.status !== "FEE_SENT") return null;

  const handleSendFee = async () => {
    const cents = parseInt(feeCents, 10);
    if (isNaN(cents) || cents < 0) {
      setError("Enter a valid delivery fee (0 or more).");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiClient.post(`/v1/business/orders/${order.id}/delivery-fee`, {
        delivery_fee_cents: cents,
      });
      setSent(true);
      onUpdated();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Failed to send delivery fee";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (order.status === "FEE_SENT" || sent) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
            Fee Sent
          </span>
          <span className="text-sm text-muted-foreground">Waiting for customer approval</span>
        </div>
        {(order.delivery_fee_cents ?? 0) > 0 && (
          <p className="text-sm text-foreground">
            Fee sent: <span className="font-semibold">{formatCurrency(order.delivery_fee_cents)}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          The customer will receive a WhatsApp message to accept or reject the fee.
          This order will move to <strong>NEW</strong> automatically once they confirm.
        </p>
      </div>
    );
  }

  // PENDING_DELIVERY_FEE — staff must set the fee
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          Awaiting Delivery Fee
        </span>
      </div>

      {order.delivery_address && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-0.5">Delivery address</p>
          <p className="text-sm text-foreground">{order.delivery_address}</p>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground">
          Set delivery fee (enter amount in Rand)
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">R</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.50"
            value={feeCents ? (parseInt(feeCents) / 100).toFixed(2) : ""}
            onChange={(e) => {
              const rand = parseFloat(e.target.value);
              setFeeCents(isNaN(rand) ? "" : String(Math.round(rand * 100)));
            }}
            placeholder="e.g. 35.00"
            className="flex h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {feeCents && (
          <p className="text-xs text-muted-foreground">
            Customer will see: {formatCurrency(parseInt(feeCents))}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        onClick={handleSendFee}
        disabled={loading || !feeCents}
        className="flex h-12 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50 transition-colors"
      >
        {loading ? (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          "Send Fee to Customer"
        )}
      </button>

      <p className="text-xs text-muted-foreground text-center">
        The customer will receive a WhatsApp message with this fee to approve or decline.
      </p>
    </div>
  );
}
