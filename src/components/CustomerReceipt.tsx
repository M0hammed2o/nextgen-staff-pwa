import type { ReceiptDocument } from "@/types/receipt";

interface CustomerReceiptProps {
  document: ReceiptDocument;
}

/**
 * Customer-facing tax-invoice-capable receipt — a pure renderer of the
 * backend's ReceiptDocument (backend/app/receipts/document.py). Distinct
 * from KitchenSlip.tsx, which is an internal prep slip (no prices, no
 * tenant/VAT details) and does NOT need to go through this document.
 *
 * KNOWN_BUGS BUG-0045 (fixed here): this component used to be a hand-built
 * slip that only showed the business name and a tax amount, ignoring the
 * tenant's configured receipt settings (trading name, franchise/branch,
 * address, phone, VAT number, footer, TAX INVOICE label) entirely — for a
 * VAT-registered restaurant the printed slip was not a valid tax invoice.
 * It now renders ONLY what the document says, so the printed slip and the
 * Receipts settings page can never drift apart. Every money value is
 * printed via its pre-formatted `*_display` string, never recomputed here.
 *
 * Same hidden-div + window.print() pattern as KitchenSlip.tsx.
 */
// Destructured/aliased to `doc` at the parameter level (never a local
// named `document`) — this component would otherwise shadow the global
// `window.document` for its entire body, a real footgun even though
// nothing here currently needs the global.
export default function CustomerReceipt({ document: doc }: CustomerReceiptProps) {
  const { header, meta, lines, totals, payment, footer, banner } = doc;

  // Thermal rolls are 58 mm or 80 mm. Anything else is a misconfiguration
  // upstream, so fall back to the more common 80 rather than printing at a
  // width the paper cannot physically hold.
  const widthMm = doc.paper_width_mm === 58 ? 58 : 80;
  const widthClass = widthMm === 58 ? "receipt-58" : "receipt-80";

  const vatRatePercent =
    totals.vat_rate_basis_points != null ? (totals.vat_rate_basis_points / 100).toFixed(2) : null;
  const vatInclusiveLabel =
    totals.vat_inclusive === true ? "incl." : totals.vat_inclusive === false ? "excl." : null;

  return (
    <div className={`customer-receipt ${widthClass}`} data-paper-width-mm={widthMm}>
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

      {/* Header — the tenant's own configured trading identity, never a
          hardcoded/generic name. Any field the tenant hasn't set is simply
          omitted, never shown as placeholder text. */}
      <div style={{ textAlign: "center", borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "6px" }}>
        <div style={{ fontWeight: "bold", fontSize: "14px" }}>{header.trading_name}</div>
        {header.franchise_name && <div style={{ fontSize: "10px" }}>{header.franchise_name}</div>}
        {header.branch_name && <div style={{ fontSize: "10px" }}>{header.branch_name}</div>}
        {header.address && <div style={{ fontSize: "10px" }}>{header.address}</div>}
        {header.phone && <div style={{ fontSize: "10px" }}>{header.phone}</div>}
        {header.vat_number && <div style={{ fontSize: "10px" }}>VAT No: {header.vat_number}</div>}
        {header.registration_number && (
          <div style={{ fontSize: "10px" }}>Reg No: {header.registration_number}</div>
        )}
        {header.extra_lines.map((line) => (
          <div key={line} style={{ fontSize: "10px" }}>{line}</div>
        ))}
        {footer.show_vat_invoice_label && (
          <div style={{ fontWeight: "bold", fontSize: "11px", marginTop: "4px" }}>TAX INVOICE</div>
        )}
      </div>

      {/* Abnormal-state banner — REPRINT, REFUNDED or SALE VOIDED, decided
          server-side so it can never disagree with the audit trail. */}
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
      {banner === "REPRINT" && meta.reprint_count > 0 && (
        <div style={{ textAlign: "center", fontSize: "9px", marginBottom: "6px" }}>
          Reprinted {meta.reprint_count}x
          {meta.last_reprinted_at ? ` · last ${meta.last_reprinted_at}` : ""}
        </div>
      )}

      {/* Order info */}
      <div style={{ borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "6px" }}>
        <div style={{ fontWeight: "bold", fontSize: "18px", textAlign: "center" }}>
          #{meta.order_number || "—"}
        </div>
        {meta.issued_at_local && (
          <div style={{ fontSize: "10px", textAlign: "center", marginTop: "2px" }}>{meta.issued_at_local}</div>
        )}
        {meta.cashier_name && <div><strong>Served by:</strong> {meta.cashier_name}</div>}
        {meta.order_type && <div><strong>Type:</strong> {meta.order_type}</div>}
        {meta.customer_name && <div><strong>Customer:</strong> {meta.customer_name}</div>}
        {meta.table_number && <div><strong>Table:</strong> {meta.table_number}</div>}
      </div>

      {/* Items */}
      <div style={{ borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "6px" }}>
        {lines.length ? (
          lines.map((line, idx) => (
            <div key={`${line.name}-${idx}`} style={{ marginBottom: "4px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{line.quantity}x {line.name}</span>
                <span>{line.amount_display}</span>
              </div>
              {line.modifiers.map((m, mIdx) => (
                <div key={`${m.label}-${mIdx}`} style={{ fontSize: "10px", paddingLeft: "8px", color: "#333", display: "flex", justifyContent: "space-between" }}>
                  <span>{m.label}</span>
                  {m.amount_display && <span>{m.amount_display}</span>}
                </div>
              ))}
              {line.note && (
                <div style={{ fontSize: "10px", paddingLeft: "8px", color: "#333", fontStyle: "italic" }}>
                  {line.note}
                </div>
              )}
            </div>
          ))
        ) : (
          <div>No items</div>
        )}
      </div>

      {/* Totals — every value here is the backend's own `*_display` string,
          rendered verbatim, never recomputed from cents. */}
      <div style={{ borderBottom: "1px dashed #000", paddingBottom: "6px", marginBottom: "6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Subtotal</span>
          <span>{totals.subtotal_display}</span>
        </div>
        {totals.delivery_fee_display && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Delivery</span>
            <span>{totals.delivery_fee_display}</span>
          </div>
        )}
        {totals.discount_display && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Discount{totals.discount_reason ? ` (${totals.discount_reason})` : ""}</span>
            <span>{totals.discount_display}</span>
          </div>
        )}
        {totals.vat_display && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>
              VAT{vatRatePercent ? ` (${vatRatePercent}%${vatInclusiveLabel ? ` ${vatInclusiveLabel}` : ""})` : ""}
            </span>
            <span>{totals.vat_display}</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "14px" }}>
        <span>Total</span>
        <span>{totals.total_display}</span>
      </div>

      {/* Payment */}
      <div style={{ marginTop: "6px", fontSize: "10px" }}>
        <div><strong>Payment:</strong> {payment.method || "—"}{payment.status ? ` (${payment.status})` : ""}</div>
        {payment.cash_tendered_display && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Cash received</span>
            <span>{payment.cash_tendered_display}</span>
          </div>
        )}
        {payment.change_due_display && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Change</span>
            <span>{payment.change_due_display}</span>
          </div>
        )}
        {payment.reference && <div><strong>Reference:</strong> {payment.reference}</div>}
        {payment.refund_amount_display && (
          <div style={{ fontWeight: "bold", marginTop: "2px" }}>
            REFUNDED: {payment.refund_amount_display}
          </div>
        )}
      </div>

      {/* Footer */}
      {(footer.message || footer.qr_data) && (
        <div style={{ textAlign: "center", fontSize: "9px", marginTop: "8px", color: "#666" }}>
          {footer.message && <div>{footer.message}</div>}
          {/* QR rendering as an actual scannable code is not implemented —
              see WORKLOG.md; shown as text so the data isn't silently lost. */}
          {footer.qr_data && <div>{footer.qr_data}</div>}
        </div>
      )}
    </div>
  );
}

/** Trigger browser print for the customer receipt. Call from a button click handler. */
export function printCustomerReceipt() {
  window.print();
}
