import type { Order } from "@/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

interface CustomerReceiptProps {
  order: Order;
  businessName?: string;
}

/**
 * Customer-facing itemized receipt — distinct from KitchenSlip.tsx, which is
 * a prep slip for the kitchen (no prices). Shows per-line pricing, discount,
 * delivery fee, tax, and total, plus payment method/status. Same
 * hidden-div + window.print() pattern as KitchenSlip.tsx.
 */
export default function CustomerReceipt({ order, businessName }: CustomerReceiptProps) {
  return (
    <div className="customer-receipt">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .customer-receipt, .customer-receipt * { visibility: visible !important; }
          .customer-receipt {
            position: fixed !important;
            top: 0; left: 0;
            width: 80mm;
            padding: 4mm;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            color: #000 !important;
            background: #fff !important;
          }
          .no-print { display: none !important; }
        }
        @media screen {
          .customer-receipt {
            width: 80mm;
            padding: 4mm;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            color: #000;
            background: #fff;
            border: 1px dashed #999;
            border-radius: 4px;
          }
        }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "6px" }}>
        <div style={{ fontWeight: "bold", fontSize: "14px" }}>{businessName || "NextGen"}</div>
        <div style={{ fontSize: "10px", marginTop: "2px" }}>Receipt</div>
      </div>

      {/* Order info */}
      <div style={{ borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "6px" }}>
        <div style={{ fontWeight: "bold", fontSize: "18px", textAlign: "center" }}>
          #{order.order_number ?? "—"}
        </div>
        <div style={{ fontSize: "10px", textAlign: "center", marginTop: "2px" }}>
          {formatDateTime(order.created_at)}
        </div>
        {order.customer_name && <div><strong>Customer:</strong> {order.customer_name}</div>}
      </div>

      {/* Items */}
      <div style={{ borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "6px" }}>
        {order.items?.length ? (
          order.items.map((item, idx) => (
            <div key={item.id || idx} style={{ marginBottom: "4px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{item.quantity}x {item.name_snapshot}</span>
                <span>{formatCurrency(item.line_total_cents)}</span>
              </div>
              {item.selected_options_snapshot?.map((o) => (
                <div key={o.option_name} style={{ fontSize: "10px", paddingLeft: "8px", color: "#333" }}>
                  {o.option_name}
                </div>
              ))}
              {item.add_ons_snapshot?.map((ao) => (
                <div key={ao.name} style={{ fontSize: "10px", paddingLeft: "8px", color: "#333" }}>
                  + {ao.name}{(ao.quantity ?? 1) > 1 ? ` x${ao.quantity}` : ""}
                </div>
              ))}
            </div>
          ))
        ) : (
          <div>No items</div>
        )}
      </div>

      {/* Totals */}
      <div style={{ borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Subtotal</span>
          <span>{formatCurrency(order.subtotal_cents)}</span>
        </div>
        {order.delivery_fee_cents > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Delivery</span>
            <span>{formatCurrency(order.delivery_fee_cents)}</span>
          </div>
        )}
        {order.discount_cents > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Discount{order.discount_reason ? ` (${order.discount_reason})` : ""}</span>
            <span>-{formatCurrency(order.discount_cents)}</span>
          </div>
        )}
        {order.tax_cents > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Tax</span>
            <span>{formatCurrency(order.tax_cents)}</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "14px" }}>
        <span>Total</span>
        <span>{formatCurrency(order.total_cents)}</span>
      </div>

      <div style={{ marginTop: "6px", fontSize: "10px" }}>
        <div><strong>Payment:</strong> {order.payment_method || "—"} ({order.payment_status})</div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", fontSize: "9px", marginTop: "8px", color: "#666" }}>
        Thank you!
      </div>
    </div>
  );
}

/** Trigger browser print for the customer receipt. Call from a button click handler. */
export function printCustomerReceipt() {
  window.print();
}
