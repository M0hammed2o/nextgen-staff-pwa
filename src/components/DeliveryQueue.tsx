import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type { ApiFetchError } from "@/lib/api";
import { usePOSSettings } from "@/lib/pos-settings";
import { cn } from "@/lib/utils";
import { DECLINE_REASONS, deadlineInfo, type DeliveryQueueItem } from "@/lib/delivery";

export const DELIVERY_QUEUE_KEY = ["delivery-queue"];

/**
 * Delivery orders (Uber Eats) waiting on someone before they can reach the
 * kitchen. Shown above Live Orders only for a tenant with the delivery
 * module. Accepting puts the order into Live Orders like any other order;
 * nothing here can be prepared before it is accepted.
 */
export default function DeliveryQueue({ onArrival }: { onArrival?: () => void }) {
  const { data: settings } = usePOSSettings();
  const enabled = settings?.delivery_platforms_enabled === true;

  const { data: queue = [] } = useQuery<DeliveryQueueItem[]>({
    queryKey: DELIVERY_QUEUE_KEY,
    queryFn: () => apiClient.get<DeliveryQueueItem[]>("/v1/business/delivery/queue"),
    enabled,
    refetchInterval: 15000,
  });

  // A single ticking clock for every card's countdown.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled || queue.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled, queue.length]);

  // Sound the same alert as a new in-store order when the queue grows —
  // never on the first load.
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    if (prevCount.current !== null && queue.length > prevCount.current) onArrival?.();
    prevCount.current = queue.length;
  }, [queue.length, onArrival]);

  if (!enabled || queue.length === 0) return null;

  return (
    <section aria-label="Delivery orders waiting" className="mb-4 space-y-3">
      <h2 className="text-sm font-semibold text-foreground">
        Delivery orders waiting ({queue.length})
      </h2>
      {queue.map((item) => (
        <DeliveryQueueCard key={item.id} item={item} now={now} />
      ))}
    </section>
  );
}

function DeliveryQueueCard({ item, now }: { item: DeliveryQueueItem; now: number }) {
  const queryClient = useQueryClient();
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deadline = item.can_accept || item.waiting_for_manager || item.status === "RECEIVED" || item.status === "FETCHING"
    ? deadlineInfo(item.accept_deadline_at, now)
    : null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: DELIVERY_QUEUE_KEY });
    queryClient.invalidateQueries({ queryKey: ["live-orders"] });
  };
  const onError = (err: unknown) => {
    setError((err as ApiFetchError)?.message || "Something went wrong — try again.");
    refresh();
  };

  const accept = useMutation({
    mutationFn: () => apiClient.post(`/v1/business/delivery/orders/${item.id}/accept`),
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });
  const retry = useMutation({
    mutationFn: () => apiClient.post(`/v1/business/delivery/orders/${item.id}/retry-accept`),
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });
  const decline = useMutation({
    mutationFn: (reason_code: string) =>
      apiClient.post(`/v1/business/delivery/orders/${item.id}/deny`, { reason_code }),
    onSuccess: () => { setError(null); setDeclining(false); refresh(); },
    onError,
  });
  const busy = accept.isPending || retry.isPending || decline.isPending;

  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-4",
        deadline?.urgent ? "border-destructive" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold text-foreground">
            {item.provider_label} {item.display_id ? `#${item.display_id}` : ""}
          </p>
          {item.customer_first_name && (
            <p className="text-sm text-muted-foreground">{item.customer_first_name}</p>
          )}
        </div>
        {deadline && (
          <p
            role="timer"
            className={cn("text-right text-xs font-semibold", deadline.urgent ? "text-destructive" : "text-muted-foreground")}
          >
            {deadline.label}
          </p>
        )}
      </div>

      {item.lines.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-foreground">
          {item.lines.map((line, i) => (
            <li key={i}>
              <span className="font-medium">{line.quantity ?? 1}x {line.title}</span>
              {line.modifiers.length > 0 && (
                <span className="text-muted-foreground">
                  {" — "}
                  {line.modifiers.map((m) => (m.removed ? `no ${m.title}` : m.title)).join(", ")}
                </span>
              )}
              {line.special_instructions && (
                <span className="block text-xs text-warning">Note: {line.special_instructions}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {item.special_instructions && (
        <p className="mt-2 rounded-md bg-warning/10 px-3 py-1.5 text-xs text-warning">
          Note: {item.special_instructions}
        </p>
      )}

      {item.message && <p className="mt-3 text-sm text-muted-foreground">{item.message}</p>}
      {item.waiting_for_manager && item.unresolved.length > 0 && (
        <p className="mt-1 text-sm font-medium text-foreground">
          Not yet on your menu: {item.unresolved.join(", ")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {declining ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium text-foreground">Why are you declining?</p>
          <div className="grid grid-cols-2 gap-2">
            {DECLINE_REASONS.map((reason) => (
              <button
                key={reason.code}
                type="button"
                disabled={busy}
                onClick={() => decline.mutate(reason.code)}
                className="min-h-[44px] rounded-lg border border-border px-3 py-2 text-sm text-foreground active:bg-muted disabled:opacity-50"
              >
                {reason.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setDeclining(false)}
            className="w-full py-2 text-sm text-muted-foreground"
          >
            Back
          </button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          {item.can_accept && (
            <button
              type="button"
              disabled={busy}
              onClick={() => accept.mutate()}
              className="min-h-[44px] flex-1 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {accept.isPending ? "Accepting…" : "Accept"}
            </button>
          )}
          {item.can_retry_accept && (
            <button
              type="button"
              disabled={busy}
              onClick={() => retry.mutate()}
              className="min-h-[44px] flex-1 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {retry.isPending ? "Retrying…" : `Retry with ${item.provider_label}`}
            </button>
          )}
          {item.can_deny && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDeclining(true)}
              className="min-h-[44px] flex-1 rounded-lg border border-border px-4 py-3 text-sm font-semibold text-foreground disabled:opacity-50"
            >
              Decline
            </button>
          )}
        </div>
      )}
    </article>
  );
}
