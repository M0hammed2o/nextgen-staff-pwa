import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import CustomerReceipt from "@/components/CustomerReceipt";
import type { ReceiptDocument } from "@/types/receipt";

/**
 * CustomerReceipt is a PURE renderer of the backend's ReceiptDocument
 * (backend/app/receipts/document.py) — see KNOWN_BUGS BUG-0045. These tests
 * build a document fixture by hand (mirroring
 * tests/test_receipts_document_contract.py's fixtures on the backend side)
 * and assert the renderer shows exactly what the document says, nothing
 * recomputed and nothing invented locally.
 */

function baseDocument(overrides: Partial<ReceiptDocument> = {}): ReceiptDocument {
  return {
    document_type: "CUSTOMER_RECEIPT",
    paper_width_mm: 80,
    columns: 48,
    currency: "ZAR",
    copies: 1,
    header: {
      trading_name: "Ciao Pizza",
      franchise_name: null,
      branch_name: null,
      address: "Lifestyle Centre",
      phone: "032 946 0000",
      vat_number: "4123456789",
      registration_number: null,
      logo_url: null,
      extra_lines: [],
    },
    meta: {
      order_number: "A-0042",
      issued_at: "2026-09-07T18:32:00+00:00",
      issued_at_local: "2026-09-07 20:32",
      cashier_name: "Thabo M",
      order_type: "Dine In",
      table_number: "7",
      customer_name: "Thabo",
      till_session_reference: null,
      reprint_count: 0,
      last_reprinted_at: null,
    },
    lines: [
      {
        quantity: 2,
        name: "Large Chicken Pizza",
        unit_amount_cents: 12900,
        unit_amount_display: "R129.00",
        amount_cents: 25800,
        amount_display: "R258.00",
        modifiers: [
          { label: "Large", amount_cents: 3000, amount_display: "R30.00" },
          { label: "+ Extra Cheese", amount_cents: 1500, amount_display: "R15.00" },
          { label: "No Mushroom", amount_cents: null, amount_display: null },
        ],
        note: "Well done",
      },
    ],
    totals: {
      subtotal_cents: 25800,
      subtotal_display: "R258.00",
      discount_cents: 800,
      discount_display: "-R8.00",
      discount_reason: "Staff discount",
      loyalty_discount_cents: 0,
      loyalty_discount_display: null,
      loyalty_reward_name: null,
      loyalty_points_redeemed: 0,
      delivery_fee_cents: 0,
      delivery_fee_display: null,
      vat_cents: 3261,
      vat_display: "R32.61",
      vat_rate_basis_points: 1500,
      vat_inclusive: true,
      total_cents: 25000,
      total_display: "R250.00",
    },
    payment: {
      method: "CASH",
      status: "PAID",
      cash_tendered_cents: 30000,
      cash_tendered_display: "R300.00",
      change_due_cents: 5000,
      change_due_display: "R50.00",
      reference: null,
      refund_amount_cents: null,
      refund_amount_display: null,
    },
    footer: {
      message: "Grazie!",
      qr_data: null,
      show_vat_invoice_label: true,
    },
    banner: null,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("CustomerReceipt — header / tenant configuration", () => {
  it("shows configured trading name, address, phone, VAT number and TAX INVOICE label when present", () => {
    render(<CustomerReceipt document={baseDocument()} />);
    expect(screen.getByText("Ciao Pizza")).toBeInTheDocument();
    expect(screen.getByText("Lifestyle Centre")).toBeInTheDocument();
    expect(screen.getByText("032 946 0000")).toBeInTheDocument();
    expect(screen.getByText("VAT No: 4123456789")).toBeInTheDocument();
    expect(screen.getByText("TAX INVOICE")).toBeInTheDocument();
  });

  it("omits VAT number and TAX INVOICE label when the business is not VAT registered", () => {
    render(
      <CustomerReceipt
        document={baseDocument({
          header: { ...baseDocument().header, vat_number: null },
          footer: { ...baseDocument().footer, show_vat_invoice_label: false },
        })}
      />
    );
    expect(screen.queryByText(/VAT No:/)).not.toBeInTheDocument();
    expect(screen.queryByText("TAX INVOICE")).not.toBeInTheDocument();
  });

  it("shows franchise/branch name and extra header lines when configured", () => {
    render(
      <CustomerReceipt
        document={baseDocument({
          header: {
            ...baseDocument().header,
            franchise_name: "Ciao Pizza Franchising",
            branch_name: "Umhlanga Branch",
            registration_number: "2020/123456/07",
            extra_lines: ["Follow us @ciaopizza"],
          },
        })}
      />
    );
    expect(screen.getByText("Ciao Pizza Franchising")).toBeInTheDocument();
    expect(screen.getByText("Umhlanga Branch")).toBeInTheDocument();
    expect(screen.getByText("Reg No: 2020/123456/07")).toBeInTheDocument();
    expect(screen.getByText("Follow us @ciaopizza")).toBeInTheDocument();
  });
});

describe("CustomerReceipt — line items", () => {
  it("renders modifiers (with and without a price) and a line note", () => {
    render(<CustomerReceipt document={baseDocument()} />);
    expect(screen.getByText("2x Large Chicken Pizza")).toBeInTheDocument();
    expect(screen.getByText("Large")).toBeInTheDocument();
    expect(screen.getByText("R30.00")).toBeInTheDocument();
    expect(screen.getByText("+ Extra Cheese")).toBeInTheDocument();
    expect(screen.getByText("No Mushroom")).toBeInTheDocument();
    expect(screen.getByText("Well done")).toBeInTheDocument();
  });
});

describe("CustomerReceipt — totals, discount, VAT, payment", () => {
  it("shows discount with its reason", () => {
    render(<CustomerReceipt document={baseDocument()} />);
    expect(screen.getByText("Discount (Staff discount)")).toBeInTheDocument();
    expect(screen.getByText("-R8.00")).toBeInTheDocument();
  });

  it("shows a loyalty reward discount line with the reward name and points redeemed", () => {
    render(
      <CustomerReceipt
        document={baseDocument({
          totals: {
            ...baseDocument().totals,
            loyalty_discount_cents: 5000,
            loyalty_discount_display: "-R50.00",
            loyalty_reward_name: "Free Large Pizza",
            loyalty_points_redeemed: 200,
          },
        })}
      />
    );
    expect(screen.getByText("Loyalty reward (Free Large Pizza)")).toBeInTheDocument();
    expect(screen.getByText("-R50.00")).toBeInTheDocument();
    expect(screen.getByText("200 pts redeemed")).toBeInTheDocument();
  });

  it("omits the loyalty reward line entirely when no reward was redeemed on this order", () => {
    render(<CustomerReceipt document={baseDocument()} />);
    expect(screen.queryByText(/Loyalty reward/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pts redeemed/)).not.toBeInTheDocument();
  });

  it("shows the VAT rate and inclusive/exclusive label when the backend supplies one", () => {
    render(<CustomerReceipt document={baseDocument()} />);
    expect(screen.getByText("VAT (15.00% incl.)")).toBeInTheDocument();
    expect(screen.getByText("R32.61")).toBeInTheDocument();
  });

  it("prints the VAT amount WITHOUT a rate when vat_rate_basis_points is null (rate changed since the sale)", () => {
    render(
      <CustomerReceipt
        document={baseDocument({
          totals: {
            ...baseDocument().totals,
            vat_rate_basis_points: null,
            vat_inclusive: null,
          },
        })}
      />
    );
    expect(screen.getByText("VAT")).toBeInTheDocument();
    expect(screen.getByText("R32.61")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("shows cash tendered and change due", () => {
    render(<CustomerReceipt document={baseDocument()} />);
    expect(screen.getByText("R300.00")).toBeInTheDocument();
    expect(screen.getByText("R50.00")).toBeInTheDocument();
  });

  it("shows a refund line when the payment carries a refund amount", () => {
    render(
      <CustomerReceipt
        document={baseDocument({
          payment: {
            ...baseDocument().payment,
            refund_amount_cents: 1200,
            refund_amount_display: "R12.00",
          },
        })}
      />
    );
    expect(screen.getByText("REFUNDED: R12.00")).toBeInTheDocument();
  });

  it("uses every *_display string verbatim, never recomputing from the *_cents value", () => {
    // Deliberately inconsistent with the cents values, to prove the
    // renderer never reformats/recalculates — if it did, these exact
    // (wrong) strings would NOT appear.
    render(
      <CustomerReceipt
        document={baseDocument({
          totals: {
            ...baseDocument().totals,
            subtotal_display: "R999.99",
            total_display: "R000.01",
            vat_display: "R7.77",
          },
        })}
      />
    );
    expect(screen.getByText("R999.99")).toBeInTheDocument();
    expect(screen.getByText("R000.01")).toBeInTheDocument();
    expect(screen.getByText("R7.77")).toBeInTheDocument();
  });
});

describe("CustomerReceipt — banners", () => {
  it("shows the REPRINT banner and reprint count/timestamp supplied by the backend", () => {
    render(
      <CustomerReceipt
        document={baseDocument({
          banner: "REPRINT",
          meta: { ...baseDocument().meta, reprint_count: 2, last_reprinted_at: "2026-09-20T10:00:00+00:00" },
        })}
      />
    );
    expect(screen.getByText("*** REPRINT ***")).toBeInTheDocument();
    expect(screen.getByText(/Reprinted 2x/)).toBeInTheDocument();
  });

  it("shows SALE VOIDED / REFUNDED banners verbatim from the document", () => {
    render(<CustomerReceipt document={baseDocument({ banner: "SALE VOIDED" })} />);
    expect(screen.getByText("*** SALE VOIDED ***")).toBeInTheDocument();
  });
});

describe("CustomerReceipt — paper width", () => {
  it("renders at 80mm by default/when configured", () => {
    const { container } = render(<CustomerReceipt document={baseDocument({ paper_width_mm: 80 })} />);
    const root = container.querySelector(".customer-receipt");
    expect(root).toHaveClass("receipt-80");
    expect(root).toHaveAttribute("data-paper-width-mm", "80");
  });

  it("renders at 58mm when the document says 58", () => {
    const { container } = render(<CustomerReceipt document={baseDocument({ paper_width_mm: 58 })} />);
    const root = container.querySelector(".customer-receipt");
    expect(root).toHaveClass("receipt-58");
    expect(root).toHaveAttribute("data-paper-width-mm", "58");
  });

  it("falls back to 80mm for an unrecognised width rather than printing off the paper", () => {
    const { container } = render(<CustomerReceipt document={baseDocument({ paper_width_mm: 112 })} />);
    const root = container.querySelector(".customer-receipt");
    expect(root).toHaveClass("receipt-80");
  });
});
