import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";
import type { MenuItemEntry, MenuOptionGroup } from "@/types";
import { cn } from "@/lib/utils";

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "+";
  return `${sign}R${(Math.abs(cents) / 100).toFixed(2)}`;
}

interface Props {
  item: MenuItemEntry | null;
  onClose: () => void;
  onAdd: (result: {
    selectedOptionIds: Record<string, string>;
    selectedOptionsDisplay: { groupName: string; optionName: string; priceDeltaCents: number }[];
    addOnSelections: { addOnId: string; name: string; priceCents: number; quantity: number }[];
    specialInstructions: string | null;
  }) => void;
}

/**
 * Shown when a menu item has option groups and/or add-ons to choose from.
 * Items with neither are added straight to cart from the tile grid — this
 * dialog only appears when there's actually something to pick.
 */
export default function ItemOptionsDialog({ item, onClose, onAdd }: Props) {
  // Missing `is_enabled` means enabled, matching the backend's own default
  // (backend/app/pos/pricing.py's `group.get("is_enabled", True)`) -- see
  // the matching fix/comment in Pos.tsx's `itemHasChoices`.
  const groups: MenuOptionGroup[] = (item?.options_json?.option_groups ?? [])
    .filter((g) => g.is_enabled !== false)
    .sort((a, b) => a.sort_order - b.sort_order);
  const addOns = (item?.add_ons ?? []).filter((a) => a.is_active);

  const [selected, setSelected] = useState<Record<string, string>>({});
  const [addOnQty, setAddOnQty] = useState<Record<string, number>>({});

  // Reset local selection state every time a different item is opened.
  useEffect(() => {
    if (!item) return;
    const defaults: Record<string, string> = {};
    for (const g of groups) {
      if (g.default_option_id) defaults[g.id] = g.default_option_id;
    }
    setSelected(defaults);
    setAddOnQty({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (!item) return null;

  const missingRequired = groups.filter((g) => g.required && !selected[g.id]);
  const canAdd = missingRequired.length === 0;

  function handleAdd() {
    const selectedOptionsDisplay = groups
      .filter((g) => selected[g.id])
      .map((g) => {
        const opt = g.options.find((o) => o.id === selected[g.id]);
        return { groupName: g.name, optionName: opt?.name ?? "", priceDeltaCents: opt?.price_delta_cents ?? 0 };
      });

    const addOnSelections = Object.entries(addOnQty)
      .filter(([, qty]) => qty > 0)
      .map(([addOnId, qty]) => {
        const addOn = addOns.find((a) => a.id === addOnId);
        return { addOnId, name: addOn?.name ?? "", priceCents: addOn?.price_cents ?? 0, quantity: qty };
      });

    onAdd({
      selectedOptionIds: selected,
      selectedOptionsDisplay,
      addOnSelections,
      specialInstructions: null,
    });
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  {group.name} {group.required && <span className="text-destructive">*</span>}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {group.options
                  .filter((o) => o.is_enabled !== false)
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((opt) => {
                    const isSelected = selected[group.id] === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSelected((prev) => ({ ...prev, [group.id]: opt.id }))}
                        className={cn(
                          "flex min-h-[56px] flex-col items-center justify-center rounded-lg border px-3 py-2 text-center text-sm transition-colors",
                          isSelected
                            ? "border-primary bg-primary/10 text-primary font-semibold"
                            : "border-border bg-card text-foreground active:bg-muted"
                        )}
                      >
                        <span>{opt.name}</span>
                        {opt.price_delta_cents !== 0 && (
                          <span className="text-xs text-muted-foreground">{formatCents(opt.price_delta_cents)}</span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}

          {addOns.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm font-semibold text-foreground">Add-ons</span>
              <div className="space-y-2">
                {addOns.map((addOn) => {
                  const qty = addOnQty[addOn.id] ?? 0;
                  return (
                    <div
                      key={addOn.id}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{addOn.name}</p>
                        <p className="text-xs text-muted-foreground">+R{(addOn.price_cents / 100).toFixed(2)} each</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAddOnQty((prev) => ({ ...prev, [addOn.id]: Math.max(0, qty - 1) }))}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-foreground active:bg-muted"
                          aria-label={`Remove ${addOn.name}`}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-5 text-center text-sm font-medium">{qty}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setAddOnQty((prev) => ({ ...prev, [addOn.id]: Math.min(addOn.max_qty, qty + 1) }))
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-foreground active:bg-muted"
                          aria-label={`Add ${addOn.name}`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!canAdd} className="flex-1">
            {canAdd ? "Add to order" : `Choose ${missingRequired[0]?.name ?? "options"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
