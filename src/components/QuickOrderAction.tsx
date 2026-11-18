import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Order, OrderStatus } from "@/types";
import { apiClient } from "@/lib/api";
import { marketplaceLabel } from "@/lib/delivery";
import { getReadyAction } from "@/components/StatusActions";
import { cn } from "@/lib/utils";

/**
 * The single next kitchen step for an order, or null when it should be handled
 * on the order screen (payment still owed, marketplace courier orders, NEW
 * orders that need the estimated-time / accept flow). Uses the existing status
 * machine only: ACCEPTED -> IN_PROGRESS -> READY -> terminal.
 */
export function quickAction(order: Order): { label: string; next: OrderStatus } | null {
  if (marketplaceLabel(order.source)) return null;
  const awaitingPayment = order.payment_required && order.payment_status !== "PAID";
  if (order.status === "ACCEPTED" && !awaitingPayment) return { label: "Start preparing", next: "IN_PROGRESS" };
  if (order.status === "IN_PROGRESS") return { label: "Mark ready", next: "READY" };
  if (order.status === "READY" && order.payment_status === "PAID") {
    const a = getReadyAction(order.order_mode);
    return { label: a.label, next: a.next };
  }
  return null;
}

export default function QuickOrderAction({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action = quickAction(order);
  if (!action) return null;

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/v1/business/orders/${order.id}/status`, { status: action.next });
      await queryClient.invalidateQueries({ queryKey: ["live-orders"] });
    } catch (err: unknown) {
      setError(err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "Status update failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={cn(
          "flex h-12 w-full items-center justify-center rounded-lg text-sm font-semibold disabled:opacity-50",
          action.next === "IN_PROGRESS" ? "bg-primary text-primary-foreground" : "bg-success text-success-foreground",
        )}
      >
        {busy ? "Updating..." : `${action.label} - #${order.order_number}`}
      </button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
