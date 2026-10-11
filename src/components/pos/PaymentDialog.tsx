import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Split, X } from "lucide-react";
import type { POSPaymentMethod, POSSettings, POSSplitPaymentMethod, POSCheckoutPaymentPayload, PaymentIntent, PaymentIntentStatus, PaymentIntentWhatsAppStatus } from "@/types";
import { cn, formatCurrency } from "@/lib/utils";
import { useTouchField } from "@/hooks/useTouchField";
import { looksLikeSaPhoneNumber } from "@/lib/phone";
import { createPaymentIntent, getPaymentIntent, resendPaymentIntent, cancelPaymentIntent, maskPhoneForStatus, formatIntentReceivedAt } from "@/lib/payment-intents";
import type { ApiFetchError } from "@/lib/api";

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

/** Stable, generated-once allocation id — never derived from a field the
 * cashier can edit live (amount/method/phone). Reusing a mutable field as a
 * React list key is exactly the class of bug KNOWN_BUGS.md BUG-0010
 * documents (menu editor losing input focus every keystroke because its key
 * was regenerated from the live-typed name) — this id is generated exactly
 * once, at allocation-creation time, and never touched again. */
function newAllocationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `alloc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface SplitAllocation {
  id: string;
  method: POSSplitPaymentMethod;
  /** The amount actually applied to the bill — NOT the cash tendered. Change
   * due is tracked separately (cashTenderedCents) and never added to the
   * allocated/remaining math, so it's never double-counted. */
  amountCents: number;
  cashTenderedCents?: number;
  paymentReference?: string;
  paymentIntentId?: string;
  intentStatus?: PaymentIntentStatus;
  whatsappStatus?: PaymentIntentWhatsAppStatus;
  /** Display-only, already masked — the raw number is never stored here. */
  maskedPhone?: string;
  /** An EXISTING already-PAID intent picked via "Use existing payment"
   * (Pos.tsx's "Payment received but sale not completed" recovery) rather
   * than a link created in this dialog. Removing it locally is safe — it
   * is never cancelled (a PAID intent can't be) and it stays listed by
   * GET /payment-intents/unconsumed-paid until a checkout consumes it. */
  resumed?: boolean;
}

/** Exact copy required by the financial-safety brief — shown whenever the
 * cashier tries to leave the payment screen (Back out of split, or close
 * the dialog) while a Pay-by-Link allocation has already been PAID but the
 * sale hasn't been completed, since leaving would drop real received money
 * from the screen with no order pointing at it. */
export const LEAVE_WITH_PAID_LINK_MESSAGE =
  "Payment has already been received. Complete this sale before leaving the payment screen.";

function isPaidLink(a: SplitAllocation): boolean {
  return a.method === "PAY_BY_LINK" && a.intentStatus === "PAID";
}

/** A Pay-by-Link allocation only counts as real, collected money once the
 * intent has actually reached PAID — never while merely sent/pending. */
function isAllocationSettled(a: SplitAllocation): boolean {
  return a.method !== "PAY_BY_LINK" || a.intentStatus === "PAID";
}

/** Never say "Sent" unless whatsapp_status is actually SENT, and never imply
 * success unless the intent itself reached PAID — see hard product
 * constraint on PaymentIntent.whatsapp_status/TEMPLATE_REQUIRED handling. */
function describeLinkStatus(a: SplitAllocation): { label: string; tone: "pending" | "success" | "error" } {
  if (a.whatsappStatus === "TEMPLATE_REQUIRED") {
    return { label: "Could not send — this restaurant needs an approved WhatsApp payment template", tone: "error" };
  }
  switch (a.intentStatus) {
    case "PAID":
      return { label: "Paid", tone: "success" };
    case "FAILED":
      return { label: "Payment failed", tone: "error" };
    case "EXPIRED":
      return { label: "Link expired", tone: "error" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "error" };
    case "CONSUMED":
      return { label: "Paid", tone: "success" };
    case "PENDING":
    default:
      if (a.whatsappStatus === "SENT") return { label: "Sent — waiting for payment", tone: "pending" };
      if (a.whatsappStatus === "FAILED") return { label: "Could not send the WhatsApp message", tone: "error" };
      return { label: "Sending…", tone: "pending" };
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  totalCents: number;
  posSettings: POSSettings | null;
  onConfirm: (payload: POSCheckoutPaymentPayload) => void;
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
  /**
   * The order's existing customer phone, if any — prefills the Pay-by-Link
   * phone field (hard product constraint: prefer the order's phone, else
   * let the cashier type one). Never auto-submitted.
   */
  customerPhone?: string | null;
  /**
   * An already-PAID, never-consumed intent the cashier chose to resume from
   * Pos.tsx's recovery banner. When set, the Pay-by-Link sub-flow offers
   * "Use existing payment" (attach THIS intent by id, no new link sent)
   * ahead of the normal send-a-new-link form.
   */
  resumePaymentIntent?: PaymentIntent | null;
}

type Step =
  | "method"
  | "cash"
  | "card"
  | "other"
  | "split"
  | "split-add"
  | "split-cash"
  | "split-card"
  | "split-other"
  | "split-link";

export default function PaymentDialog({
  open, onClose, totalCents, posSettings, onConfirm, isSubmitting, errorMessage, loyaltyRewardPreview = null,
  customerPhone = null, resumePaymentIntent = null,
}: Props) {
  const [step, setStep] = useState<Step>("method");
  const [cashInput, setCashInput] = useState("");
  const [reference, setReference] = useState("");

  // ── Split-payment state ──────────────────────────────────────────────
  const [allocations, setAllocations] = useState<SplitAllocation[]>([]);
  const [splitCashPhase, setSplitCashPhase] = useState<"amount" | "received">("amount");
  const [allocAmountInput, setAllocAmountInput] = useState("");
  const [allocCashReceivedInput, setAllocCashReceivedInput] = useState("");
  const [allocReferenceInput, setAllocReferenceInput] = useState("");
  const [allocPhoneInput, setAllocPhoneInput] = useState("");
  const [activeLinkAllocationId, setActiveLinkAllocationId] = useState<string | null>(null);
  const [linkCreating, setLinkCreating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [backingOutOfSplit, setBackingOutOfSplit] = useState(false);
  // Dialog-level blocking notice (e.g. LEAVE_WITH_PAID_LINK_MESSAGE).
  const [blockingNotice, setBlockingNotice] = useState<string | null>(null);
  const [resumeChecking, setResumeChecking] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const cashTouch = useTouchField({ value: cashInput, onChange: setCashInput, layout: "CURRENCY" });
  const referenceTouch = useTouchField({ value: reference, onChange: setReference, layout: "QWERTY", maxLength: 255 });
  const allocAmountTouch = useTouchField({ value: allocAmountInput, onChange: setAllocAmountInput, layout: "CURRENCY" });
  const allocCashReceivedTouch = useTouchField({ value: allocCashReceivedInput, onChange: setAllocCashReceivedInput, layout: "CURRENCY" });
  const allocReferenceTouch = useTouchField({ value: allocReferenceInput, onChange: setAllocReferenceInput, layout: "QWERTY", maxLength: 255 });
  const allocPhoneTouch = useTouchField({ value: allocPhoneInput, onChange: setAllocPhoneInput, layout: "PHONE", maxLength: 20 });

  useEffect(() => {
    if (open) {
      setStep("method");
      setCashInput("");
      setReference("");
      setAllocations([]);
      setSplitCashPhase("amount");
      setAllocAmountInput("");
      setAllocCashReceivedInput("");
      setAllocReferenceInput("");
      setAllocPhoneInput(customerPhone?.trim() || "");
      setActiveLinkAllocationId(null);
      setLinkCreating(false);
      setLinkError(null);
      setResendingId(null);
      setCancellingId(null);
      setBackingOutOfSplit(false);
      setBlockingNotice(null);
      setResumeChecking(false);
      setResumeError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A blocking notice / resume error belongs to the screen it was raised on.
  useEffect(() => {
    setBlockingNotice(null);
    setResumeError(null);
  }, [step]);

  const cashTenderedCents = Math.round((parseFloat(cashInput || "0") || 0) * 100);
  const changeDueCents = cashTenderedCents - totalCents;
  const canConfirmCash = cashTenderedCents >= totalCents;

  const quickAmounts = suggestedTenderAmountsCents(totalCents);

  // ── Split-payment derived totals ─────────────────────────────────────
  const allocatedCents = allocations.reduce((sum, a) => sum + a.amountCents, 0);
  const remainingCents = Math.max(0, totalCents - allocatedCents);
  const paidCents = allocations.reduce((sum, a) => sum + (isAllocationSettled(a) ? a.amountCents : 0), 0);
  const hasUnsettledLink = allocations.some((a) => a.method === "PAY_BY_LINK" && a.intentStatus !== "PAID");
  const canCompleteSplit = remainingCents === 0 && !hasUnsettledLink && allocations.length > 0;
  // PAID but not yet consumed (checkout hasn't been submitted) — leaving the
  // payment screen now would lose track of real money.
  const hasPaidLink = allocations.some(isPaidLink);

  const enabledMethodCount = [
    posSettings?.cash_enabled, posSettings?.card_enabled, posSettings?.other_payment_enabled, posSettings?.pay_by_link_enabled,
  ].filter(Boolean).length;
  const splitAvailable = enabledMethodCount >= 2;

  // Poll every ~2.5s for any PAY_BY_LINK allocation still PENDING, for as
  // long as the dialog is open — independent of which split sub-step is
  // currently shown, so a link started, then left to poll in the
  // background while the cashier adds another payment, still resolves.
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      setAllocations((current) => {
        const pending = current.filter(
          (a) => a.method === "PAY_BY_LINK" && a.paymentIntentId && a.intentStatus === "PENDING"
        );
        pending.forEach((a) => {
          getPaymentIntent(a.paymentIntentId!)
            .then((intent) => {
              setAllocations((prev) =>
                prev.map((c) => (c.id === a.id ? { ...c, intentStatus: intent.status, whatsappStatus: intent.whatsapp_status } : c))
              );
            })
            .catch(() => {
              // Transient poll failure — leave state as-is, the next tick retries.
            });
        });
        return current;
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [open]);

  function handleClose() {
    if (isSubmitting) return;
    if (hasPaidLink) {
      setBlockingNotice(LEAVE_WITH_PAID_LINK_MESSAGE);
      return;
    }
    onClose();
  }

  /** Cancel failed — the backend refuses to cancel anything not PENDING, so
   * the customer may have paid since the last poll. Re-read the intent
   * rather than assuming it's gone. Returns the fresh intent, or null if
   * that read failed too (status genuinely unknown). */
  async function refreshAfterFailedCancel(intentId: string): Promise<PaymentIntent | null> {
    try {
      return await getPaymentIntent(intentId);
    } catch {
      return null;
    }
  }

  function startAddAllocation(method: POSSplitPaymentMethod) {
    setAllocAmountInput((remainingCents / 100).toFixed(2));
    setAllocCashReceivedInput("");
    setAllocReferenceInput("");
    setAllocPhoneInput(customerPhone?.trim() || "");
    setSplitCashPhase("amount");
    setLinkError(null);
    if (method === "CASH") setStep("split-cash");
    else if (method === "CARD") setStep("split-card");
    else if (method === "OTHER") setStep("split-other");
    else setStep("split-link");
  }

  const allocAmountCents = Math.round((parseFloat(allocAmountInput || "0") || 0) * 100);
  const allocAmountValid = allocAmountCents > 0 && allocAmountCents <= remainingCents;
  const allocCashReceivedCents = Math.round((parseFloat(allocCashReceivedInput || "0") || 0) * 100);
  const allocChangeDueCents = allocCashReceivedCents - allocAmountCents;

  function addCashAllocation() {
    setAllocations((prev) => [
      ...prev,
      { id: newAllocationId(), method: "CASH", amountCents: allocAmountCents, cashTenderedCents: allocCashReceivedCents },
    ]);
    setStep("split");
  }

  function addCardOrOtherAllocation(method: "CARD" | "OTHER") {
    setAllocations((prev) => [
      ...prev,
      { id: newAllocationId(), method, amountCents: allocAmountCents, paymentReference: allocReferenceInput.trim() || undefined },
    ]);
    setStep("split");
  }

  async function sendPaymentLink() {
    if (!allocAmountValid || !looksLikeSaPhoneNumber(allocPhoneInput) || linkCreating) return;
    setLinkCreating(true);
    setLinkError(null);
    const id = newAllocationId();
    try {
      const intent = await createPaymentIntent({ amount_cents: allocAmountCents, customer_phone: allocPhoneInput.trim() });
      setAllocations((prev) => [
        ...prev,
        {
          id,
          method: "PAY_BY_LINK",
          amountCents: allocAmountCents,
          paymentIntentId: intent.id,
          intentStatus: intent.status,
          whatsappStatus: intent.whatsapp_status,
          maskedPhone: maskPhoneForStatus(allocPhoneInput),
        },
      ]);
      setActiveLinkAllocationId(id);
    } catch (err) {
      const apiErr = err as ApiFetchError;
      setLinkError(apiErr?.message ?? "Could not create the payment link — try again.");
    } finally {
      setLinkCreating(false);
    }
  }

  async function handleResend(allocationId: string) {
    const alloc = allocations.find((a) => a.id === allocationId);
    if (!alloc?.paymentIntentId || resendingId) return;
    setResendingId(allocationId);
    setLinkError(null);
    try {
      const intent = await resendPaymentIntent(alloc.paymentIntentId);
      setAllocations((prev) =>
        prev.map((a) => (a.id === allocationId ? { ...a, intentStatus: intent.status, whatsappStatus: intent.whatsapp_status } : a))
      );
    } catch (err) {
      const apiErr = err as ApiFetchError;
      setLinkError(apiErr?.message ?? "Could not resend the payment link — try again.");
    } finally {
      setResendingId(null);
    }
  }

  async function removeAllocation(allocationId: string) {
    const alloc = allocations.find((a) => a.id === allocationId);
    if (alloc?.method === "PAY_BY_LINK" && alloc.intentStatus === "PENDING" && alloc.paymentIntentId) {
      setCancellingId(allocationId);
      let paidMeanwhile: PaymentIntent | null = null;
      try {
        await cancelPaymentIntent(alloc.paymentIntentId);
      } catch {
        // If the customer paid between the last poll and this cancel, the
        // backend refused (422 PAYMENT_INTENT_NOT_PENDING) — keep the now-PAID
        // allocation instead of silently dropping received money. Any other
        // failure stays best-effort as before: a stray PENDING intent simply
        // expires, and checkout can never reference it once it's removed
        // from this list (a PAID one would still surface in Pos.tsx's
        // unconsumed-paid banner).
        const latest = await refreshAfterFailedCancel(alloc.paymentIntentId);
        if (latest?.status === "PAID") paidMeanwhile = latest;
      } finally {
        setCancellingId(null);
      }
      if (paidMeanwhile) {
        const latest = paidMeanwhile;
        setAllocations((prev) =>
          prev.map((a) => (a.id === allocationId ? { ...a, intentStatus: latest.status, whatsappStatus: latest.whatsapp_status } : a))
        );
        setActiveLinkAllocationId(null);
        if (step === "split") {
          setBlockingNotice(LEAVE_WITH_PAID_LINK_MESSAGE);
        } else {
          setStep("split");
          // Raised after the step-change effect has cleared notices.
          setTimeout(() => setBlockingNotice(LEAVE_WITH_PAID_LINK_MESSAGE), 0);
        }
        return;
      }
    }
    setAllocations((prev) => prev.filter((a) => a.id !== allocationId));
    if (activeLinkAllocationId === allocationId) {
      setActiveLinkAllocationId(null);
      setStep("split");
    }
  }

  // Backing all the way out of split payment discards every allocation —
  // for Cash/Card/Other that's just local UI state, but a PAY_BY_LINK
  // allocation still PENDING is a real, live server-side intent. Cancel
  // each of those first rather than silently abandoning them (same rule as
  // the single-allocation remove button above).
  //
  // A PAID (not yet consumed) Pay-by-Link allocation blocks this outright:
  // that's received money, and discarding it here is exactly the
  // "payment disappears with no order" gap this guard closes.
  async function handleBackFromSplit() {
    if (hasPaidLink) {
      setBlockingNotice(LEAVE_WITH_PAID_LINK_MESSAGE);
      return;
    }
    const pendingLinks = allocations.filter(
      (a) => a.method === "PAY_BY_LINK" && a.intentStatus === "PENDING" && a.paymentIntentId
    );
    setBackingOutOfSplit(true);
    const outcomes = await Promise.all(
      pendingLinks.map(async (a) => {
        try {
          const cancelled: PaymentIntent | null = await cancelPaymentIntent(a.paymentIntentId!);
          return { allocationId: a.id, intent: cancelled };
        } catch {
          // Same race as removeAllocation: a refused cancel may mean it was
          // just paid. Re-read before discarding.
          return { allocationId: a.id, intent: await refreshAfterFailedCancel(a.paymentIntentId!) };
        }
      })
    );
    setBackingOutOfSplit(false);
    if (outcomes.some((o) => o.intent?.status === "PAID")) {
      // Stay on the split screen with every allocation's latest known state.
      const latestById = new Map<string, PaymentIntent>();
      outcomes.forEach((o) => {
        if (o.intent) latestById.set(o.allocationId, o.intent);
      });
      setAllocations((prev) =>
        prev.map((c) => {
          const latest = latestById.get(c.id);
          return latest ? { ...c, intentStatus: latest.status, whatsappStatus: latest.whatsapp_status } : c;
        })
      );
      setBlockingNotice(LEAVE_WITH_PAID_LINK_MESSAGE);
      return;
    }
    setAllocations([]);
    setStep("method");
  }

  // "Use existing payment" — attach an ALREADY-PAID, never-consumed intent
  // (from Pos.tsx's recovery banner) as this checkout's Pay-by-Link
  // allocation, by id. No new intent is created and nothing is sent: the
  // money is already received. Re-read first so a payment another device
  // has meanwhile used (or one that's somehow no longer PAID) is refused
  // here rather than at checkout. The allocation amount is the intent's own
  // server-side amount — the backend rejects any other figure
  // (PAYMENT_INTENT_AMOUNT_MISMATCH) — so it's never editable.
  async function useExistingPayment() {
    if (!resumePaymentIntent || resumeChecking) return;
    setResumeChecking(true);
    setResumeError(null);
    try {
      const latest = await getPaymentIntent(resumePaymentIntent.id);
      if (latest.status !== "PAID" || latest.order_id) {
        setResumeError("This payment has already been used for a sale or is no longer available.");
        return;
      }
      if (latest.amount_cents > remainingCents) {
        setResumeError(
          `This payment is ${formatCurrency(latest.amount_cents)}, more than the ${formatCurrency(remainingCents)} still owing.`
        );
        return;
      }
      setAllocations((prev) => [
        ...prev,
        {
          id: newAllocationId(),
          method: "PAY_BY_LINK",
          amountCents: latest.amount_cents,
          paymentIntentId: latest.id,
          intentStatus: latest.status,
          whatsappStatus: latest.whatsapp_status,
          maskedPhone: latest.customer_phone_masked ?? undefined,
          resumed: true,
        },
      ]);
      setStep("split");
    } catch (err) {
      const apiErr = err as ApiFetchError;
      setResumeError(apiErr?.message ?? "Couldn't confirm this payment with the server — try again.");
    } finally {
      setResumeChecking(false);
    }
  }

  function handleCompleteSplit() {
    onConfirm({
      payments: allocations.map((a) => ({
        payment_method: a.method,
        amount_cents: a.amountCents,
        ...(a.method === "CASH" && a.cashTenderedCents != null ? { cash_tendered_cents: a.cashTenderedCents } : {}),
        ...(a.paymentReference ? { payment_reference: a.paymentReference } : {}),
        ...(a.method === "PAY_BY_LINK" && a.paymentIntentId ? { payment_intent_id: a.paymentIntentId } : {}),
      })),
    });
  }

  const activeLinkAllocation = allocations.find((a) => a.id === activeLinkAllocationId) ?? null;
  const resumeOffer =
    resumePaymentIntent &&
    resumePaymentIntent.status === "PAID" &&
    !resumePaymentIntent.order_id &&
    !allocations.some((a) => a.paymentIntentId === resumePaymentIntent.id)
      ? resumePaymentIntent
      : null;

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
            {step === "split" && "Split payment"}
            {step === "split-add" && "Add a payment"}
            {step === "split-cash" && "Cash — split payment"}
            {step === "split-card" && "Card — split payment"}
            {step === "split-other" && "Other — split payment"}
            {step === "split-link" && "Pay by Link (WhatsApp)"}
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
        {blockingNotice && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {blockingNotice}
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
            {splitAvailable && (
              <button
                type="button"
                onClick={() => setStep("split")}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card text-sm font-semibold text-foreground shadow-sm transition-colors duration-fast hover:border-brand-border hover:bg-brand-soft active:bg-muted"
              >
                <Split className="h-4 w-4" /> Split payment
              </button>
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

        {step === "split" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-success/10 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-success">Paid</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums text-success">{formatCurrency(paidCents)}</p>
              </div>
              <div className={cn("rounded-xl px-3 py-2.5", remainingCents > 0 ? "bg-destructive/10" : "bg-success/10")}>
                <p className={cn("text-[11px] font-medium uppercase tracking-wide", remainingCents > 0 ? "text-destructive" : "text-success")}>
                  Remaining
                </p>
                <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", remainingCents > 0 ? "text-destructive" : "text-success")}>
                  {formatCurrency(remainingCents)}
                </p>
              </div>
            </div>

            {allocations.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">No payments added yet.</p>
            ) : (
              <ul className="space-y-2">
                {allocations.map((a, idx) => {
                  // A PAID link created here can't be removed (it's received
                  // money — complete the sale). A RESUMED one can: removing it
                  // only detaches it locally; it stays unconsumed server-side
                  // and stays in Pos.tsx's recovery banner.
                  const canRemove = a.method !== "PAY_BY_LINK" || a.intentStatus !== "PAID" || a.resumed === true;
                  const linkStatus = a.method === "PAY_BY_LINK" ? describeLinkStatus(a) : null;
                  const isOpenable = a.method === "PAY_BY_LINK" && a.intentStatus !== "PAID";
                  return (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5"
                    >
                      <button
                        type="button"
                        disabled={!isOpenable}
                        onClick={() => {
                          if (!isOpenable) return;
                          setActiveLinkAllocationId(a.id);
                          setStep("split-link");
                        }}
                        className="flex-1 text-left disabled:cursor-default"
                      >
                        <p className="text-sm font-semibold text-foreground">
                          Payment {idx + 1} · {a.method === "PAY_BY_LINK" ? "Pay by Link" : a.method}
                          {a.resumed && <span className="font-normal text-muted-foreground"> · existing payment</span>}
                        </p>
                        <p className="text-sm tabular-nums text-muted-foreground">{formatCurrency(a.amountCents)}</p>
                        {linkStatus && (
                          <p className={cn(
                            "text-xs font-medium",
                            linkStatus.tone === "success" && "text-success",
                            linkStatus.tone === "error" && "text-destructive",
                            linkStatus.tone === "pending" && "text-muted-foreground"
                          )}>
                            {linkStatus.label}
                          </p>
                        )}
                      </button>
                      {canRemove && (
                        <button
                          type="button"
                          onClick={() => removeAllocation(a.id)}
                          disabled={cancellingId === a.id || isSubmitting}
                          aria-label={`Remove payment ${idx + 1}`}
                          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50"
                        >
                          {cancellingId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {remainingCents > 0 && (
              <button
                type="button"
                onClick={() => setStep("split-add")}
                className="flex h-14 w-full items-center justify-center rounded-xl border border-dashed border-border text-sm font-semibold text-foreground active:bg-muted"
              >
                + Add payment
              </button>
            )}

            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

            <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-2 border-t border-border bg-background px-6 py-4">
              <button
                type="button"
                onClick={handleBackFromSplit}
                disabled={isSubmitting || backingOutOfSplit}
                className="flex h-14 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground disabled:opacity-50"
              >
                {backingOutOfSplit ? <Loader2 className="h-5 w-5 animate-spin" /> : "Back"}
              </button>
              <button
                type="button"
                onClick={handleCompleteSplit}
                disabled={!canCompleteSplit || isSubmitting}
                className="flex h-14 flex-[2] items-center justify-center rounded-lg bg-success text-sm font-semibold text-success-foreground disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Complete sale"}
              </button>
            </div>
          </div>
        )}

        {step === "split-add" && (
          <div className="space-y-2">
            <p className="text-center text-sm text-muted-foreground">
              {formatCurrency(remainingCents)} remaining
            </p>
            {posSettings?.cash_enabled && (
              <button type="button" onClick={() => startAddAllocation("CASH")}
                className="flex h-16 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-semibold text-foreground shadow-sm active:bg-muted">
                💵 Cash
              </button>
            )}
            {posSettings?.card_enabled && (
              <button type="button" onClick={() => startAddAllocation("CARD")}
                className="flex h-16 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-semibold text-foreground shadow-sm active:bg-muted">
                💳 Card
              </button>
            )}
            {posSettings?.other_payment_enabled && (
              <button type="button" onClick={() => startAddAllocation("OTHER")}
                className="flex h-16 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-semibold text-foreground shadow-sm active:bg-muted">
                Other
              </button>
            )}
            {posSettings?.pay_by_link_enabled && (
              <button type="button" onClick={() => startAddAllocation("PAY_BY_LINK")}
                className="flex h-16 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-semibold text-foreground shadow-sm active:bg-muted">
                📱 Pay by Link (WhatsApp)
              </button>
            )}
            <button
              type="button"
              onClick={() => setStep("split")}
              className="mt-2 flex h-12 w-full items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground"
            >
              Back
            </button>
          </div>
        )}

        {step === "split-cash" && splitCashPhase === "amount" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Amount to apply to bill</label>
              <input
                type="number"
                inputMode={allocAmountTouch.touchActive ? undefined : "decimal"}
                step="0.01"
                min="0"
                autoFocus
                value={allocAmountInput}
                onChange={(e) => setAllocAmountInput(e.target.value)}
                className="flex h-14 w-full rounded-lg border border-border bg-secondary px-4 text-xl font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                {...allocAmountTouch.fieldProps}
              />
              {allocAmountCents > remainingCents && (
                <p className="text-xs text-destructive">Can't exceed the remaining balance, {formatCurrency(remainingCents)}.</p>
              )}
            </div>
            <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-2 border-t border-border bg-background px-6 py-4">
              <button type="button" onClick={() => setStep("split-add")} className="flex h-14 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground">
                Back
              </button>
              <button
                type="button"
                onClick={() => setSplitCashPhase("received")}
                disabled={!allocAmountValid}
                className="flex h-14 flex-[2] items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === "split-cash" && splitCashPhase === "received" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-center text-sm text-muted-foreground">
              Applying {formatCurrency(allocAmountCents)} of this payment to the bill
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Cash received</label>
              <input
                type="number"
                inputMode={allocCashReceivedTouch.touchActive ? undefined : "decimal"}
                step="0.01"
                min="0"
                autoFocus
                value={allocCashReceivedInput}
                onChange={(e) => setAllocCashReceivedInput(e.target.value)}
                placeholder="0.00"
                className="flex h-14 w-full rounded-lg border border-border bg-secondary px-4 text-xl font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                {...allocCashReceivedTouch.fieldProps}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {suggestedTenderAmountsCents(allocAmountCents).map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setAllocCashReceivedInput((amt / 100).toFixed(2))}
                  className={cn(
                    "flex h-11 items-center justify-center rounded-lg border text-sm font-medium transition-colors",
                    allocCashReceivedCents === amt ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary text-foreground active:bg-muted"
                  )}
                >
                  {amt === allocAmountCents ? "Exact" : formatCurrency(amt)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tendered</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">{formatCurrency(allocCashReceivedCents)}</p>
              </div>
              <div className={cn("rounded-xl px-3 py-2.5", allocChangeDueCents < 0 ? "bg-destructive/10" : "bg-success/10")}>
                <p className={cn("text-[11px] font-medium uppercase tracking-wide", allocChangeDueCents < 0 ? "text-destructive" : "text-success")}>
                  {allocChangeDueCents < 0 ? "Still owing" : "Change due"}
                </p>
                <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", allocChangeDueCents < 0 ? "text-destructive" : "text-success")}>
                  {formatCurrency(Math.abs(allocChangeDueCents))}
                </p>
              </div>
            </div>
            <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-2 border-t border-border bg-background px-6 py-4">
              <button type="button" onClick={() => setSplitCashPhase("amount")} className="flex h-14 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground">
                Back
              </button>
              <button
                type="button"
                onClick={addCashAllocation}
                disabled={allocCashReceivedCents < allocAmountCents}
                className="flex h-14 flex-[2] items-center justify-center rounded-lg bg-success text-sm font-semibold text-success-foreground disabled:opacity-50"
              >
                Add payment
              </button>
            </div>
          </div>
        )}

        {(step === "split-card" || step === "split-other") && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Amount to apply to bill</label>
              <input
                type="number"
                inputMode={allocAmountTouch.touchActive ? undefined : "decimal"}
                step="0.01"
                min="0"
                autoFocus
                value={allocAmountInput}
                onChange={(e) => setAllocAmountInput(e.target.value)}
                className="flex h-14 w-full rounded-lg border border-border bg-secondary px-4 text-xl font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                {...allocAmountTouch.fieldProps}
              />
              {allocAmountCents > remainingCents && (
                <p className="text-xs text-destructive">Can't exceed the remaining balance, {formatCurrency(remainingCents)}.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Reference (optional)</label>
              <input
                value={allocReferenceInput}
                onChange={(e) => setAllocReferenceInput(e.target.value)}
                placeholder="Terminal / transaction reference"
                className="flex h-12 w-full rounded-lg border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                {...allocReferenceTouch.fieldProps}
              />
            </div>
            <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-2 border-t border-border bg-background px-6 py-4">
              <button type="button" onClick={() => setStep("split-add")} className="flex h-14 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground">
                Back
              </button>
              <button
                type="button"
                onClick={() => addCardOrOtherAllocation(step === "split-card" ? "CARD" : "OTHER")}
                disabled={!allocAmountValid}
                className="flex h-14 flex-[2] items-center justify-center rounded-lg bg-success text-sm font-semibold text-success-foreground disabled:opacity-50"
              >
                Add payment
              </button>
            </div>
          </div>
        )}

        {step === "split-link" && !activeLinkAllocation && (
          <div className="space-y-4">
            {resumeOffer && (() => {
              const fits = resumeOffer.amount_cents <= remainingCents;
              const receivedAt = formatIntentReceivedAt(resumeOffer.paid_at);
              return (
                <div className="space-y-2 rounded-xl border border-success/40 bg-success/5 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-success">Payment already received</p>
                  <button
                    type="button"
                    onClick={useExistingPayment}
                    disabled={!fits || resumeChecking}
                    className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-success px-3 py-2 text-sm font-semibold text-success-foreground disabled:opacity-50"
                  >
                    {resumeChecking ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      `Use existing payment (${formatCurrency(resumeOffer.amount_cents)}${receivedAt ? `, received ${receivedAt}` : ""})`
                    )}
                  </button>
                  {!fits && (
                    <p className="text-xs text-destructive">
                      This payment is {formatCurrency(resumeOffer.amount_cents)}, more than the {formatCurrency(remainingCents)} still
                      owing. Add items to the sale (or remove another payment) before using it.
                    </p>
                  )}
                  {resumeError && <p className="text-sm text-destructive">{resumeError}</p>}
                  <p className="pt-1 text-center text-xs text-muted-foreground">Or send a new payment link:</p>
                </div>
              );
            })()}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Amount to apply to bill</label>
              <input
                type="number"
                inputMode={allocAmountTouch.touchActive ? undefined : "decimal"}
                step="0.01"
                min="0"
                value={allocAmountInput}
                onChange={(e) => setAllocAmountInput(e.target.value)}
                className="flex h-14 w-full rounded-lg border border-border bg-secondary px-4 text-xl font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                {...allocAmountTouch.fieldProps}
              />
              {allocAmountCents > remainingCents && (
                <p className="text-xs text-destructive">Can't exceed the remaining balance, {formatCurrency(remainingCents)}.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Customer's WhatsApp number</label>
              <input
                value={allocPhoneInput}
                onChange={(e) => setAllocPhoneInput(e.target.value)}
                placeholder="082 123 4567"
                inputMode={allocPhoneTouch.touchActive ? undefined : "tel"}
                className="flex h-14 w-full rounded-lg border border-border bg-secondary px-4 text-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                {...allocPhoneTouch.fieldProps}
              />
              {allocPhoneInput.trim().length > 0 && !looksLikeSaPhoneNumber(allocPhoneInput) && (
                <p className="text-xs text-destructive">Enter a valid South African mobile number, e.g. 082 123 4567.</p>
              )}
            </div>
            {linkError && <p className="text-sm text-destructive">{linkError}</p>}
            <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-2 border-t border-border bg-background px-6 py-4">
              <button type="button" onClick={() => setStep("split-add")} disabled={linkCreating} className="flex h-14 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground disabled:opacity-50">
                Back
              </button>
              <button
                type="button"
                onClick={sendPaymentLink}
                disabled={!allocAmountValid || !looksLikeSaPhoneNumber(allocPhoneInput) || linkCreating}
                className="flex h-14 flex-[2] items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {linkCreating ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send link"}
              </button>
            </div>
          </div>
        )}

        {step === "split-link" && activeLinkAllocation && (() => {
          const status = describeLinkStatus(activeLinkAllocation);
          const isPending = activeLinkAllocation.intentStatus === "PENDING";
          return (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-muted/40 p-4 text-center">
                {status.tone === "pending" && <Loader2 className="h-8 w-8 animate-spin text-primary" />}
                <p className="text-sm font-semibold text-foreground">{formatCurrency(activeLinkAllocation.amountCents)}</p>
                <p className="text-xs text-muted-foreground">{activeLinkAllocation.maskedPhone}</p>
                <p className={cn(
                  "text-sm font-medium",
                  status.tone === "success" && "text-success",
                  status.tone === "error" && "text-destructive",
                  status.tone === "pending" && "text-muted-foreground"
                )}>
                  {status.label}
                </p>
              </div>
              {linkError && <p className="text-sm text-destructive">{linkError}</p>}
              <div className="flex gap-2">
                {isPending && (
                  <button
                    type="button"
                    onClick={() => handleResend(activeLinkAllocation.id)}
                    disabled={resendingId === activeLinkAllocation.id}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-foreground disabled:opacity-50"
                  >
                    {resendingId === activeLinkAllocation.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resend"}
                  </button>
                )}
                {isPending && (
                  <button
                    type="button"
                    onClick={() => removeAllocation(activeLinkAllocation.id)}
                    disabled={cancellingId === activeLinkAllocation.id}
                    className="flex h-12 flex-1 items-center justify-center rounded-lg border border-destructive text-sm font-medium text-destructive disabled:opacity-50"
                  >
                    {cancellingId === activeLinkAllocation.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancel"}
                  </button>
                )}
                {!isPending && status.tone === "error" && (
                  <button
                    type="button"
                    onClick={() => removeAllocation(activeLinkAllocation.id)}
                    className="flex h-12 flex-1 items-center justify-center rounded-lg border border-destructive text-sm font-medium text-destructive"
                  >
                    Remove
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveLinkAllocationId(null);
                  setStep("split");
                }}
                className="flex h-14 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
              >
                Back to split payment
              </button>
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}
