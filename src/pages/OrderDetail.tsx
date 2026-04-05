import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type { Order } from "@/types";
import { formatCurrency, formatDateTime, getStatusColor, cn } from "@/lib/utils";
import StatusActions from "@/components/StatusActions";
import DeliveryFeePanel from "@/components/DeliveryFeePanel";
import KitchenSlip, { printKitchenSlip } from "@/components/KitchenSlip";
import { useAuth } from "@/lib/auth";

export default function OrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showSlip, setShowSlip] = useState(false);

  const { data: order, isLoading, error } = useQuery<Order>({
    queryKey: ["order", orderId],
    queryFn: () => apiClient.get<Order>(`/v1/business/orders/${orderId}`),
    enabled: !!orderId,
  });

  const handleUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    queryClient.invalidateQueries({ queryKey: ["live-orders"] });
  };

  const handlePrint = () => {
    setShowSlip(true);
    // Wait for render, then print
    setTimeout(() => {
      printKitchenSlip();
      setShowSlip(false);
    }, 100);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <p className="text-sm text-destructive">Order not found</p>
        <button onClick={() => navigate(-1)} className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground">
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Kitchen Slip (hidden, only rendered for printing) */}
      {showSlip && (
        <div className="fixed top-0 left-0 z-[9999]">
          <KitchenSlip order={order} businessName={user?.business_name ?? undefined} />
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm safe-top no-print">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-4">
          <button onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-foreground">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Order #{order.order_number ?? "—"}</h1>
          </div>
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", getStatusColor(order.status))}>
            {order.status}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-lg space-y-4 px-4 py-4 no-print">
        {/* Print Slip Button */}
        <button
          onClick={handlePrint}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card p-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary active:scale-[0.98]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          Print Kitchen Slip
        </button>

        {/* Customer & Order Info */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Customer</span>
            <span className="text-sm font-medium text-foreground">{order.customer_name || "Guest"}</span>
          </div>
          {order.phone_number && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Phone</span>
              <a href={`tel:${order.phone_number}`} className="text-sm font-medium text-primary">{order.phone_number}</a>
            </div>
          )}
          {order.delivery_address && (
            <div className="flex items-start justify-between gap-4">
              <span className="shrink-0 text-sm text-muted-foreground">Address</span>
              <span className="text-right text-sm font-medium text-foreground">{order.delivery_address}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Mode</span>
            <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">{order.order_mode || "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Source</span>
            <span className="text-sm text-foreground">{order.source || "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Ordered</span>
            <span className="text-sm text-foreground">{formatDateTime(order.created_at)}</span>
          </div>
        </div>

        {/* Items */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Items</h3>
          <div className="space-y-3">
            {order.items?.length ? (
              order.items.map((item, idx) => (
                <div key={item.id || idx} className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {item.quantity}x {item.name_snapshot}
                    </p>
                    {item.special_instructions && (
                      <p className="text-xs italic text-muted-foreground">Note: {item.special_instructions}</p>
                    )}
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {formatCurrency(item.line_total_cents)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No items</p>
            )}
          </div>
        </div>

        {/* Totals */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="text-foreground">{formatCurrency(order.subtotal_cents)}</span>
          </div>
          {(order.delivery_fee_cents ?? 0) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Delivery Fee</span>
              <span className="text-foreground">{formatCurrency(order.delivery_fee_cents)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
            <span className="text-foreground">Total</span>
            <span className="text-foreground">{formatCurrency(order.total_cents)}</span>
          </div>
        </div>

        {/* Delivery Fee Panel — shown for PENDING_DELIVERY_FEE and FEE_SENT orders */}
        <DeliveryFeePanel order={order} onUpdated={handleUpdated} />

        {/* Status Actions */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Update Status</h3>
          <StatusActions order={order} onUpdated={handleUpdated} />
        </div>
      </div>
    </div>
  );
}
