import type { Order } from "@/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

interface KitchenSlipProps {
  order: Order;
  businessName?: string;
}

/**
 * Kitchen slip component — renders a print-friendly order slip.
 * Usage: render inside a hidden div, then call window.print() with print media styles.
 */
export default function KitchenSlip({ order, businessName }: KitchenSlipProps) {
  return (
    <div className="kitchen-slip">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .kitchen-slip, .kitchen-slip * { visibility: visible !important; }
          .kitchen-slip {
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
          .kitchen-slip {
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
        <div style={{ fontWeight: "bold", fontSize: "14px" }}>
          {businessName || "NextGen Kitchen"}
        </div>
        <div style={{ fontSize: "10px", marginTop: "2px" }}>Kitchen Order Slip</div>
      </div>

      {/* Order info */}
      <div style={{ borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "6px" }}>
        <div style={{ fontWeight: "bold", fontSize: "18px", textAlign: "center" }}>
          #{order.order_number ?? "—"}
        </div>
        <div style={{ fontSize: "10px", textAlign: "center", marginTop: "2px" }}>
          {formatDateTime(order.created_at)}
        </div>
        <div style={{ marginTop: "4px" }}>
          <strong>Status:</strong> {order.status}
        </div>
        <div>
          <strong>Mode:</strong> {order.order_mode || "—"}
        </div>
        {order.customer_name && (
          <div><strong>Customer:</strong> {order.customer_name}</div>
        )}
        {order.phone_number && (
          <div><strong>Phone:</strong> {order.phone_number}</div>
        )}
        {order.delivery_address && (
          <div><strong>Address:</strong> {order.delivery_address}</div>
        )}
      </div>

      {/* Items */}
      <div style={{ borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "6px" }}>
        <div style={{ fontWeight: "bold", marginBottom: "4px" }}>ITEMS:</div>
        {order.items?.length ? (
          order.items.map((item, idx) => (
            <div key={item.id || idx} style={{ marginBottom: "4px" }}>
              <div style={{ fontWeight: "bold" }}>
                {item.quantity}x {item.name_snapshot}
              </div>
              {item.special_instructions && (
                <div style={{ fontSize: "10px", fontStyle: "italic", paddingLeft: "8px" }}>
                  → {item.special_instructions}
                </div>
              )}
              {item.options_snapshot && Object.keys(item.options_snapshot).length > 0 && (
                <div style={{ fontSize: "10px", paddingLeft: "8px" }}>
                  Options: {Object.entries(item.options_snapshot).map(([k, v]) => `${k}: ${v}`).join(", ")}
                </div>
              )}
            </div>
          ))
        ) : (
          <div>No items</div>
        )}
      </div>

      {/* Total */}
      <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "14px" }}>
        Total: {formatCurrency(order.total_cents)}
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", fontSize: "9px", marginTop: "8px", color: "#666" }}>
        NextGen AI Platform
      </div>
    </div>
  );
}

/**
 * Trigger browser print for kitchen slip.
 * Call this from a button click handler.
 */
export function printKitchenSlip() {
  window.print();
}
