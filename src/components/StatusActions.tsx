import { useState } from "react";
import type { Order, OrderStatus, StatusUpdateRequest } from "@/types";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";

type PaymentMethod = "CASH" | "CARD";

interface StatusActionsProps {
  order: Order;
  onUpdated: () => void;
}

/**
 * Backend order flow (from shared/enums.py ORDER_STATUS_TRANSITIONS):
 *   NEW → ACCEPTED → IN_PROGRESS → READY → COLLECTED/DELIVERED
 * Each status can also → CANCELLED
 */
const STATUS_FLOW: Record<string, { label: string; next: OrderStatus; variant: string }[]> = {
  // Delivery fee states — no standard status buttons; DeliveryFeePanel handles the action
  PENDING_DELIVERY_FEE: [
    { label: "Cancel", next: "CANCELLED", variant: "bg-destructive text-destructive-foreground" },
  ],
  FEE_SENT: [
    { label: "Cancel", next: "CANCELLED", variant: "bg-destructive text-destructive-foreground" },
  ],
  NEW: [
    { label: "Accept Order", next: "ACCEPTED", variant: "bg-primary text-primary-foreground" },
    { label: "Cancel", next: "CANCELLED", variant: "bg-destructive text-destructive-foreground" },
  ],
  ACCEPTED: [
    { label: "Start Preparing", next: "IN_PROGRESS", variant: "bg-primary text-primary-foreground" },
    { label: "Cancel", next: "CANCELLED", variant: "bg-destructive text-destructive-foreground" },
  ],
  // FIX: was "PREPARING" — backend status is "IN_PROGRESS"
  IN_PROGRESS: [
    { label: "Mark Ready", next: "READY", variant: "bg-[hsl(var(--success))] text-white" },
    { label: "Cancel", next: "CANCELLED", variant: "bg-destructive text-destructive-foreground" },
  ],
  READY: [
    { label: "Collected", next: "COLLECTED", variant: "bg-[hsl(var(--success))] text-white" },
    { label: "Delivered", next: "DELIVERED", variant: "bg-primary text-primary-foreground" },
  ],
};

export default function StatusActions({ order, onUpdated }: StatusActionsProps) {
  const [loading, setLoading] = useState<OrderStatus | string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [error, setError] = useState("");

  // Payment prompt state — shown after COLLECTED or DELIVERED
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [paymentReference, setPaymentReference] = useState("");

  const actions = STATUS_FLOW[order.status] || [];

  if (actions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-2">
        No further actions — order is {order.status.toLowerCase()}.
      </p>
    );
  }

  const handleAction = async (nextStatus: OrderStatus) => {
    if (nextStatus === "CANCELLED") {
      setShowCancel(true);
      return;
    }

    setLoading(nextStatus);
    setError("");
    try {
      const body: StatusUpdateRequest = { status: nextStatus };
      if ((nextStatus === "ACCEPTED" || nextStatus === "IN_PROGRESS") && estimatedMinutes) {
        body.estimated_ready_minutes = parseInt(estimatedMinutes, 10);
      }
      await apiClient.post(`/v1/business/orders/${order.id}/status`, body);
      // After collection or delivery, ask for payment method
      if (nextStatus === "COLLECTED" || nextStatus === "DELIVERED") {
        setShowPayment(true);
        setPaymentMethod(null);
        setPaymentReference("");
      } else {
        onUpdated();
      }
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message : "Status update failed";
      setError(msg);
    } finally {
      setLoading(null);
    }
  };

  const handlePayment = async () => {
    if (!paymentMethod) return;
    if (paymentMethod === "CARD" && !paymentReference.trim()) return;
    setLoading("payment");
    setError("");
    try {
      await apiClient.patch(`/v1/business/orders/${order.id}/payment`, {
        payment_status: "PAID",
        payment_method: paymentMethod,
        payment_reference: paymentMethod === "CARD" ? paymentReference.trim() : null,
      });
      setShowPayment(false);
      onUpdated();
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message : "Payment recording failed";
      setError(msg);
    } finally {
      setLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) return;
    setLoading("CANCELLED");
    setError("");
    try {
      await apiClient.post(`/v1/business/orders/${order.id}/status`, {
        status: "CANCELLED",
        reason: cancelReason.trim(),
      });
      setShowCancel(false);
      setCancelReason("");
      onUpdated();
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message : "Cancel failed";
      setError(msg);
    } finally {
      setLoading(null);
    }
  };

  if (showPayment) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold text-foreground">How was payment made?</p>
        <div className="flex gap-3">
          {(["CASH", "CARD"] as PaymentMethod[]).map((m) => (
            <button
              key={m}
              onClick={() => setPaymentMethod(m)}
              className={cn(
                "flex h-12 flex-1 items-center justify-center rounded-lg border text-sm font-medium transition-colors",
                paymentMethod === m
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary text-foreground",
              )}
            >
              {m === "CASH" ? "💵 Cash" : "💳 Card"}
            </button>
          ))}
        </div>
        {paymentMethod === "CARD" && (
          <input
            type="text"
            value={paymentReference}
            onChange={(e) => setPaymentReference(e.target.value)}
            placeholder="Card / payment reference"
            className="flex h-12 w-full rounded-lg border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          onClick={handlePayment}
          disabled={
            !paymentMethod ||
            (paymentMethod === "CARD" && !paymentReference.trim()) ||
            loading === "payment"
          }
          className="flex h-14 w-full items-center justify-center rounded-lg bg-[hsl(var(--success))] text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading === "payment" ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            "Mark as Paid ✓"
          )}
        </button>
      </div>
    );
  }

  if (showCancel) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Reason for cancellation</p>
        <textarea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="Enter reason..."
          rows={3}
          className="w-full rounded-lg border border-border bg-secondary p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={() => { setShowCancel(false); setError(""); }}
            className="flex h-12 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground"
          >
            Go Back
          </button>
          <button
            onClick={handleCancel}
            disabled={!cancelReason.trim() || loading === "CANCELLED"}
            className="flex h-12 flex-1 items-center justify-center rounded-lg bg-destructive text-sm font-semibold text-destructive-foreground disabled:opacity-50"
          >
            {loading === "CANCELLED" ? "Cancelling..." : "Confirm Cancel"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(order.status === "NEW" || order.status === "ACCEPTED") && (
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">
            Estimated ready (minutes, optional)
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
            placeholder="e.g. 15"
            className="flex h-12 w-full rounded-lg border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-3">
        {actions.map((action) => (
          <button
            key={action.next}
            onClick={() => handleAction(action.next)}
            disabled={loading !== null}
            className={cn(
              "flex h-14 flex-1 items-center justify-center rounded-lg text-sm font-semibold transition-colors disabled:opacity-50",
              action.variant
            )}
          >
            {loading === action.next ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              action.label
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
