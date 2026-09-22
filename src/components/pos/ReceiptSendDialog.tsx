import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageCircleWarning, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiClient } from "@/lib/api";
import type { ApiFetchError } from "@/lib/api";
import type { POSReceiptResponse } from "@/types";
import { looksLikeSaPhoneNumber } from "@/lib/phone";
import { useTouchField } from "@/hooks/useTouchField";

/**
 * The single reusable "send this order's digital receipt over WhatsApp"
 * dialog — used both right after a POS checkout (Pos.tsx, force_resend
 * always false since the receipt is brand new) and from Order Detail's
 * OWNER/MANAGER-only "Resend receipt" action (force_resend always true,
 * since a resend there is explicitly about an already-SENT/DELIVERED
 * receipt — see backend/app/api/v1/routes_pos.py::request_pos_receipt and
 * backend/app/receipts/whatsapp_receipt.py's FORCE_RESEND_ROLES docstring).
 * A FAILED status is always retryable without force_resend regardless of
 * which caller opened this — that rule lives once, here, not duplicated at
 * each call site.
 */

type Step = "form" | "sending" | "result";

interface ResultState {
  kind: "sent" | "failed" | "queued" | "disabled" | "transport_error";
  reason?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string;
  /** The order's already-captured customer phone, if any — prefilled, editable. */
  prefillPhone?: string | null;
  /** True only for the OWNER/MANAGER "Resend receipt" action on a past order. */
  forceResend?: boolean;
  title?: string;
  /**
   * True when a print was also requested alongside this WhatsApp send (the
   * "Both" choice at checkout) — used only to soften the "WhatsApp isn't
   * available" copy, never to fabricate a WhatsApp success.
   */
  printAlsoRequested?: boolean;
}

export default function ReceiptSendDialog({
  open, onClose, orderId, prefillPhone, forceResend = false, title, printAlsoRequested = false,
}: Props) {
  const [step, setStep] = useState<Step>("form");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<ResultState | null>(null);

  const phoneTouch = useTouchField({ value: phone, onChange: setPhone, layout: "PHONE", maxLength: 20 });

  useEffect(() => {
    if (open) {
      setStep("form");
      setPhone(prefillPhone?.trim() || "");
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillPhone]);

  const phoneValid = looksLikeSaPhoneNumber(phone);

  async function send() {
    setStep("sending");
    try {
      const response = await apiClient.post<POSReceiptResponse>(
        `/v1/business/pos/orders/${orderId}/receipt`,
        { channels: ["WHATSAPP"], phone_number: phone.trim(), force_resend: forceResend }
      );
      applyResponse(response);
    } catch (err) {
      const apiErr = err as ApiFetchError;
      setResult({ kind: "transport_error", reason: apiErr?.message ?? "Could not reach the server" });
      setStep("result");
    }
  }

  function applyResponse(response: POSReceiptResponse) {
    if (response.whatsapp_requested && response.whatsapp_status === "NOT_REQUESTED") {
      // Never a delivery failure — the WHATSAPP channel is simply off for
      // this business (business.digital_receipts_enabled is false). See
      // send_digital_receipt's own docstring: status is deliberately left
      // as NOT_REQUESTED rather than FAILED for this case.
      setResult({ kind: "disabled" });
    } else if (response.whatsapp_status === "SENT" || response.whatsapp_status === "DELIVERED") {
      setResult({ kind: "sent" });
    } else if (response.whatsapp_status === "FAILED") {
      setResult({ kind: "failed", reason: response.whatsapp_failure_reason });
    } else {
      // QUEUED (or any other transitional value) — the backend send is
      // synchronous today so this should be momentary/rare, but the
      // contract doesn't promise it never happens.
      setResult({ kind: "queued" });
    }
    setStep("result");
  }

  function handleRetry() {
    void send();
  }

  function handleEditNumber() {
    setStep("form");
    setResult(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? "Send receipt via WhatsApp"}</DialogTitle>
        </DialogHeader>

        {step === "form" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Customer's WhatsApp number</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="082 123 4567"
                inputMode={phoneTouch.touchActive ? undefined : "tel"}
                autoFocus
                className="flex h-14 w-full rounded-lg border border-border bg-secondary px-4 text-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                {...phoneTouch.fieldProps}
              />
              {phone.trim().length > 0 && !phoneValid && (
                <p className="text-xs text-destructive">Enter a valid South African mobile number, e.g. 082 123 4567.</p>
              )}
            </div>
            <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-2 border-t border-border bg-background px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                className="flex h-14 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={send}
                disabled={!phoneValid}
                className="flex h-14 flex-[2] items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                <Send className="h-4 w-4" /> Send
              </button>
            </div>
          </div>
        )}

        {step === "sending" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Sending the receipt…</p>
          </div>
        )}

        {step === "result" && result?.kind === "sent" && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-success" />
              <p className="text-sm font-semibold text-foreground">Receipt sent</p>
              <p className="text-xs text-muted-foreground">Sent to {phone.trim()}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-14 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
            >
              Done
            </button>
          </div>
        )}

        {step === "result" && (result?.kind === "failed" || result?.kind === "transport_error") && (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-center">
              <p className="text-sm font-semibold text-destructive">Could not send the receipt</p>
              <p className="mt-1 text-xs text-muted-foreground">{result.reason || "Unknown error — try again."}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleEditNumber}
                className="flex h-12 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground"
              >
                Edit number
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="flex h-12 flex-[2] items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {step === "result" && result?.kind === "queued" && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-semibold text-foreground">Still sending</p>
              <p className="text-xs text-muted-foreground">This can take a moment — check back shortly.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-14 w-full items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground"
            >
              Close
            </button>
          </div>
        )}

        {step === "result" && result?.kind === "disabled" && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <MessageCircleWarning className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">WhatsApp receipts aren't enabled</p>
              <p className="text-xs text-muted-foreground">
                {printAlsoRequested
                  ? "Ask a manager to turn this on in Settings — the printed receipt is still on its way."
                  : "Ask a manager to turn this on in Settings, or print a receipt instead."}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-14 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
            >
              OK
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
