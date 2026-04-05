import { useState } from "react";
import type { Order, OrderStatus, StatusUpdateRequest } from "@/types";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";

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
  const [loading, setLoading] = useState<OrderStatus | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [error, setError] = useState("");

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
      onUpdated();
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message : "Status update failed";
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
