import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, createSSEConnection } from "@/lib/api";
import type { Order, PaginatedResponse } from "@/types";

/** Same query key + endpoints as the kitchen queue (LiveOrders). */
export const LIVE_ORDERS_KEY = ["live-orders"] as const;
const SSE_RETRY_AFTER_MS = 30_000;

/**
 * Read-only live-orders feed: SSE for instant updates, polling as the
 * fallback, and a slow SSE re-open after the stream gives up. Uses the same
 * authenticated, business-scoped endpoints as the kitchen queue.
 */
export function useLiveOrdersFeed(pollMs = 10_000) {
  const queryClient = useQueryClient();
  const [sseEpoch, setSseEpoch] = useState(0);
  const [sseDown, setSseDown] = useState(false);

  const query = useQuery<PaginatedResponse<Order>>({
    queryKey: LIVE_ORDERS_KEY,
    queryFn: () => apiClient.get<PaginatedResponse<Order>>("/v1/business/orders?live=true"),
    refetchInterval: pollMs,
    refetchIntervalInBackground: true, // a TV tab must keep updating
  });

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const conn = createSSEConnection(
      "/v1/business/orders/live/stream",
      () => {
        setSseDown(false);
        queryClient.invalidateQueries({ queryKey: LIVE_ORDERS_KEY });
      },
      () => {
        // Retries exhausted: polling carries on; try the stream again later.
        setSseDown(true);
        retryTimer = setTimeout(() => setSseEpoch((n) => n + 1), SSE_RETRY_AFTER_MS);
      },
    );
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      conn.close();
    };
  }, [queryClient, sseEpoch]);

  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // "Connection lost" = the browser is offline, or the last poll failed.
  // (SSE being down alone is not a loss: polling still updates the board.)
  const connectionLost = !browserOnline || query.isError;

  return {
    orders: query.data?.data ?? [],
    isLoading: query.isLoading,
    hasData: query.data !== undefined,
    connectionLost,
    sseDown,
    refetch: query.refetch,
  };
}
