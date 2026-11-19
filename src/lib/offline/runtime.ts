/**
 * Process-wide offline runtime: one queue + one sync engine per page load.
 * React-free so non-React code (auth logout) can reach it.
 */
import { apiFetch } from "@/lib/api";
import type { Order } from "@/types";
import { getStoredTokens, getStoredUser } from "@/lib/token-storage";
import { loadPosDraft, clearPosDraft } from "@/lib/pos-draft";
import { safeRemoveItem } from "@/lib/safe-storage";
import { OfflineQueue } from "./queue";
import { SyncEngine } from "./sync-engine";
import type { SyncedOrder } from "./sync-engine";
import { IndexedDbStore } from "./store";
import { clearSnapshots } from "./snapshot-cache";
import { trainingStore } from "./training";
import { clockSkewMs, clockSkewStore } from "./capture";

export const SALE_ENDPOINT = "/v1/business/pos/orders";

let queue: OfflineQueue | null = null;
let engine: SyncEngine | null = null;
let onSyncedHook: (() => void) | null = null;

export function getQueue(): OfflineQueue {
  if (!queue) queue = new OfflineQueue(new IndexedDbStore());
  return queue;
}

export function setOnSyncedHook(fn: (() => void) | null) {
  onSyncedHook = fn;
}

export function getEngine(): SyncEngine {
  if (!engine) {
    engine = new SyncEngine({
      queue: getQueue(),
      getIdentity: () => {
        const user = getStoredUser() as { business_id?: string | null } | null;
        if (!getStoredTokens()?.access_token || !user?.business_id) return null;
        return { businessId: user.business_id };
      },
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
      send: (entry, payload) => {
        // One call covers the whole sale; its idempotency key is the entry id,
        // identical on every retry of this sale. Any offline_captured_at /
        // captured_by_user_id / offline_client_total_cents were stamped at sale
        // time and ride along unchanged; an older entry without them is sent as is.
        // BUG-0208: opt in to the server's late-upload review queue, so a sale
        // older than the automatic limit is sent to a manager (202) instead of
        // being refused. Only valid on an offline capture (the server 422s it
        // otherwise), so an old entry without a capture time is sent as before.
        const body = {
          ...payload.request,
          idempotency_key: entry.id,
          ...(payload.request.offline_captured_at ? { offline_review_if_too_old: true } : {}),
        };
        return apiFetch<Order & SyncedOrder>(SALE_ENDPOINT, {
          method: "POST",
          body: JSON.stringify(body),
          timeoutMs: 30_000,
          noAuthRedirect: true,
          // Warn-only: the Date header is readable cross-origin only if the server
          // exposes it. captured_at is never adjusted from this.
          onResponse: (res) => {
            const skew = clockSkewMs(res.headers?.get?.("Date"), Date.now());
            if (skew !== null) clockSkewStore.set(skew);
          },
        });
      },
      onSynced: () => onSyncedHook?.(),
    });
  }
  return engine;
}

/**
 * Logout wipe of local POS data: queue (synced items; unsynced too only when
 * explicitly discarded), cached menu/till/settings, training state, and an
 * idle (not in-flight) cart draft. An in-flight draft is deliberately kept:
 * it is the recovery record for a checkout whose outcome is unknown.
 */
export async function wipeLocalPosData(opts: { discardUnsynced: boolean }): Promise<void> {
  const user = getStoredUser() as { id?: string; business_id?: string | null } | null;
  trainingStore.reset();
  clearSnapshots(user?.business_id);
  safeRemoveItem(`nextgen_staff_event_access_v1_${user?.business_id ?? ""}`);
  if (user?.business_id && user?.id) {
    const draft = loadPosDraft(user.business_id, user.id);
    if (draft && draft.submission.status === "idle") clearPosDraft(user.business_id, user.id);
  }
  try {
    await getQueue().wipe({ discardUnsynced: opts.discardUnsynced });
  } catch {
    /* IndexedDB unavailable: nothing stored there to wipe */
  }
}

export async function unsyncedSaleCount(): Promise<number> {
  try {
    return await getQueue().unsyncedCount();
  } catch {
    return 0;
  }
}
