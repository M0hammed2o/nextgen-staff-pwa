import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type {
  CartLine, MenuCategoryEntry, MenuItemEntry, Order, POSOrderCreateRequest,
} from "@/types";
import ItemOptionsDialog from "@/components/pos/ItemOptionsDialog";
import CartDialog from "@/components/pos/CartDialog";
import CashupDialog from "@/components/pos/CashupDialog";
import CustomerReceipt, { printCustomerReceipt } from "@/components/CustomerReceipt";
import { useAuth } from "@/lib/auth";
import { ShoppingBag, Printer, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

function cartLineTotalCents(line: CartLine): number {
  const optionAdjustment = line.selectedOptionsDisplay.reduce((sum, o) => sum + o.priceDeltaCents, 0);
  const addOnTotal = line.addOnSelections.reduce((sum, a) => sum + a.priceCents * a.quantity, 0);
  const unitPrice = Math.max(0, line.basePriceCents + optionAdjustment + addOnTotal);
  return unitPrice * line.quantity;
}

export default function Pos() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeCategory, setActiveCategory] = useState<string | "ALL">("ALL");
  const [optionsItem, setOptionsItem] = useState<MenuItemEntry | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [cashupOpen, setCashupOpen] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const { data: categories = [], isLoading: loadingCategories } = useQuery({
    queryKey: ["pos-categories"],
    queryFn: () => apiClient.get<MenuCategoryEntry[]>("/v1/business/menu/categories"),
  });

  const { data: items = [], isLoading: loadingItems, error: itemsError } = useQuery({
    queryKey: ["pos-items"],
    queryFn: () => apiClient.get<MenuItemEntry[]>("/v1/business/menu/items"),
  });

  const visibleItems = useMemo(() => {
    const active = items.filter((i) => i.is_active);
    if (activeCategory === "ALL") return active;
    return active.filter((i) => i.category_id === activeCategory);
  }, [items, activeCategory]);

  function itemHasChoices(item: MenuItemEntry): boolean {
    // A group with no explicit `is_enabled` key is enabled by default -- this
    // must match the backend's own default (backend/app/pos/pricing.py's
    // `group.get("is_enabled", True)`), or a menu item whose option groups
    // were seeded/persisted without that key (e.g. Barn Owl's Cappuccino)
    // silently skips its own required-size prompt here while the backend
    // still rejects the order for missing it.
    const hasGroups = (item.options_json?.option_groups ?? []).some((g) => g.is_enabled !== false);
    const hasAddOns = item.add_ons.some((a) => a.is_active);
    return hasGroups || hasAddOns;
  }

  function addSimpleItem(item: MenuItemEntry) {
    setCart((prev) => {
      const existing = prev.find((l) => l.key === item.id);
      if (existing) {
        return prev.map((l) => (l.key === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      const newLine: CartLine = {
        key: item.id,
        menuItemId: item.id,
        name: item.name,
        basePriceCents: item.price_cents,
        quantity: 1,
        selectedOptionIds: {},
        selectedOptionsDisplay: [],
        addOnSelections: [],
        specialInstructions: null,
      };
      return [...prev, newLine];
    });
  }

  function handleTileTap(item: MenuItemEntry) {
    if (itemHasChoices(item)) {
      setOptionsItem(item);
    } else {
      addSimpleItem(item);
    }
  }

  function handleAddFromDialog(result: {
    selectedOptionIds: Record<string, string>;
    selectedOptionsDisplay: { groupName: string; optionName: string; priceDeltaCents: number }[];
    addOnSelections: { addOnId: string; name: string; priceCents: number; quantity: number }[];
    specialInstructions: string | null;
  }) {
    if (!optionsItem) return;
    const newLine: CartLine = {
      key: `${optionsItem.id}::${Date.now()}`,
      menuItemId: optionsItem.id,
      name: optionsItem.name,
      basePriceCents: optionsItem.price_cents,
      quantity: 1,
      ...result,
    };
    setCart((prev) => [...prev, newLine]);
    setOptionsItem(null);
    setCartOpen(true);
  }

  function updateQty(key: string, quantity: number) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, quantity } : l)));
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const body: POSOrderCreateRequest = {
        order_mode: "PICKUP",
        items: cart.map((line) => ({
          menu_item_id: line.menuItemId,
          quantity: line.quantity,
          selected_option_ids: line.selectedOptionIds,
          add_on_selections: line.addOnSelections.map((a) => ({ add_on_id: a.addOnId, quantity: a.quantity })),
          special_instructions: line.specialInstructions,
        })),
      };
      const order = await apiClient.post<Order>("/v1/business/pos/orders", body);
      setCart([]);
      setCartOpen(false);
      setLastOrder(order);
      queryClient.invalidateQueries({ queryKey: ["live-orders"] });
      setTimeout(() => setLastOrder(null), 10000);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? "Could not submit the order — try again";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePrintReceipt() {
    setShowReceipt(true);
    setTimeout(() => {
      printCustomerReceipt();
      setShowReceipt(false);
    }, 100);
  }

  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const cartTotalCents = cart.reduce((sum, l) => sum + cartLineTotalCents(l), 0);
  const isLoading = loadingCategories || loadingItems;

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm safe-top">
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Till</h1>
            <p className="text-xs text-muted-foreground">Tap an item to add it to the order</p>
          </div>
          <button
            onClick={() => setCashupOpen(true)}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-foreground active:bg-muted"
            aria-label="Cash-up"
          >
            <Wallet className="h-5 w-5" />
          </button>
        </div>

        {categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3">
            <button
              onClick={() => setActiveCategory("ALL")}
              className={cn(
                "flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                activeCategory === "ALL" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
              )}
            >
              All
            </button>
            {categories.filter((c) => c.is_active).map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  "flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  activeCategory === cat.id ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="px-4 py-4">
        {isLoading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : itemsError ? (
          <p className="py-8 text-center text-sm text-destructive">Failed to load the menu</p>
        ) : visibleItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No menu items in this category</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleTileTap(item)}
                className="flex min-h-[110px] flex-col justify-between rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-transform active:scale-95"
              >
                <span className="text-sm font-semibold text-foreground line-clamp-2">{item.name}</span>
                <span className="text-sm font-bold text-primary">R{(item.price_cents / 100).toFixed(2)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {lastOrder && (
        <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg">
          <span>Order {lastOrder.order_number} sent to the kitchen</span>
          <button
            onClick={handlePrintReceipt}
            className="flex items-center gap-1 rounded-md bg-primary-foreground/20 px-2 py-1 text-xs font-semibold active:bg-primary-foreground/30"
          >
            <Printer className="h-3.5 w-3.5" /> Receipt
          </button>
        </div>
      )}

      {/* Customer receipt (hidden, only rendered for printing) */}
      {showReceipt && lastOrder && (
        <div className="fixed top-0 left-0 z-[9999]">
          <CustomerReceipt order={lastOrder} businessName={user?.business_name ?? undefined} />
        </div>
      )}

      {cart.length > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-20 left-4 right-4 z-40 flex items-center justify-between rounded-xl bg-primary px-5 py-4 text-primary-foreground shadow-lg"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingBag className="h-5 w-5" />
            {cartCount} item{cartCount !== 1 ? "s" : ""}
          </span>
          <span className="text-base font-bold">R{(cartTotalCents / 100).toFixed(2)}</span>
        </button>
      )}

      <CashupDialog open={cashupOpen} onClose={() => setCashupOpen(false)} />

      <ItemOptionsDialog item={optionsItem} onClose={() => setOptionsItem(null)} onAdd={handleAddFromDialog} />

      <CartDialog
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        lines={cart}
        onUpdateQty={updateQty}
        onRemove={removeLine}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
      />
    </div>
  );
}
