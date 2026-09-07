import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import type { POSPaymentMethod, POSSettings } from "@/types";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * Intelligent quick-tender amounts: exact change, plus the next R50/R100/R200/
 * R500 note above the total (deduped, capped at 5) — e.g. a R48 sale offers
 * Exact/R50/R100/R200/R500, a R145 sale offers Exact/R150/R200/R500.
 */
function suggestedTenderAmountsCents(totalCents: number): number[] {
  const totalRand = totalCents / 100;
  const roundUpTo = (value: number, step: number) => Math.ceil(value / step) * step;
  const candidates = [50, 100, 200, 500].map((step) => roundUpTo(totalRand, step) * 100);
  const unique = Array.from(new Set([totalCents, ...candidates])).filter((v) => v >= totalCents);
  return unique.slice(0, 5);
}

interface ConfirmPayload {
  payment_method: POSPaymentMethod;
  cash_tendered_cents?: number;
  payment_reference?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  totalCents: number;
  posSettings: POSSettings | null;
  onConfirm: (payload: ConfirmPayload) => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

type Step = "method" | "cash" | "card" | "other";

export default function PaymentDialog({
  open, onClose, totalCents, posSettings, onConfirm, isSubmitting, errorMessage,
}: Props) {
  const [step, setStep] = useState<Step>("method");
  const [cashInput, setCashInput] = useState("");
  const [reference, setReference] = useState("");

  useEffect(() => {
    if (open) {
      setStep("method");
      setCashInput("");
      setReference("");
    }
  }, [open]);

  const cashTenderedCents = Math.round((parseFloat(cashInput || "0") || 0) * 100);
  const changeDueCents = cashTenderedCents - totalCents;
  const canConfirmCash = cashTenderedCents >= totalCents;

  const quickAmounts = suggestedTenderAmountsCents(totalCents);

  function handleClose() {
    if (isSubmitting) return;
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "method" && "Select payment method"}
            {step === "cash" && "Cash payment"}
            {(step === "card" || step === "other") && (step === "card" ? "Card payment" : "Other payment")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
          <span className="text-sm text-muted-foreground">Total due</span>
          <span className="text-xl font-bold text-foreground">{formatCurrency(totalCents)}</span>
        </div>

        {step === "method" && (
          <div className="space-y-2">
            {posSettings?.cash_enabled && (
              <button
                type="button"
                onClick={() => setStep("cash")}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-base font-semibold text-foreground active:bg-muted"
              >
                💵 Cash
              </button>
            )}
            {posSettings?.card_enabled && (
              <button
                type="button"
                onClick={() => setStep("card")}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-base font-semibold text-foreground active:bg-muted"
              >
                💳 Card
              </button>
            )}
            {posSettings?.other_payment_enabled && (
              <button
                type="button"
                onClick={() => setStep("other")}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-base font-semibold text-foreground active:bg-muted"
              >
                Other
              </button>
            )}
            {posSettings && !posSettings.cash_enabled && !posSettings.card_enabled && !posSettings.other_payment_enabled && (
              <p className="text-sm text-destructive">
                No payment methods are enabled for this business — ask a manager to check Settings.
              </p>
            )}
          </div>
        )}

        {step === "cash" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Cash received</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                autoFocus
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                placeholder="0.00"
                className="flex h-14 w-full rounded-lg border border-border bg-secondary px-4 text-xl font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {quickAmounts.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setCashInput((amt / 100).toFixed(2))}
                  className={cn(
                    "flex h-11 items-center justify-center rounded-lg border text-sm font-medium transition-colors",
                    cashTenderedCents === amt
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-secondary text-foreground active:bg-muted"
                  )}
                >
                  {amt === totalCents ? "Exact" : formatCurrency(amt)}
                </button>
              ))}
            </div>

            <div className={cn(
              "flex items-center justify-between rounded-lg p-3",
              changeDueCents < 0 ? "bg-destructive/10" : "bg-[hsl(var(--success))]/10"
            )}>
              <span className="text-sm font-medium text-foreground">
                {changeDueCents < 0 ? "Still owing" : "Change due"}
              </span>
              <span className={cn(
                "text-lg font-bold",
                changeDueCents < 0 ? "text-destructive" : "text-[hsl(var(--success))]"
              )}>
                {formatCurrency(Math.abs(changeDueCents))}
              </span>
            </div>

            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("method")}
                disabled={isSubmitting}
                className="flex h-14 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => onConfirm({ payment_method: "CASH", cash_tendered_cents: cashTenderedCents })}
                disabled={!canConfirmCash || isSubmitting}
                className="flex h-14 flex-[2] items-center justify-center rounded-lg bg-[hsl(var(--success))] text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Complete sale"}
              </button>
            </div>
          </div>
        )}

        {(step === "card" || step === "other") && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {step === "card"
                ? "Process the payment on the card terminal, then confirm the result below."
                : "Complete the payment via the customer's chosen method, then confirm below."}
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Reference (optional)</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Terminal / transaction reference"
                className="flex h-12 w-full rounded-lg border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("method")}
                disabled={isSubmitting}
                className="flex h-14 flex-1 items-center justify-center rounded-lg border border-destructive text-sm font-medium text-destructive disabled:opacity-50"
              >
                Mark declined
              </button>
              <button
                type="button"
                onClick={() => onConfirm({
                  payment_method: step === "card" ? "CARD" : "OTHER",
                  payment_reference: reference.trim() || undefined,
                })}
                disabled={isSubmitting}
                className="flex h-14 flex-[2] items-center justify-center rounded-lg bg-[hsl(var(--success))] text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Confirm approved"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
