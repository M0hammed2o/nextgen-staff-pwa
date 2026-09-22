import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

/**
 * Single shared "nothing here yet" pattern for every list in the app (Live
 * Orders, Completed, the POS product grid, Stocktake's count/history lists,
 * Wastage's ingredient search) — icon in a muted circle, a short title, and
 * an optional one-line description. Kept deliberately compact (no illustration,
 * no call-to-action button) since most of these lists are read-only or the
 * action that fills them lives elsewhere on the same screen.
 */
export default function EmptyState({ icon: Icon, title, description, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-10 text-center", className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        <Icon className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
