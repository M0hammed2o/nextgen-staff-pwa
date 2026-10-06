import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type { ApiFetchError } from "@/lib/api";
import type { Order } from "@/types";
import type { ReceiptDocument } from "@/types/receipt";
import { fetchReceiptDocument, reprintReceiptDocument } from "@/lib/receipts";
import { formatCurrency, formatDateTime, getStatusColor, cn } from "@/lib/utils";
import StatusActions from "@/components/StatusActions";
import DeliveryFeePanel from "@/components/DeliveryFeePanel";
import KitchenSlip, { printKitchenSlip } from "@/components/KitchenSlip";
import CustomerReceipt, { printCustomerReceipt } from "@/components/CustomerReceipt";
import ReceiptSendDialog from "@/components/pos/ReceiptSendDialog";
import { useAuth } from "@/lib/auth";
import ReversalPanel from "@/components/ReversalPanel";
import type { POSSettings } from "@/types";
import { MessageCircle } from "lucide-react";

export default function OrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showSlip, setShowSlip] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptDocument, setReceiptDocument] = useState<ReceiptDocument | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [lastReceiptAction, setLastReceiptAction] = useState<"print" | "reprint" | null>(null);
  const [resendDialogOpen, setResendDialogOpen] = useState(false);

  // A resend here is explicitly about an already-SENT/DELIVERED receipt
  // (or simply re-sending with a corrected number) — the backend requires
  // force_resend=true for that, and gates it to OWNER/MANAGER at the route
  // layer (backend/app/api/v1/routes_pos.py::request_pos_receipt). A plain
  // STAFF cashier never sees this action at all, matching that rule rather
  // than relying on a 403 to hide it.
  const canResendReceipt = user?.role === "OWNER" || user?.role === "MANAGER";

  const { data: posSettings } = useQuery<POSSettings>({
    queryKey: ["pos-settings"],
    queryFn: () => apiClient.get<POSSettings>("/v1/business/pos/settings"),
    staleTime: 5 * 60 * 1000,
  });

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

  // A reprint must be recorded server-side (the audit event) BEFORE it is
  // printed — the returned document already carries the REPRINT banner and
  // the correct reprint_count sourced from that same audit trail. Unlike
  // the old behaviour (print anyway even if the audit write failed), a
  // reprint failure now blocks printing entirely: a reprinted slip with no
  // matching audit event, or with a REPRINT banner invented locally instead
  // of the backend's own, is worse than a cashier having to tap "Reprint" a
  // second time — see backend/app/api/v1/routes_receipts.py's own docstring
  // ("an audit trail is what keeps a reprinted slip from being usable as
  // evidence of a second one"). A plain (non-reprint) print failure is a
  // read-only GET — safe to simply retry.
  async function loadAndPrint(action: "print" | "reprint") {
    if (!orderId) return;
    setReceiptError(null);
    setLastReceiptAction(action);
    setReceiptLoading(true);
    try {
      const doc = action === "reprint" ? await reprintReceiptDocument(orderId) : await fetchReceiptDocument(orderId);
      setReceiptDocument(doc);
      setShowReceipt(true);
      setTimeout(() => {
        printCustomerReceipt();
        setShowReceipt(false);
      }, 100);
    } catch (err) {
      const fallback =
        action === "reprint"
          ? "Could not reprint — nothing was printed. Try again."
          : "Could not load the receipt — try again.";
      setReceiptError((err as ApiFetchError)?.message ?? fallback);
    } finally {
      setReceiptLoading(false);
    }
  }

  const handlePrintReceipt = () => loadAndPrint("print");
  const handleReprint = () => loadAndPrint("reprint");
  const handleRetryReceipt = () => loadAndPrint(lastReceiptAction ?? "print");

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
    // BottomNav hides itself on this route, so no bottom-nav clearance is
    // needed here — but ReversalPanel's reason field (below) now opens the
    // on-screen keyboard on a plain, normally-scrolling page (no dialog),
    // so this still reserves room for it, same idea as
    // useTouchKeyboardSpacerStyle used inside dialogs.
    <div className="min-h-screen bg-background" style={{ paddingBottom: "calc(2rem + var(--touch-keyboard-height, 0px))" }}>
      {/* Kitchen Slip (hidden, only rendered for printing) */}
      {showSlip && (
        <div className="fixed top-0 left-0 z-[9999]">
          <KitchenSlip order={order} businessName={user?.business_name ?? undefined} />
        </div>
      )}

      {/* Customer Receipt (hidden, only rendered for printing) — built from
          the backend's own receipt document, never from `order` directly. */}
      {showReceipt && receiptDocument && (
        <div className="fixed top-0 left-0 z-[9999]">
          <CustomerReceipt document={receiptDocument} />
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

        <button
          onClick={handlePrintReceipt}
          disabled={receiptLoading}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card p-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary active:scale-[0.98] disabled:opacity-50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
            <path d="M3 6h18" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
          {receiptLoading ? "Loading receipt…" : "Print Customer Receipt"}
        </button>

        <button
          onClick={handleReprint}
          disabled={receiptLoading}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card p-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary active:scale-[0.98] disabled:opacity-50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          {receiptLoading ? "Reprinting…" : "Reprint Receipt"}
        </button>

        {canResendReceipt && (
          <button
            onClick={() => setResendDialogOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card p-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary active:scale-[0.98]"
          >
            <MessageCircle className="h-4 w-4" />
            Resend Receipt via WhatsApp
          </button>
        )}

        {receiptError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
            <p className="text-sm text-destructive">{receiptError}</p>
            <button
              onClick={handleRetryReceipt}
              className="flex-shrink-0 text-xs font-semibold text-destructive underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        <ReversalPanel
          order={order}
          role={user?.role ?? "STAFF"}
          inventoryEnabled={posSettings?.inventory_enabled ?? false}
          onDone={handleUpdated}
        />

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
            <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {order.order_mode || "—"}{order.table_number ? ` · Table ${order.table_number}` : ""}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Source</span>
            <span className="text-sm text-foreground">{order.source || "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Payment</span>
            <span className={cn(
              "rounded-md px-2 py-0.5 text-xs font-medium",
              order.payment_status === "PAID" ? "bg-success/15 text-success" : "bg-secondary text-secondary-foreground"
            )}>
              {order.payment_method ? `${order.payment_method} · ` : ""}{order.payment_status}
            </span>
          </div>
          {order.payment_method === "CASH" && order.cash_tendered_cents != null && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Cash received / change</span>
              <span className="text-sm text-foreground">
                {formatCurrency(order.cash_tendered_cents)} / {formatCurrency(order.change_due_cents)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Ordered</span>
            <span className="text-sm text-foreground">{formatDateTime(order.created_at)}</span>
          </div>
          {order.special_instructions && (
            <div className="rounded-md bg-warning/10 px-3 py-2">
              <p className="text-xs font-semibold text-warning">Special Instructions</p>
              <p className="mt-0.5 text-sm text-foreground">{order.special_instructions}</p>
            </div>
          )}
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
                    {item.add_ons_snapshot?.map((ao) => (
                      <p key={ao.name} className="text-xs text-muted-foreground">
                        ✦ {ao.name} +{formatCurrency(ao.price_cents * (ao.quantity ?? 1))}
                      </p>
                    ))}
                    {item.selected_options_snapshot?.filter(o => o.price_delta_cents !== 0).map((o) => (
                      <p key={o.option_name} className="text-xs text-muted-foreground">
                        ✦ {o.option_name} {o.price_delta_cents > 0 ? "+" : ""}{formatCurrency(o.price_delta_cents)}
                      </p>
                    ))}
                    {item.removed_ingredients_snapshot?.map((ing) => (
                      <p key={ing.id} className="text-xs font-medium text-destructive">No {ing.name}</p>
                    ))}
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

      {canResendReceipt && (
        <ReceiptSendDialog
          open={resendDialogOpen}
          onClose={() => setResendDialogOpen(false)}
          orderId={order.id}
          prefillPhone={order.phone_number}
          forceResend
          title="Resend receipt"
        />
      )}
    </div>
  );
}
