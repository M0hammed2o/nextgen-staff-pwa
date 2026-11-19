import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, RefreshCw } from "lucide-react";
import { useOffline } from "@/lib/offline/offline-context";
import type { QueueEntry } from "@/lib/offline/types";
import { useAuth } from "@/lib/auth";
import { canToggleTraining } from "@/lib/offline/training";
import { formatCurrency } from "@/lib/utils";

const STATUS_LABEL: Record<QueueEntry["status"], string> = {
  pending: "Waiting to upload",
  syncing: "Uploading…",
  synced: "Uploaded",
  review: "Sent to manager for review",
  conflict: "Needs attention",
  failed: "Needs attention",
};

export default function OfflineQueueDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { entries, online, counts, authRequired, syncNow, retry, discard } = useOffline();
  const { user } = useAuth();
  const isManager = canToggleTraining(user?.role);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const visible = entries.filter((e) => e.status !== "synced");
  const inReview = visible.filter((e) => e.status === "review").length;
  const recentlySynced = entries.filter((e) => e.status === "synced").slice(-5).reverse();

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Offline sales</DialogTitle>
          <DialogDescription>
            Sales taken without a connection are saved on this device and uploaded in order.{" "}
            {online ? "You are online." : "You are offline."}
          </DialogDescription>
        </DialogHeader>

        {authRequired && counts.pending + counts.attention > 0 && (
          <p role="alert" className="rounded-md bg-warning/10 px-3 py-2 text-sm text-foreground">
            Sign in again to upload the waiting sales. They are safe on this device.
          </p>
        )}
        {inReview > 0 && (
          <p role="status" data-testid="queue-review-note" className="rounded-md bg-primary/10 px-3 py-2 text-sm text-foreground">
            {inReview} late sale{inReview === 1 ? " was" : "s were"} sent to a manager for review. Nothing more is needed on
            this device; a manager approves or rejects {inReview === 1 ? "it" : "them"} in the Manager Dashboard.
          </p>
        )}
        {actionError && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p>}

        {visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nothing waiting. Every sale has been uploaded.</p>
        ) : (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {visible.map((e) => {
              const needsAttention = e.status === "conflict" || e.status === "failed";
              return (
                <li key={e.id} data-testid={`queue-entry-${e.local_ref}`} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-foreground">{e.local_ref}</span>
                    <span className="text-sm font-semibold tabular-nums">{formatCurrency(e.total_cents)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString("en-ZA")} · {e.item_count} item{e.item_count === 1 ? "" : "s"} ·{" "}
                    <span className={needsAttention ? "font-semibold text-destructive" : undefined}>{STATUS_LABEL[e.status]}</span>
                  </p>
                  {e.last_error && <p className="mt-1 text-xs text-destructive">{e.last_error}</p>}
                  {needsAttention && (
                    <div className="mt-2">
                      {confirmId === e.id ? (
                        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
                          <p className="text-sm text-foreground">
                            Discard sale {e.local_ref} ({formatCurrency(e.total_cents)})? The order will not be recorded on
                            the server. This cannot be undone.
                          </p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => run(async () => { await discard(e.id, true); setConfirmId(null); })}
                              className="h-10 flex-1 rounded-lg bg-destructive text-sm font-semibold text-destructive-foreground disabled:opacity-60"
                            >
                              Yes, discard
                            </button>
                            <button type="button" onClick={() => setConfirmId(null)} className="h-10 flex-1 rounded-lg border border-border text-sm font-medium">
                              Keep it
                            </button>
                          </div>
                        </div>
                      ) : isManager ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => run(() => retry(e.id))}
                            className="h-10 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
                          >
                            Retry
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmId(e.id)}
                            className="h-10 flex-1 rounded-lg border border-destructive text-sm font-medium text-destructive"
                          >
                            Discard…
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Ask a manager to retry or discard this sale.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {recentlySynced.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Recently uploaded: {recentlySynced.map((e) => `${e.local_ref} → ${e.server_order_number ?? "ok"}`).join(", ")}
          </div>
        )}

        <button
          type="button"
          onClick={() => run(syncNow)}
          disabled={busy}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-semibold disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync now
        </button>
      </DialogContent>
    </Dialog>
  );
}
