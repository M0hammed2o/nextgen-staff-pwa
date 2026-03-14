import { useNavigate } from "react-router-dom";
import type { Order } from "@/types";
import { cn, formatCurrency, timeAgo, getStatusColor } from "@/lib/utils";

interface OrderCardProps {
  order: Order;
}

export default function OrderCard({ order }: OrderCardProps) {
  const navigate = useNavigate();

  const itemPreview =
    order.items
      ?.slice(0, 3)
      .map((i) => `${i.quantity}x ${i.name_snapshot}`)
      .join(", ") || "No items";

  const hasMore = (order.items?.length ?? 0) > 3;

  return (
    <button
      onClick={() => navigate(`/orders/${order.id}`)}
      className="w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-secondary active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-foreground">
              #{order.order_number ?? "—"}
            </span>
            <span
              className={cn(
                "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
                getStatusColor(order.status)
              )}
            >
              {order.status}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-foreground">
            {order.customer_name || "Guest"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-foreground">
            {formatCurrency(order.total_cents)}
          </p>
          <p className="text-xs text-muted-foreground">
            {timeAgo(order.created_at)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="truncate text-sm text-muted-foreground">
          {itemPreview}
          {hasMore && ` +${(order.items?.length ?? 0) - 3} more`}
        </p>
        {order.order_mode && (
          <span className="ml-2 shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {order.order_mode}
          </span>
        )}
      </div>
    </button>
  );
}
