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
import { IndexedDbStore } from "./store";
import { clearSnapshots } from "./snapshot-cache";
import { trainingStore } from "./training";

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
        // identical on every retry of this sale.
        const body = { ...payload.request, idempotency_key: entry.id };
        return apiFetch<Order>(SALE_ENDPOINT, {
          method: "POST",
          body: JSON.stringify(body),
          timeoutMs: 30_000,
          noAuthRedirect: true,
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
