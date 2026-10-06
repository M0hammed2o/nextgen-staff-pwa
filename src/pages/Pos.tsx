import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type { ApiFetchError } from "@/lib/api";
import type {
  CartLine, LoyaltyRewardResponse, MenuCategoryEntry, MenuItemEntry, Order, POSOrderCreateRequest, POSPaymentMethod,
  POSSettings, TillSession,
} from "@/types";
import type { ReceiptDocument } from "@/types/receipt";
import { fetchReceiptDocument } from "@/lib/receipts";
import ItemOptionsDialog from "@/components/pos/ItemOptionsDialog";
import CartPanel, { lineTotalCents, type OrderMode } from "@/components/pos/CartPanel";
import { previewLoyaltyDiscountCents } from "@/components/pos/LoyaltyRewardPicker";
import PaymentDialog from "@/components/pos/PaymentDialog";
import CashupDialog from "@/components/pos/CashupDialog";
import CustomerReceipt, { printCustomerReceipt } from "@/components/CustomerReceipt";
import ReceiptSendDialog from "@/components/pos/ReceiptSendDialog";
import EmptyState from "@/components/EmptyState";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useBrand } from "@/lib/brand-provider";
import { RestaurantMark } from "@/components/RestaurantIdentity";
import { ShoppingBag, Printer, Wallet, PartyPopper, Loader2, RefreshCw, MessageCircle } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { loadPosDraft, savePosDraft, clearPosDraft, type PosDraftSubmission } from "@/lib/pos-draft";
import { useTouchField } from "@/hooks/useTouchField";
import { useTouchKeyboardContext, useTouchKeyboardSpacerStyle } from "@/lib/touch-keyboard";
import { useIsLandscapePOS } from "@/hooks/useIsLandscapePOS";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Pos() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Restaurant identity for the header. Falls back to the saved business name
  // and finally to a neutral product name, so an unbranded tenant still gets a
  // deliberate header rather than an empty space.
  const { displayName, branchName } = useBrand();
  const brandName = displayName?.trim() || user?.business_name || "NextGen Restaurant OS";
  const { close: closeTouchKeyboard } = useTouchKeyboardContext();
  // Persistent side-cart (landscape POS terminals) vs mobile-style full-width
  // cart dialog (any portrait viewport, whatever its width) — see
  // src/lib/pos-layout.ts and KNOWN_BUGS.md for why this can't be a bare
  // Tailwind `md:` breakpoint (width alone can't distinguish a portrait
  // tablet from a landscape terminal at the same width).
  const isLandscapePOS = useIsLandscapePOS();
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
  // The cashier's current reward pick, if any — see LoyaltyRewardPicker.tsx
  // for the selection/filtering UI and DRAFT-PERSISTENCE DECISION below for
  // why this is never written to pos-draft.ts.
  const [loyaltyReward, setLoyaltyReward] = useState<LoyaltyRewardResponse | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [receiptDocument, setReceiptDocument] = useState<ReceiptDocument | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [printFailed, setPrintFailed] = useState(false);
  // The post-sale "Print / WhatsApp / Both / No receipt" choice — see
  // ReceiptSendDialog for the actual WhatsApp send/status/retry flow this
  // opens. Tracked only to show a small "no receipt sent" confirmation and
  // to tell ReceiptSendDialog whether a print was ALSO requested (for its
  // "WhatsApp isn't available" copy) — never gates anything security-related.
  const [receiptChoice, setReceiptChoice] = useState<"PRINT" | "WHATSAPP" | "BOTH" | "NONE" | null>(null);
  const [whatsappDialogOpen, setWhatsappDialogOpen] = useState(false);

  // ── Draft persistence + checkout submission state machine ───────────────
  // See src/lib/pos-draft.ts for the full design rationale. Short version:
  // "idle" = cart is freely editable; "in_flight" = a checkout request was
  // sent and its outcome is unknown (reload/timeout/tab-close mid-request) —
  // the cart is frozen and the only allowed action is re-sending the exact
  // same payload under the exact same idempotency key.
  const [submissionState, setSubmissionState] = useState<PosDraftSubmission>({ status: "idle" });
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const didRestoreDraftRef = useRef(false);

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

  // Entitlement only. A `true` here means the module is switched on for this
  // tenant -- it is NOT a claim that a Meta message template has been approved,
  // which only the send attempt can establish and which ReceiptSendDialog
  // reports honestly on its own.
  const whatsappReceiptsAvailable = posSettings?.digital_receipts_enabled === true;

  // Restore a persisted draft exactly once, after the menu has loaded (so we
  // can re-validate cart lines against it). Deliberately per-user (see
  // pos-draft.ts) — a different cashier logging into the same terminal never
  // silently inherits this draft, since loadPosDraft is keyed on user.id too.
  useEffect(() => {
    if (didRestoreDraftRef.current) return;
    if (loadingItems || loadingCategories) return;
    if (!user?.business_id || !user?.id) return;
    didRestoreDraftRef.current = true;

    const draft = loadPosDraft(user.business_id, user.id);
    if (!draft) return;

    const activeItemIds = new Set(items.filter((i) => i.is_active).map((i) => i.id));
    const validLines = draft.cart.filter((line) => activeItemIds.has(line.menuItemId));
    const droppedCount = draft.cart.length - validLines.length;

    setCart(validLines);
    setOrderMode(draft.orderMode);
    setTableNumber(draft.tableNumber);
    setCustomerName(draft.customerName);
    setCustomerPhone(draft.customerPhone);
    setDiscountRand(draft.discountRand);
    setDiscountReason(draft.discountReason);
    setIdempotencyKey(draft.idempotencyKey);
    setSubmissionState(draft.submission);
    // DRAFT-PERSISTENCE DECISION (loyalty reward selection): deliberately
    // NEVER restored — PosDraftV1/PosDraftFields (pos-draft.ts) carries no
    // loyaltyReward field at all, on purpose. A restored draft can be
    // hours old (see DRAFT_MAX_AGE_MS) and the "in progress" pick here is a
    // live UI convenience, not a committed fact about the sale the way the
    // cart/phone/discount are — restoring a stale reward selection risks
    // silently re-attaching a reward to a DIFFERENT set of cart lines (the
    // very hazard this feature's spec calls out), or one the customer's
    // balance can no longer actually afford by the time the till reloads.
    // Safety over convenience: always start unselected and make the
    // cashier re-pick, exactly like a resend from a frozen in-flight
    // payload is the ONLY thing allowed to carry an already-attached
    // reward through a reload (see submissionState.payload, which DOES
    // legitimately embed loyalty_reward_id once a checkout was actually
    // sent — that's a different, already-submitted request, not a live
    // pick).
    setLoyaltyReward(null);

    if (validLines.length > 0 || draft.submission.status === "in_flight") {
      setDraftNotice(
        droppedCount > 0
          ? `Your unfinished order was restored — ${droppedCount} item${droppedCount === 1 ? "" : "s"} removed (no longer on the menu).`
          : "Your unfinished order was restored."
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingItems, loadingCategories, items, user?.business_id, user?.id]);

  // Persist the draft on every relevant change, after restoration has run
  // (never save before restoring, or we'd immediately overwrite the very
  // draft we're about to read). An empty, idle cart has nothing worth
  // persisting, so it clears the draft instead of writing an empty one.
  useEffect(() => {
    if (!didRestoreDraftRef.current) return;
    if (!user?.business_id || !user?.id) return;
    if (cart.length === 0 && submissionState.status === "idle") {
      clearPosDraft(user.business_id, user.id);
      return;
    }
    savePosDraft(user.business_id, user.id, {
      cart, orderMode, tableNumber, customerName, customerPhone,
      discountRand, discountReason, idempotencyKey, submission: submissionState,
    });
  }, [
    cart, orderMode, tableNumber, customerName, customerPhone,
    discountRand, discountReason, idempotencyKey, submissionState,
    user?.business_id, user?.id,
  ]);

  // ── Loyalty reward selection safety — clear on anything that could make
  //    a stale pick apply to the wrong customer/cart/session. Each of these
  //    is one of the consequences this feature's spec explicitly calls
  //    out; "checkout succeeding" is covered by resetForNextSale() below,
  //    "cashier logging out" needs no handling here (this is in-memory
  //    React state that dies with the component on logout/navigation), and
  //    "cart restoration from pos-draft.ts" is covered above (never
  //    restored in the first place). ────────────────────────────────────
  //
  // Customer phone changed (including being cleared, or still mid-typing)
  // — a reward is tied to the specific customer it was checked against;
  // ANY change invalidates that, not just a change to a "different" number.
  useEffect(() => {
    setLoyaltyReward(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerPhone]);

  // Cart emptied (every line removed, or resetForNextSale, which also
  // clears it directly) — a reward must never silently carry over onto
  // whatever gets rung up next.
  useEffect(() => {
    if (cart.length === 0) setLoyaltyReward(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.length]);

  // Till session changed (closed and a new one opened) — a reward checked
  // against one till session's context must not silently ride into another.
  useEffect(() => {
    setLoyaltyReward(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [till?.id]);

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
    // The mobile cart dialog only renders when the persistent side-cart
    // panel isn't shown (see isLandscapePOS above) — opening it while the
    // side panel IS shown rendered a full-screen dialog overlay with
    // nothing visible inside it, and the very next tap anywhere just
    // dismissed that blank overlay instead of reaching whatever the
    // cashier meant to tap.
    if (!isLandscapePOS) setMobileCartOpen(true);
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
    setLoyaltyReward(null);
    setIdempotencyKey(newIdempotencyKey());
    setErrorMessage(null);
    setSubmissionState({ status: "idle" });
    setDraftNotice(null);
    setRecoveryError(null);
    if (user?.business_id && user?.id) clearPosDraft(user.business_id, user.id);
  }

  const subtotalCents = cart.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const discountCents = Math.round((parseFloat(discountRand || "0") || 0) * 100);
  // PREVIEW ONLY — see LoyaltyRewardPicker.tsx's docstring. Computed with
  // the exact same clamp formula the backend uses, purely so the cashier
  // isn't flying blind before Pay; the committed order's own
  // loyalty_discount_cents (from the backend response) is the only real
  // figure this app ever prints on a receipt or "Sale complete" screen.
  const loyaltyDiscountPreviewCents = previewLoyaltyDiscountCents(loyaltyReward, subtotalCents, discountCents);
  const deliveryFeeCents = orderMode === "DELIVERY" ? (posSettings?.delivery_fee_cents ?? 0) : 0;
  const estimatedTotalCents = Math.max(0, subtotalCents - discountCents - loyaltyDiscountPreviewCents) + deliveryFeeCents;

  // Fetches the backend's authoritative receipt document for a just-placed
  // order and prints THAT — never a locally-rebuilt slip (see BUG-0045).
  // The sale itself is already safely saved by the time this runs (it is
  // only ever called from finishSuccessfulSale, strictly after the order
  // was created and the draft/idempotency state was cleared) — a failure
  // here can NEVER cause a second POST to /pos/orders, only a "receipt
  // didn't print" banner with a retry that re-fetches, never re-submits.
  async function printReceiptForOrder(orderId: string) {
    try {
      const doc = await fetchReceiptDocument(orderId);
      setReceiptDocument(doc);
      setPrintFailed(false);
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

  // Shared by both a normal checkout success and the recovery flow (a
  // same-key resend after an "outcome unknown" submission) — one place that
  // decides what "the sale is definitely done" means, so the two call sites
  // can never drift apart on print/reset behaviour.
  function finishSuccessfulSale(order: Order) {
    setPaymentOpen(false);
    setMobileCartOpen(false);
    setLastOrder(order);
    setReceiptChoice(null);
    setWhatsappDialogOpen(false);
    resetForNextSale();
    // Don't wait for PaymentDialog's close animation to unmount the cash
    // field (that's what used to leave the keyboard open, covering the
    // "Sale complete" overlay's "New sale" button for the duration of the
    // transition) — close it the instant the sale is known to have
    // succeeded.
    closeTouchKeyboard();
    queryClient.invalidateQueries({ queryKey: ["live-orders"] });

    // Print AFTER the sale is safely saved, and never inside the try that
    // guards the sale itself. Payment and printing are separate concerns:
    // an offline printer (or a receipt fetch that times out) must not make
    // a paid order look like it failed, or the cashier will ring it up a
    // second time.
    if (posSettings?.receipt_auto_print !== false) {
      void printReceiptForOrder(order.id);
    }
  }

  async function handleConfirmPayment(payload: {
    payment_method: POSPaymentMethod;
    cash_tendered_cents?: number;
    payment_reference?: string;
  }) {
    setIsSubmitting(true);
    setErrorMessage(null);
    const body: POSOrderCreateRequest = {
      order_mode: orderMode,
      table_number: orderMode === "DINE_IN" ? (tableNumber.trim() || null) : null,
      customer_name: customerName.trim() || null,
      customer_phone: customerPhone.trim() || null,
      discount_cents: discountCents > 0 ? discountCents : undefined,
      discount_reason: discountCents > 0 ? (discountReason.trim() || null) : null,
      // The backend requires customer_phone whenever this is set
      // (routes_pos.py::POSOrderCreateRequest.validate_loyalty_redemption)
      // — loyaltyReward is already cleared the instant customerPhone
      // changes (see the effects above), but this guard is cheap insurance
      // against ever sending a redemption with no phone attached.
      loyalty_reward_id: loyaltyReward && customerPhone.trim() ? loyaltyReward.id : undefined,
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
    // Freeze this exact payload + key as "in flight" BEFORE sending. If the
    // response never comes back (timeout, reload, tab close) this is what
    // lets a later reload recover safely — resending the SAME payload under
    // the SAME key, never a fresh one, since the backend returns the
    // original order for a repeated key.
    setSubmissionState({ status: "in_flight", payload: body, idempotencyKey, startedAt: Date.now() });
    try {
      const order = await apiClient.post<Order>("/v1/business/pos/orders", body);
      finishSuccessfulSale(order);
    } catch (err) {
      const apiErr = err as ApiFetchError;
      if (apiErr?.noResponse) {
        // Outcome unknown — do NOT clear the in-flight state (it's already
        // persisted). Close the payment dialog and let the blocking recovery
        // card (rendered below, driven by submissionState) take over instead
        // of showing a normal "failed" error — we do not yet know that.
        setPaymentOpen(false);
      } else {
        // A real HTTP response came back rejecting the order (validation,
        // till closed, etc.) — the backend's idempotency check runs before
        // any of that, so no order exists under this key. Safe to go back to
        // idle and let the cashier fix the cart and retry with the same key.
        setSubmissionState({ status: "idle" });
        setErrorMessage(apiErr?.message ?? "Could not complete the sale — try again");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // Recovery: resend the EXACT payload/key an unknown-outcome submission was
  // sent with. Manual, single-shot per click — never an automatic retry
  // loop. Safe regardless of what actually happened last time: the backend
  // returns the original order if it was created, or creates it now for the
  // first time if it wasn't — never a duplicate.
  async function handleRecoverySubmit() {
    if (submissionState.status !== "in_flight") return;
    setRecoverySubmitting(true);
    setRecoveryError(null);
    try {
      const order = await apiClient.post<Order>("/v1/business/pos/orders", submissionState.payload);
      finishSuccessfulSale(order);
    } catch (err) {
      const apiErr = err as ApiFetchError;
      if (apiErr?.noResponse) {
        // Still don't know — stay in_flight, let the cashier try again.
        setRecoveryError("Still couldn't reach the server. Check the connection and try again.");
      } else {
        // A definite rejection this time proves no order exists under this
        // key (the idempotency check runs first, before this rejection could
        // have happened) — safe to unfreeze the cart.
        setSubmissionState({ status: "idle" });
        setRecoveryError(apiErr?.message ?? "That sale could not be completed. Check the details and try again.");
      }
    } finally {
      setRecoverySubmitting(false);
    }
  }

  // Manual "Print receipt" / retry button in the success overlay — always
  // re-fetches the document rather than reusing a stale one, and never
  // touches the order/checkout endpoint.
  function handlePrintReceipt() {
    if (!lastOrder) return;
    void printReceiptForOrder(lastOrder.id);
  }

  // The post-sale receipt step: Print/Both trigger the EXISTING print flow
  // above (never re-implemented here); WhatsApp/Both open ReceiptSendDialog
  // for the actual send/status/retry. "No receipt" makes no call at all —
  // it only records the choice so the cashier gets a small confirmation
  // that nothing was sent, it never auto-dismisses "Sale complete" (the
  // order total/change info there may still be worth a glance).
  function handleReceiptChoice(choice: "PRINT" | "WHATSAPP" | "BOTH" | "NONE") {
    setReceiptChoice(choice);
    if (choice === "PRINT" || choice === "BOTH") {
      handlePrintReceipt();
    }
    if (choice === "WHATSAPP" || choice === "BOTH") {
      setWhatsappDialogOpen(true);
    }
  }

  const searchTouch = useTouchField({ value: search, onChange: setSearch, layout: "QWERTY" });
  const mobileCartKeyboardSpacer = useTouchKeyboardSpacerStyle();

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
      loyaltyReward={loyaltyReward}
      onLoyaltyRewardChange={setLoyaltyReward}
      tillOpen={tillOpen}
      errorMessage={null}
      onCheckout={() => setPaymentOpen(true)}
    />
  );

  return (
    // The persistent-side-cart layout (isLandscapePOS) drives this
    // container's shrink-by-the-on-screen-keyboard height (0px when closed,
    // via the --touch-keyboard-height CSS var TouchKeyboard.tsx sets) so the
    // panel's checkout button and order total are pushed up above the
    // keyboard instead of being covered by it. This used to be a bare
    // Tailwind `md:` breakpoint (width-only) — now driven by
    // useIsLandscapePOS() instead, since a portrait tablet can share a
    // width with a landscape terminal but needs the OTHER (mobile-style)
    // layout entirely, not just a narrower cart (see KNOWN_BUGS.md).
    // The `min-h-0` override is load-bearing whenever isLandscapePOS is
    // true: the base `min-h-screen` (needed for the normally-scrolling
    // mobile-style layout) sets a min-height of 100vh, which previously
    // silently WON over the explicit `h-[...]` rule below whenever the
    // keyboard was open (min-height always wins over a smaller explicit
    // height) — the container never actually shrank, so content stayed
    // exactly as tall as the keyboard covered.
    // `pb-[var(--bottom-nav-height,0px)]` reserves real, measured space
    // (BottomNav.tsx) for the always-`fixed` bottom nav in this layout too —
    // reserving none at all left only a ~5px sliver of the Checkout button
    // tappable above the nav at 1366x768/1024x768.
    <div
      className={cn(
        "min-h-screen bg-background pb-28",
        isLandscapePOS && "min-h-0 flex h-[calc(100vh-var(--touch-keyboard-height,0px))] flex-col pb-[var(--bottom-nav-height,0px)]"
      )}
    >
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm safe-top">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          {/* The restaurant leads, the screen name follows: a cashier should
              see whose till this is, not which SaaS product it belongs to.
              RestaurantMark degrades logo -> monogram -> neutral, so an
              unbranded tenant still gets a deliberate header. The <h1>"Till"
              is kept as a sibling rather than replaced -- it is the screen's
              accessible name and existing specs locate the page by it. */}
          <div className="flex min-w-0 items-center gap-3">
            <RestaurantMark size="md" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-semibold leading-tight text-foreground">
                  {brandName}
                </span>
                {branchName ? (
                  <span className="shrink-0 text-xs text-muted-foreground">{branchName}</span>
                ) : null}
              </div>
              {/* sr-only, NOT hidden, below sm. `hidden` sets display:none,
                  which removes the screen's accessible name from the
                  accessibility tree entirely -- on exactly the devices most
                  likely to be driven by a screen reader. This keeps the
                  heading announced at every size while giving the phone its
                  vertical space back. */}
              <h1 className="sr-only text-lg font-semibold leading-tight tracking-tight text-foreground sm:not-sr-only sm:block">
                Till
              </h1>
              <p className="hidden text-xs text-muted-foreground sm:block">
                {tillOpen ? "Tap an item to add it to the order" : "Open the till to start selling"}
              </p>
              {/* Phone: the till state still has to be visible, but as one
                  short line rather than a heading plus a hint. */}
              {!tillOpen && (
                <p className="text-xs font-medium text-warning sm:hidden">Till closed</p>
              )}
            </div>
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
            {/* Phone: the icon plus the aria-label carry the meaning, and the
                label would otherwise wrap to two lines and push the menu grid
                down. The accessible name is unchanged at every size. */}
            <span className="hidden sm:inline">{tillOpen ? "Cash-up" : "Open till"}</span>
          </button>
        </div>

        <div className="px-4 pb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu…"
            className="h-11 w-full rounded-full border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            {...searchTouch.fieldProps}
          />
        </div>

        {categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3">
            <button
              onClick={() => setActiveCategory("ALL")}
              className={cn(
                "flex-shrink-0 rounded-full px-4 py-2.5 min-h-[44px] text-sm font-medium transition-colors",
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
                  "flex-shrink-0 rounded-full px-4 py-2.5 min-h-[44px] text-sm font-medium transition-colors",
                  activeCategory === cat.id ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Told inline, not silently — a cashier who reopens the till after a
          reload/relogin needs to know this cart isn't the one they left with
          moments ago, since it was restored from local storage rather than
          freshly built. Dismissable: it's informational, not a blocker. */}
      {draftNotice && submissionState.status !== "in_flight" && (
        <div className="px-4 pt-4">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm text-foreground">{draftNotice}</p>
            <button
              onClick={() => setDraftNotice(null)}
              className="flex-shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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

      <div className={cn(isLandscapePOS && "flex flex-1 overflow-hidden")}>
        {/* Left: product grid */}
        <div className={cn("px-4 py-4", isLandscapePOS && "flex-1 overflow-y-auto")}>
          {isLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : itemsError ? (
            <p className="py-8 text-center text-sm text-destructive">Failed to load the menu</p>
          ) : visibleItems.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="No menu items found"
              description={search.trim() ? "Try a different search" : "Add items to the menu from the Manager Dashboard"}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleTileTap(item)}
                  disabled={!tillOpen}
                  className="flex min-h-[84px] flex-col justify-between gap-1 overflow-hidden rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-all duration-fast hover:border-brand-border hover:shadow-md active:scale-[0.97] disabled:opacity-50 sm:min-h-[104px]"
                >
                  {item.image_url && (
                    <img
                      src={item.image_url}
                      alt=""
                      className="-mx-3 -mt-3 mb-2 h-16 w-[calc(100%+1.5rem)] object-cover"
                    />
                  )}
                  <span className="text-sm font-semibold leading-snug text-foreground line-clamp-2">{item.name}</span>
                  <span className="flex items-baseline justify-between gap-1">
                    <span className="text-sm font-bold tabular-nums text-brand">{formatCurrency(item.price_cents)}</span>
                    {itemHasChoices(item) && (
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Options
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: persistent cart panel — landscape POS layout only (see
            isLandscapePOS above); a portrait viewport of any width gets the
            mobile-style dialog cart below instead. */}
        {isLandscapePOS && (
          <div className="flex w-[380px] flex-shrink-0 flex-col border-l border-border bg-card">
            {cartPanel}
          </div>
        )}
      </div>

      {/* Blocking recovery overlay — shown whenever a checkout request's
          outcome is unknown (timeout, reload/relogin mid-request, tab
          closed). The cart is frozen: the only way out is checking with the
          server, using the exact same order and idempotency key that was
          already sent, never a fresh one. See handleRecoverySubmit(). */}
      {submissionState.status === "in_flight" && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
            <div className="flex flex-col items-center gap-2 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <h2 className="text-lg font-bold text-foreground">Checking your last sale…</h2>
              <p className="text-sm text-muted-foreground">
                The last checkout didn't get a clear response from the server — it may
                have gone through, or it may not have. We'll check using the exact same
                order, so it's safe to press this even if it already succeeded.
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {cartCount} item{cartCount !== 1 ? "s" : ""} · {formatCurrency(estimatedTotalCents)}
              </p>
            </div>
            {recoveryError && (
              <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
                {recoveryError}
              </p>
            )}
            <button
              onClick={handleRecoverySubmit}
              disabled={recoverySubmitting}
              className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
            >
              {recoverySubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" /> Check now
                </>
              )}
            </button>
          </div>
        </div>
      )}

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
              {/* Sourced ONLY from the backend's own committed order — never
                  recomputed locally. This is the real, applied redemption,
                  not the pre-checkout preview shown earlier in CartPanel/
                  PaymentDialog. */}
              {lastOrder.loyalty_reward_id && (
                <p className="text-sm text-muted-foreground">
                  {lastOrder.loyalty_reward_name ?? "Reward"} redeemed · -{formatCurrency(lastOrder.loyalty_discount_cents ?? 0)}
                  {lastOrder.loyalty_points_redeemed ? ` · ${lastOrder.loyalty_points_redeemed} pts` : ""}
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
            {/* Receipt step: an explicit choice rather than a silent print —
                Print/Both reuse the exact same print flow as the old
                single "Print receipt" button above (still the only thing
                that ever touches the printer); WhatsApp/Both open
                ReceiptSendDialog. Auto-print (posSettings.receipt_auto_print,
                unchanged, above in finishSuccessfulSale) already ran before
                this renders — tapping Print/Both again here is a deliberate
                reprint/retry, same as before. */}
            <div className="mt-5 space-y-2">
              <p className="text-center text-xs font-medium text-muted-foreground">Receipt</p>
              {/* Truthful availability, surfaced BEFORE the cashier taps --
                  but the choice is LABELLED, never removed.
                  
                  An earlier version of this disabled WhatsApp/Both when the
                  tenant lacked the entitlement. That broke a deliberate
                  Commercial V1 contract: all four choices are offered, and an
                  unentitled send is reported honestly as NOT_REQUESTED rather
                  than refused (spec 14-D4b exists precisely to test that, and
                  spec 13-D1b asserts all four are present). Disabling the
                  option removed a path the product had deliberately kept open.
                  
                  So the annotation stays and the disabling goes: the cashier
                  learns the module is off before tapping, and the existing,
                  already-honest NOT_REQUESTED path remains available. This
                  reflects the tenant's ENTITLEMENT only -- it is not a claim
                  about Meta template approval, which only the send can
                  establish. */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleReceiptChoice("PRINT")}
                  className="flex h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground shadow-sm transition-colors duration-fast hover:border-brand-border hover:bg-brand-soft active:bg-muted"
                >
                  <Printer className="h-5 w-5" /> Print
                </button>
                <button
                  type="button"
                  onClick={() => handleReceiptChoice("WHATSAPP")}
                  title={whatsappReceiptsAvailable ? undefined : "WhatsApp receipts are not enabled for this restaurant"}
                  className="flex h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground shadow-sm transition-colors duration-fast hover:border-brand-border hover:bg-brand-soft active:bg-muted"
                >
                  {/* Nothing but the icon and the word may live inside this
                      button. An earlier version nested a "Not enabled" caption
                      here, which made the button's text content
                      "WhatsAppNot enabled" -- changing its ACCESSIBLE NAME and
                      breaking spec 13-D1b, which enumerates the four receipt
                      choices by name. The unavailability message belongs to
                      the explanatory line below the grid, where it already is. */}
                  <MessageCircle className="h-5 w-5" /> WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => handleReceiptChoice("BOTH")}
                  title={whatsappReceiptsAvailable ? undefined : "WhatsApp receipts are not enabled for this restaurant"}
                  className="flex h-12 items-center justify-center rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors duration-fast hover:bg-muted active:bg-muted"
                >
                  Both
                </button>
                <button
                  type="button"
                  onClick={() => handleReceiptChoice("NONE")}
                  className="flex h-12 items-center justify-center rounded-xl border border-border bg-card text-sm font-medium text-muted-foreground transition-colors duration-fast hover:bg-muted active:bg-muted"
                >
                  No receipt
                </button>
              </div>
              {!whatsappReceiptsAvailable && (
                <p className="text-center text-xs text-muted-foreground">
                  WhatsApp receipts aren&apos;t enabled for this restaurant. Printing still works.
                </p>
              )}
              {receiptChoice === "NONE" && (
                <p className="text-center text-xs text-muted-foreground">No receipt will be sent.</p>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={() => {
                  setPrintFailed(false);
                  setLastOrder(null);
                  setReceiptChoice(null);
                  setWhatsappDialogOpen(false);
                }}
                className="flex h-12 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground active:bg-primary/90"
              >
                New sale
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer receipt (hidden, only rendered for printing) — built from
          the backend's own receipt document, never from local order state. */}
      {showReceipt && receiptDocument && (
        <div className="fixed top-0 left-0 z-[9999]">
          <CustomerReceipt document={receiptDocument} />
        </div>
      )}

      {/* Mobile-style layout (any portrait viewport — see isLandscapePOS
          above): floating cart bar opens a dialog with the same CartPanel */}
      {!isLandscapePOS && cart.length > 0 && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="fixed bottom-20 left-4 right-4 z-40 flex items-center justify-between rounded-xl bg-primary px-5 py-4 text-primary-foreground shadow-lg"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingBag className="h-5 w-5" />
            {cartCount} item{cartCount !== 1 ? "s" : ""}
          </span>
          <span className="text-base font-bold">{formatCurrency(estimatedTotalCents)}</span>
        </button>
      )}

      <Dialog open={!isLandscapePOS && mobileCartOpen} onOpenChange={setMobileCartOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="sr-only">Current order</DialogTitle>
          </DialogHeader>
          <div className="max-h-[85vh] overflow-y-auto" style={mobileCartKeyboardSpacer}>{cartPanel}</div>
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
        loyaltyRewardPreview={
          loyaltyReward ? { name: loyaltyReward.name, discountCents: loyaltyDiscountPreviewCents } : null
        }
      />

      {lastOrder && (
        <ReceiptSendDialog
          open={whatsappDialogOpen}
          onClose={() => setWhatsappDialogOpen(false)}
          orderId={lastOrder.id}
          prefillPhone={lastOrder.phone_number}
          forceResend={false}
          printAlsoRequested={receiptChoice === "BOTH"}
        />
      )}
    </div>
  );
}
