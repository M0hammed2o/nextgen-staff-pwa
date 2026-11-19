import { useEffect, useState, useSyncExternalStore } from "react";
import { GraduationCap, CalendarClock, Ban, Clock, UploadCloud } from "lucide-react";
import { useOffline } from "@/lib/offline/offline-context";
import { useEventAccess } from "@/lib/offline/event-access";
import { clockSkewStore, isClockSkewed, staleQueueState, thresholdsFor, CLOCK_SKEW_WARN_MS } from "@/lib/offline/capture";
import type { EventAccessState } from "@/lib/offline/event-access";

export function TrainingBanner({ onExit, sales }: { onExit: () => void; sales: number }) {
  return (
    <div role="status" data-testid="training-banner" className="border-b-2 border-warning bg-warning/20 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <GraduationCap className="h-5 w-5 flex-shrink-0 text-foreground" />
          <p className="text-sm font-bold uppercase tracking-wide text-foreground">
            Training — not real sales
            {sales > 0 && (
              <span className="ml-2 text-xs font-medium normal-case">
                ({sales} practice sale{sales === 1 ? "" : "s"})
              </span>
            )}
          </p>
        </div>
        <button type="button" onClick={onExit} className="h-9 flex-shrink-0 rounded-lg border border-foreground/30 bg-card px-3 text-xs font-semibold">
          Exit training
        </button>
      </div>
      <p className="mt-1 text-xs text-foreground/80">
        Nothing here is sent to the server, taken off stock, or counted in payments or reports. Leaving training clears these practice sales.
      </p>
    </div>
  );
}

export function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export interface AccessCopy {
  /** "info" = set-up before trading starts; "stop" = selling is switched off. */
  tone: "info" | "stop";
  title: string;
  detail: string;
  /** One line under the Checkout button explaining why it is disabled. */
  checkout: string;
}

const PRACTISE = " You can practise in Training mode.";

/**
 * What the till says for a non-trading event vendor, from the server's
 * `reason` (backend app/events/rules.py evaluate_access). It used to say
 * "Set-up mode — trading opens when your paid event day starts" for every
 * CONFIGURE reason and print the raw code underneath, which was wrong once a
 * vendor's paid days were over while the event was still running
 * (NO_PAID_COVER_TODAY). Unknown reasons fall back on the access level.
 * Display only: the server still refuses the sale whatever this says.
 */
export function describeEventAccess(access: EventAccessState): AccessCopy | null {
  if (access.suspended) {
    return {
      tone: "stop",
      title: "This stall is no longer trading",
      detail:
        "The account has been suspended (for example the event was cancelled). New sales are switched off. Sales already saved on this device stay here and upload if access is restored. Contact your event organiser.",
      checkout: "This stall is no longer trading: new sales are switched off.",
    };
  }
  if (!access.isEventVendor || access.level === "TRADE") return null;
  switch (access.reason) {
    case "CANCELLED":
      return {
        tone: "stop",
        title: "This event was cancelled — sales are switched off",
        detail: "Contact your event organiser. Sales already saved on this device stay here.",
        checkout: "The event was cancelled: selling is switched off.",
      };
    case "EVENT_ENDED":
      return {
        tone: "stop",
        title: "The event has ended — sales are switched off",
        detail: "The event's last day is over, so new sales can no longer be taken.",
        checkout: "The event has ended: selling is switched off.",
      };
    case "NO_PAID_COVER_TODAY":
      return {
        tone: "stop",
        title: "No paid event day today — sales are switched off",
        detail:
          "Today is an event day, but none of your paid days covers it. To trade today the owner can pay for this day in the manager app (Event), or ask the event organiser.",
        checkout: "No paid event day covers today: selling is switched off." + PRACTISE,
      };
    case "NOT_AN_EVENT_DAY":
      return {
        tone: "stop",
        title: "Not an event day — sales are switched off",
        detail: "Selling opens again on the next event day you have paid for.",
        checkout: "Today is not an event day: selling is switched off." + PRACTISE,
      };
    case "PREP_WINDOW":
      return {
        tone: "info",
        title: "Set-up mode — the event has not started yet",
        detail: "Set up your stall now. Selling opens on your first paid event day.",
        checkout: "Set-up mode: selling opens on your first paid event day." + PRACTISE,
      };
    case "CALENDAR_NOT_PUBLISHED":
      return {
        tone: "info",
        title: "Set-up mode — the event days are not published yet",
        detail: "Selling opens once the organiser publishes the event days and a paid day starts.",
        checkout: "Set-up mode: the event days are not published yet." + PRACTISE,
      };
    case "BEFORE_PREP_WINDOW":
      return {
        tone: "stop",
        title: "The event has not opened yet",
        detail: "Set-up opens a few days before the event starts.",
        checkout: "The event has not opened yet: selling is switched off." + PRACTISE,
      };
    case "EMAIL_NOT_VERIFIED":
      return {
        tone: "stop",
        title: "Selling is locked until the owner's email is verified",
        detail: "The owner must use the link in the verification email, or request a new one in the manager app.",
        checkout: "Selling is locked until the owner's email is verified." + PRACTISE,
      };
  }
  if (access.level === "CONFIGURE") {
    return {
      tone: "info",
      title: "Set-up mode — selling is switched off",
      detail: "Selling opens when a paid event day covers today.",
      checkout: "Set-up mode: selling opens when a paid event day covers today." + PRACTISE,
    };
  }
  return {
    tone: "stop",
    title: "Your event access has ended — sales are switched off",
    detail: "There is no paid event day covering today. Contact your event organiser to renew.",
    checkout: "Your event access has ended: selling is switched off." + PRACTISE,
  };
}

export function EventAccessBanner({ access }: { access: EventAccessState }) {
  const stale = access.stale ? " (last known status; reconnect to refresh)" : "";
  if (access.syncOnly && !access.suspended) {
    const deadline = formatDeadline(access.syncOnlyUntil);
    return (
      <div role="alert" data-testid="event-sync-only-banner" className="border-b border-primary/40 bg-primary/10 px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <UploadCloud className="h-4 w-4 flex-shrink-0" />
          Event ended — upload your offline sales only
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          New sales are switched off. Sales saved on this device while offline still upload
          {deadline ? ` until ${deadline}` : ""}. Keep this device online and tap Sync now in Offline sales.{stale}
        </p>
      </div>
    );
  }
  const copy = describeEventAccess(access);
  if (!copy) return null;
  if (copy.tone === "info") {
    return (
      <div role="status" data-testid="event-access-banner" className="border-b border-primary/30 bg-primary/10 px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="h-4 w-4 flex-shrink-0" />
          {copy.title}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {copy.detail}
          {stale}
        </p>
      </div>
    );
  }
  return (
    <div role="alert" data-testid="event-access-banner" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <Ban className="h-4 w-4 flex-shrink-0" />
        {copy.title}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {copy.detail}
        {stale}
      </p>
    </div>
  );
}

/**
 * Warns when offline sales have been waiting close to the server's 72 hour limit,
 * and when the device clock disagrees with the server's by more than 5 minutes.
 */
export function OfflineWarnings() {
  const { entries } = useOffline();
  const { isEventVendor } = useEventAccess();
  const skew = useSyncExternalStore(clockSkewStore.subscribe, clockSkewStore.get, clockSkewStore.get);
  // Re-evaluate every minute so the warning appears without any interaction.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const stale = staleQueueState(entries, Date.now(), thresholdsFor(isEventVendor));
  const skewed = isClockSkewed(skew);
  if (stale.level === "none" && !skewed) return null;
  return (
    <>
      {stale.level !== "none" && (
        <div role="alert" data-testid="stale-queue-warning" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <Clock className="h-4 w-4 flex-shrink-0" />
            {stale.level === "expired"
              ? `Some offline sales are over ${stale.maxAgeHours} hours old`
              : `Reconnect soon: an offline sale is getting old (about ${stale.hoursLeft}h left)`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {stale.level === "expired"
              ? `The server refuses sales older than ${stale.maxAgeHours} hours. Reconnect and tap Sync now; any refused sale will show under Needs attention for a manager to enter by hand.`
              : `Connect this device to the internet so the sale uploads. Sales older than ${stale.maxAgeHours} hours are refused.`}
          </p>
        </div>
      )}
      {skewed && (
        <div role="alert" data-testid="clock-skew-warning" className="border-b border-warning/40 bg-warning/15 px-4 py-2.5">
          <p className="text-sm font-semibold text-foreground">
            This device's clock is {Math.round(Math.abs(skew as number) / 60000)} minutes {(skew as number) > 0 ? "ahead of" : "behind"} the server
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Sales taken offline are stamped with this clock. Correct the date and time in the device settings
            (more than {CLOCK_SKEW_WARN_MS / 60000} minutes off can get offline sales refused).
          </p>
        </div>
      )}
    </>
  );
}
