import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import type { POSPaymentMethod, POSSettings } from "@/types";
import { cn, formatCurrency } from "@/lib/utils";
import { useTouchField } from "@/hooks/useTouchField";

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
  /**
   * A selected loyalty reward's PREVIEW discount, for the cashier's benefit
   * only — `totalCents` above already has it netted in. The backend's
   * committed order (never this) is the only real figure; see
   * LoyaltyRewardPicker.tsx's docstring for why this can never be trusted
   * as the actual applied amount.
   */
  loyaltyRewardPreview?: { name: string; discountCents: number } | null;
}

type Step = "method" | "cash" | "card" | "other";

export default function PaymentDialog({
  open, onClose, totalCents, posSettings, onConfirm, isSubmitting, errorMessage, loyaltyRewardPreview = null,
}: Props) {
  const [step, setStep] = useState<Step>("method");
  const [cashInput, setCashInput] = useState("");
  const [reference, setReference] = useState("");

  const cashTouch = useTouchField({ value: cashInput, onChange: setCashInput, layout: "CURRENCY" });
  const referenceTouch = useTouchField({ value: reference, onChange: setReference, layout: "QWERTY", maxLength: 255 });

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
      {/* No max-h/overflow/keyboard-spacer override here — components/ui/dialog.tsx's
          DialogContent already keeps every dialog fully above the on-screen
          keyboard (re-centers within the safe area, caps its own height,
          scrolls internally). The action-button rows below are additionally
          pinned with `sticky bottom-0` so "Complete sale" never requires
          scrolling to reach even on a very tall payment form. */}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {step === "method" && "Select payment method"}
            {step === "cash" && "Cash payment"}
            {(step === "card" || step === "other") && (step === "card" ? "Card payment" : "Other payment")}
          </DialogTitle>
        </DialogHeader>

        {/* The total is the number the cashier reads back to the customer, so
            it gets the largest type on the screen rather than sharing a row
            with its own label. Tabular figures keep the digits aligned as the
            amount changes. */}
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total due</p>
          <p className="mt-0.5 text-4xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatCurrency(totalCents)}
          </p>
        </div>
        {loyaltyRewardPreview && (
          <p className="text-center text-xs text-muted-foreground">
            Includes {loyaltyRewardPreview.name} (-{formatCurrency(loyaltyRewardPreview.discountCents)}) · preview,
            confirmed at checkout
          </p>
        )}

        {step === "method" && (
          <div className="space-y-2">
            {posSettings?.cash_enabled && (
              <button
                type="button"
                onClick={() => setStep("cash")}
                className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card text-base font-semibold text-foreground shadow-sm transition-colors duration-fast hover:border-brand-border hover:bg-brand-soft active:bg-muted"
              >
                💵 Cash
              </button>
            )}
            {posSettings?.card_enabled && (
              <button
                type="button"
                onClick={() => setStep("card")}
                className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card text-base font-semibold text-foreground shadow-sm transition-colors duration-fast hover:border-brand-border hover:bg-brand-soft active:bg-muted"
              >
                💳 Card
              </button>
            )}
            {posSettings?.other_payment_enabled && (
              <button
                type="button"
                onClick={() => setStep("other")}
                className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card text-base font-semibold text-foreground shadow-sm transition-colors duration-fast hover:border-brand-border hover:bg-brand-soft active:bg-muted"
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
                inputMode={cashTouch.touchActive ? undefined : "decimal"}
                step="0.01"
                min="0"
                autoFocus
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                placeholder="0.00"
                className="flex h-14 w-full rounded-lg border border-border bg-secondary px-4 text-xl font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                {...cashTouch.fieldProps}
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

            {/* Tendered and change side by side: on a cash sale these are the
                two figures the whole interaction turns on, and a cashier
                counting change should not have to hunt for the second one. */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tendered</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                  {formatCurrency(cashTenderedCents)}
                </p>
              </div>
              <div className={cn(
                "rounded-xl px-3 py-2.5",
                changeDueCents < 0 ? "bg-destructive/10" : "bg-success/10"
              )}>
                <p className={cn(
                  "text-[11px] font-medium uppercase tracking-wide",
                  changeDueCents < 0 ? "text-destructive" : "text-success"
                )}>
                  {/* "Change due", NOT "Change". The redesign briefly shortened
                      this to fit the new side-by-side card, which broke 13
                      Commercial V1 regression tests: the exact string is
                      asserted in 11 places across rc0051, wave0a and
                      wave0a-final. That wording is an established user-visible
                      contract, and it is not worse than the short form -- a
                      cashier reading "Change due R 36.50" is arguably clearer
                      than "Change". Restoring it costs the layout nothing. */}
                  {changeDueCents < 0 ? "Still owing" : "Change due"}
                </p>
                <p className={cn(
                  "mt-0.5 text-xl font-semibold tabular-nums",
                  changeDueCents < 0 ? "text-destructive" : "text-success"
                )}>
                  {formatCurrency(Math.abs(changeDueCents))}
                </p>
              </div>
            </div>

            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

            {/* sticky + bg-background: stays visible at the bottom of the
                dialog's own scroll area even if the form above it (or the
                on-screen keyboard reserving space) pushes it out of the
                immediately-visible viewport — never requires scrolling to
                find "Complete sale". */}
            <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-2 border-t border-border bg-background px-6 py-4">
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
                className="flex h-14 flex-[2] items-center justify-center rounded-lg bg-success text-sm font-semibold text-success-foreground disabled:opacity-50"
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
                {...referenceTouch.fieldProps}
              />
            </div>

            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

            <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-2 border-t border-border bg-background px-6 py-4">
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
                className="flex h-14 flex-[2] items-center justify-center rounded-lg bg-success text-sm font-semibold text-success-foreground disabled:opacity-50"
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
