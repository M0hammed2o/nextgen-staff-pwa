import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type { Order, PaginatedResponse } from "@/types";
import OrderCard from "@/components/OrderCard";
import EmptyState from "@/components/EmptyState";
import { ClipboardCheck } from "lucide-react";

export default function CompletedOrders() {
  const [search, setSearch] = useState("");

  const { data: ordersRes, isLoading, error, refetch } = useQuery<PaginatedResponse<Order>>({
    queryKey: ["completed-orders"],
    queryFn: () => apiClient.get<PaginatedResponse<Order>>("/v1/business/orders?status=COLLECTED,DELIVERED"),
  });

  const orders = ordersRes?.data ?? [];

  const filtered = search.trim()
    ? orders.filter(
        (o) =>
          (o.order_number ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (o.customer_name ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : orders;

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
          onClick={() => refetch()}
          className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-app bg-background pb-nav">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm safe-top">
        <div className="mx-auto max-w-lg px-4 py-4">
          <h1 className="text-xl font-bold text-foreground">Completed</h1>
          <p className="text-xs text-muted-foreground">{orders.length} orders</p>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by order # or name..."
          className="mb-4 flex h-12 w-full rounded-lg border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />

        {filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={search ? "No matching orders" : "No completed orders yet"}
            description={search ? "Try a different order number or name" : undefined}
            className="min-h-[30vh]"
          />
        ) : (
          <div className="space-y-3">
            {filtered.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
