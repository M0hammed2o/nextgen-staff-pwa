import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type {
  CartLine, MenuCategoryEntry, MenuItemEntry, Order, POSOrderCreateRequest, POSPaymentMethod, POSSettings, TillSession,
} from "@/types";
import ItemOptionsDialog from "@/components/pos/ItemOptionsDialog";
import CartPanel, { lineTotalCents, type OrderMode } from "@/components/pos/CartPanel";
import PaymentDialog from "@/components/pos/PaymentDialog";
import CashupDialog from "@/components/pos/CashupDialog";
import CustomerReceipt, { printCustomerReceipt } from "@/components/CustomerReceipt";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { ShoppingBag, Printer, Wallet, PartyPopper } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Pos() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeCategory, setActiveCategory] = useState<string | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [optionsItem, setOptionsItem] = useState<MenuItemEntry | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [cashupOpen, setCashupOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderMode, setOrderMode] = useState<OrderMode>("PICKUP");
  const [tableNumber, setTableNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discountRand, setDiscountRand] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [printFailed, setPrintFailed] = useState(false);

  const { data: categories = [], isLoading: loadingCategories } = useQuery({
    queryKey: ["pos-categories"],
    queryFn: () => apiClient.get<MenuCategoryEntry[]>("/v1/business/menu/categories"),
  });

  const { data: items = [], isLoading: loadingItems, error: itemsError } = useQuery({
    queryKey: ["pos-items"],
    queryFn: () => apiClient.get<MenuItemEntry[]>("/v1/business/menu/items"),
  });

  const { data: till } = useQuery({
    queryKey: ["till-current"],
    queryFn: () => apiClient.get<TillSession | null>("/v1/business/pos/till/current"),
  });
  const tillOpen = !!till;

  const { data: posSettings = null } = useQuery({
    queryKey: ["pos-settings"],
    queryFn: () => apiClient.get<POSSettings>("/v1/business/pos/settings"),
  });

  const visibleItems = useMemo(() => {
    let active = items.filter((i) => i.is_active);
    if (activeCategory !== "ALL") active = active.filter((i) => i.category_id === activeCategory);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      active = active.filter((i) => i.name.toLowerCase().includes(q));
    }
    return active;
  }, [items, activeCategory, search]);

  function itemHasChoices(item: MenuItemEntry): boolean {
    // A group with no explicit `is_enabled` key is enabled by default -- this
    // must match the backend's own default (backend/app/pos/pricing.py's
    // `group.get("is_enabled", True)`), or a menu item whose option groups
    // were seeded/persisted without that key (e.g. Barn Owl's Cappuccino)
    // silently skips its own required-size prompt here while the backend
    // still rejects the order for missing it.
    const hasGroups = (item.options_json?.option_groups ?? []).some((g) => g.is_enabled !== false);
    const hasAddOns = item.add_ons.some((a) => a.is_active);
    const hasRemovable = (item.options_json?.removable_ingredients ?? []).length > 0;
    return hasGroups || hasAddOns || hasRemovable;
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
        requiresPreparation: item.requires_preparation,
        selectedOptionIds: {},
        selectedOptionsDisplay: [],
        addOnSelections: [],
        removedIngredientIds: [],
        removedIngredientsDisplay: [],
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
    removedIngredientIds: string[];
    removedIngredientsDisplay: { id: string; name: string }[];
    specialInstructions: string | null;
  }) {
    if (!optionsItem) return;
    const newLine: CartLine = {
      key: `${optionsItem.id}::${Date.now()}`,
      menuItemId: optionsItem.id,
      name: optionsItem.name,
      basePriceCents: optionsItem.price_cents,
      quantity: 1,
      requiresPreparation: optionsItem.requires_preparation,
      ...result,
    };
    setCart((prev) => [...prev, newLine]);
    setOptionsItem(null);
    setMobileCartOpen(true);
  }

  function updateQty(key: string, quantity: number) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, quantity } : l)));
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function resetForNextSale() {
    setCart([]);
    setOrderMode("PICKUP");
    setTableNumber("");
    setCustomerName("");
    setCustomerPhone("");
    setDiscountRand("");
    setDiscountReason("");
    setIdempotencyKey(newIdempotencyKey());
    setErrorMessage(null);
  }

  const subtotalCents = cart.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const discountCents = Math.round((parseFloat(discountRand || "0") || 0) * 100);
  const deliveryFeeCents = orderMode === "DELIVERY" ? (posSettings?.delivery_fee_cents ?? 0) : 0;
  const estimatedTotalCents = Math.max(0, subtotalCents - discountCents) + deliveryFeeCents;

  async function handleConfirmPayment(payload: {
    payment_method: POSPaymentMethod;
    cash_tendered_cents?: number;
    payment_reference?: string;
  }) {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const body: POSOrderCreateRequest = {
        order_mode: orderMode,
        table_number: orderMode === "DINE_IN" ? (tableNumber.trim() || null) : null,
        customer_name: customerName.trim() || null,
        customer_phone: customerPhone.trim() || null,
        discount_cents: discountCents > 0 ? discountCents : undefined,
        discount_reason: discountCents > 0 ? (discountReason.trim() || null) : null,
        items: cart.map((line) => ({
          menu_item_id: line.menuItemId,
          quantity: line.quantity,
          selected_option_ids: line.selectedOptionIds,
          add_on_selections: line.addOnSelections.map((a) => ({ add_on_id: a.addOnId, quantity: a.quantity })),
          removed_ingredient_ids: line.removedIngredientIds,
          special_instructions: line.specialInstructions,
        })),
        payment_method: payload.payment_method,
        cash_tendered_cents: payload.cash_tendered_cents,
        payment_reference: payload.payment_reference,
        idempotency_key: idempotencyKey,
      };
      const order = await apiClient.post<Order>("/v1/business/pos/orders", body);
      setPaymentOpen(false);
      setMobileCartOpen(false);
      setLastOrder(order);
      resetForNextSale();
      queryClient.invalidateQueries({ queryKey: ["live-orders"] });

      // Print AFTER the sale is safely saved, and never inside the try that
      // guards the sale itself. Payment and printing are separate concerns:
      // an offline printer must not make a paid order look like it failed,
      // or the cashier will ring it up a second time.
      if (posSettings?.receipt_auto_print !== false) {
        try {
          setShowReceipt(true);
          // One frame for the hidden receipt to mount before window.print().
          setTimeout(() => {
            try {
              printCustomerReceipt();
            } catch {
              setPrintFailed(true);
            } finally {
              setShowReceipt(false);
            }
          }, 100);
        } catch {
          setPrintFailed(true);
        }
      }
    } catch (err) {
      const message = (err as { message?: string })?.message ?? "Could not complete the sale — try again";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePrintReceipt() {
    setPrintFailed(false);
    setShowReceipt(true);
    setTimeout(() => {
      try {
        printCustomerReceipt();
      } catch {
        setPrintFailed(true);
      } finally {
        setShowReceipt(false);
      }
    }, 100);
  }

  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const isLoading = loadingCategories || loadingItems;

  const cartPanel = (
    <CartPanel
      lines={cart}
      onUpdateQty={updateQty}
      onRemove={removeLine}
      orderMode={orderMode}
      onOrderModeChange={setOrderMode}
      tableNumber={tableNumber}
      onTableNumberChange={setTableNumber}
      posSettings={posSettings}
      customerName={customerName}
      onCustomerNameChange={setCustomerName}
      customerPhone={customerPhone}
      onCustomerPhoneChange={setCustomerPhone}
      discountRand={discountRand}
      onDiscountRandChange={setDiscountRand}
      discountReason={discountReason}
      onDiscountReasonChange={setDiscountReason}
      tillOpen={tillOpen}
      errorMessage={null}
      onCheckout={() => setPaymentOpen(true)}
    />
  );

  return (
    <div className="min-h-screen bg-background pb-28 md:flex md:h-screen md:flex-col md:pb-0">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm safe-top">
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Till</h1>
            <p className="text-xs text-muted-foreground">
              {tillOpen ? "Tap an item to add it to the order" : "Open the till to start selling"}
            </p>
          </div>
          <button
            onClick={() => setCashupOpen(true)}
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold",
              tillOpen
                ? "bg-secondary text-foreground active:bg-muted"
                : "bg-primary text-primary-foreground shadow-sm active:opacity-90"
            )}
            aria-label={tillOpen ? "Cash-up" : "Open the till"}
          >
            <Wallet className="h-5 w-5" />
            {/* Previously this read "Till closed" — a status, styled like a
                badge, which told staff what was wrong but not that tapping it
                was the fix. It now names the action it performs. */}
            <span>{tillOpen ? "Cash-up" : "Open till"}</span>
          </button>
        </div>

        <div className="px-4 pb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu…"
            className="h-10 w-full rounded-full border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
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

      {/* The till being closed is the single most common reason a sale cannot
          be rung up, and the header button alone was too easy to miss on a
          busy screen. This states the blocker in plain words and carries the
          action that clears it, in the place staff are already looking. */}
      {!tillOpen && (
        <div className="px-4 pt-4">
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <Wallet className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">The till is closed</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Open it with the cash already in the drawer to start selling. Until
                  then, menu items and checkout stay locked.
                </p>
                <button
                  onClick={() => setCashupOpen(true)}
                  className="mt-3 h-11 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground active:opacity-90 sm:w-auto"
                >
                  Open till
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="md:flex md:flex-1 md:overflow-hidden">
        {/* Left: product grid */}
        <div className="px-4 py-4 md:flex-1 md:overflow-y-auto">
          {isLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : itemsError ? (
            <p className="py-8 text-center text-sm text-destructive">Failed to load the menu</p>
          ) : visibleItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No menu items found</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4">
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleTileTap(item)}
                  disabled={!tillOpen}
                  className="flex min-h-[110px] flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-transform active:scale-95 disabled:opacity-50"
                >
                  {item.image_url && (
                    <img
                      src={item.image_url}
                      alt=""
                      className="-mx-3 -mt-3 mb-2 h-16 w-[calc(100%+1.5rem)] object-cover"
                    />
                  )}
                  <span className="text-sm font-semibold text-foreground line-clamp-2">{item.name}</span>
                  <span className="text-sm font-bold text-primary">{formatCurrency(item.price_cents)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: persistent cart panel — desktop/tablet only, always visible */}
        <div className="hidden md:flex md:w-[380px] md:flex-shrink-0 md:flex-col md:border-l md:border-border md:bg-card">
          {cartPanel}
        </div>
      </div>

      {/* Success overlay after a completed sale */}
      {lastOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
            <div className="flex flex-col items-center gap-2 text-center">
              <PartyPopper className="h-10 w-10 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Sale complete</h2>
              <p className="text-sm text-muted-foreground">Order {lastOrder.order_number}</p>
              <p className="text-2xl font-bold text-foreground">{formatCurrency(lastOrder.total_cents)}</p>
              {lastOrder.payment_method === "CASH" && lastOrder.change_due_cents != null && (
                <p className="text-sm text-muted-foreground">
                  Cash received {formatCurrency(lastOrder.cash_tendered_cents)} · Change {formatCurrency(lastOrder.change_due_cents)}
                </p>
              )}
            </div>
            {printFailed && (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-center">
                <p className="text-sm font-semibold text-destructive">Receipt did not print</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The sale is saved and paid. Check the printer, then print again.
                </p>
              </div>
            )}
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={handlePrintReceipt}
                className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-foreground active:bg-muted"
              >
                <Printer className="h-4 w-4" /> Print receipt
              </button>
              <button
                onClick={() => {
                  setPrintFailed(false);
                  setLastOrder(null);
                }}
                className="flex h-12 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground active:bg-primary/90"
              >
                New sale
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer receipt (hidden, only rendered for printing) */}
      {showReceipt && lastOrder && (
        <div className="fixed top-0 left-0 z-[9999]">
          <CustomerReceipt
            order={lastOrder}
            businessName={user?.business_name ?? undefined}
            paperWidthMm={posSettings?.receipt_paper_width_mm ?? 80}
          />
        </div>
      )}

      {/* Mobile: floating cart bar opens a dialog with the same CartPanel */}
      {cart.length > 0 && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="fixed bottom-20 left-4 right-4 z-40 flex items-center justify-between rounded-xl bg-primary px-5 py-4 text-primary-foreground shadow-lg md:hidden"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingBag className="h-5 w-5" />
            {cartCount} item{cartCount !== 1 ? "s" : ""}
          </span>
          <span className="text-base font-bold">{formatCurrency(estimatedTotalCents)}</span>
        </button>
      )}

      <Dialog open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden p-0 md:hidden">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="sr-only">Current order</DialogTitle>
          </DialogHeader>
          <div className="max-h-[85vh] overflow-y-auto">{cartPanel}</div>
        </DialogContent>
      </Dialog>

      <CashupDialog open={cashupOpen} onClose={() => setCashupOpen(false)} />

      <ItemOptionsDialog item={optionsItem} onClose={() => setOptionsItem(null)} onAdd={handleAddFromDialog} />

      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        totalCents={estimatedTotalCents}
        posSettings={posSettings}
        onConfirm={handleConfirmPayment}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
      />
    </div>
  );
}
