import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, createSSEConnection } from "@/lib/api";
import type { Order, PaginatedResponse } from "@/types";
import OrderCard from "@/components/OrderCard";

const NEW_ORDER_SOUND_URL = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgipGLfWxka3aBg3lsdH6Nmpyrqqednpydo6urpKCdn6SnqKiloqGho6WnpqalpKOlpqempqWkpaalpaSkpKWlpaWkpKSlpaWlpKSlpQ==";

export default function LiveOrders() {
  const queryClient = useQueryClient();
  const [lastCount, setLastCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: ordersRes, isLoading, error, refetch } = useQuery<PaginatedResponse<Order>>({
    queryKey: ["live-orders"],
    queryFn: () => apiClient.get<PaginatedResponse<Order>>("/v1/business/orders?live=true"),
    refetchInterval: 15000,
  });

  const orders = ordersRes?.data ?? [];

  // SSE with fallback
  useEffect(() => {
    const es = createSSEConnection(
      "/v1/business/orders/live/stream",
      () => {
        queryClient.invalidateQueries({ queryKey: ["live-orders"] });
      },
      () => {
        // SSE failed, polling handles it
      }
    );
    return () => es?.close();
  }, [queryClient]);

  // Sound alert for new orders
  useEffect(() => {
    if (orders.length > lastCount && lastCount > 0) {
      try {
        if (!audioRef.current) {
          audioRef.current = new Audio(NEW_ORDER_SOUND_URL);
        }
        audioRef.current.play().catch(() => {});
      } catch {}
    }
    setLastCount(orders.length);
  }, [orders.length, lastCount]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6">
        <p className="text-sm text-destructive">Failed to load orders</p>
        <button
          onClick={handleRefresh}
          className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm safe-top">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Live Orders</h1>
            <p className="text-xs text-muted-foreground">
              {orders.length} active order{orders.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-foreground transition-colors active:bg-muted"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-4">
        {orders.length === 0 ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                <path d="M3 6h18" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">No active orders</p>
            <p className="text-xs text-muted-foreground">New orders will appear here automatically</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
