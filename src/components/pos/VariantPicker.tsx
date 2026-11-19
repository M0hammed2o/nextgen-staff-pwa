import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";
import type { MenuItemEntry } from "@/types";
import { formatCurrency, cn } from "@/lib/utils";
import { stockState, type ProductVariant } from "@/lib/variants";

interface Props {
  item: MenuItemEntry | null;
  variants: ProductVariant[] | null;
  onSelect: (variant: ProductVariant) => void;
  onClose: () => void;
}

/**
 * Size / colour grid for a product with variants. A variant at zero stock is
 * greyed out and warned but stays tappable: stock counts drift (a returned item
 * not yet restocked, a late receiving), and refusing the sale at the till is
 * worse than a visible warning. The server never blocks it either.
 */
export default function VariantPicker({ item, variants, onSelect, onClose }: Props) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item?.name ?? "Choose a variant"}</DialogTitle>
          <DialogDescription>Choose the size or colour.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2" data-testid="variant-grid">
            {(variants ?? []).map((v) => {
              const state = stockState(v);
              const out = state === "out";
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onSelect(v)}
                  data-testid={`variant-${v.sku}`}
                  className={cn(
                    "flex min-h-[72px] flex-col justify-between rounded-lg border p-3 text-left active:scale-[0.97]",
                    out ? "border-dashed border-border bg-muted/40 text-muted-foreground" : "border-border bg-card text-foreground",
                  )}
                >
                  <span className="text-sm font-semibold leading-snug">{v.label}</span>
                  <span className="flex items-baseline justify-between gap-1">
                    <span className="text-sm font-bold tabular-nums">{formatCurrency(v.effective_price_cents)}</span>
                    <span
                      className={cn(
                        "text-[11px] font-medium",
                        out ? "text-destructive" : state === "low" ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {state === "untracked" ? "" : out ? "Out of stock" : `${v.stock_on_hand} left`}
                    </span>
                  </span>
                  {out && (
                    <span className="mt-1 flex items-center gap-1 text-[11px] text-destructive">
                      <AlertTriangle className="h-3 w-3" /> Shows none in stock. Tap to sell anyway.
                    </span>
                  )}
                </button>
              );
            })}
          </div>
      </DialogContent>
    </Dialog>
  );
}
