import { CloudOff, GraduationCap, Printer } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { SnapshotLine } from "@/lib/offline/types";

export interface LocalSaleView {
  kind: "offline" | "training";
  ref: string;
  created_at: string;
  total_cents: number;
  cash_tendered_cents: number | null;
  change_due_cents: number | null;
  lines: SnapshotLine[];
}

/** Printable provisional slip. Never a tax invoice: the server issues the real receipt. */
export function LocalSlip({ sale }: { sale: LocalSaleView }) {
  return (
    <div className="receipt-80 bg-white p-3 font-mono text-xs text-black" style={{ width: "72mm" }}>
      <p className="text-center font-bold">{sale.kind === "training" ? "TRAINING — NOT A REAL SALE" : "PROVISIONAL RECEIPT"}</p>
      <p className="text-center">
        {sale.kind === "training" ? "No payment was taken" : "Not a tax invoice. Final receipt follows when uploaded."}
      </p>
      <p className="mt-2">Ref: {sale.ref}</p>
      <p>{new Date(sale.created_at).toLocaleString("en-ZA")}</p>
      <hr className="my-2 border-black" />
      {sale.lines.map((l, i) => (
        <div key={i} className="flex justify-between gap-2">
          <span>
            {l.quantity} x {l.name}
          </span>
          <span>{formatCurrency(l.line_total_cents)}</span>
        </div>
      ))}
      <hr className="my-2 border-black" />
      <div className="flex justify-between font-bold">
        <span>Total (estimate)</span>
        <span>{formatCurrency(sale.total_cents)}</span>
      </div>
      {sale.cash_tendered_cents != null && (
        <div className="flex justify-between">
          <span>Cash</span>
          <span>{formatCurrency(sale.cash_tendered_cents)}</span>
        </div>
      )}
      {sale.change_due_cents != null && (
        <div className="flex justify-between">
          <span>Change</span>
          <span>{formatCurrency(sale.change_due_cents)}</span>
        </div>
      )}
    </div>
  );
}

export default function LocalSaleOverlay({
  sale,
  onNewSale,
  onPrint,
  printFailed,
}: {
  sale: LocalSaleView;
  onNewSale: () => void;
  onPrint: () => void;
  printFailed: boolean;
}) {
  const training = sale.kind === "training";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      style={{
        paddingTop: "max(1rem, var(--safe-area-top))",
        paddingBottom: "calc(max(var(--bottom-nav-height), var(--safe-area-bottom)) + 1rem)",
      }}
    >
      <div data-testid="local-sale-overlay" className="max-h-full w-full max-w-sm overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
        <div className="flex flex-col items-center gap-2 text-center">
          {training ? <GraduationCap className="h-10 w-10 text-warning" /> : <CloudOff className="h-10 w-10 text-primary" />}
          <h2 className="text-lg font-bold text-foreground">{training ? "Practice sale — not real" : "Sale saved on this device"}</h2>
          <p className="font-mono text-2xl font-bold text-foreground" data-testid="local-sale-ref">
            {sale.ref}
          </p>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(sale.total_cents)}</p>
          {sale.change_due_cents != null && sale.cash_tendered_cents != null && (
            <p className="text-sm text-muted-foreground">
              Cash received {formatCurrency(sale.cash_tendered_cents)} · Change {formatCurrency(sale.change_due_cents)}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {training
              ? "Nothing was sent to the server and no payment was taken."
              : "It will upload automatically when the connection is back. Give the customer this reference. The total shown is an estimate; the server confirms the final price."}
          </p>
        </div>
        {printFailed && (
          <p className="mt-3 text-center text-sm text-destructive">Could not print. Check the printer; the sale is still saved.</p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onPrint} className="flex h-14 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card text-sm font-medium">
            <Printer className="h-5 w-5" /> Print slip
          </button>
          <button
            type="button"
            disabled
            title="Needs internet"
            className="flex h-14 flex-col items-center justify-center rounded-xl border border-border bg-card text-xs font-medium opacity-50"
          >
            WhatsApp receipt
            <span className="text-[10px]">needs internet</span>
          </button>
        </div>
        <button type="button" onClick={onNewSale} className="mt-3 flex h-12 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          New sale
        </button>
      </div>
    </div>
  );
}
