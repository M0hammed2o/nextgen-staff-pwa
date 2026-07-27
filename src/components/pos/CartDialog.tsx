import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Trash2, Loader2 } from "lucide-react";
import type { CartLine } from "@/types";

function lineTotalCents(line: CartLine): number {
  const optionAdjustment = line.selectedOptionsDisplay.reduce((sum, o) => sum + o.priceDeltaCents, 0);
  const addOnTotal = line.addOnSelections.reduce((sum, a) => sum + a.priceCents * a.quantity, 0);
  const unitPrice = Math.max(0, line.basePriceCents + optionAdjustment + addOnTotal);
  return unitPrice * line.quantity;
}

interface Props {
  open: boolean;
  onClose: () => void;
  lines: CartLine[];
  onUpdateQty: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

export default function CartDialog({
  open, onClose, lines, onUpdateQty, onRemove, onSubmit, isSubmitting, errorMessage,
}: Props) {
  const estimatedTotalCents = lines.reduce((sum, l) => sum + lineTotalCents(l), 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Current order</DialogTitle>
        </DialogHeader>

        {lines.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No items yet — tap a menu item to add it.</p>
        ) : (
          <div className="space-y-3">
            {lines.map((line) => (
              <div key={line.key} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{line.name}</p>
                  {line.selectedOptionsDisplay.map((o) => (
                    <p key={o.groupName} className="text-xs text-muted-foreground">{o.optionName}</p>
                  ))}
                  {line.addOnSelections.map((a) => (
                    <p key={a.addOnId} className="text-xs text-muted-foreground">
                      {a.quantity}x {a.name}
                    </p>
                  ))}
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    R{(lineTotalCents(line) / 100).toFixed(2)}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (line.quantity <= 1 ? onRemove(line.key) : onUpdateQty(line.key, line.quantity - 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-foreground active:bg-muted"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-5 text-center text-sm font-medium">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => onUpdateQty(line.key, line.quantity + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-foreground active:bg-muted"
                    aria-label="Increase quantity"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(line.key)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-destructive active:bg-destructive/10"
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {lines.length > 0 && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-medium text-muted-foreground">Estimated total</span>
            <span className="text-lg font-bold text-foreground">R{(estimatedTotalCents / 100).toFixed(2)}</span>
          </div>
        )}

        {errorMessage && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</p>
        )}

        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Keep adding
          </Button>
          <Button onClick={onSubmit} disabled={lines.length === 0 || isSubmitting} className="flex-1 gap-1.5">
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Place order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
