// ═══════════════════════════════════════════════════════════════
// Receipt document — the ONE structured representation of a till slip,
// built server-side and rendered here. Mirrors
// backend/app/receipts/document.py::ReceiptDocument.to_dict() field for
// field (see that file's module docstring for the "one document, three
// renderers" rationale).
//
// KNOWN_BUGS BUG-0045: before this type existed, the staff app's printed
// slip was a hand-built component that ignored the tenant's configured
// receipt settings (trading name, VAT number, TAX INVOICE label, footer)
// entirely — for a VAT-registered restaurant the printed slip was not a
// valid tax invoice. This type (and the renderer in CustomerReceipt.tsx
// built from it) makes the backend document the single source of truth.
//
// Every money value ships as BOTH a raw integer (`*_cents`) and a
// pre-formatted string (`*_display`). The frontend must always render the
// `*_display` string verbatim — never recompute/reformat from the cents
// value — so the slip can never drift from what the backend (the only
// place that knows the tenant's currency/locale formatting rules) decided
// to print.
// ═══════════════════════════════════════════════════════════════

export interface ReceiptLineModifier {
  label: string;
  amount_cents: number | null;
  amount_display: string | null;
}

export interface ReceiptLine {
  quantity: number;
  name: string;
  unit_amount_cents: number;
  unit_amount_display: string;
  amount_cents: number;
  amount_display: string;
  modifiers: ReceiptLineModifier[];
  note: string | null;
}

export interface ReceiptTotals {
  subtotal_cents: number;
  subtotal_display: string;
  discount_cents: number;
  discount_display: string | null;
  discount_reason: string | null;
  delivery_fee_cents: number;
  delivery_fee_display: string | null;
  vat_cents: number;
  vat_display: string | null;
  // null means "do not print a rate/inclusive label next to the VAT
  // amount" — see document.py::_vat_rate_display()'s docstring. The VAT
  // amount itself is always correct (a snapshot); only the rate label is
  // sometimes withheld when it can no longer be proven consistent with it.
  vat_rate_basis_points: number | null;
  vat_inclusive: boolean | null;
  total_cents: number;
  total_display: string;
}

export interface ReceiptPayment {
  method: string | null;
  status: string | null;
  cash_tendered_cents: number | null;
  cash_tendered_display: string | null;
  change_due_cents: number | null;
  change_due_display: string | null;
  reference: string | null;
  refund_amount_cents: number | null;
  refund_amount_display: string | null;
}

export interface ReceiptHeader {
  trading_name: string;
  franchise_name: string | null;
  branch_name: string | null;
  address: string | null;
  phone: string | null;
  vat_number: string | null;
  registration_number: string | null;
  logo_url: string | null;
  extra_lines: string[];
}

export interface ReceiptMeta {
  order_number: string;
  issued_at: string | null;
  // Same instant as issued_at, pre-formatted in the business's OWN
  // timezone by the backend — the frontend must never localise this
  // itself (it does not, and must not be trusted to, know the tenant's
  // timezone).
  issued_at_local: string | null;
  cashier_name: string | null;
  order_type: string | null;
  table_number: string | null;
  customer_name: string | null;
  till_session_reference: string | null;
  // 0 for an original print; >0 = how many times this order's receipt has
  // been reprinted before (not counting the copy currently returned).
  reprint_count: number;
  last_reprinted_at: string | null;
}

export interface ReceiptFooter {
  message: string | null;
  qr_data: string | null;
  show_vat_invoice_label: boolean;
}

export interface ReceiptDocument {
  document_type: "CUSTOMER_RECEIPT" | "KITCHEN" | string;
  paper_width_mm: number;
  columns: number;
  currency: string;
  copies: number;

  header: ReceiptHeader;
  meta: ReceiptMeta;
  lines: ReceiptLine[];
  totals: ReceiptTotals;
  payment: ReceiptPayment;
  footer: ReceiptFooter;

  // Banner text for an abnormal state — REPRINT, REFUNDED, SALE VOIDED.
  // Computed server-side; the frontend renders it verbatim and never
  // derives its own banner text from order fields (that duplication is
  // exactly what let the old hand-built slip drift from the backend).
  banner: string | null;
}
