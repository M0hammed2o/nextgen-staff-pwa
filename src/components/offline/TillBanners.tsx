import { GraduationCap, CalendarClock, Ban } from "lucide-react";
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

export function EventAccessBanner({ access }: { access: EventAccessState }) {
  if (!access.isEventVendor || access.level === "TRADE") return null;
  const stale = access.stale ? " (last known status; reconnect to refresh)" : "";
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
