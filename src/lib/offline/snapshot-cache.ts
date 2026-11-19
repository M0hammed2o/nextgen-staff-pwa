/**
 * Read-through cache for the few GETs the till needs to keep working offline
 * (menu, categories, current till, POS settings). On a successful fetch the
 * answer is remembered; when the request produces NO HTTP RESPONSE the last
 * remembered answer is returned instead. A real HTTP error is never masked.
 *
 * Contents are business catalogue/config data, not customer data, so this uses
 * safe-storage (localStorage with fallbacks) rather than the encrypted queue.
 * Wiped on logout (see runtime.wipeLocalPosData).
 */
import { apiClient } from "@/lib/api";
import type { ApiFetchError } from "@/lib/api";
import { clearVariantCache } from "@/lib/variants";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/safe-storage";

const PREFIX = "nextgen_staff_snapshot_v1";
export const SNAPSHOT_NAMES = ["categories", "items", "till", "settings"] as const;
export type SnapshotName = (typeof SNAPSHOT_NAMES)[number];

const k = (businessId: string, name: string) => `${PREFIX}:${businessId}:${name}`;

export function readSnapshot<T>(businessId: string, name: SnapshotName): { value: T } | null {
  try {
    const raw = safeGetItem(k(businessId, name));
    return raw ? (JSON.parse(raw) as { value: T }) : null;
  } catch {
    return null;
  }
}

// Which snapshots the LAST cachedGet answered from the device copy rather
// than the server. A query fed from a snapshot is polled until a real server
// answer replaces it (see tillCurrentQuery), so a reconnect that the browser
// never announced with an "online" event still recovers.
const servedFromSnapshot = new Set<SnapshotName>();

export function isServingSnapshot(name: SnapshotName): boolean {
  return servedFromSnapshot.has(name);
}

export async function cachedGet<T>(businessId: string | null | undefined, name: SnapshotName, path: string): Promise<T> {
  try {
    const data = await apiClient.get<T>(path);
    servedFromSnapshot.delete(name);
    if (businessId) {
      try {
        safeSetItem(k(businessId, name), JSON.stringify({ value: data }));
      } catch {
        /* cache is best-effort */
      }
    }
    return data;
  } catch (err) {
    if ((err as ApiFetchError | undefined)?.noResponse && businessId) {
      const hit = readSnapshot<T>(businessId, name);
      if (hit) {
        servedFromSnapshot.add(name);
        return hit.value;
      }
    }
    throw err;
  }
}

/** How often a till-current answer that is unknown or from the device copy is re-asked. */
export const TILL_RECHECK_MS = 15_000;

/**
 * The ONE definition of the ["till-current"] query. Pos and CashupDialog both
 * observe this key; React Query runs a refetch (e.g. the invalidate after
 * "Open till") with whichever observer's options were set last, and
 * CashupDialog used to pass a plain apiClient.get. So after opening the till
 * the refetch never wrote the snapshot, which kept the pre-open `null`: an
 * offline reload then showed "The till is closed" while the server session
 * was OPEN (Souk e2e 6a). Both now share this queryFn.
 */
export function tillCurrentQuery<T>(businessId: string | null | undefined) {
  return {
    queryKey: ["till-current"] as const,
    queryFn: () => cachedGet<T | null>(businessId, "till", "/v1/business/pos/till/current"),
    networkMode: "always" as const, // offline must fall back to the snapshot, not pause
    // Keep asking while we only have the device copy or no answer at all; a
    // network error is "unknown", never "no open till".
    refetchInterval: (query: { state: { status: string } }) =>
      query.state.status === "error" || isServingSnapshot("till") ? TILL_RECHECK_MS : false,
  };
}

export function clearSnapshots(businessId: string | null | undefined) {
  servedFromSnapshot.clear();
  if (!businessId) return;
  for (const n of SNAPSHOT_NAMES) safeRemoveItem(k(businessId, n));
  clearVariantCache(businessId);
}
