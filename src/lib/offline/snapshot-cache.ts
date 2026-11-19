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

export async function cachedGet<T>(businessId: string | null | undefined, name: SnapshotName, path: string): Promise<T> {
  try {
    const data = await apiClient.get<T>(path);
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
      if (hit) return hit.value;
    }
    throw err;
  }
}

export function clearSnapshots(businessId: string | null | undefined) {
  if (!businessId) return;
  for (const n of SNAPSHOT_NAMES) safeRemoveItem(k(businessId, n));
  clearVariantCache(businessId);
}
