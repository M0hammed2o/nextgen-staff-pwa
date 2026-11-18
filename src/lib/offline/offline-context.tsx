import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { OfflineQueueError } from "./types";
import type { QueueEntry, SalePayload } from "./types";
import { getEngine, getQueue, setOnSyncedHook } from "./runtime";

export interface QueueCounts {
  pending: number;
  syncing: number;
  attention: number;
  synced: number;
}

export interface OfflineContextValue {
  /** false when rendered without a provider (inert default, e.g. unit tests). */
  available: boolean;
  online: boolean;
  entries: QueueEntry[];
  counts: QueueCounts;
  authRequired: boolean;
  syncNow: () => Promise<void>;
  enqueueSale: (payload: SalePayload) => Promise<QueueEntry>;
  retry: (id: string) => Promise<void>;
  /** `confirmed` must be true, i.e. the caller has shown an explicit confirmation. */
  discard: (id: string, confirmed: boolean) => Promise<void>;
}

const EMPTY_COUNTS: QueueCounts = { pending: 0, syncing: 0, attention: 0, synced: 0 };

const INERT: OfflineContextValue = {
  available: false,
  online: true,
  entries: [],
  counts: EMPTY_COUNTS,
  authRequired: false,
  syncNow: async () => undefined,
  enqueueSale: async () => {
    throw new OfflineQueueError("Offline sales are not available here.", "STORAGE");
  },
  retry: async () => undefined,
  discard: async () => undefined,
};

export const OfflineContext = createContext<OfflineContextValue>(INERT);

export function countEntries(entries: QueueEntry[]): QueueCounts {
  const c = { ...EMPTY_COUNTS };
  for (const e of entries) {
    if (e.status === "pending") c.pending++;
    else if (e.status === "syncing") c.syncing++;
    else if (e.status === "conflict" || e.status === "failed") c.attention++;
    else if (e.status === "synced") c.synced++;
  }
  return c;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const qc = useQueryClient();
  const online = useOnline();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [authRequired, setAuthRequired] = useState(false);
  const userRef = useRef(user);
  userRef.current = user;

  const refresh = useCallback(async () => {
    try {
      setEntries(await getQueue().list());
    } catch {
      setEntries([]); // IndexedDB unavailable: nothing queued here
    }
    setAuthRequired(getEngine().status.authRequired);
  }, []);

  useEffect(() => {
    void refresh();
    const q = getQueue();
    const e = getEngine();
    const un1 = q.subscribe(() => void refresh());
    const un2 = e.subscribe(() => void refresh());
    return () => {
      un1();
      un2();
    };
  }, [refresh]);

  useEffect(() => {
    setOnSyncedHook(() => {
      void qc.invalidateQueries({ queryKey: ["live-orders"] });
      void qc.invalidateQueries({ queryKey: ["pos-unconsumed-paid-intents"] });
    });
    return () => setOnSyncedHook(null);
  }, [qc]);

  // Engine runs only while signed in; unsynced sales simply wait otherwise.
  useEffect(() => {
    if (!isAuthenticated) return;
    const engine = getEngine();
    const stop = engine.start();
    engine.notifyLogin();
    return stop;
  }, [isAuthenticated, user?.id]);

  const enqueueSale = useCallback(async (payload: SalePayload) => {
    const u = userRef.current;
    if (!u?.business_id || !u.id) throw new OfflineQueueError("Sign in before taking sales.", "BAD_STATE");
    const entry = await getQueue().enqueueSale({ businessId: u.business_id, staffId: u.id, payload });
    // If we actually are online (e.g. a request timed out), try straight away.
    if (typeof navigator === "undefined" || navigator.onLine !== false) void getEngine().syncNow().catch(() => undefined);
    return entry;
  }, []);

  const value = useMemo<OfflineContextValue>(
    () => ({
      available: true,
      online,
      entries,
      counts: countEntries(entries),
      authRequired,
      syncNow: () => getEngine().syncNow({ manual: true }),
      enqueueSale,
      retry: async (id) => {
        await getQueue().retry(id);
        void getEngine().syncNow({ manual: true }).catch(() => undefined);
      },
      discard: async (id, confirmed) => {
        await getQueue().discard(id, { confirmed, actorId: userRef.current?.id ?? null });
      },
    }),
    [online, entries, authRequired, enqueueSale],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineContextValue {
  return useContext(OfflineContext);
}
