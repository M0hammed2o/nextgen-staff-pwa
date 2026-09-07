import type { Order } from "@/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

interface CustomerReceiptProps {
  order: Order;
  businessName?: string;
  /** 58 or 80. Comes from POS settings; the tenant configures it. */
  paperWidthMm?: number;
  /** Marks a re-issued slip so it can't be mistaken for a second sale. */
  isReprint?: boolean;
}

/**
 * Customer-facing itemized receipt — distinct from KitchenSlip.tsx, which is
 * a prep slip for the kitchen (no prices). Shows per-line pricing, discount,
 * delivery fee, tax, and total, plus payment method/status. Same
 * hidden-div + window.print() pattern as KitchenSlip.tsx.
 */
export default function CustomerReceipt({
  order,
  businessName,
  paperWidthMm = 80,
  isReprint = false,
}: CustomerReceiptProps) {
  // Thermal rolls are 58 mm or 80 mm. Anything else is a misconfiguration,
  // so fall back to the more common 80 rather than printing at a width the
  // paper cannot physically hold.
  const widthMm = paperWidthMm === 58 ? 58 : 80;
  const isVoided = order.payment_status === "VOIDED";
  const isRefunded =
    order.payment_status === "REFUNDED" || order.payment_status === "PARTIALLY_REFUNDED";
  const banner = isVoided ? "SALE VOIDED" : isRefunded ? "REFUNDED" : isReprint ? "REPRINT" : null;

  return (
    <div className="customer-receipt">
      <style>{`
        @media print {
          @page { size: ${widthMm}mm auto; margin: 0; }
          body * { visibility: hidden !important; }
          .customer-receipt, .customer-receipt * { visibility: visible !important; }
          .customer-receipt {
            position: fixed !important;
            top: 0; left: 0;
            width: ${widthMm}mm;
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
            width: ${widthMm}mm;
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

      {/* Abnormal-state banner — a reprinted, refunded or voided slip must be
          visibly different from an original, or it stops being evidence of
          anything. */}
      {banner && (
        <div
          style={{
            textAlign: "center",
            fontWeight: "bold",
            fontSize: "13px",
            border: "1px solid #000",
            padding: "3px",
            marginBottom: "6px",
          }}
        >
          *** {banner} ***
        </div>
      )}

      {/* Order info */}
      <div style={{ borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "6px" }}>
        <div style={{ fontWeight: "bold", fontSize: "18px", textAlign: "center" }}>
          #{order.order_number ?? "—"}
        </div>
        <div style={{ fontSize: "10px", textAlign: "center", marginTop: "2px" }}>
          {formatDateTime(order.created_at)}
        </div>
        {order.customer_name && <div><strong>Customer:</strong> {order.customer_name}</div>}
        {order.table_number && <div><strong>Table:</strong> {order.table_number}</div>}
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
              {item.removed_ingredients_snapshot?.map((ing) => (
                <div key={ing.id} style={{ fontSize: "10px", paddingLeft: "8px", color: "#333" }}>
                  No {ing.name}
                </div>
              ))}
              {item.special_instructions && (
                <div style={{ fontSize: "10px", paddingLeft: "8px", color: "#333", fontStyle: "italic" }}>
                  {item.special_instructions}
                </div>
              )}
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
        {order.payment_method === "CASH" && order.cash_tendered_cents != null && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Cash received</span>
              <span>{formatCurrency(order.cash_tendered_cents)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Change</span>
              <span>{formatCurrency(order.change_due_cents)}</span>
            </div>
          </>
        )}
        {order.payment_reference && (
          <div><strong>Reference:</strong> {order.payment_reference}</div>
        )}
        {(order.payment_status === "REFUNDED" || order.payment_status === "PARTIALLY_REFUNDED" || order.payment_status === "VOIDED") && (
          <div style={{ fontWeight: "bold", marginTop: "2px" }}>
            {order.payment_status === "VOIDED" ? "SALE VOIDED" : `REFUNDED: ${formatCurrency(order.refund_amount_cents)}`}
          </div>
        )}
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
