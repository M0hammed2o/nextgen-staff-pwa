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

export function EventAccessBanner({ access }: { access: EventAccessState }) {
  if (!access.isEventVendor || access.level === "TRADE") return null;
  const stale = access.stale ? " (last known status; reconnect to refresh)" : "";
  if (access.syncOnly) {
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
  if (access.level === "CONFIGURE") {
    return (
      <div role="status" data-testid="event-access-banner" className="border-b border-primary/30 bg-primary/10 px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="h-4 w-4 flex-shrink-0" />
          Set-up mode — trading opens when your paid event day starts
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {access.reason ?? ""}
          {stale}
        </p>
      </div>
    );
  }
  return (
    <div role="alert" data-testid="event-access-banner" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <Ban className="h-4 w-4 flex-shrink-0" />
        Your event access has ended — sales are switched off
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {access.reason ?? "There is no paid event day covering today."} Contact your event organiser to renew.{stale}
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
