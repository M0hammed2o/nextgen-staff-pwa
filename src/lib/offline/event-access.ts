/**
 * Event-vendor trading gate (souk). Backend: GET /v1/business/event-access.
 *
 *   { is_event_vendor, access_level: "NONE"|"CONFIGURE"|"TRADE"|null, reason, events,
 *     ready_notify_available? }   // event vendors only (souk WhatsApp gate)
 *
 * The SERVER is the enforcement point (403 EVENT_TRADING_NOT_ALLOWED on a
 * sale); this module only decides what the till shows. Behaviour:
 *  - success: use it and remember it (per business) as the last known level;
 *  - 404 (older backend): definitively "not an event business";
 *  - no response / 5xx / anything else: use the last known value, or behave
 *    as a normal non-event business if we never learned one.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiClient } from "@/lib/api";
import type { ApiFetchError } from "@/lib/api";
import { safeGetItem, safeSetItem } from "@/lib/safe-storage";
import { useAuth } from "@/lib/auth";

export type AccessLevel = "NONE" | "CONFIGURE" | "TRADE";

export interface EventAccessResponse {
  is_event_vendor: boolean;
  access_level: AccessLevel | null;
  reason: string | null;
  events?: unknown[];
  /**
   * Event vendors only: true when the backend can actually send the
   * order-ready WhatsApp (WhatsApp enabled by the platform, the vendor's own
   * number connected, approved template). Absent/false means "not available".
   */
  ready_notify_available?: boolean;
}

export interface EventAccessState {
  isEventVendor: boolean;
  level: AccessLevel | null;
  reason: string | null;
  /** true when the value is the cached last-known one, not freshly fetched. */
  stale: boolean;
  /** Real (non-training) trading allowed? Non-event businesses always can. */
  canTrade: boolean;
  /**
   * May the till offer the order-ready WhatsApp opt-in? Non-event businesses:
   * always (unchanged). Event vendors: only when the backend says the message
   * can really be sent.
   */
  readyNotifyAvailable: boolean;
}

const NOT_EVENT: EventAccessResponse = { is_event_vendor: false, access_level: null, reason: null };

const cacheKey = (businessId: string) => `nextgen_staff_event_access_v1_${businessId}`;

function readCache(businessId: string): EventAccessResponse | null {
  try {
    const raw = safeGetItem(cacheKey(businessId));
    return raw ? (JSON.parse(raw) as EventAccessResponse) : null;
  } catch {
    return null;
  }
}

function writeCache(businessId: string, value: EventAccessResponse) {
  try {
    safeSetItem(cacheKey(businessId), JSON.stringify({ ...value, events: undefined }));
  } catch {
    /* a cache is a convenience */
  }
}

export async function fetchEventAccess(businessId: string): Promise<{ data: EventAccessResponse; stale: boolean }> {
  try {
    const data = await apiClient.get<EventAccessResponse>("/v1/business/event-access", { timeoutMs: 8000 });
    writeCache(businessId, data);
    return { data, stale: false };
  } catch (err) {
    const e = err as ApiFetchError | undefined;
    if (e?.status === 404) {
      writeCache(businessId, NOT_EVENT);
      return { data: NOT_EVENT, stale: false };
    }
    const cached = readCache(businessId);
    if (cached) return { data: cached, stale: true };
    return { data: NOT_EVENT, stale: true };
  }
}

export function toState(data: EventAccessResponse, stale: boolean): EventAccessState {
  const level = data.is_event_vendor ? (data.access_level ?? "NONE") : null;
  return {
    isEventVendor: data.is_event_vendor,
    level,
    reason: data.reason,
    stale,
    canTrade: !data.is_event_vendor || level === "TRADE",
    readyNotifyAvailable: !data.is_event_vendor || data.ready_notify_available === true,
  };
}

export function useEventAccess(): EventAccessState & { refresh: () => void } {
  const { user } = useAuth();
  const qc = useQueryClient();
  const businessId = user?.business_id ?? "";
  const q = useQuery({
    queryKey: ["event-access", businessId],
    queryFn: () => fetchEventAccess(businessId),
    enabled: !!businessId,
    networkMode: "always", // offline must resolve fast to the cached value, not pause
    retry: false,
    staleTime: 60_000,
  });

  // Back online: re-check (an event day may have started or ended meanwhile).
  useEffect(() => {
    const onOnline = () => void qc.invalidateQueries({ queryKey: ["event-access"] });
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [qc]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["event-access"] });
  // Until the first answer arrives, trust the last known value (never optimistically open up).
  const cached = !q.data && businessId ? readCache(businessId) : null;
  const state = q.data ? toState(q.data.data, q.data.stale) : toState(cached ?? NOT_EVENT, true);
  return { ...state, refresh };
}
