import { useTouchField } from "@/hooks/useTouchField";
import { notifyProblem } from "@/lib/ready-notify";

export interface ReadyNotifyState {
  phone: string;
  onPhoneChange: (v: string) => void;
  consent: boolean;
  onConsentChange: (v: boolean) => void;
  /** True in training mode: the section is not shown at all. */
  trainingMode: boolean;
  /** False offline: shown disabled, never promising a notification. */
  online: boolean;
}

/**
 * Optional "message the customer when their order is ready" opt-in. The
 * phone is only attached to the sale when the consent box is ticked (see
 * lib/ready-notify.ts). Nothing is sent from the frontend.
 */
export default function ReadyNotifyOptIn({ phone, onPhoneChange, consent, onConsentChange, trainingMode, online }: ReadyNotifyState) {
  const phoneTouch = useTouchField({ value: phone, onChange: onPhoneChange, layout: "PHONE", maxLength: 20 });
  if (trainingMode) return null;

  if (!online) {
    return (
      <div data-testid="ready-notify-offline" className="space-y-1 rounded-lg border border-border bg-muted/40 p-3">
        <span className="text-xs font-medium text-muted-foreground">Notify customer when ready (WhatsApp)</span>
        <p className="text-xs text-muted-foreground">
          Needs internet, so it is unavailable while offline. This sale will not send a notification.
        </p>
      </div>
    );
  }

  const problem = notifyProblem({ notifyPhone: phone, consent, available: true });
  return (
    <div data-testid="ready-notify" className="space-y-2 rounded-lg border border-border p-3">
      <label className="flex items-start gap-2 text-sm font-medium text-foreground">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => onConsentChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span>Notify customer when ready (WhatsApp) - customer agrees to be messaged</span>
      </label>
      {consent && (
        <>
          <input
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="Customer WhatsApp number"
            aria-label="Customer WhatsApp number"
            inputMode={phoneTouch.touchActive ? undefined : "tel"}
            className="flex h-11 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            {...phoneTouch.fieldProps}
          />
          {problem && <p className="text-xs text-destructive">{problem}</p>}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Requires this stall&apos;s own WhatsApp number to be connected. The number is only attached to the sale when this box is ticked.
      </p>
    </div>
  );
}
